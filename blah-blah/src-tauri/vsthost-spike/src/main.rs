// WHY THIS EXISTS
//
// Phase 0 is a command-line spike, not the app sidecar. It proves the parts
// that are risky on real Windows plugins: scan, load and process a WAV with
// latency compensation and tail, save/reload state through a file, and host
// an editor window that writes state when it closes.
//
// The CLI deliberately speaks JSON lines on stdout so its result shapes can be
// lifted into the Phase 1 sidecar unchanged. Human-readable help and logs go
// to stderr.

mod backend;
mod chain;
mod log;
mod protocol;
mod wav;

use std::collections::HashMap;
use std::mem::ManuallyDrop;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

use serde_json::{json, Value};

use backend::{PluginBackend, ScannedPlugin, TruceRackBackend};
use chain::{load_chain_file, Chain, ChainSpec};
use log::Log;
use protocol::{CliError, CliResult, ErrorCode, Progress};
use wav::{WavSink, WavSource};

struct Args {
    values: HashMap<String, Vec<String>>,
}

impl Args {
    fn get(&self, key: &str) -> Option<&str> {
        self.values
            .get(key)
            .and_then(|values| values.last())
            .map(String::as_str)
    }

    fn all(&self, key: &str) -> &[String] {
        self.values.get(key).map(Vec::as_slice).unwrap_or(&[])
    }

    fn require(&self, key: &str) -> CliResult<&str> {
        self.get(key)
            .ok_or_else(|| CliError::bad_args(format!("missing --{key}")))
    }

    fn ensure_known(&self, allowed: &[&str]) -> CliResult<()> {
        for key in self.values.keys() {
            if !allowed.iter().any(|item| *item == key.as_str()) {
                return Err(CliError::bad_args(format!("unknown option --{key}")));
            }
        }
        Ok(())
    }
}

struct Invocation {
    command: String,
    args: Args,
}

fn main() {
    if let Err(error) = protocol::init_stdout() {
        eprintln!("warning: could not isolate protocol stdout: {error}");
    }
    init_com();
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let invocation = match parse_invocation(raw) {
        Ok(invocation) => invocation,
        Err(error) => {
            eprintln!("{error}");
            protocol::emit_error(&error);
            std::process::exit(2);
        }
    };

    if invocation.command == "help" {
        print_help();
        return;
    }

    let log_path = invocation.args.get("log-file").map(PathBuf::from);
    if let Some(path) = &log_path {
        if let Err(error) = validate_abs_path(path, "log") {
            eprintln!("{error}");
            protocol::emit_error(&error);
            std::process::exit(2);
        }
    }
    let mut log = match Log::new(log_path.as_deref(), &invocation.command) {
        Ok(log) => log,
        Err(error) => {
            let error = CliError::io(format!("could not open log file: {error}"));
            eprintln!("{error}");
            protocol::emit_error(&error);
            std::process::exit(2);
        }
    };
    log.event("info", "started", None, None, None);

    match run(&invocation, &mut log) {
        Ok(()) => {
            log.event("info", "finished", None, None, None);
            // Some plugins crash in terminate/unload even after producing a
            // correct result. The sidecar contract is per-process, so flush
            // results and leave the OS to reclaim the address space instead of
            // running plugin destructors after a successful job.
            std::process::exit(0);
        }
        Err(error) => {
            log.event(
                "error",
                &error.message,
                error.plugin.as_deref(),
                Some(error.code),
                None,
            );
            protocol::emit_error(&error);
            std::process::exit(2);
        }
    }
}

fn run(invocation: &Invocation, log: &mut Log) -> CliResult<()> {
    match invocation.command.as_str() {
        "info" => cmd_info(&invocation.args),
        "scan" => cmd_scan(&invocation.args, log),
        "process" => cmd_process(&invocation.args, log),
        "state" => cmd_state(&invocation.args, log),
        "editor" => cmd_editor(&invocation.args, log),
        "impulse" => cmd_impulse(&invocation.args, log),
        "tail" => cmd_tail(&invocation.args, log),
        "selftest" => cmd_selftest(&invocation.args, log),
        other => Err(CliError::bad_args(format!(
            "unknown command {other:?}; try --help"
        ))),
    }
}

fn cmd_info(args: &Args) -> CliResult<()> {
    args.ensure_known(&["log-file"])?;
    protocol::emit_result("info", protocol::info_fields());
    Ok(())
}

