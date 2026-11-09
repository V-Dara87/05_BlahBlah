// WHY THIS EXISTS
//
// The spike speaks the same JSON-lines contract the production vsthost
// sidecar will speak: stdout carries machine-readable events only, and
// every failure is an error event with a stable code. Keeping this tiny
// module separate means the future sidecar can adopt it without dragging
// in CLI or plugin-host concerns.
//
// Protocol version 1 is the first contract. The app will refuse to use a
// helper whose protocolVersion it does not know instead of failing deep
// inside a plugin call.

use std::fs::File;
use std::io::Write;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Map, Value};

/// Bumped whenever the JSON-lines contract changes incompatibly.
pub const PROTOCOL_VERSION: u32 = 1;
/// Which plugin-host library currently sits behind `backend.rs`.
pub const BACKEND_NAME: &str = "truce-rack";
/// Kept in sync with the `truce-rack` requirement in Cargo.toml.
pub const BACKEND_VERSION: &str = "1.1.5";
/// Version of this spike binary.
pub const SIDECAR_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    PluginCrash,
    PluginMissing,
    LoadFailed,
    // Reserved for the Phase 1 child-process scan/process timeout path.
    #[allow(dead_code)]
    Timeout,
    BadArgs,
    Io,
}

#[derive(Debug, Clone)]
pub struct CliError {
    pub code: ErrorCode,
    pub message: String,
    pub plugin: Option<String>,
}

impl CliError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            plugin: None,
        }
    }

    pub fn with_plugin(mut self, plugin: impl Into<String>) -> Self {
        self.plugin = Some(plugin.into());
        self
    }

    pub fn bad_args(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::BadArgs, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Io, message)
    }
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CliError {}

impl From<std::io::Error> for CliError {
    fn from(value: std::io::Error) -> Self {
        Self::io(value.to_string())
    }
}

pub type CliResult<T> = Result<T, CliError>;

/// The protocol output is a duplicate of the process's original stdout. CRT
/// stdout (fd 1) is pointed at stderr before any plugin loads, so a plugin's
/// own `printf`/`std::cout` cannot corrupt the JSON-lines stream. This is the
/// same discipline the production sidecar needs.
static OUTPUT: OnceLock<Mutex<File>> = OnceLock::new();

#[cfg(target_os = "windows")]
pub fn init_stdout() -> std::io::Result<()> {
    use std::ffi::c_void;
    use std::os::windows::io::FromRawHandle;
    use std::ptr;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(which: u32) -> *mut c_void;
        fn DuplicateHandle(
            process: *mut c_void,
            source: *mut c_void,
            target: *mut c_void,
            duplicate: *mut *mut c_void,
            access: u32,
            inherit: i32,
            options: u32,
        ) -> i32;
        fn GetCurrentProcess() -> *mut c_void;
    }

    #[link(name = "msvcrt")]
    extern "C" {
        fn _dup2(source: i32, target: i32) -> i32;
    }

    const STD_OUTPUT_HANDLE: u32 = (-11i32) as u32;
    const DUPLICATE_SAME_ACCESS: u32 = 0x0000_0002;
    let invalid_handle = (-1isize) as *mut c_void;

    unsafe {
        let handle = GetStdHandle(STD_OUTPUT_HANDLE);
        if handle.is_null() || handle == invalid_handle {
            return Err(std::io::Error::last_os_error());
        }
        let mut duplicate = ptr::null_mut();
        if DuplicateHandle(
            GetCurrentProcess(),
            handle,
            GetCurrentProcess(),
            &mut duplicate,
            0,
            0,
            DUPLICATE_SAME_ACCESS,
        ) == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        let file = File::from_raw_handle(duplicate);
        let _ = OUTPUT.set(Mutex::new(file));
        if _dup2(2, 1) == -1 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn init_stdout() -> std::io::Result<()> {
    Ok(())
}

fn write_event(value: &Value) {
    if let Some(output) = OUTPUT.get() {
        if let Ok(mut file) = output.lock() {
            if serde_json::to_writer(&mut *file, value).is_ok() {
                let _ = writeln!(file);
                let _ = file.flush();
            }
            return;
        }
    }
    // Non-Windows fallback, or a failed duplicate: still emit a valid event.
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    if serde_json::to_writer(&mut lock, value).is_ok() {
        let _ = writeln!(lock);
        let _ = lock.flush();
    }
}

/// `{"event":"result","command":..., ...fields}`
pub fn emit_result(command: &str, fields: Value) {
    let mut object = Map::new();
    object.insert("event".to_string(), Value::String("result".to_string()));
    object.insert(
        "command".to_string(),
        Value::String(command.to_string()),
    );
    if let Value::Object(fields) = fields {
        for (key, value) in fields {
            object.insert(key, value);
        }
    }
    write_event(&Value::Object(object));
}

/// `{"event":"error","code":...,"message":...,"plugin":...}`
pub fn emit_error(error: &CliError) {
    let mut object = Map::new();
    object.insert("event".to_string(), Value::String("error".to_string()));
    object.insert(
        "code".to_string(),
        serde_json::to_value(error.code).unwrap_or(Value::String("IO".to_string())),
    );
    object.insert(
        "message".to_string(),
        Value::String(error.message.clone()),
    );
    if let Some(plugin) = &error.plugin {
        object.insert("plugin".to_string(), Value::String(plugin.clone()));
    }
    write_event(&Value::Object(object));
}

/// `{"event":"progress","pct":0-100}`, throttled so a fast render cannot
/// flood the app with thousands of lines.
pub struct Progress {
    last_emit: Option<Instant>,
}

impl Progress {
    pub fn new() -> Self {
        Self { last_emit: None }
    }

    pub fn emit(&mut self, pct: f64, force: bool) {
        let now = Instant::now();
        let due = self
            .last_emit
            .map_or(true, |last| now.duration_since(last) >= Duration::from_millis(100));
        if !force && !due {
            return;
        }
        self.last_emit = Some(now);
        let value = Value::Object(Map::from_iter([
            (
                "event".to_string(),
                Value::String("progress".to_string()),
            ),
            (
                "pct".to_string(),
                Value::Number(serde_json::Number::from_f64(pct.clamp(0.0, 100.0)).unwrap()),
            ),
        ]));
        write_event(&value);
    }
}

impl Default for Progress {
    fn default() -> Self {
        Self::new()
    }
}

pub fn info_fields() -> Value {
    serde_json::json!({
        "protocolVersion": PROTOCOL_VERSION,
        "sidecarVersion": SIDECAR_VERSION,
        "backend": BACKEND_NAME,
        "backendVersion": BACKEND_VERSION,
        "command": "info",
        "platform": std::env::consts::OS,
        "supportsEditor": cfg!(target_os = "windows"),
    })
}
