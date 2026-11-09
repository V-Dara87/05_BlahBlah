// WHY THIS EXISTS
//
// The post-processor must stream audio, never hold a whole track in memory.
// This module is the only place that knows the WAV container. It reads any
// normal PCM WAV (8/16/24/32-bit) or IEEE-float WAV into stereo f32 blocks,
// and always writes 32-bit float stereo, so the sidecar never clips or clamps
// what a plugin produced.
//
// Hound is used only as a container codec; sample conversion and block
// boundaries live here.

use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

use hound::{SampleFormat, WavReader, WavSpec, WavWriter};

pub struct WavSource {
    reader: WavReader<BufReader<File>>,
    channels: u16,
    bits: u16,
    is_float: bool,
    sample_rate: u32,
    frames: u64,
}

impl WavSource {
    pub fn open(path: &Path) -> Result<Self, String> {
        let reader = WavReader::open(path)
            .map_err(|error| format!("could not open WAV {}: {error}", path.display()))?;
        let spec = reader.spec();
        if spec.channels == 0 {
            return Err("WAV has zero channels".to_string());
        }
        if spec.channels > 2 {
            return Err(format!(
                "WAV must be mono or stereo, got {} channels",
                spec.channels
            ));
        }
        if spec.sample_rate == 0 {
            return Err("WAV has a zero sample rate".to_string());
        }
        if spec.sample_format == SampleFormat::Int && spec.bits_per_sample > 32 {
            return Err(format!(
                "{}-bit integer WAV is not supported",
                spec.bits_per_sample
            ));
        }
        let frames = u64::from(reader.duration());
        Ok(Self {
            reader,
            channels: spec.channels,
            bits: spec.bits_per_sample,
            is_float: spec.sample_format == SampleFormat::Float,
            sample_rate: spec.sample_rate,
            frames,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn frames(&self) -> u64 {
        self.frames
    }

    /// Reads up to `max_frames` interleaved frames into planar stereo buffers.
    /// Returns 0 at end of file. A mono source is duplicated to both sides.
    pub fn read_block(
        &mut self,
        max_frames: usize,
        left: &mut [f32],
        right: &mut [f32],
    ) -> Result<usize, String> {
        let capacity = max_frames.min(left.len()).min(right.len());
        if capacity == 0 {
            return Ok(0);
        }

        if self.is_float {
            let mut samples = self.reader.samples::<f32>();
            if self.channels == 1 {
                let mut count = 0;
                while count < capacity {
                    let Some(sample) = samples.next() else {
                        break;
                    };
                    let value = sample.map_err(|error| format!("WAV read failed: {error}"))?;
                    left[count] = value;
                    right[count] = value;
                    count += 1;
                }
                return Ok(count);
            }
            let mut count = 0;
            while count < capacity {
                let Some(first) = samples.next() else {
                    break;
                };
                let Some(second) = samples.next() else {
                    break;
                };
                left[count] =
                    first.map_err(|error| format!("WAV read failed: {error}"))?;
                right[count] =
                    second.map_err(|error| format!("WAV read failed: {error}"))?;
                count += 1;
            }
            return Ok(count);
        }

        let scale = sample_scale(self.bits);
        let mut samples = self.reader.samples::<i32>();
        if self.channels == 1 {
            let mut count = 0;
            while count < capacity {
                let Some(sample) = samples.next() else {
                    break;
                };
                let value = sample.map_err(|error| format!("WAV read failed: {error}"))?;
                let normalized = value as f64 / scale;
                left[count] = normalized as f32;
                right[count] = normalized as f32;
                count += 1;
            }
            return Ok(count);
        }
        let mut count = 0;
        while count < capacity {
            let Some(first) = samples.next() else {
                break;
            };
            let Some(second) = samples.next() else {
                break;
            };
            let first = first.map_err(|error| format!("WAV read failed: {error}"))?;
            let second = second.map_err(|error| format!("WAV read failed: {error}"))?;
            left[count] = (first as f64 / scale) as f32;
            right[count] = (second as f64 / scale) as f32;
            count += 1;
        }
        Ok(count)
    }
}

fn sample_scale(bits: u16) -> f64 {
    if bits == 0 || bits >= 63 {
        return 1.0;
    }
    (1u64 << (bits - 1)) as f64
}

pub struct WavSink {
    writer: WavWriter<BufWriter<File>>,
    frames_written: u64,
}

impl WavSink {
    pub fn create(path: &Path, sample_rate: u32) -> Result<Self, String> {
        if sample_rate == 0 {
            return Err("cannot write a WAV at a zero sample rate".to_string());
        }
        let spec = WavSpec {
            channels: 2,
            sample_rate,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        };
        let writer = WavWriter::create(path, spec)
            .map_err(|error| format!("could not create WAV {}: {error}", path.display()))?;
        Ok(Self {
            writer,
            frames_written: 0,
        })
    }

    /// Writes exactly `frames` frames from planar buffers. No clamping: the
    /// contract is that the file preserves whatever the chain produced.
    pub fn write_block(
        &mut self,
        left: &[f32],
        right: &[f32],
        frames: usize,
    ) -> Result<(), String> {
        for index in 0..frames {
            self.writer
                .write_sample(left[index])
                .map_err(|error| format!("WAV write failed: {error}"))?;
            self.writer
                .write_sample(right[index])
                .map_err(|error| format!("WAV write failed: {error}"))?;
        }
        self.frames_written += frames as u64;
        Ok(())
    }

    pub fn finalize(self) -> Result<u64, String> {
        let frames = self.frames_written;
        self.writer
            .finalize()
            .map_err(|error| format!("WAV finalize failed: {error}"))?;
        Ok(frames)
    }
}
