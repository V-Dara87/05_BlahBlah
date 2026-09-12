use tauri::Emitter;
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

    Ok(stdout)
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
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