fn cmd_scan(args: &Args, log: &mut Log) -> CliResult<()> {
    args.ensure_known(&["log-file", "dir", "out"])?;
    let dirs = args
        .all("dir")
        .iter()
        .map(|dir| validate_abs_dir(Path::new(dir), "scan folder"))
        .collect::<CliResult<Vec<_>>>()?;
    let out = args
        .get("out")
        .map(|path| validate_output_path(Path::new(path), "scan output"))
        .transpose()?;

    let started = Instant::now();
    let backend = TruceRackBackend::new();
    let outcome = backend.scan(&dirs)?;
    if let Some(path) = &out {
        let text = serde_json::to_string_pretty(&outcome)
            .map_err(|error| CliError::io(format!("encode scan result: {error}")))?;
        std::fs::write(path, text)
            .map_err(|error| CliError::io(format!("write scan output {}: {error}", path.display())))?;
    }

    let mut value = serde_json::to_value(&outcome)
        .map_err(|error| CliError::io(format!("encode scan result: {error}")))?;
    if let Value::Object(map) = &mut value {
        if let Some(path) = &out {
            map.insert(
                "out".to_string(),
                Value::String(path.to_string_lossy().into_owned()),
            );
        }
    }
    log.event(
        "info",
        &format!(
            "scan: {} plugins, {} failed",
            outcome.plugins.len(),
            outcome.failed.len()
        ),
        None,
        None,
        Some(started.elapsed()),
    );
    protocol::emit_result("scan", value);
    Ok(())
}

fn cmd_process(args: &Args, log: &mut Log) -> CliResult<()> {
    args.ensure_known(&[
        "log-file",
        "chain",
        "plugin",
        "class-id",
        "state-in",
        "in",
        "out",
        "sample-rate",
        "block-size",
        "tail-max-ms",
        "discard-head-ms",
    ])?;
    let specs = specs_from_args(args)?;
    let input_path = validate_input_file(Path::new(args.require("in")?), "input WAV")?;
    let output_path = validate_output_path(Path::new(args.require("out")?), "output WAV")?;

    let mut source = WavSource::open(&input_path).map_err(CliError::io)?;
    let sample_rate = source.sample_rate();
    if let Some(raw) = args.get("sample-rate") {
        let requested = parse_u32(raw, "sample-rate")?;
        if requested != sample_rate {
            return Err(CliError::bad_args(format!(
                "input WAV is {sample_rate} Hz, not the requested {requested} Hz"
            )));
        }
    }
    let block_size = parse_u32(args.get("block-size").unwrap_or("1024"), "block-size")?;
    if !(16..=8192).contains(&block_size) {
        return Err(CliError::bad_args("block-size must be between 16 and 8192"));
    }
    let tail_max_ms = parse_f64(args.get("tail-max-ms").unwrap_or("5000"), "tail-max-ms")?;
    if !(0.0..=60_000.0).contains(&tail_max_ms) {
        return Err(CliError::bad_args("tail-max-ms must be between 0 and 60000"));
    }
    let discard_head_ms = parse_f64(
        args.get("discard-head-ms").unwrap_or("0"),
        "discard-head-ms",
    )?;
    if !(0.0..=60_000.0).contains(&discard_head_ms) {
        return Err(CliError::bad_args(
            "discard-head-ms must be between 0 and 60000",
        ));
    }

    let backend = TruceRackBackend::new();
    // Plugin instances are intentionally never unloaded: several real plugins
    // crash inside terminate()/DllMain on some hosts. The process exit reclaims
    // them, which is the same lifetime model the out-of-process sidecar uses.
    let mut chain = ManuallyDrop::new(Chain::new(
        &backend,
        &specs,
        f64::from(sample_rate),
        block_size as usize,
    )?);
    let mut sink = WavSink::create(&output_path, sample_rate).map_err(CliError::io)?;
    let mut progress = Progress::new();
    let started = Instant::now();
    let report = chain::render_wav(
        &mut chain,
        &backend,
        &mut source,
        &mut sink,
        block_size as usize,
        discard_head_ms,
        tail_max_ms,
        |pct| progress.emit(pct, false),
    )?;
    let finalized = sink.finalize().map_err(CliError::io)?;
    if finalized != report.output_frames {
        return Err(CliError::io(format!(
            "WAV finalized {finalized} frames but renderer reported {}",
            report.output_frames
        )));
    }

    let mut value = serde_json::to_value(&report)
        .map_err(|error| CliError::io(format!("encode render result: {error}")))?;
    if let Value::Object(map) = &mut value {
        map.insert(
            "output".to_string(),
            Value::String(output_path.to_string_lossy().into_owned()),
        );
        map.insert(
            "input".to_string(),
            Value::String(input_path.to_string_lossy().into_owned()),
        );
        map.insert("sampleRate".to_string(), json!(sample_rate));
        map.insert("blockSize".to_string(), json!(block_size));
        map.insert("finalizedFrames".to_string(), json!(finalized));
        map.insert(
            "slots".to_string(),
            serde_json::to_value(chain.summaries())
                .map_err(|error| CliError::io(format!("encode slots: {error}")))?,
        );
    }
    log.event(
        "info",
        &format!(
            "render: {} frames out, latency {} samples, {:.2}x realtime",
            report.output_frames, report.latency_samples, report.real_time_factor
        ),
        None,
        None,
        Some(started.elapsed()),
    );
    protocol::emit_result("process", value);
    Ok(())
}

