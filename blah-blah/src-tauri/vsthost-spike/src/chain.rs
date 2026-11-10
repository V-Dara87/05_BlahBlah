// WHY THIS EXISTS
//
// A track insert chain is more than "call one plugin": slots load in order,
// bypassed slots pass audio through, latencies add up, and the output has to
// be shifted back by that total. This module owns that ordering and the
// streaming render loop; it knows nothing about the plugin library, the CLI or
// the Tauri app.
//
// Phase 0 processes one WAV through one plugin, but the same Chain type already
// sums latency across multiple slots so the impulse test and the future
// sidecar share one code path.

use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::backend::{PluginBackend, ScannedPlugin};
use crate::protocol::{CliError, CliResult, ErrorCode};
use crate::wav::{WavSink, WavSource};

pub const MAX_SLOTS: usize = 8;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainSpec {
    pub plugin: PathBuf,
    pub class_id: String,
    #[serde(default)]
    pub state_file: Option<PathBuf>,
    #[serde(default)]
    pub bypass: bool,
}

impl ChainSpec {
    pub fn single(
        plugin: PathBuf,
        class_id: String,
        state_file: Option<PathBuf>,
    ) -> Self {
        Self {
            plugin,
            class_id,
            state_file,
            bypass: false,
        }
    }

    pub fn descriptor(&self) -> CliResult<ScannedPlugin> {
        ScannedPlugin::from_path_and_class(&self.plugin, &self.class_id)
    }
}

