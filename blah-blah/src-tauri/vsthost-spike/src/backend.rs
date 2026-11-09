// WHY THIS EXISTS
//
// This is the only file that may call into the plugin-host library. Everything
// else (CLI, chain, WAV, tests) talks to the small PluginBackend trait below,
// so replacing truce-rack with vst3-host means changing this file and the
// dependency, not rewriting the renderer.
//
// The spike deliberately loads plugins in-process. Phase 1 moves scanning and
// processing into the isolated sidecar and adds child-process scan probes.

use std::collections::HashSet;
use std::ffi::c_void;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

use serde::Serialize;
use truce_rack::core::buffer::{AudioBuffer, BusRange};
use truce_rack::core::bus::BusLayout;
use truce_rack::core::editor::WindowHandle;
use truce_rack::core::events::EventList;
use truce_rack::core::info::{PluginCategory, PluginInfo};
use truce_rack::core::plugin::{Plugin, PluginCore, ProcessContext, ProcessStatus};
use truce_rack::core::scanner::PluginScanner;
use truce_rack::core::Error as RackError;
use truce_rack::vst3::{default_vst3_paths, Vst3Plugin, Vst3Scanner};

use crate::protocol::{CliError, CliResult, ErrorCode};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedPlugin {
    pub name: String,
    pub vendor: String,
    pub version: u32,
    pub category: String,
    pub path: PathBuf,
    pub class_id: String,
    pub format: String,
    pub has_editor: bool,
    pub accepts_midi: bool,
    #[serde(skip)]
    pub(crate) info: PluginInfo,
}

impl ScannedPlugin {
    fn from_info(info: PluginInfo) -> Self {
        let category = match info.category {
            PluginCategory::Effect => "effect",
            PluginCategory::Instrument => "instrument",
            PluginCategory::NoteEffect => "note-effect",
            PluginCategory::Analyzer => "analyzer",
            PluginCategory::Tool => "tool",
        };
        Self {
            name: info.name.clone(),
            vendor: info.vendor.clone(),
            version: info.version,
            category: category.to_string(),
            path: info.path.clone(),
            class_id: info.unique_id.clone(),
            format: info.format.to_string(),
            has_editor: info.has_editor,
            accepts_midi: info.accepts_midi,
            info,
        }
    }

