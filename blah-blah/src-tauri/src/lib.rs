use std::collections::HashMap;
use std::path::{Component, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::webview::{NewWindowFeatures, NewWindowResponse, PageLoadEvent};
use tauri::{Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// ─── Sidecar / download hardening ────────────────────────────────────────────
//
// The webview can invoke these commands, so nothing a compromised page sends
// may become an arbitrary command line, an arbitrary URL, or a write outside
// the app's own data directory.

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

/// FFmpeg options this app actually builds commands with. Anything else is
/// rejected, so the sidecar cannot be re-purposed as a generic shell tool.
const FFMPEG_ALLOWED_OPTIONS: &[&str] = &[
    "-y", "-n", "-nostats", "-hide_banner", "-loglevel", "-ss", "-t", "-to", "-i",
    "-vn", "-an", "-sn", "-ac", "-ar", "-ab", "-acodec", "-c:a", "-c:v", "-c",
    "-f", "-pix_fmt", "-vf", "-filter_complex", "-filter:v", "-map", "-b:v", "-b:a",
    "-crf", "-preset", "-profile:v", "-tag:v", "-movflags", "-progress", "-r", "-s",
    "-aspect", "-shortest", "-af", "-frames:v", "-start_number", "-q:v", "-g", "-threads",
    "-",
];

/// whisper-cli options this app builds commands with.
const WHISPER_ALLOWED_OPTIONS: &[&str] = &[
    "-m", "-f", "-l", "-osrt", "-of", "--print-progress", "-t", "--threads", "-pp", "-ml",
    "-sow", "-owts", "-nt",
];

const MAX_ARG_COUNT: usize = 512;
const MAX_ARG_BYTES: usize = 4096;
const MAX_ARGS_TOTAL_BYTES: usize = 64 * 1024;

/// Validate a sidecar argument vector: bounded size, no control bytes and no
/// option outside the command's allowlist. Negative numbers (`-1`) are values.
fn validate_sidecar_args(args: &[String], allowed: &[&str], label: &str) -> Result<(), String> {
    if args.is_empty() {
        return Err(format!("{label}: refusing to run with no arguments."));
    }
    if args.len() > MAX_ARG_COUNT {
        return Err(format!("{label}: too many arguments ({}).", args.len()));
    }

    let mut total = 0usize;
    for arg in args {
        if arg.is_empty() {
            return Err(format!("{label}: empty argument."));
        }
        if arg.len() > MAX_ARG_BYTES {
            return Err(format!("{label}: argument is too long."));
        }
        if arg.contains('\0') || arg.contains('\n') || arg.contains('\r') {
            return Err(format!("{label}: argument contains a forbidden character."));
        }
        total += arg.len();
        if total > MAX_ARGS_TOTAL_BYTES {
            return Err(format!("{label}: arguments are too large."));
        }
        if arg.starts_with('-') && arg.len() > 1 {
            if arg.parse::<f64>().is_ok() {
                continue;
            }
            if !allowed.iter().any(|option| *option == arg.as_str()) {
                return Err(format!("{label}: option \"{arg}\" is not allowed."));
            }
        }
    }
    Ok(())
}

/// Every value of `option` must be an existing absolute path without `..`
/// components, so an argument can never point outside a user-chosen file.
fn validate_absolute_file_arg(args: &[String], option: &str, label: &str) -> Result<(), String> {
    let mut index = 0;
    while index < args.len() {
        if args[index] == option {
            let value = args
                .get(index + 1)
                .ok_or_else(|| format!("{label}: \"{option}\" has no value."))?;
            let path = PathBuf::from(value);
            if !path.is_absolute()
                || path.components().any(|c| matches!(c, Component::ParentDir))
            {
                return Err(format!("{label}: \"{option}\" must be an absolute path."));
            }
            if !path.is_file() {
                return Err(format!("{label}: input file does not exist: {value}"));
            }
            index += 2;
        } else {
            index += 1;
        }
    }
    Ok(())
}

/// Like `validate_absolute_file_arg`, for an output prefix that does not exist
/// yet (whisper's `-of`).
fn validate_output_prefix(args: &[String], option: &str, label: &str) -> Result<(), String> {
    let mut index = 0;
    while index < args.len() {
        if args[index] == option {
            let value = args
                .get(index + 1)
                .ok_or_else(|| format!("{label}: \"{option}\" has no value."))?;
            let path = PathBuf::from(value);
            if !path.is_absolute()
                || path.components().any(|c| matches!(c, Component::ParentDir))
            {
                return Err(format!("{label}: \"{option}\" must be an absolute path."));
            }
            index += 2;
        } else {
            index += 1;
        }
    }
    Ok(())
}

#[tauri::command]
async fn run_ffmpeg(
    app: tauri::AppHandle,
    args: Vec<String>,
    session_id: Option<String>,
) -> Result<String, String> {
    validate_sidecar_args(&args, FFMPEG_ALLOWED_OPTIONS, "ffmpeg")?;
    validate_absolute_file_arg(&args, "-i", "ffmpeg")?;

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
    validate_sidecar_args(&args, WHISPER_ALLOWED_OPTIONS, "whisper")?;
    validate_absolute_file_arg(&args, "-m", "whisper")?;
    validate_absolute_file_arg(&args, "-f", "whisper")?;
    validate_output_prefix(&args, "-of", "whisper")?;

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

/// Hosts a model package may be downloaded from. The package manifest ships
/// with the app, so an unknown host means the request did not come from it.
const DOWNLOAD_HOST_ALLOWLIST: &[&str] = &[
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "hf.co",
];
const DOWNLOAD_HOST_SUFFIX_ALLOWLIST: &[&str] = &[".huggingface.co", ".hf.co"];

/// Downloads must be plain HTTPS from an allowlisted model host — no `file:`,
/// `data:`, `http:` URLs and no redirect to either.
fn validate_download_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| format!("Invalid download URL: {e}"))?;
    if url.scheme() != "https" {
        return Err("Refusing to download over anything but HTTPS.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Refusing a download URL with embedded credentials.".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Download URL has no host.".to_string())?
        .to_ascii_lowercase();
    let allowed = DOWNLOAD_HOST_ALLOWLIST.iter().any(|h| *h == host.as_str())
        || DOWNLOAD_HOST_SUFFIX_ALLOWLIST
            .iter()
            .any(|suffix| host.ends_with(suffix));
    if !allowed {
        return Err(format!("Refusing to download from untrusted host: {host}"));
    }
    Ok(url)
}

/// The destination must resolve to a path inside the app's data directory.
/// `..` is rejected outright and the parent is canonicalised before the check,
/// so a symlink or junction cannot redirect the write elsewhere.
fn validate_download_destination(
    app: &tauri::AppHandle,
    dest_path: &str,
) -> Result<PathBuf, String> {
    let dest = PathBuf::from(dest_path);
    if dest_path.trim().is_empty() || !dest.is_absolute() {
        return Err("Download destination must be an absolute path.".to_string());
    }
    if dest
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("Download destination may not contain '..'.".to_string());
    }

    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;
    let app_dir = std::fs::canonicalize(&app_dir)
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let parent = dest
        .parent()
        .ok_or_else(|| "Download destination has no parent directory.".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create destination directory: {e}"))?;
    let parent = std::fs::canonicalize(parent)
        .map_err(|e| format!("Failed to resolve destination directory: {e}"))?;
    if !parent.starts_with(&app_dir) {
        return Err(
            "Refusing to write a download outside the application data directory.".to_string(),
        );
    }
    Ok(dest)
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

    let url = validate_download_url(&url)?;
    let dest = validate_download_destination(&app, &dest_path)?;

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(DOWNLOAD_CONNECT_TIMEOUT_SECS))
        // A redirect may not escape HTTPS or the allowlisted hosts, so a
        // trusted URL cannot be bounced to an arbitrary destination.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.stop()
            } else if validate_download_url(attempt.url().as_str()).is_err() {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = tokio::time::timeout(
        Duration::from_secs(DOWNLOAD_CONNECT_TIMEOUT_SECS * 2),
        client.get(url).send(),
    )
    .await
    .map_err(|_| "Request timed out".to_string())?
    .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with HTTP status: {}", response.status()));
    }

    let total_bytes = response.content_length();

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

/// Grant the filesystem plugin access to one user-chosen path (or, for a save
/// destination that does not exist yet, to its parent folder). Only the exact
/// folder is added, non-recursively, and only after the OS picker returned it.
#[tauri::command]
fn allow_user_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.is_absolute() || target.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Path must be absolute and may not contain '..'.".to_string());
    }
    let directory = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .map(|parent| parent.to_path_buf())
            .ok_or_else(|| "Path has no parent directory.".to_string())?
    };
    if !directory.is_dir() {
        return Err(format!("Directory does not exist: {}", directory.display()));
    }
    app.fs_scope()
        .allow_directory(&directory, false)
        .map_err(|e| format!("Failed to grant filesystem access: {e}"))
}

