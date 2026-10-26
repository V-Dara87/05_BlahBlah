use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Clone, serde::Serialize)]
pub struct FfmpegProgressEvent {
    pub session_id: String,
    pub line: String,
    pub key: Option<String>,
    pub value: Option<String>,
}

/// Cap for captured stdout / stderr of sidecar processes. Only the tail is
/// kept, so a chatty process cannot grow memory without bound.
const OUTPUT_CAP_BYTES: usize = 1024 * 1024;

fn push_capped(buf: &mut Vec<u8>, bytes: &[u8]) {
    buf.extend_from_slice(bytes);
    buf.push(b'\n');
    if buf.len() > OUTPUT_CAP_BYTES {
        let excess = buf.len() - OUTPUT_CAP_BYTES;
        buf.drain(..excess);
    }
}

/// Running sidecar children by session id, so they can be cancelled.
static RUNNING_PROCESSES: std::sync::Mutex<Option<HashMap<String, CommandChild>>> =
    std::sync::Mutex::new(None);

fn register_process(sess_id: &str, child: CommandChild) {
    if sess_id.is_empty() {
        return;
    }
    if let Ok(mut lock) = RUNNING_PROCESSES.lock() {
        lock.get_or_insert_with(HashMap::new)
            .insert(sess_id.to_string(), child);
    }
}

/// Removes the child from the registry. Returns true when it was still
/// registered (i.e. it was NOT cancelled in the meantime).
fn unregister_process(sess_id: &str) -> bool {
    if sess_id.is_empty() {
        return true;
    }
    match RUNNING_PROCESSES.lock() {
        Ok(mut lock) => lock
            .as_mut()
            .map_or(false, |map| map.remove(sess_id).is_some()),
        Err(_) => true,
    }
}

#[tauri::command]
fn cancel_process(session_id: String) -> bool {
    let child = RUNNING_PROCESSES
        .lock()
        .ok()
        .and_then(|mut lock| lock.as_mut().and_then(|map| map.remove(&session_id)));
    match child {
        Some(child) => child.kill().is_ok(),
        None => false,
    }
}

#[tauri::command]
async fn ffmpeg_version(app: tauri::AppHandle) -> Result<String, String> {
    let sidecar_command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Failed to configure ffmpeg sidecar: {e}"))?;

    let output = sidecar_command
        .args(["-version"])
        .output()
        .await
        .map_err(|e| format!("Failed to execute ffmpeg sidecar (-version): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "ffmpeg -version exited with code {:?}: {}",
            output.status.code(),
            if !stderr.is_empty() { stderr } else { stdout }
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next().unwrap_or("").trim().to_string();
    if first_line.is_empty() {
        return Err("ffmpeg -version returned empty output".to_string());
    }

    Ok(first_line)
}

#[tauri::command]
async fn run_ffmpeg(
    app: tauri::AppHandle,
    args: Vec<String>,
    session_id: Option<String>,
) -> Result<String, String> {
    let sess_id = session_id.unwrap_or_default();

    let sidecar_command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Failed to configure ffmpeg sidecar: {e}"))?;

    let (mut rx, child) = sidecar_command
        .args(args)
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg sidecar: {e}"))?;
    register_process(&sess_id, child);

    let mut stdout_accum = Vec::new();
    let mut stderr_accum = Vec::new();
    let mut exit_code = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line_bytes) => {
                let line_str = String::from_utf8_lossy(&line_bytes).to_string();
                let (key, value) = if let Some((k, v)) = line_str.split_once('=') {
                    (Some(k.trim().to_string()), Some(v.trim().to_string()))
                } else {
                    (None, None)
                };

                let _ = app.emit(
                    "ffmpeg-progress",
                    FfmpegProgressEvent {
                        session_id: sess_id.clone(),
                        line: line_str,
                        key,
                        value,
                    },
                );

                push_capped(&mut stdout_accum, &line_bytes);
            }
            CommandEvent::Stderr(line_bytes) => {
                push_capped(&mut stderr_accum, &line_bytes);
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
            }
            CommandEvent::Error(err) => {
                unregister_process(&sess_id);
                return Err(format!("ffmpeg process error: {err}"));
            }
            _ => {}
        }
    }

    if !unregister_process(&sess_id) {
        return Err("ffmpeg process cancelled by user".to_string());
    }

    let stdout = String::from_utf8_lossy(&stdout_accum).to_string();
    let stderr = String::from_utf8_lossy(&stderr_accum).to_string();

    if exit_code != Some(0) {
        return Err(format!(
            "ffmpeg process exited with code {:?}: {}",
            exit_code,
            if !stderr.is_empty() { stderr } else { stdout }
        ));
    }

    if stdout.trim().is_empty() && !stderr.trim().is_empty() {
        Ok(stderr)
    } else {
        Ok(stdout)
    }
}