fn cmd_state(args: &Args, log: &mut Log) -> CliResult<()> {
    args.ensure_known(&["log-file", "plugin", "class-id", "state-in", "state-out"])?;
    let descriptor = descriptor_from_args(args)?;
    let state = optional_state_arg(args.get("state-in"))?;
    let state_out = validate_output_path(Path::new(args.require("state-out")?), "state output")?;
    let backend = TruceRackBackend::new();
    let started = Instant::now();

    let plugin = ManuallyDrop::new(backend.load(&descriptor, state.as_deref(), 48_000.0, 1024)?);
    let saved = backend.get_state(&plugin)?;
    std::fs::write(&state_out, &saved)
        .map_err(|error| CliError::io(format!("write state {}: {error}", state_out.display())))?;

    let mut reloaded = ManuallyDrop::new(backend.load(&descriptor, None, 48_000.0, 1024)?);
    backend.set_state(&mut reloaded, &saved)?;
    let compared = backend.get_state(&reloaded)?;
    let round_trip_equal = compared == saved;

    log.event(
        "info",
        &format!(
            "state: {} bytes, round-trip {}",
            saved.len(),
            if round_trip_equal { "equal" } else { "different" }
        ),
        Some(&descriptor.class_id),
        None,
        Some(started.elapsed()),
    );
    protocol::emit_result(
        "state",
        json!({
            "stateBytes": saved.len(),
            "stateOut": state_out.to_string_lossy(),
            "roundTripEqual": round_trip_equal,
            "latencySamples": backend.latency_samples(&plugin),
        }),
    );
    Ok(())
}

fn cmd_editor(args: &Args, log: &mut Log) -> CliResult<()> {
    args.ensure_known(&[
        "log-file",
        "plugin",
        "class-id",
        "state-in",
        "state-out",
        "title",
        "auto-close-ms",
    ])?;
    let descriptor = descriptor_from_args(args)?;
    let state = optional_state_arg(args.get("state-in"))?;
    let state_out = validate_output_path(Path::new(args.require("state-out")?), "state output")?;
    let title = args.get("title").unwrap_or("VST3 Editor");
    let auto_close_ms = parse_u32(
        args.get("auto-close-ms").unwrap_or("0"),
        "auto-close-ms",
    )?;
    if auto_close_ms > 600_000 {
        return Err(CliError::bad_args(
            "auto-close-ms must be 0 or at most 600000",
        ));
    }
    let backend = TruceRackBackend::new();
    let started = Instant::now();

    let mut plugin = ManuallyDrop::new(backend.load(
        &descriptor,
        state.as_deref(),
        48_000.0,
        1024,
    )?);
    log.event("info", "editor: plugin loaded", Some(&descriptor.class_id), None, None);
    let window = editor_window::Window::create(title, 900, 650)
        .map_err(|error| CliError::io(format!("create editor window: {error}")))?;
    log.event("info", "editor: parent window created", Some(&descriptor.class_id), None, None);
    let info = backend.open_editor(&mut plugin, backend::EditorParent(window.hwnd()))?;
    log.event("info", "editor: plugin attached", Some(&descriptor.class_id), None, None);
    window.resize(info.width, info.height);
    window.focus();

    if auto_close_ms > 0 {
        let hwnd = window.close_hwnd();
        log.event(
            "info",
            &format!("editor: auto-close armed for {auto_close_ms} ms"),
            Some(&descriptor.class_id),
            None,
            None,
        );
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(u64::from(auto_close_ms)));
            editor_window::post_close(hwnd);
        });
    }

    let auto_close_deadline = if auto_close_ms > 0 {
        // WM_CLOSE should win; this is only a watchdog for a plugin editor
        // that traps the message and would otherwise hang the process.
        Some(
            Instant::now()
                + std::time::Duration::from_millis(u64::from(auto_close_ms) + 1_500),
        )
    } else {
        None
    };
    while editor_window::pump_one() {
        backend.editor_idle(&mut plugin);
        if auto_close_deadline.map_or(false, |deadline| Instant::now() >= deadline) {
            log.event(
                "info",
                "editor: auto-close deadline reached",
                Some(&descriptor.class_id),
                None,
                None,
            );
            break;
        }
    }
    log.event("info", "editor: window loop ended", Some(&descriptor.class_id), None, None);
    backend.close_editor(&mut plugin);
    drop(window);
    log.event("info", "editor: plugin view closed", Some(&descriptor.class_id), None, None);

    let saved = backend.get_state(&plugin)?;
    std::fs::write(&state_out, &saved)
        .map_err(|error| CliError::io(format!("write state {}: {error}", state_out.display())))?;

    log.event(
        "info",
        &format!(
            "editor: closed after {} ms, saved {} state bytes",
            started.elapsed().as_millis(),
            saved.len()
        ),
        Some(&descriptor.class_id),
        None,
        Some(started.elapsed()),
    );
    protocol::emit_result(
        "editor",
        json!({
            "editorOpened": true,
            "width": info.width,
            "height": info.height,
            "resizable": info.resizable,
            "stateBytes": saved.len(),
            "stateOut": state_out.to_string_lossy(),
        }),
    );
    Ok(())
}