/// Grant the filesystem plugin access to one user-chosen project folder.
///
/// The static capability only covers the app's own data/temp/resource dirs;
/// project folders live wherever the user picked them, so the scope is widened
/// at open/create time instead of allowing every path up front.
#[tauri::command]
fn allow_project_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if !dir.is_absolute() || dir.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Project directory must be an absolute path without '..'.".to_string());
    }
    if !dir.is_dir() {
        return Err(format!("Project directory does not exist: {path}"));
    }
    app.fs_scope()
        .allow_directory(&dir, true)
        .map_err(|e| format!("Failed to grant filesystem access to the project folder: {e}"))
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
  let mut builder = WebviewWindowBuilder::from_config(app, &config)?;

  // The configured size is a preference, not a promise: on a 1366x768 laptop a
  // 1400x900 window would open larger than the screen and its edges (menu bar,
  // timeline, window buttons) would be unreachable. Clamp it to the monitor.
  if let Some((width, height)) = fitted_window_size(app, config.width, config.height) {
    builder = builder.inner_size(width, height).center();
  }

  let window = builder
    .on_new_window(move |url, features| {
      create_popout_window(&handler_app, url, features)
        .map(|window| NewWindowResponse::Create { window })
        .unwrap_or(NewWindowResponse::Deny)
    })
    // Zoom is applied per page load too, so a reload (or the dev server
    // restarting) never leaves the UI at the wrong scale.
    .on_page_load(|window, payload| {
      if matches!(payload.event(), PageLoadEvent::Finished) {
        apply_fit_zoom(&window, true);
      }
    })
    .build()?;

  // Re-fit the UI every time the window is resized, maximised, moved to a
  // monitor with another DPI, and so on.
  let resized = window.clone();
  window.on_window_event(move |event| {
    if matches!(
      event,
      tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
    ) {
      apply_fit_zoom(&resized, false);
    }
  });
  apply_fit_zoom(&window, true);

  Ok(window)
}

