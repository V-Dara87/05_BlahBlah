use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
  tauri_build::build();

  // Ensure sidecar DLLs (whisper.dll, ggml.dll, etc.) are copied next to the binary in target
  let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
  let binaries_dir = Path::new(&manifest_dir).join("binaries");

  if let Ok(entries) = fs::read_dir(&binaries_dir) {
    if let Ok(out_dir_str) = env::var("OUT_DIR") {
      let out_dir = PathBuf::from(out_dir_str);
      let target_dir = out_dir
        .ancestors()
        .find(|p| p.ends_with("debug") || p.ends_with("release"));

      if let Some(target) = target_dir {
        for entry in entries.flatten() {
          let path = entry.path();
          if path.extension().and_then(|e| e.to_str()) == Some("dll") {
            let dest = target.join(entry.file_name());
            let _ = fs::copy(&path, dest);
          }
        }
      }
    }
  }
}