fn cmd_impulse(args: &Args, log: &mut Log) -> CliResult<()> {
    args.ensure_known(&[
        "log-file",
        "plugin",
        "class-id",
        "state-in",
        "sample-rate",
        "block-size",
    ])?;
    let (backend, chain, sample_rate, block_size) = test_chain(args)?;
    let mut chain = ManuallyDrop::new(chain);
    let started = Instant::now();
    let report = chain::impulse_test(&mut chain, &backend, sample_rate, block_size)?;
    log.event(
        if report.passed { "info" } else { "warn" },
        &format!(
            "impulse: latency {} samples, peak {} at {}",
            report.latency_samples, report.peak_value, report.peak_index
        ),
        None,
        None,
        Some(started.elapsed()),
    );
    protocol::emit_result(
        "impulse",
        serde_json::to_value(&report)
            .map_err(|error| CliError::io(format!("encode impulse result: {error}")))?,
    );
    Ok(())
}

fn cmd_tail(args: &Args, log: &mut Log) -> CliResult<()> {
    args.ensure_known(&[
        "log-file",
        "plugin",
        "class-id",
        "state-in",
        "sample-rate",
        "block-size",
        "tail-max-ms",
    ])?;
    let (backend, chain, sample_rate, block_size) = test_chain(args)?;
    let mut chain = ManuallyDrop::new(chain);
    let tail_max_ms = parse_f64(args.get("tail-max-ms").unwrap_or("30000"), "tail-max-ms")?;
    let started = Instant::now();
    let report = chain::tail_test(&mut chain, &backend, sample_rate, block_size, tail_max_ms)?;
    log.event(
        "info",
        &format!("tail: {} samples ({:.1} ms)", report.tail_samples, report.tail_ms),
        None,
        None,
        Some(started.elapsed()),
    );
    protocol::emit_result(
        "tail",
        serde_json::to_value(&report)
            .map_err(|error| CliError::io(format!("encode tail result: {error}")))?,
    );
    Ok(())
}

fn cmd_selftest(args: &Args, log: &mut Log) -> CliResult<()> {
    args.ensure_known(&[
        "log-file",
        "plugin",
        "class-id",
        "state-in",
        "sample-rate",
        "block-size",
        "tail-max-ms",
    ])?;
    let tail_max_ms = parse_f64(args.get("tail-max-ms").unwrap_or("30000"), "tail-max-ms")?;
    let started = Instant::now();

    let (backend, chain, sample_rate, block_size) = test_chain(args)?;
    let mut chain = ManuallyDrop::new(chain);
    let impulse = chain::impulse_test(&mut chain, &backend, sample_rate, block_size)?;
    protocol::emit_result(
        "impulse",
        serde_json::to_value(&impulse)
            .map_err(|error| CliError::io(format!("encode impulse result: {error}")))?,
    );

    let (backend, chain, sample_rate, block_size) = test_chain(args)?;
    let mut chain = ManuallyDrop::new(chain);
    let tail = chain::tail_test(&mut chain, &backend, sample_rate, block_size, tail_max_ms)?;
    protocol::emit_result(
        "tail",
        serde_json::to_value(&tail)
            .map_err(|error| CliError::io(format!("encode tail result: {error}")))?,
    );

    log.event(
        "info",
        &format!(
            "selftest: impulse {} (latency {}), tail {} samples",
            if impulse.passed { "passed" } else { "failed" },
            impulse.latency_samples,
            tail.tail_samples
        ),
        None,
        None,
        Some(started.elapsed()),
    );
    Ok(())
}