#[derive(Clone, serde::Serialize)]
pub struct WhisperProgressEvent {
    pub session_id: String,
    pub line: String,
}

#[tauri::command]
async fn whisper_version(app: tauri::AppHandle) -> Result<String, String> {
    let sidecar_command = app
        .shell()
        .sidecar("whisper-cli")
        .map_err(|e| format!("Failed to configure whisper-cli sidecar: {e}"))?;

    let output = sidecar_command
        .args(["--version"])
        .output()
        .await
        .map_err(|e| format!("Failed to execute whisper-cli sidecar (--version): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "whisper-cli --version exited with code {:?}: {}",
            output.status.code(),
            if !stderr.is_empty() { stderr } else { stdout }
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next().unwrap_or("").trim().to_string();
    if first_line.is_empty() {
        return Err("whisper-cli --version returned empty output".to_string());
    }

    Ok(first_line)
}

#[tauri::command]
async fn run_whisper(
    app: tauri::AppHandle,
    args: Vec<String>,
    session_id: Option<String>,
) -> Result<String, String> {
    let sess_id = session_id.unwrap_or_default();

    let sidecar_command = app
        .shell()
        .sidecar("whisper-cli")
        .map_err(|e| format!("Failed to configure whisper-cli sidecar: {e}"))?;

    let (mut rx, child) = sidecar_command
        .args(args)
        .spawn()
        .map_err(|e| format!("Failed to spawn whisper-cli sidecar: {e}"))?;
    register_process(&sess_id, child);

    let mut stdout_accum = Vec::new();
    let mut stderr_accum = Vec::new();
    let mut exit_code = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line_bytes) => {
                let line_str = String::from_utf8_lossy(&line_bytes).to_string();
                let _ = app.emit(
                    "whisper-progress",
                    WhisperProgressEvent {
                        session_id: sess_id.clone(),
                        line: line_str,
                    },
                );
                push_capped(&mut stdout_accum, &line_bytes);
            }
            CommandEvent::Stderr(line_bytes) => {
                let line_str = String::from_utf8_lossy(&line_bytes).to_string();
                let _ = app.emit(
                    "whisper-progress",
                    WhisperProgressEvent {
                        session_id: sess_id.clone(),
                        line: line_str,
                    },
                );
                push_capped(&mut stderr_accum, &line_bytes);
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
            }
            CommandEvent::Error(err) => {
                unregister_process(&sess_id);
                return Err(format!("whisper process error: {err}"));
            }
            _ => {}
        }
    }

    if !unregister_process(&sess_id) {
        return Err("whisper process cancelled by user".to_string());
    }

    let stdout = String::from_utf8_lossy(&stdout_accum).to_string();
    let stderr = String::from_utf8_lossy(&stderr_accum).to_string();

    if exit_code != Some(0) {
        return Err(format!(
            "whisper process exited with code {:?}: {}",
            exit_code,
            if !stderr.is_empty() { stderr } else { stdout }
        ));
    }

    if stdout.trim().is_empty() && !stderr.trim().is_empty() {
        Ok(stderr)
    } else {
        Ok(stdout)
    }
}

#[derive(Clone, serde::Serialize)]
pub struct PackageDownloadProgressEvent {
    pub session_id: String,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<f64>,
}

static CANCELLED_DOWNLOADS: std::sync::Mutex<Option<std::collections::HashSet<String>>> =
    std::sync::Mutex::new(None);

fn is_download_cancelled(sess_id: &str) -> bool {
    if sess_id.is_empty() {
        return false;
    }
    let lock = CANCELLED_DOWNLOADS.lock().unwrap();
    lock.as_ref().map_or(false, |set| set.contains(sess_id))
}

#[tauri::command]
fn cancel_download(session_id: String) {
    let mut lock = CANCELLED_DOWNLOADS.lock().unwrap();
    if lock.is_none() {
        *lock = Some(std::collections::HashSet::new());
    }
    if let Some(set) = lock.as_mut() {
        set.insert(session_id);
    }
}

/// Max time to wait for the server's response headers.
const DOWNLOAD_CONNECT_TIMEOUT_SECS: u64 = 30;
/// Max time to wait for the next chunk before the download is considered stalled.
const DOWNLOAD_STALL_TIMEOUT_SECS: u64 = 60;

fn clear_download_cancel(sess_id: &str) {
    if sess_id.is_empty() {
        return;
    }
    if let Ok(mut lock) = CANCELLED_DOWNLOADS.lock() {
        if let Some(set) = lock.as_mut() {
            set.remove(sess_id);
        }
    }
}