pub fn load_chain_file(path: &Path) -> CliResult<Vec<ChainSpec>> {
    let path = validate_file(path, "chain")?;
    let text = std::fs::read_to_string(&path)
        .map_err(|error| CliError::io(format!("read chain {}: {error}", path.display())))?;
    let specs: Vec<ChainSpec> = serde_json::from_str(&text)
        .map_err(|error| CliError::bad_args(format!("invalid chain JSON: {error}")))?;
    if specs.is_empty() {
        return Err(CliError::bad_args("chain must contain at least one plugin"));
    }
    if specs.len() > MAX_SLOTS {
        return Err(CliError::bad_args(format!(
            "chain has {} slots; the maximum is {MAX_SLOTS}",
            specs.len()
        )));
    }
    for spec in &specs {
        spec.descriptor()?;
    }
    Ok(specs)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotSummary {
    pub name: String,
    pub bypass: bool,
    pub latency_samples: usize,
}

struct ChainSlot<P> {
    summary: SlotSummary,
    plugin: Option<P>,
}

pub struct Chain<B: PluginBackend> {
    slots: Vec<ChainSlot<B::Plugin>>,
    latency_samples: usize,
    sample_rate: f64,
    max_block_size: usize,
    warnings: Vec<String>,
}

impl<B: PluginBackend> Chain<B> {
    pub fn new(
        backend: &B,
        specs: &[ChainSpec],
        sample_rate: f64,
        block_size: usize,
    ) -> CliResult<Self> {
        if specs.is_empty() {
            return Err(CliError::bad_args("chain must contain at least one plugin"));
        }
        if specs.len() > MAX_SLOTS {
            return Err(CliError::bad_args(format!(
                "chain has {} slots; the maximum is {MAX_SLOTS}",
                specs.len()
            )));
        }

        let mut slots = Vec::with_capacity(specs.len());
        let mut latency_samples = 0usize;
        let mut warnings = Vec::new();
        for spec in specs {
            let descriptor = spec.descriptor()?;
            if spec.bypass {
                slots.push(ChainSlot {
                    summary: SlotSummary {
                        name: descriptor.name,
                        bypass: true,
                        latency_samples: 0,
                    },
                    plugin: None,
                });
                continue;
            }

            let state = match &spec.state_file {
                Some(path) => Some(read_state(path)?),
                None => None,
            };
            let plugin = match backend.load(
                &descriptor,
                state.as_deref(),
                sample_rate,
                block_size,
            ) {
                Ok(plugin) => plugin,
                // A missing install must not stop playback or export. Keep the
                // slot in the chain as a bypassed pass-through and report it in
                // the result warnings so the UI can show what is missing.
                Err(error) if error.code == ErrorCode::PluginMissing => {
                    warnings.push(format!(
                        "{} bypassed: {}",
                        descriptor.path.display(),
                        error.message
                    ));
                    slots.push(ChainSlot {
                        summary: SlotSummary {
                            name: descriptor.name,
                            bypass: true,
                            latency_samples: 0,
                        },
                        plugin: None,
                    });
                    continue;
                }
                Err(error) => return Err(error),
            };
            let slot_latency = backend.latency_samples(&plugin);
            latency_samples = latency_samples.saturating_add(slot_latency);
            slots.push(ChainSlot {
                summary: SlotSummary {
                    name: descriptor.name,
                    bypass: false,
                    latency_samples: slot_latency,
                },
                plugin: Some(plugin),
            });
        }

        Ok(Self {
            slots,
            latency_samples,
            sample_rate,
            max_block_size: block_size,
            warnings,
        })
    }

    pub fn latency_samples(&self) -> usize {
        self.latency_samples
    }

    pub fn summaries(&self) -> Vec<SlotSummary> {
        self.slots.iter().map(|slot| slot.summary.clone()).collect()
    }

    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    pub fn process_block(
        &mut self,
        backend: &B,
        scratch: &mut Scratch,
        input_l: &[f32],
        input_r: &[f32],
        output_l: &mut [f32],
        output_r: &mut [f32],
        frames: usize,
    ) -> CliResult<()> {
        let capacity = scratch.capacity();
        if frames > capacity {
            return Err(CliError::bad_args(format!(
                "block of {frames} frames exceeds scratch capacity {capacity}"
            )));
        }
        scratch.a_l[..frames].copy_from_slice(&input_l[..frames]);
        scratch.a_r[..frames].copy_from_slice(&input_r[..frames]);

        let sample_rate = self.sample_rate;
        let max_block_size = self.max_block_size;
        for slot in &mut self.slots {
            if slot.summary.bypass {
                continue;
            }
            let Some(plugin) = slot.plugin.as_mut() else {
                continue;
            };
            backend.process_block(
                plugin,
                &scratch.a_l[..frames],
                &scratch.a_r[..frames],
                &mut scratch.b_l[..frames],
                &mut scratch.b_r[..frames],
                sample_rate,
                max_block_size,
            )?;
            std::mem::swap(&mut scratch.a_l, &mut scratch.b_l);
            std::mem::swap(&mut scratch.a_r, &mut scratch.b_r);
        }

        output_l[..frames].copy_from_slice(&scratch.a_l[..frames]);
        output_r[..frames].copy_from_slice(&scratch.a_r[..frames]);
        Ok(())
    }
}

pub struct Scratch {
    a_l: Vec<f32>,
    a_r: Vec<f32>,
    b_l: Vec<f32>,
    b_r: Vec<f32>,
}

impl Scratch {
    pub fn new(block_size: usize) -> Self {
        let block_size = block_size.max(1);
        Self {
            a_l: vec![0.0; block_size],
            a_r: vec![0.0; block_size],
            b_l: vec![0.0; block_size],
            b_r: vec![0.0; block_size],
        }
    }

    fn capacity(&self) -> usize {
        self.a_l.len()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderReport {
    pub input_frames: u64,
    pub output_frames: u64,
    pub latency_samples: usize,
    pub discarded_head_samples: usize,
    pub tail_samples: u64,
    pub tail_ms: f64,
    pub tail_limit_reached: bool,
    pub elapsed_ms: u128,
    pub real_time_factor: f64,
    pub warnings: Vec<String>,
}

/// Streams `source` through the chain and writes a float WAV. This is the
/// single render path the future bounce/export will reuse; it includes the
/// tail rule (250 ms below -80 dBFS, capped by `tail_max_ms`) and head
/// compensation (latency, then optional pre-roll discard).
pub fn render_wav<B: PluginBackend, F: FnMut(f64)>(
    chain: &mut Chain<B>,
    backend: &B,
    source: &mut WavSource,
    sink: &mut WavSink,
    block_size: usize,
    discard_head_ms: f64,
    tail_max_ms: f64,
    mut on_progress: F,
) -> CliResult<RenderReport> {
    let sample_rate = f64::from(source.sample_rate());
    let block_size = block_size.max(1);
    let discard_head_samples = ms_to_samples(discard_head_ms, sample_rate);
    let latency_samples = chain.latency_samples();
    let mut drop_remaining = latency_samples.saturating_add(discard_head_samples);
    let tail_max_samples = ms_to_samples(tail_max_ms, sample_rate);
    let silence_hold_samples = ms_to_samples(250.0, sample_rate);
    let silence_threshold = 1e-4f32; // -80 dBFS
    let total_input = source.frames().max(1);

    let mut scratch = Scratch::new(block_size);
    let mut input_l = vec![0.0f32; block_size];
    let mut input_r = vec![0.0f32; block_size];
    let mut output_l = vec![0.0f32; block_size];
    let mut output_r = vec![0.0f32; block_size];
    let mut write_l = vec![0.0f32; block_size];
    let mut write_r = vec![0.0f32; block_size];

    let started = Instant::now();
    let mut last_progress = Instant::now();
    let mut input_eof = false;
    let mut input_frames_total = 0u64;
    let mut output_frames = 0u64;
    let mut tail_frames = 0u64;
    let mut silence_run = 0usize;
    let mut tail_last_above: Option<u64> = None;
    let mut tail_silence_done = false;

    loop {
        let in_tail;
        let frames;
        if !input_eof {
            let read = source
                .read_block(block_size, &mut input_l, &mut input_r)
                .map_err(CliError::io)?;
            if read == 0 {
                input_eof = true;
                continue;
            }
            frames = read;
            input_frames_total += frames as u64;
            in_tail = false;
        } else {
            if tail_silence_done || tail_frames >= tail_max_samples as u64 {
                break;
            }
            let remaining = tail_max_samples.saturating_sub(tail_frames as usize);
            frames = block_size.min(remaining);
            if frames == 0 {
                break;
            }
            input_l[..frames].fill(0.0);
            input_r[..frames].fill(0.0);
            in_tail = true;
        }

        chain.process_block(
            backend,
            &mut scratch,
            &input_l[..frames],
            &input_r[..frames],
            &mut output_l[..frames],
            &mut output_r[..frames],
            frames,
        )?;

        let mut keep = 0usize;
        for index in 0..frames {
            if drop_remaining > 0 {
                drop_remaining -= 1;
                continue;
            }
            write_l[keep] = output_l[index];
            write_r[keep] = output_r[index];

            if in_tail {
                let output_index = output_frames + keep as u64;
                let amplitude = output_l[index].abs().max(output_r[index].abs());
                if amplitude > silence_threshold {
                    tail_last_above = Some(output_index);
                    silence_run = 0;
                } else {
                    silence_run += 1;
                }
                if silence_run >= silence_hold_samples && tail_last_above.is_some() {
                    tail_silence_done = true;
                }
            }
            keep += 1;
        }

        if keep > 0 {
            sink.write_block(&write_l[..keep], &write_r[..keep], keep)
                .map_err(CliError::io)?;
            output_frames += keep as u64;
            if in_tail {
                tail_frames += keep as u64;
            }
        }

        if last_progress.elapsed() >= Duration::from_millis(100) {
            last_progress = Instant::now();
            let pct = if input_eof {
                let tail_max = tail_max_samples.max(1) as f64;
                90.0 + (tail_frames as f64 / tail_max * 10.0).min(10.0)
            } else {
                (input_frames_total as f64 / total_input as f64 * 90.0).min(90.0)
            };
            on_progress(pct);
        }
    }

    on_progress(100.0);
    let elapsed = started.elapsed();
    let tail_origin = input_frames_total.saturating_sub(discard_head_samples as u64);
    let tail_samples = tail_last_above
        .map(|last| last.saturating_sub(tail_origin).saturating_add(1))
        .unwrap_or(0);
    let tail_limit_reached = tail_max_samples > 0
        && !tail_silence_done
        && tail_frames >= tail_max_samples as u64;
    let audio_seconds = output_frames as f64 / sample_rate;

    Ok(RenderReport {
        input_frames: input_frames_total,
        output_frames,
        latency_samples,
        discarded_head_samples: discard_head_samples,
        tail_samples,
        tail_ms: tail_samples as f64 / sample_rate * 1000.0,
        tail_limit_reached,
        elapsed_ms: elapsed.as_millis(),
        real_time_factor: if audio_seconds > 0.0 {
            elapsed.as_secs_f64() / audio_seconds
        } else {
            0.0
        },
        warnings: chain.warnings().to_vec(),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpulseReport {
    pub latency_samples: usize,
    pub latency_ms: f64,
    pub peak_index: usize,
    pub peak_value: f32,
    pub aligned_index: usize,
    pub passed: bool,
}

pub fn impulse_test<B: PluginBackend>(
    chain: &mut Chain<B>,
    backend: &B,
    sample_rate: f64,
    block_size: usize,
) -> CliResult<ImpulseReport> {
    let block_size = block_size.max(1);
    let search_frames = ((sample_rate * 2.0).ceil() as usize).max(block_size);
    let latency_samples = chain.latency_samples();
    let mut scratch = Scratch::new(block_size);
    let mut input_l = vec![0.0f32; block_size];
    let mut input_r = vec![0.0f32; block_size];
    let mut output_l = vec![0.0f32; block_size];
    let mut output_r = vec![0.0f32; block_size];
    let mut peak_value = 0.0f32;
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
        chain.process_block(
            backend,
            &mut scratch,
            &input_l[..frames],
            &input_r[..frames],
            &mut output_l[..frames],
            &mut output_r[..frames],
            frames,
        )?;
        for index in 0..frames {
            let amplitude = output_l[index].abs().max(output_r[index].abs());
            if amplitude > peak_value {
                peak_value = amplitude;
                peak_index = fed + index;
            }
        }
        fed += frames;
    }

    let aligned_index = peak_index.saturating_sub(latency_samples);
    Ok(ImpulseReport {
        latency_samples,
        latency_ms: latency_samples as f64 / sample_rate * 1000.0,
        peak_index,
        peak_value,
        aligned_index,
        passed: peak_value > 1e-6 && peak_index.abs_diff(latency_samples) <= 1,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailReport {
    pub input_frames: usize,
    pub latency_samples: usize,
    pub tail_samples: u64,
    pub tail_ms: f64,
    pub tail_limit_reached: bool,
    pub elapsed_ms: u128,
}

pub fn tail_test<B: PluginBackend>(
    chain: &mut Chain<B>,
    backend: &B,
    sample_rate: f64,
    block_size: usize,
    tail_max_ms: f64,
) -> CliResult<TailReport> {
    let block_size = block_size.max(1);
    let input_frames = ms_to_samples(100.0, sample_rate).max(1);
    let tail_max_samples = ms_to_samples(tail_max_ms, sample_rate);
    let silence_hold_samples = ms_to_samples(250.0, sample_rate);
    let silence_threshold = 1e-4f32;
    let latency_samples = chain.latency_samples();
    let mut drop_remaining = latency_samples;
    let mut scratch = Scratch::new(block_size);
    let mut input_l = vec![0.0f32; block_size];
    let mut input_r = vec![0.0f32; block_size];
    let mut output_l = vec![0.0f32; block_size];
    let mut output_r = vec![0.0f32; block_size];
    let started = Instant::now();
    let mut fed = 0usize;
    let mut tail_frames = 0u64;
    let mut silence_run = 0usize;
    let mut tail_last_above: Option<u64> = None;
    let mut tail_silence_done = false;

    loop {
        let in_tail = fed >= input_frames;
        if in_tail && (tail_silence_done || tail_frames >= tail_max_samples as u64) {
            break;
        }
        let frames = if in_tail {
            let remaining = tail_max_samples.saturating_sub(tail_frames as usize);
            if remaining == 0 {
                break;
            }
            block_size.min(remaining)
        } else {
            block_size.min(input_frames - fed)
        };
        if frames == 0 {
            break;
        }

        if in_tail {
            input_l[..frames].fill(0.0);
            input_r[..frames].fill(0.0);
        } else {
            for index in 0..frames {
                let t = (fed + index) as f64 / sample_rate;
                let value = (t * 440.0 * std::f64::consts::TAU).sin() as f32 * 0.25;
                input_l[index] = value;
                input_r[index] = value;
            }
        }

        chain.process_block(
            backend,
            &mut scratch,
            &input_l[..frames],
            &input_r[..frames],
            &mut output_l[..frames],
            &mut output_r[..frames],
            frames,
        )?;

        for index in 0..frames {
            if drop_remaining > 0 {
                drop_remaining -= 1;
                continue;
            }
            if in_tail {
                let amplitude = output_l[index].abs().max(output_r[index].abs());
                let output_index = (fed as u64 + index as u64)
                    .saturating_sub(latency_samples as u64);
                if output_index >= input_frames as u64 {
                    if amplitude > silence_threshold {
                        tail_last_above = Some(output_index);
                        silence_run = 0;
                    } else {
                        silence_run += 1;
                    }
                    if silence_run >= silence_hold_samples && tail_last_above.is_some() {
                        tail_silence_done = true;
                    }
                }
                tail_frames += 1;
            }
        }
        fed += frames;
    }

    let tail_samples = tail_last_above
        .map(|last| last.saturating_sub(input_frames as u64).saturating_add(1))
        .unwrap_or(0);
    Ok(TailReport {
        input_frames,
        latency_samples,
        tail_samples,
        tail_ms: tail_samples as f64 / sample_rate * 1000.0,
        tail_limit_reached: tail_max_samples > 0
            && !tail_silence_done
            && tail_frames >= tail_max_samples as u64,
        elapsed_ms: started.elapsed().as_millis(),
    })
}

fn ms_to_samples(ms: f64, sample_rate: f64) -> usize {
    if !(ms.is_finite() && ms > 0.0) {
        return 0;
    }
    (ms / 1000.0 * sample_rate).round() as usize
}

fn validate_file(path: &Path, label: &str) -> CliResult<PathBuf> {
    if !path.is_absolute() {
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
    if !path.is_file() {
        return Err(CliError::new(
            ErrorCode::Io,
            format!("{label} file does not exist: {}", path.display()),
        ));
    }
    Ok(path.to_path_buf())
}

fn read_state(path: &Path) -> CliResult<Vec<u8>> {
    let path = validate_file(path, "state")?;
    std::fs::read(&path)
        .map_err(|error| CliError::io(format!("read state {}: {error}", path.display())))
}