fn test_chain(args: &Args) -> CliResult<(TruceRackBackend, Chain<TruceRackBackend>, f64, usize)> {
    let descriptor = descriptor_from_args(args)?;
    let sample_rate = parse_u32(
        args.get("sample-rate").unwrap_or("48000"),
        "sample-rate",
    )?;
    if sample_rate == 0 {
        return Err(CliError::bad_args("sample-rate must be positive"));
    }
    let block_size = parse_u32(args.get("block-size").unwrap_or("1024"), "block-size")?;
    if !(16..=8192).contains(&block_size) {
        return Err(CliError::bad_args("block-size must be between 16 and 8192"));
    }
    let state_path = args
        .get("state-in")
        .filter(|value| *value != "none")
        .map(PathBuf::from);
    let spec = ChainSpec::single(
        descriptor.path.clone(),
        descriptor.class_id.clone(),
        state_path,
    );
    let backend = TruceRackBackend::new();
    let chain = Chain::new(
        &backend,
        &[spec],
        f64::from(sample_rate),
        block_size as usize,
    )?;
    Ok((backend, chain, f64::from(sample_rate), block_size as usize))
}

fn specs_from_args(args: &Args) -> CliResult<Vec<ChainSpec>> {
    if let Some(chain_path) = args.get("chain") {
        if args.get("plugin").is_some() {
            return Err(CliError::bad_args(
                "use either --chain or --plugin, not both",
            ));
        }
        return load_chain_file(Path::new(chain_path));
    }
    let plugin = args.require("plugin")?;
    let class_id = args.require("class-id")?;
    let state_file = args
        .get("state-in")
        .filter(|value| *value != "none")
        .map(PathBuf::from);
    Ok(vec![ChainSpec::single(
        PathBuf::from(plugin),
        class_id.to_string(),
        state_file,
    )])
}

fn descriptor_from_args(args: &Args) -> CliResult<ScannedPlugin> {
    ScannedPlugin::from_path_and_class(
        Path::new(args.require("plugin")?),
        args.require("class-id")?,
    )
}

fn optional_state_arg(value: Option<&str>) -> CliResult<Option<Vec<u8>>> {
    match value {
        None | Some("none") => Ok(None),
        Some(path) => {
            let path = validate_input_file(Path::new(path), "state")?;
            Ok(Some(std::fs::read(&path).map_err(|error| {
                CliError::io(format!("read state {}: {error}", path.display()))
            })?))
        }
    }
}

fn validate_abs_path(path: &Path, label: &str) -> CliResult<PathBuf> {
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(CliError::bad_args(format!(
            "{label} path must be absolute: {}",
            path.display()
        )));
    }
    if path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err(CliError::bad_args(format!(
            "{label} path may not contain '..': {}",
            path.display()
        )));
    }
    Ok(path.to_path_buf())
}

fn validate_abs_dir(path: &Path, label: &str) -> CliResult<PathBuf> {
    let path = validate_abs_path(path, label)?;
    if !path.is_dir() {
        return Err(CliError::new(
            ErrorCode::Io,
            format!("{label} does not exist: {}", path.display()),
        ));
    }
    Ok(path)
}

fn validate_input_file(path: &Path, label: &str) -> CliResult<PathBuf> {
    let path = validate_abs_path(path, label)?;
    if !path.is_file() {
        return Err(CliError::new(
            ErrorCode::Io,
            format!("{label} does not exist: {}", path.display()),
        ));
    }
    Ok(path)
}

fn validate_output_path(path: &Path, label: &str) -> CliResult<PathBuf> {
    let path = validate_abs_path(path, label)?;
    if let Some(parent) = path.parent() {
        if !parent.is_dir() {
            return Err(CliError::new(
                ErrorCode::Io,
                format!("{label} directory does not exist: {}", parent.display()),
            ));
        }
    }
    Ok(path)
}