#[tauri::command]
async fn download_package(
    app: tauri::AppHandle,
    url: String,
    dest_path: String,
    session_id: Option<String>,
    expected_sha256: Option<String>,
) -> Result<u64, String> {
    use futures_util::StreamExt;
    use sha2::{Digest, Sha256};
    use std::time::Duration;
    use tokio::io::AsyncWriteExt;

    let sess_id = session_id.unwrap_or_default();

    // A hash is mandatory: never keep a file we cannot verify.
    let expected = expected_sha256
        .map(|h| h.trim().to_ascii_lowercase())
        .filter(|h| !h.is_empty())
        .ok_or_else(|| "Refusing to download a package without a SHA-256 hash.".to_string())?;

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(DOWNLOAD_CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = tokio::time::timeout(
        Duration::from_secs(DOWNLOAD_CONNECT_TIMEOUT_SECS * 2),
        client.get(&url).send(),
    )
    .await
    .map_err(|_| "Request timed out".to_string())?
    .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with HTTP status: {}", response.status()));
    }

    let total_bytes = response.content_length();
    let dest = std::path::PathBuf::from(&dest_path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create destination directory: {e}"))?;
    }

    let tmp_dest = dest.with_extension(format!(
        "{}.download.tmp",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    let result: Result<u64, String> = async {
        let mut file = tokio::fs::File::create(&tmp_dest)
            .await
            .map_err(|e| format!("Failed to create temporary download file: {e}"))?;

        let mut hasher = Sha256::new();
        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now();

        loop {
            if is_download_cancelled(&sess_id) {
                return Err("Download cancelled by user".to_string());
            }

            let next = tokio::time::timeout(
                Duration::from_secs(DOWNLOAD_STALL_TIMEOUT_SECS),
                stream.next(),
            )
            .await
            .map_err(|_| "Download stalled (no data received)".to_string())?;

            let Some(chunk_result) = next else { break };
            let chunk = chunk_result.map_err(|e| format!("Error reading download stream: {e}"))?;
            hasher.update(&chunk);
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Error writing chunk to file: {e}"))?;
            downloaded += chunk.len() as u64;

            if last_emit.elapsed().as_millis() >= 100 || downloaded == total_bytes.unwrap_or(0) {
                last_emit = std::time::Instant::now();
                let percent = total_bytes.map(|total| {
                    if total > 0 {
                        (downloaded as f64 / total as f64) * 100.0
                    } else {
                        0.0
                    }
                });
                let _ = app.emit(
                    "package-download-progress",
                    PackageDownloadProgressEvent {
                        session_id: sess_id.clone(),
                        bytes_downloaded: downloaded,
                        total_bytes,
                        percent,
                    },
                );
            }
        }

        file.flush()
            .await
            .map_err(|e| format!("Error flushing downloaded file: {e}"))?;
        drop(file);

        // Verify BEFORE the file is moved to its final path.
        let actual = format!("{:x}", hasher.finalize());
        if actual != expected {
            return Err(
                "SHA-256 verification failed: the downloaded file was corrupted or tampered with."
                    .to_string(),
            );
        }

        Ok(downloaded)
    }
    .await;

    clear_download_cancel(&sess_id);

    let downloaded = match result {
        Ok(n) => n,
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp_dest).await;
            return Err(e);
        }
    };

    if tokio::fs::rename(&tmp_dest, &dest).await.is_err() {
        // Windows cannot rename over an existing file.
        if dest.exists() {
            let _ = tokio::fs::remove_file(&dest).await;
        }
        if let Err(e) = tokio::fs::rename(&tmp_dest, &dest).await {
            let _ = tokio::fs::remove_file(&tmp_dest).await;
            return Err(format!("Failed to finalize downloaded file: {e}"));
        }
    }

    Ok(downloaded)
}