    /// Builds the minimum PluginInfo a load needs from a chain entry. The
    /// scanner later replaces the display metadata with the plugin's own.
    pub fn from_path_and_class(
        path: impl AsRef<Path>,
        class_id: &str,
    ) -> CliResult<Self> {
        let path = validate_plugin_path(path.as_ref())?;
        let class_id = validate_class_id(class_id)?;
        let name = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("VST3 plugin")
            .to_string();
        Ok(Self::from_info(PluginInfo {
            name,
            vendor: String::new(),
            version: 0,
            category: PluginCategory::Effect,
            path,
            unique_id: class_id,
            format: "vst3",
            has_editor: false,
            accepts_midi: false,
        }))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFailure {
    pub path: PathBuf,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOutcome {
    pub dirs: Vec<PathBuf>,
    pub plugins: Vec<ScannedPlugin>,
    pub failed: Vec<ScanFailure>,
    pub elapsed_ms: u128,
}

/// Native parent handle for an editor. Kept as an integer so the trait does
/// not leak the plugin library's WindowHandle type.
#[derive(Debug, Clone, Copy)]
pub struct EditorParent(pub isize);

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorInfo {
    pub width: u32,
    pub height: u32,
    pub resizable: bool,
}

pub trait PluginBackend {
    type Plugin;

    fn scan(&self, dirs: &[PathBuf]) -> CliResult<ScanOutcome>;
    fn load(
        &self,
        plugin: &ScannedPlugin,
        state: Option<&[u8]>,
        sample_rate: f64,
        block_size: usize,
    ) -> CliResult<Self::Plugin>;
    fn get_state(&self, plugin: &Self::Plugin) -> CliResult<Vec<u8>>;
    fn set_state(&self, plugin: &mut Self::Plugin, state: &[u8]) -> CliResult<()>;
    fn process_block(
        &self,
        plugin: &mut Self::Plugin,
        input_l: &[f32],
        input_r: &[f32],
        output_l: &mut [f32],
        output_r: &mut [f32],
        sample_rate: f64,
        max_block_size: usize,
    ) -> CliResult<()>;
    fn latency_samples(&self, plugin: &Self::Plugin) -> usize;
    fn open_editor(
        &self,
        plugin: &mut Self::Plugin,
        parent: EditorParent,
    ) -> CliResult<EditorInfo>;
    fn editor_idle(&self, plugin: &mut Self::Plugin);
    fn close_editor(&self, plugin: &mut Self::Plugin);
}

pub struct HostedPlugin {
    plugin: Vst3Plugin,
    latency_samples: usize,
}

pub struct TruceRackBackend {
    scanner: Vst3Scanner,
}

impl TruceRackBackend {
    pub fn new() -> Self {
        Self {
            scanner: Vst3Scanner::new(),
        }
    }

    fn load_raw(
        &self,
        descriptor: &ScannedPlugin,
        state: Option<&[u8]>,
        sample_rate: f64,
        block_size: usize,
    ) -> CliResult<Vst3Plugin> {
        if !(sample_rate.is_finite() && sample_rate > 0.0) {
            return Err(CliError::bad_args("sample rate must be positive"));
        }
        if block_size == 0 {
            return Err(CliError::bad_args("block size must be positive"));
        }
        let mut plugin = self
            .scanner
            .load(&descriptor.info)
            .map_err(|error| load_error("load", descriptor, error))?;
        if let Some(state) = state {
            plugin
                .load_state(state)
                .map_err(|error| load_error("set state", descriptor, error))?;
        }
        plugin
            .activate(BusLayout::stereo(), sample_rate, block_size)
            .map_err(|error| load_error("activate", descriptor, error))?;
        Ok(plugin)
    }

    /// The spec needs the chain's total latency so the renderer can drop that
    /// many samples. truce-rack 1.1.5 has no latency getter, so this spike
    /// derives it from the impulse response of a throw-away instance.
    ///
    // VERIFY: replace this with the plugin-reported
    // IAudioProcessor::getLatencySamples value. truce-rack 1.1.5's public
    // PluginCore/Plugin traits expose no latency method, so an impulse probe is
    // the only option here. A linear-phase EQ or a wet-only reverb can make
    // this estimate differ from the plugin's own latency; Phase 1 must not
    // ship this as the production latency source.
    fn probe_latency(
        &self,
        descriptor: &ScannedPlugin,
        state: Option<&[u8]>,
        sample_rate: f64,
        block_size: usize,
    ) -> CliResult<usize> {
        let mut probe = self.load_raw(descriptor, state, sample_rate, block_size)?;
        let search_frames = ((sample_rate * 2.0).ceil() as usize).max(block_size);
        let mut input_l = vec![0.0f32; block_size];
        let mut input_r = vec![0.0f32; block_size];
        let mut output_l = vec![0.0f32; block_size];
        let mut output_r = vec![0.0f32; block_size];
        let mut peak = 0.0f32;
        let mut peak_index = 0usize;
        let mut fed = 0usize;

        while fed < search_frames {
            let frames = block_size.min(search_frames - fed);
            input_l[..frames].fill(0.0);
            input_r[..frames].fill(0.0);
            if fed == 0 {
                input_l[0] = 1.0;
                input_r[0] = 1.0;
            }
            self.process_raw(
                &mut probe,
                &input_l[..frames],
                &input_r[..frames],
                &mut output_l[..frames],
                &mut output_r[..frames],
                frames,
                sample_rate,
                block_size,
            )?;
            for index in 0..frames {
                let amplitude = output_l[index].abs().max(output_r[index].abs());
                if amplitude > peak {
                    peak = amplitude;
                    peak_index = fed + index;
                }
            }
            fed += frames;
        }

        if peak < 1e-7 {
            Ok(0)
        } else {
            Ok(peak_index)
        }
    }

    fn process_raw(
        &self,
        plugin: &mut Vst3Plugin,
        input_l: &[f32],
        input_r: &[f32],
        output_l: &mut [f32],
        output_r: &mut [f32],
        frames: usize,
        sample_rate: f64,
        max_block_size: usize,
    ) -> CliResult<()> {
        let inputs: [&[f32]; 2] = [&input_l[..frames], &input_r[..frames]];
        let mut outputs: [&mut [f32]; 2] =
            [&mut output_l[..frames], &mut output_r[..frames]];
        let ranges = [BusRange::new(0, 2)];
        let mut buffer = AudioBuffer::new(&inputs, &mut outputs, frames, &ranges, &ranges);
        let events = EventList::new();
        let mut output_events = EventList::new();
        let mut context = ProcessContext {
            sample_rate,
            max_block_size,
            transport: None,
            output_events: &mut output_events,
        };

        match Plugin::<f32>::process(plugin, &mut buffer, &events, &mut context) {
            Ok(ProcessStatus::Continue | ProcessStatus::Sleep | ProcessStatus::Tail { .. }) => {
                Ok(())
            }
            Ok(ProcessStatus::Error) => Err(CliError::new(
                ErrorCode::PluginCrash,
                "plugin reported an error while processing",
            )),
            Err(error) => Err(process_error(error)),
        }
    }
}

impl Default for TruceRackBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl PluginBackend for TruceRackBackend {
    type Plugin = HostedPlugin;

    fn scan(&self, dirs: &[PathBuf]) -> CliResult<ScanOutcome> {
        let started = Instant::now();
        let explicit_dirs = !dirs.is_empty();
        let scan_dirs = if explicit_dirs {
            dirs.iter()
                .map(|dir| validate_scan_dir(dir))
                .collect::<CliResult<Vec<_>>>()?
        } else {
            default_vst3_paths()
        };

        let mut plugins = Vec::new();
        let mut failed = Vec::new();
        let mut seen = HashSet::<(String, String)>::new();

        for dir in &scan_dirs {
            if !dir.is_dir() {
                if explicit_dirs {
                    failed.push(ScanFailure {
                        path: dir.clone(),
                        reason: "scan folder does not exist".to_string(),
                    });
                }
                continue;
            }

            let expected = vst3_bundles(dir);
            let infos = match self.scanner.scan_path(dir) {
                Ok(infos) => infos,
                Err(error) => {
                    failed.push(ScanFailure {
                        path: dir.clone(),
                        reason: format!("scan failed: {error}"),
                    });
                    continue;
                }
            };

            let mut found = HashSet::<String>::new();
            for info in infos {
                found.insert(path_key(&info.path));
                let key = (path_key(&info.path), info.unique_id.to_ascii_lowercase());
                if seen.insert(key) {
                    plugins.push(ScannedPlugin::from_info(info));
                }
            }

            for path in expected {
                if !found.contains(&path_key(&path)) {
                    // VERIFY: PluginScanner::scan_path logs and skips a bundle
                    // that fails to load, so this list is inferred from the
                    // bundles that produced no loadable effect class. It may
                    // also contain instruments, which the scanner currently
                    // reports as "Audio Module Class" effects only.
                    failed.push(ScanFailure {
                        path,
                        reason: "no loadable effect class returned (instrument, unsupported, or failed to load)".to_string(),
                    });
                }
            }
        }

        plugins.sort_by(|a, b| {
            a.name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase())
                .then_with(|| a.class_id.cmp(&b.class_id))
        });

        Ok(ScanOutcome {
            dirs: scan_dirs,
            plugins,
            failed,
            elapsed_ms: started.elapsed().as_millis(),
        })
    }

    fn load(
        &self,
        plugin: &ScannedPlugin,
        state: Option<&[u8]>,
        sample_rate: f64,
        block_size: usize,
    ) -> CliResult<Self::Plugin> {
        let actual = self.load_raw(plugin, state, sample_rate, block_size)?;
        let latency_samples = match self.probe_latency(plugin, state, sample_rate, block_size) {
            Ok(latency) => latency,
            Err(error) => {
                eprintln!(
                    "warning: latency probe failed for {}: {}",
                    plugin.path.display(),
                    error
                );
                0
            }
        };
        Ok(HostedPlugin {
            plugin: actual,
            latency_samples,
        })
    }

    fn get_state(&self, plugin: &Self::Plugin) -> CliResult<Vec<u8>> {
        plugin
            .plugin
            .save_state()
            .map_err(|error| state_error("save state", error))
    }

    fn set_state(&self, plugin: &mut Self::Plugin, state: &[u8]) -> CliResult<()> {
        plugin
            .plugin
            .load_state(state)
            .map_err(|error| state_error("set state", error))
    }

    fn process_block(
        &self,
        plugin: &mut Self::Plugin,
        input_l: &[f32],
        input_r: &[f32],
        output_l: &mut [f32],
        output_r: &mut [f32],
        sample_rate: f64,
        max_block_size: usize,
    ) -> CliResult<()> {
        let frames = input_l
            .len()
            .min(input_r.len())
            .min(output_l.len())
            .min(output_r.len());
        self.process_raw(
            &mut plugin.plugin,
            input_l,
            input_r,
            output_l,
            output_r,
            frames,
            sample_rate,
            max_block_size,
        )
    }

    fn latency_samples(&self, plugin: &Self::Plugin) -> usize {
        plugin.latency_samples
    }

    fn open_editor(
        &self,
        plugin: &mut Self::Plugin,
        parent: EditorParent,
    ) -> CliResult<EditorInfo> {
        let editor = plugin
            .plugin
            .editor()
            .ok_or_else(|| CliError::new(ErrorCode::LoadFailed, "plugin has no editor"))?;
        editor
            .open(WindowHandle::HWND(parent.0 as *mut c_void), 1.0)
            .map_err(|error| CliError::new(ErrorCode::LoadFailed, format!("open editor: {error}")))?;
        editor.show();
        let mut size = editor.size().unwrap_or((900, 650));
        // Some VST3 editors report a placeholder size until the host asks for
        // a real one. set_size also lets the plugin apply its own constraints.
        if size.0 < 32 || size.1 < 32 {
            size = editor
                .set_size(900, 650)
                .filter(|(width, height)| *width >= 32 && *height >= 32)
                .unwrap_or((900, 650));
        }
        Ok(EditorInfo {
            width: size.0,
            height: size.1,
            resizable: editor.is_resizable(),
        })
    }

    fn editor_idle(&self, plugin: &mut Self::Plugin) {
        if let Some(editor) = plugin.plugin.editor() {
            editor.on_idle();
        }
    }

    fn close_editor(&self, plugin: &mut Self::Plugin) {
        if let Some(editor) = plugin.plugin.editor() {
            editor.close();
        }
    }
}

pub fn validate_plugin_path(path: &Path) -> CliResult<PathBuf> {
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(CliError::bad_args(format!(
            "plugin path must be absolute: {}",
            path.display()
        )));
    }
    if path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err(CliError::bad_args(format!(
            "plugin path may not contain '..': {}",
            path.display()
        )));
    }
    let is_vst3 = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase().ends_with(".vst3"))
        .unwrap_or(false);
    if !is_vst3 {
        return Err(CliError::bad_args(format!(
            "plugin path must end in .vst3: {}",
            path.display()
        )));
    }
    if !path.exists() {
        return Err(CliError::new(
            ErrorCode::PluginMissing,
            format!("plugin does not exist: {}", path.display()),
        ));
    }
    Ok(path.to_path_buf())
}