fn parse_u32(value: &str, label: &str) -> CliResult<u32> {
    value
        .parse::<u32>()
        .map_err(|_| CliError::bad_args(format!("{label} must be a positive integer")))
}

fn parse_f64(value: &str, label: &str) -> CliResult<f64> {
    let parsed = value
        .parse::<f64>()
        .map_err(|_| CliError::bad_args(format!("{label} must be a number")))?;
    if !parsed.is_finite() {
        return Err(CliError::bad_args(format!("{label} must be finite")));
    }
    Ok(parsed)
}

fn parse_invocation(raw: Vec<String>) -> CliResult<Invocation> {
    let mut command: Option<String> = None;
    let mut values: HashMap<String, Vec<String>> = HashMap::new();
    let mut index = 0usize;
    while index < raw.len() {
        let argument = &raw[index];
        if argument == "--help" || argument == "-h" {
            return Ok(Invocation {
                command: "help".to_string(),
                args: Args { values },
            });
        }
        if let Some(key) = argument.strip_prefix("--") {
            if key.is_empty() {
                return Err(CliError::bad_args("empty option name"));
            }
            let Some(value) = raw.get(index + 1) else {
                return Err(CliError::bad_args(format!("--{key} needs a value")));
            };
            if value.starts_with("--") {
                return Err(CliError::bad_args(format!("--{key} needs a value")));
            }
            values
                .entry(key.to_string())
                .or_default()
                .push(value.clone());
            index += 2;
        } else if command.is_none() {
            command = Some(argument.clone());
            index += 1;
        } else {
            return Err(CliError::bad_args(format!(
                "unexpected argument {argument:?}"
            )));
        }
    }

    Ok(Invocation {
        command: command.ok_or_else(|| CliError::bad_args("missing command; try --help"))?,
        args: Args { values },
    })
}

/// VST3 editors and some plugins call COM directly on the UI thread. The app
/// will run inside a Tauri webview process that already has COM configured, but
/// this standalone spike must initialize it explicitly.
#[cfg(target_os = "windows")]
fn init_com() {
    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(reserved: *mut std::ffi::c_void, coinit: u32) -> i32;
    }
    // COINIT_APARTMENTTHREADED. S_FALSE / RPC_E_CHANGED_MODE simply mean COM is
    // already initialized, which is fine for the spike.
    const COINIT_APARTMENTTHREADED: u32 = 0x2;
    unsafe {
        CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED);
    }
}

#[cfg(not(target_os = "windows"))]
fn init_com() {}

fn print_help() {
    eprintln!(
        "vsthost-spike - Phase 0 VST3 effect-host spike\n\
         \n\
         Usage:\n\
           vsthost-spike info\n\
           vsthost-spike scan [--dir <abs folder>]... [--out <abs json>]\n\
           vsthost-spike process --plugin <abs .vst3> --class-id <cid> --in <abs wav> --out <abs wav>\n\
                                 [--sample-rate <n>] [--block-size 1024] [--tail-max-ms 5000]\n\
                                 [--discard-head-ms 0] [--state-in <abs file|none>]\n\
           vsthost-spike process --chain <abs chain.json> --in <abs wav> --out <abs wav>\n\
                                 [--sample-rate <n>] [--block-size 1024] [--tail-max-ms 5000]\n\
           vsthost-spike state --plugin <abs .vst3> --class-id <cid>\n\
                               --state-in <abs file|none> --state-out <abs file>\n\
           vsthost-spike editor --plugin <abs .vst3> --class-id <cid>\n\
                                --state-in <abs file|none> --state-out <abs file> [--title <text>]\n\
                                [--auto-close-ms <n>]\n\
           vsthost-spike impulse --plugin <abs .vst3> --class-id <cid> [--sample-rate 48000]\n\
           vsthost-spike tail --plugin <abs .vst3> --class-id <cid> [--tail-max-ms 30000]\n\
           vsthost-spike selftest --plugin <abs .vst3> --class-id <cid>\n\
         \n\
         Global option: --log-file <abs path>\n\
         stdout is JSON lines only. Help and logs go to stderr.\n\
         Input WAVs may be mono or stereo PCM/float; output is stereo 32-bit float.\n\
         The editor command is Windows-only in this spike."
    );
}

