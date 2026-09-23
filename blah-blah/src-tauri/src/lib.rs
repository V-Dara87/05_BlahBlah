use std::sync::atomic::{AtomicU64, Ordering};

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Clone, serde::Serialize)]
pub struct FfmpegProgressEvent {
    pub session_id: String,
    pub line: String,
    pub key: Option<String>,
    pub value: Option<String>,
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

    let (mut rx, _child) = sidecar_command
        .args(args)
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg sidecar: {e}"))?;

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

                stdout_accum.extend(line_bytes);
                stdout_accum.push(b'\n');
            }
            CommandEvent::Stderr(line_bytes) => {
                stderr_accum.extend(line_bytes);
                stderr_accum.push(b'\n');
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
            }
            CommandEvent::Error(err) => {
                return Err(format!("ffmpeg process error: {err}"));
            }
            _ => {}
        }
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
    .invoke_handler(tauri::generate_handler![ffmpeg_version, run_ffmpeg])
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