#[tauri::command]
async fn verify_sha256(
    file_path: String,
    expected_hash: String,
) -> Result<bool, String> {
    use sha2::{Sha256, Digest};
    use tokio::io::AsyncReadExt;

    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {file_path}"));
    }

    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("Failed to open file for hashing: {e}"))?;

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let n = file
            .read(&mut buffer)
            .await
            .map_err(|e| format!("Failed to read file for hashing: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    let result = hasher.finalize();
    let hash_hex = format!("{:x}", result);

    Ok(hash_hex.eq_ignore_ascii_case(expected_hash.trim()))
}

#[tauri::command]
async fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

/// Sequence for pop-out window labels — a window label must be unique for the
/// lifetime of the process.
static POPOUT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// How long a pop-out window gets to close itself before it is destroyed
/// anyway. See `create_popout_window`.
const POPOUT_CLOSE_GRACE_MS: u64 = 500;

/// Build the main editor window.
///
/// It is declared in `tauri.conf.json` with `"create": false` so that it can be
/// built here instead: `on_new_window` is a builder method, and its webview is
/// the one that needs it. Without a new-window handler wry denies every
/// `window.open` (see `create_popout_window`).
fn create_main_window(app: &tauri::AppHandle) -> tauri::Result<WebviewWindow> {
  let config = app
    .config()
    .app
    .windows
    .first()
    .cloned()
    .expect("tauri.conf.json must declare the main window");

  // `on_new_window` is `'static`, so it needs an owned handle of its own.
  let handler_app = app.clone();
  WebviewWindowBuilder::from_config(app, &config)?
    .on_new_window(move |url, features| {
      create_popout_window(&handler_app, url, features)
        .map(|window| NewWindowResponse::Create { window })
        .unwrap_or(NewWindowResponse::Deny)
    })
    .build()
}

/// Name the window for a pop-out request.
///
/// The pop-out URL carries the dockview group id (`/popout.html?groupId=…`, see
/// `src/dock/popoutGroup.js`), which makes the label a pure function of the
/// group: the app can then find a group's window again through
/// `WebviewWindow.getByLabel` and close it, including the one window it could
/// otherwise never reach — a window the page never adopted because dockview
/// treated the request as blocked. The sanitising rule has to match the JS side
/// exactly, or the label the app looks for is not the label the window got.
fn popout_label(app: &tauri::AppHandle, url: &Url) -> String {
  let group_id = url
    .query_pairs()
    .find(|(key, _)| key == "groupId")
    .map(|(_, value)| value.into_owned())
    .unwrap_or_default();

  let safe: String = group_id
    .chars()
    .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
    .collect();

  if safe.is_empty() {
    return format!("popout-{}", POPOUT_SEQUENCE.fetch_add(1, Ordering::Relaxed));
  }

  let label = format!("popout-{safe}");
  // A window with this label is on its way out but not gone yet; a duplicate
  // label would make the new window fail to build.
  if app.get_webview_window(&label).is_some() {
    return format!("{label}-{}", POPOUT_SEQUENCE.fetch_add(1, Ordering::Relaxed));
  }
  label
}

/// Build the OS window a panel pop-out lives in.
///
/// dockview implements "Popout Active Window" as `window.open('/popout.html')`
/// followed by moving that panel's live DOM into the returned window, which is
/// what keeps the panel's React state (and, via the portal's own listeners, its
/// input handling) intact. wry denies every `window.open` when no new-window
/// handler is registered, and dockview reads that as a blocked pop-up: it
/// re-docks the group and only logs to the console — which is why the action
/// looked like it did nothing in the desktop build.
///
/// `NewWindowResponse::Create` bridges the two: the runtime gets a real Tauri
/// window instead of opening one itself, while the opener/opened relationship
/// is kept, so `window.open` still hands dockview a live `WindowProxy`.
/// `window_features` copies over the bits the platform requires for that to be
/// legal — on Windows, the new webview has to share the opener's WebView2
/// environment.
fn create_popout_window(
  app: &tauri::AppHandle,
  url: Url,
  features: NewWindowFeatures,
) -> Option<WebviewWindow> {
  let label = popout_label(app, &url);

  // The runtime navigates the new webview to `url` on its own; loading it here
  // too means the window still shows the panel if some platform does not, and
  // the repeated `load` is harmless (dockview re-appends the same container).
  let target = if matches!(url.scheme(), "http" | "https") {
    WebviewUrl::External(url)
  } else {
    WebviewUrl::External("about:blank".parse().ok()?)
  };

  let window = WebviewWindowBuilder::new(app, label, target)
    .window_features(features)
    .title("BlahBlah")
    .on_document_title_changed(|window, title| {
      let _ = window.set_title(&title);
    })
    // Panel content inside the pop-out still uses HTML5 drag and drop.
    .disable_drag_drop_handler()
    .build()
    .map_err(|err| log::error!("failed to create pop-out window: {err}"))
    .ok()?;

  // Closing through the OS window button would destroy the webview without
  // running the page's `beforeunload` — and that event is how dockview learns
  // the pop-out is gone and re-docks the panel, so without this the panel would
  // be stranded off-layout. Ask the page to close itself instead, which does
  // fire `beforeunload`, and destroy the window anyway if it did not.
  let closer = window.clone();
  window.on_window_event(move |event| {
    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
      return;
    };
    api.prevent_close();
    if let Err(err) = closer.eval("window.close()") {
      log::warn!("pop-out window could not close itself ({err}), destroying it");
      let _ = closer.destroy();
      return;
    }
    let fallback = closer.clone();
    std::thread::spawn(move || {
      std::thread::sleep(std::time::Duration::from_millis(POPOUT_CLOSE_GRACE_MS));
      // No-op when the page already closed the window.
      let _ = fallback.destroy();
    });
  });

  Some(window)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
      ffmpeg_version,
      run_ffmpeg,
      whisper_version,
      run_whisper,
      download_package,
      cancel_download,
      cancel_process,
      verify_sha256,
      get_app_data_dir
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      create_main_window(app.handle())?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}