/// Window size the editor UI is laid out for, in logical (DPI-independent)
/// pixels. A window smaller than this is zoomed out so the whole editor still
/// fits instead of being clipped.
const UI_DESIGN_WIDTH: f64 = 1280.0;
const UI_DESIGN_HEIGHT: f64 = 720.0;
/// Windows larger than this are zoomed in a little (4K at 100% OS scaling,
/// ultrawide monitors) so text and controls do not become tiny.
const UI_LARGE_WIDTH: f64 = 1920.0;
const UI_LARGE_HEIGHT: f64 = 1080.0;
const UI_MIN_ZOOM: f64 = 0.4;
const UI_MAX_ZOOM: f64 = 2.0;
/// Zoom moves in steps of this size, so dragging a window edge does not
/// re-layout the whole editor on every pixel.
const UI_ZOOM_STEP: f64 = 0.05;

/// Last zoom applied to the main window, as `f64` bits.
static LAST_UI_ZOOM_BITS: AtomicU64 = AtomicU64::new(0);

/// User-chosen zoom (header zoom buttons), as `f64` bits. 1.0 = 100%. It is
/// multiplied into the automatic fit zoom, so the whole app scales while the
/// window-size fitting keeps working.
static USER_UI_ZOOM_BITS: AtomicU64 = AtomicU64::new(0x3FF0_0000_0000_0000); // 1.0f64
const USER_MIN_ZOOM: f64 = 0.5;
const USER_MAX_ZOOM: f64 = 2.0;
const FINAL_MIN_ZOOM: f64 = 0.25;
const FINAL_MAX_ZOOM: f64 = 4.0;

/// Set the user zoom factor and re-apply it to the calling window.
#[tauri::command]
fn set_ui_zoom(window: WebviewWindow, factor: f64) -> Result<(), String> {
  if !factor.is_finite() {
    return Err("invalid zoom factor".to_string());
  }
  let clamped = factor.clamp(USER_MIN_ZOOM, USER_MAX_ZOOM);
  USER_UI_ZOOM_BITS.store(clamped.to_bits(), Ordering::Relaxed);
  apply_fit_zoom(&window, true);
  Ok(())
}

/// UI zoom factor for a window of `width` x `height` logical pixels.
fn fit_zoom(width: f64, height: f64) -> f64 {
  if !(width > 0.0 && height > 0.0) {
    return 1.0;
  }
  let shrink = (width / UI_DESIGN_WIDTH).min(height / UI_DESIGN_HEIGHT);
  let zoom = if shrink < 1.0 {
    shrink
  } else {
    (width / UI_LARGE_WIDTH).min(height / UI_LARGE_HEIGHT).max(1.0)
  };
  let stepped = (zoom / UI_ZOOM_STEP).round() * UI_ZOOM_STEP;
  ((stepped * 100.0).round() / 100.0).clamp(UI_MIN_ZOOM, UI_MAX_ZOOM)
}