pub fn validate_class_id(class_id: &str) -> CliResult<String> {
    let trimmed = class_id.trim();
    if trimmed.len() != 32 || !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(CliError::bad_args(
            "class id must be the 32-character VST3 CID hex string shown by scan",
        ));
    }
    Ok(trimmed.to_ascii_lowercase())
}

fn validate_scan_dir(dir: &Path) -> CliResult<PathBuf> {
    if !dir.is_absolute() {
        return Err(CliError::bad_args(format!(
            "scan folder must be absolute: {}",
            dir.display()
        )));
    }
    if dir.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err(CliError::bad_args(format!(
            "scan folder may not contain '..': {}",
            dir.display()
        )));
    }
    Ok(dir.to_path_buf())
}

fn vst3_bundles(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_ascii_lowercase().ends_with(".vst3"))
                .unwrap_or(false)
        })
        .collect()
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().to_ascii_lowercase()
}

fn load_error(stage: &str, plugin: &ScannedPlugin, error: RackError) -> CliError {
    let code = match &error {
        RackError::PluginNotFound(_) => ErrorCode::PluginMissing,
        RackError::Io(_) => ErrorCode::Io,
        RackError::Panic { .. } => ErrorCode::PluginCrash,
        _ => ErrorCode::LoadFailed,
    };
    CliError::new(
        code,
        format!("{stage} {}: {error}", plugin.path.display()),
    )
    .with_plugin(plugin.class_id.clone())
}

fn process_error(error: RackError) -> CliError {
    let code = match &error {
        RackError::Panic { .. } => ErrorCode::PluginCrash,
        RackError::NotActivated => ErrorCode::LoadFailed,
        _ => ErrorCode::PluginCrash,
    };
    CliError::new(code, format!("processing failed: {error}"))
}

fn state_error(stage: &str, error: RackError) -> CliError {
    let code = match &error {
        RackError::Panic { .. } => ErrorCode::PluginCrash,
        RackError::Io(_) => ErrorCode::Io,
        _ => ErrorCode::LoadFailed,
    };
    CliError::new(code, format!("{stage}: {error}"))
}