#[cfg(target_os = "windows")]
mod editor_window {
    use std::ffi::c_void;
    use std::ptr;

    type Hwnd = *mut c_void;
    type Hinstance = *mut c_void;

    const WS_OVERLAPPEDWINDOW: u32 = 0x00CF_0000;
    const WS_VISIBLE: u32 = 0x1000_0000;
    const WS_CHILD: u32 = 0x4000_0000;
    const WS_CLIPCHILDREN: u32 = 0x0200_0000;
    const CW_USEDEFAULT: i32 = 0x8000_0000u32 as i32;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SW_SHOW: i32 = 5;
    const WM_DESTROY: u32 = 0x0002;
    const WM_CLOSE: u32 = 0x0010;
    const WM_QUIT: u32 = 0x0012;
    const PM_REMOVE: u32 = 0x0001;
    const ERROR_CLASS_ALREADY_EXISTS: u32 = 1410;

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct Msg {
        hwnd: Hwnd,
        message: u32,
        w_param: usize,
        l_param: isize,
        time: u32,
        point: Point,
    }

    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    type WndProc = unsafe extern "system" fn(Hwnd, u32, usize, isize) -> isize;

    #[repr(C)]
    struct WndClassExW {
        size: u32,
        style: u32,
        wnd_proc: Option<WndProc>,
        class_extra: i32,
        window_extra: i32,
        instance: Hinstance,
        icon: *mut c_void,
        cursor: *mut c_void,
        background: *mut c_void,
        menu_name: *const u16,
        class_name: *const u16,
        small_icon: *mut c_void,
    }

