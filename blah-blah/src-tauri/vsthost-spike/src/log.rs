// WHY THIS EXISTS
//
// Plugin hosts need a paper trail when a plugin crashes or a user reports a
// bad bounce, but a log must never contain audio. This rolling logger writes
// one line per event (timestamp, command, plugin id, error code, duration) to
// stderr and, when asked, to a file capped at 5 MB with one previous file.
//
// The timestamp is UTC and derived from the system clock without pulling in a
// date/time crate.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::protocol::ErrorCode;

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

pub struct Log {
    command: String,
    path: Option<PathBuf>,
    file: Option<File>,
}

impl Log {
    pub fn new(path: Option<&Path>, command: &str) -> io::Result<Self> {
        let path = path.map(Path::to_path_buf);
        if let Some(path) = &path {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            if fs::metadata(path).map(|meta| meta.len() >= MAX_LOG_BYTES).unwrap_or(false) {
                rotate(path)?;
            }
        }
        let file = match &path {
            Some(path) => Some(
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)?,
            ),
            None => None,
        };
        Ok(Self {
            command: command.to_string(),
            path,
            file,
        })
    }

    /// `level` is "info", "warn" or "error". `plugin` is the VST3 class id,
    /// never a file's audio; `duration` is optional because not every event is
    /// tied to a timed operation.
    pub fn event(
        &mut self,
        level: &str,
        message: &str,
        plugin: Option<&str>,
        code: Option<ErrorCode>,
        duration: Option<Duration>,
    ) {
        let mut line = format!(
            "{} level={} command={}",
            timestamp_now(),
            level,
            self.command
        );
        if let Some(plugin) = plugin {
            line.push_str(" plugin=");
            line.push_str(&single_line(plugin));
        }
        if let Some(code) = code {
            line.push_str(" code=");
            line.push_str(&format!("{code:?}"));
        }
        if let Some(duration) = duration {
            line.push_str(&format!(" duration_ms={}", duration.as_millis()));
        }
        line.push_str(" message=");
        line.push_str(&single_line(message));

        eprintln!("{line}");
        if let Some(file) = &mut self.file {
            let _ = writeln!(file, "{line}");
            let _ = file.flush();
        }
        self.rotate_if_needed();
    }

    fn rotate_if_needed(&mut self) {
        let Some(path) = self.path.clone() else {
            return;
        };
        let too_large = self
            .file
            .as_ref()
            .and_then(|file| file.metadata().ok())
            .map(|meta| meta.len() >= MAX_LOG_BYTES)
            .unwrap_or(false);
        if !too_large {
            return;
        }
        self.file = None;
        if rotate(&path).is_ok() {
            self.file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .ok();
        }
    }
}

fn rotate(path: &Path) -> io::Result<()> {
    let backup = path.with_extension("log.1");
    if backup.exists() {
        fs::remove_file(&backup)?;
    }
    if path.exists() {
        fs::rename(path, backup)?;
    }
    Ok(())
}

fn single_line(value: &str) -> String {
    value
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect()
}

fn timestamp_now() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format_timestamp(millis as i64)
}

fn format_timestamp(unix_ms: i64) -> String {
    let seconds = unix_ms.div_euclid(1000);
    let millis = unix_ms.rem_euclid(1000);
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z"
    )
}

/// Howard Hinnant's days-from-civil inverse. Kept here so the spike needs no
/// date/time dependency.
fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::format_timestamp;

    #[test]
    fn formats_epoch_and_a_known_date() {
        assert_eq!(format_timestamp(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(format_timestamp(1_700_000_000_000), "2023-11-14T22:13:20.000Z");
    }
}