/// Zoom the main webview so the whole editor fits the current window size.
///
/// The size comes from the native window (physical size / OS scale factor), not
/// from `window.innerWidth` — the latter changes with the zoom itself and
/// would feed back into the calculation. Webview zoom is a real browser zoom,
/// so pointer coordinates, canvases and the dock layout stay consistent.
fn apply_fit_zoom(window: &WebviewWindow, force: bool) {
  // A minimised window reports a meaningless size.
  if window.is_minimized().unwrap_or(false) {
    return;
  }
  let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
    return;
  };
  if scale <= 0.0 || size.width == 0 || size.height == 0 {
    return;
  }

  let user_zoom = f64::from_bits(USER_UI_ZOOM_BITS.load(Ordering::Relaxed));
  let zoom = (fit_zoom(size.width as f64 / scale, size.height as f64 / scale) * user_zoom)
    .clamp(FINAL_MIN_ZOOM, FINAL_MAX_ZOOM);
  let previous = LAST_UI_ZOOM_BITS.swap(zoom.to_bits(), Ordering::Relaxed);
  if !force && previous == zoom.to_bits() {
    return;
  }
  if let Err(err) = window.set_zoom(zoom) {
    log::warn!("could not apply UI zoom {zoom}: {err}");
  }
}

/// Largest window (logical pixels) that still fits on the primary monitor,
/// leaving room for the taskbar / dock. `None` when the monitor is unknown.
fn fitted_window_size(app: &tauri::AppHandle, width: f64, height: f64) -> Option<(f64, f64)> {
  let monitor = app.primary_monitor().ok().flatten()?;
  let scale = monitor.scale_factor();
  if scale <= 0.0 {
    return None;
  }
  let screen_width = monitor.size().width as f64 / scale;
  let screen_height = monitor.size().height as f64 / scale;
  Some((
    width.min((screen_width * 0.94).floor()),
    height.min((screen_height * 0.90).floor()),
  ))
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
      get_app_data_dir,
      allow_project_dir,
      allow_user_path,
      set_ui_zoom
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
#[cfg(test)]
mod security_tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn sidecar_args_reject_unknown_options() {
        assert!(validate_sidecar_args(&args(&["-i", "C:/x.mp4", "--evil"]), &["-i"], "ffmpeg").is_err());
    }

    #[test]
    fn sidecar_args_accept_negative_numbers_as_values() {
        assert!(validate_sidecar_args(&args(&["-t", "-1"]), &["-t"], "ffmpeg").is_ok());
    }

    #[test]
    fn sidecar_args_reject_control_characters() {
        assert!(validate_sidecar_args(&args(&["-i", "a\nb"]), &["-i"], "ffmpeg").is_err());
    }

    #[test]
    fn absolute_file_arg_rejects_relative_and_parent_paths() {
        assert!(validate_absolute_file_arg(&args(&["-i", "relative.mp4"]), "-i", "ffmpeg").is_err());
        assert!(validate_absolute_file_arg(&args(&["-i", "C:/tmp/../x.mp4"]), "-i", "ffmpeg").is_err());
    }

    #[test]
    fn absolute_file_arg_requires_an_existing_file() {
        let dir = std::env::temp_dir().join(format!("blahblah-arg-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("input.txt");
        std::fs::write(&file, b"x").unwrap();
        let existing_args = vec!["-i".to_string(), file.to_string_lossy().into_owned()];
        assert!(validate_absolute_file_arg(&existing_args, "-i", "ffmpeg").is_ok());
        let missing_args = vec![
            "-i".to_string(),
            dir.join("missing.txt").to_string_lossy().into_owned(),
        ];
        assert!(validate_absolute_file_arg(&missing_args, "-i", "ffmpeg").is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn output_prefix_rejects_relative_paths() {
        assert!(validate_output_prefix(&args(&["-of", "out"]), "-of", "whisper").is_err());
        let abs = std::env::temp_dir()
            .join("blahblah-out")
            .to_string_lossy()
            .into_owned();
        assert!(validate_output_prefix(&args(&["-of", &abs]), "-of", "whisper").is_ok());
    }

    #[test]
    fn download_url_allows_only_https_model_hosts() {
        assert!(validate_download_url("https://huggingface.co/models/x.bin").is_ok());
        assert!(validate_download_url("https://cdn-lfs.huggingface.co/x.bin").is_ok());
        assert!(validate_download_url("https://foo.hf.co/x.bin").is_ok());
        assert!(validate_download_url("http://huggingface.co/x.bin").is_err());
        assert!(validate_download_url("file:///etc/passwd").is_err());
        assert!(validate_download_url("https://user:pw@huggingface.co/x").is_err());
        assert!(validate_download_url("https://evil.example/x").is_err());
        assert!(validate_download_url("https://huggingface.co.evil/x").is_err());
    }
}