    #[link(name = "user32")]
    extern "system" {
        fn CreateWindowExW(
            ex_style: u32,
            class_name: *const u16,
            window_name: *const u16,
            style: u32,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            parent: Hwnd,
            menu: *mut c_void,
            instance: Hinstance,
            param: *mut c_void,
        ) -> Hwnd;
        fn DestroyWindow(hwnd: Hwnd) -> i32;
        fn ShowWindow(hwnd: Hwnd, command: i32) -> i32;
        fn SetForegroundWindow(hwnd: Hwnd) -> i32;
        fn SetWindowPos(
            hwnd: Hwnd,
            insert_after: Hwnd,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
        fn PeekMessageW(msg: *mut Msg, hwnd: Hwnd, min: u32, max: u32, remove: u32) -> i32;
        fn TranslateMessage(msg: *const Msg) -> i32;
        fn DispatchMessageW(msg: *const Msg) -> isize;
        fn AdjustWindowRectEx(rect: *mut Rect, style: u32, menu: i32, ex_style: u32) -> i32;
        fn PostMessageW(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize) -> i32;
        fn RegisterClassExW(class: *const WndClassExW) -> u16;
        fn DefWindowProcW(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize) -> isize;
        fn PostQuitMessage(exit_code: i32);
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> Hinstance;
        fn GetLastError() -> u32;
        fn Sleep(milliseconds: u32);
    }

    unsafe extern "system" fn window_proc(
        hwnd: Hwnd,
        message: u32,
        wparam: usize,
        lparam: isize,
    ) -> isize {
        match message {
            WM_CLOSE => {
                // End the pump; the caller closes the plugin view before the
                // outer window is destroyed in Drop.
                unsafe {
                    PostQuitMessage(0);
                }
                0
            }
            WM_DESTROY => {
                unsafe {
                    PostQuitMessage(0);
                }
                0
            }
            _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
        }
    }

    pub struct Window {
        // The plugin attaches to `inner`, so a plugin that subclasses its
        // parent cannot swallow the close message sent to `outer`.
        outer: Hwnd,
        inner: Hwnd,
    }

    impl Window {
        pub fn create(title: &str, width: u32, height: u32) -> Result<Self, String> {
            let class = wide("BlahBlahVstHostSpike");
            let title = wide(title);
            let instance = unsafe { GetModuleHandleW(ptr::null()) };
            let window_class = WndClassExW {
                size: std::mem::size_of::<WndClassExW>() as u32,
                style: 0,
                wnd_proc: Some(window_proc),
                class_extra: 0,
                window_extra: 0,
                instance,
                icon: ptr::null_mut(),
                cursor: ptr::null_mut(),
                background: ptr::null_mut(),
                menu_name: ptr::null(),
                class_name: class.as_ptr(),
                small_icon: ptr::null_mut(),
            };
            let atom = unsafe { RegisterClassExW(&window_class) };
            if atom == 0 {
                let error = unsafe { GetLastError() };
                if error != ERROR_CLASS_ALREADY_EXISTS {
                    return Err(format!(
                        "RegisterClassExW failed (Windows error {error})"
                    ));
                }
            }
            let mut rect = Rect {
                left: 0,
                top: 0,
                right: width.max(320) as i32,
                bottom: height.max(200) as i32,
            };
            unsafe {
                AdjustWindowRectEx(&mut rect, WS_OVERLAPPEDWINDOW, 0, 0);
            }
            let hwnd = unsafe {
                CreateWindowExW(
                    0,
                    class.as_ptr(),
                    title.as_ptr(),
                    WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_CLIPCHILDREN,
                    CW_USEDEFAULT,
                    CW_USEDEFAULT,
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    instance,
                    ptr::null_mut(),
                )
            };
            if hwnd.is_null() {
                return Err(format!(
                    "CreateWindowExW failed (Windows error {})",
                    unsafe { GetLastError() }
                ));
            }
            let static_class = wide("STATIC");
            let inner = unsafe {
                CreateWindowExW(
                    0,
                    static_class.as_ptr(),
                    ptr::null(),
                    WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
                    0,
                    0,
                    width.max(320) as i32,
                    height.max(200) as i32,
                    hwnd,
                    ptr::null_mut(),
                    instance,
                    ptr::null_mut(),
                )
            };
            if inner.is_null() {
                unsafe {
                    DestroyWindow(hwnd);
                }
                return Err(format!(
                    "CreateWindowExW child failed (Windows error {})",
                    unsafe { GetLastError() }
                ));
            }
            unsafe {
                ShowWindow(hwnd, SW_SHOW);
                ShowWindow(inner, SW_SHOW);
            }
            Ok(Self {
                outer: hwnd,
                inner,
            })
        }

        pub fn hwnd(&self) -> isize {
            self.inner as isize
        }

        pub fn close_hwnd(&self) -> isize {
            self.outer as isize
        }

        pub fn resize(&self, width: u32, height: u32) {
            let width = width.max(320);
            let height = height.max(200);
            let mut rect = Rect {
                left: 0,
                top: 0,
                right: width as i32,
                bottom: height as i32,
            };
            unsafe {
                AdjustWindowRectEx(&mut rect, WS_OVERLAPPEDWINDOW, 0, 0);
                SetWindowPos(
                    self.outer,
                    ptr::null_mut(),
                    0,
                    0,
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                    SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
                );
                SetWindowPos(
                    self.inner,
                    ptr::null_mut(),
                    0,
                    0,
                    width as i32,
                    height as i32,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
        }

        pub fn focus(&self) {
            unsafe {
                ShowWindow(self.outer, SW_SHOW);
                SetForegroundWindow(self.outer);
            }
        }
    }

    impl Drop for Window {
        fn drop(&mut self) {
            if !self.outer.is_null() {
                unsafe {
                    DestroyWindow(self.outer);
                }
                self.outer = ptr::null_mut();
                self.inner = ptr::null_mut();
            }
        }
    }

    pub fn pump_one() -> bool {
        unsafe {
            let mut msg = std::mem::zeroed::<Msg>();
            if PeekMessageW(&mut msg, ptr::null_mut(), 0, 0, PM_REMOVE) == 0 {
                // Keep plugin editors' idle callbacks ticking without a busy
                // loop. The caller checks its auto-close deadline each pass.
                Sleep(10);
                return true;
            }
            if msg.message == WM_QUIT {
                return false;
            }
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
            true
        }
    }

    pub fn post_close(hwnd: isize) {
        if hwnd == 0 {
            return;
        }
        let posted = unsafe { PostMessageW(hwnd as Hwnd, WM_CLOSE, 0, 0) };
        if posted == 0 {
            eprintln!(
                "editor: PostMessageW(WM_CLOSE) failed (Windows error {})",
                unsafe { GetLastError() }
            );
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

#[cfg(not(target_os = "windows"))]
mod editor_window {
    pub struct Window;

    impl Window {
        pub fn create(_title: &str, _width: u32, _height: u32) -> Result<Self, String> {
            Err("the editor command is Windows-only in this spike".to_string())
        }

        pub fn hwnd(&self) -> isize {
            0
        }

        pub fn resize(&self, _width: u32, _height: u32) {}

        pub fn focus(&self) {}
    }

    pub fn pump_one() -> bool {
        false
    }

    pub fn post_close(_hwnd: isize) {}
}
