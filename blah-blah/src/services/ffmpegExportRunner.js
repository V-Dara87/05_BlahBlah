import { runFfmpeg, isTauri, isFfmpegAvailable } from './ffmpegRunner.js';

/**
 * Supported FFmpeg export formats and their codec configuration.
 */
export const FFMPEG_FORMATS = {
  mp4_h264: {
    id: 'mp4_h264',
    label: 'MP4 (H.264 / AAC)',
    extension: 'mp4',
    mimeType: 'video/mp4',
    description: 'Universal playback compatibility with high fidelity CRF encoding.',
  },
  mp4_hevc: {
    id: 'mp4_hevc',
    label: 'MP4 (H.265 / HEVC)',
    extension: 'mp4',
    mimeType: 'video/mp4',
    description: 'Modern high-efficiency codec with superior compression.',
  },
  webm_vp9: {
    id: 'webm_vp9',
    label: 'WebM (VP9 + Opus)',
    extension: 'webm',
    mimeType: 'video/webm',
    description: 'Open-source web video standard with excellent compression.',
  },
  mov_prores: {
    id: 'mov_prores',
    label: 'ProRes 422 (QuickTime)',
    extension: 'mov',
    mimeType: 'video/quicktime',
    description: 'Professional editing master format (virtually lossless, larger size).',
  },
  gif: {
    id: 'gif',
    label: 'Animated GIF',
    extension: 'gif',
    mimeType: 'image/gif',
    description: 'High-quality animated GIF with two-pass palette optimization.',
  },
};

/**
 * Quality / CRF presets for FFmpeg exports.
 */
export const FFMPEG_QUALITY_PRESETS = {
  ultra: {
    id: 'ultra',
    label: 'Ultra Fidelity (CRF 18)',
    crf: 18,
    preset: 'slow',
    description: 'Near-lossless visual quality; recommended for archival and mastering.',
  },
  high: {
    id: 'high',
    label: 'High Quality (CRF 23)',
    crf: 23,
    preset: 'medium',
    description: 'Default balance between crisp visuals and modest file size.',
  },
  standard: {
    id: 'standard',
    label: 'Compact (CRF 28)',
    crf: 28,
    preset: 'fast',
    description: 'Smaller file size, ideal for fast sharing or web previews.',
  },
};

/**
 * Constructs the command line arguments for an FFmpeg export task.
 *
 * @param {object} params
 * @param {string} params.inputPath - Path to the intermediate source video file.
 * @param {string} params.outputPath - Destination path for the exported file.
 * @param {string} [params.format='mp4_h264'] - Format identifier from FFMPEG_FORMATS.
 * @param {string} [params.quality='high'] - Quality identifier from FFMPEG_QUALITY_PRESETS.
 * @param {number} [params.fps=30] - Target framerate.
 * @param {number} [params.width] - Output width (used for GIF scaling).
 * @param {number} [params.height] - Output height.
 * @returns {string[]} Array of CLI arguments.
 */
export function buildFfmpegExportArgs({
  inputPath,
  outputPath,
  format = 'mp4_h264',
  quality = 'high',
  fps = 30,
  width,
}) {
  if (!inputPath || !outputPath) {
    throw new Error('Both inputPath and outputPath are required for FFmpeg export.');
  }

  const qualityPreset = FFMPEG_QUALITY_PRESETS[quality] || FFMPEG_QUALITY_PRESETS.high;
  const { crf, preset } = qualityPreset;

  const baseArgs = ['-y', '-i', inputPath];

  switch (format) {
    case 'mp4_hevc': {
      // H.265 (HEVC) benefits from a slightly higher CRF number for equivalent visual quality
      const hevcCrf = Math.min(32, crf + 4);
      return [
        ...baseArgs,
        '-c:v', 'libx265',
        '-crf', String(hevcCrf),
        '-preset', preset,
        '-pix_fmt', 'yuv420p',
        '-tag:v', 'hvc1',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-progress', 'pipe:1',
        outputPath,
      ];
    }

    case 'webm_vp9': {
      const vp9Crf = Math.min(35, crf + 8);
      return [
        ...baseArgs,
        '-c:v', 'libvpx-vp9',
        '-crf', String(vp9Crf),
        '-b:v', '0',
        '-c:a', 'libopus',
        '-b:a', '128k',
        '-progress', 'pipe:1',
        outputPath,
      ];
    }

    case 'mov_prores': {
      return [
        ...baseArgs,
        '-c:v', 'prores_ks',
        '-profile:v', '3', // ProRes 422 HQ
        '-pix_fmt', 'yuv422p10le',
        '-c:a', 'pcm_s16le',
        '-progress', 'pipe:1',
        outputPath,
      ];
    }

    case 'gif': {
      const gifFps = Math.min(fps, 24);
      const scaleFilter = width ? `scale=${width}:-1:flags=lanczos` : 'scale=-1:-1:flags=lanczos';
      const vf = `fps=${gifFps},${scaleFilter},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
      return [
        ...baseArgs,
        '-vf', vf,
        '-progress', 'pipe:1',
        outputPath,
      ];
    }

    case 'mp4_h264':
    default: {
      return [
        ...baseArgs,
        '-c:v', 'libx264',
        '-crf', String(crf),
        '-preset', preset,
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',
        outputPath,
      ];
    }
  }
}

/**
 * Executes the FFmpeg export process, streaming progress events back to caller.
 *
 * @param {object} params
 * @param {string} params.inputPath - Path to the intermediate source file.
 * @param {string} params.outputPath - Final destination file path.
 * @param {string} [params.format='mp4_h264'] - Format identifier.
 * @param {string} [params.quality='high'] - Quality identifier.
 * @param {number} [params.fps=30] - Target framerate.
 * @param {number} [params.width] - Video width.
 * @param {number} [params.totalDurationSec] - Total composition duration in seconds.
 * @param {(progress: { percent: number, frame: number, speed: string, timeSec: number }) => void} [params.onProgress]
 * @returns {Promise<string>} stdout of the FFmpeg command.
 */
export async function executeFfmpegExport({
  inputPath,
  outputPath,
  format = 'mp4_h264',
  quality = 'high',
  fps = 30,
  width,
  totalDurationSec = 0,
  onProgress,
}) {
  const args = buildFfmpegExportArgs({
    inputPath,
    outputPath,
    format,
    quality,
    fps,
    width,
  });

  let currentFrame = 0;
  let currentSpeed = '1x';
  let currentTimeSec = 0;

  const handleRawProgress = (payload) => {
    if (!payload || !onProgress) return;
    const { key, value } = payload;

    if (key === 'frame') {
      currentFrame = parseInt(value, 10) || currentFrame;
    } else if (key === 'speed') {
      currentSpeed = value || currentSpeed;
    } else if (key === 'out_time_us') {
      const us = parseInt(value, 10);
      if (!isNaN(us) && us > 0) {
        currentTimeSec = us / 1_000_000;
      }
    } else if (key === 'out_time_ms') {
      const ms = parseInt(value, 10);
      if (!isNaN(ms) && ms > 0) {
        currentTimeSec = ms / 1_000;
      }
    }

    let percent = 0;
    if (totalDurationSec > 0 && currentTimeSec > 0) {
      percent = Math.min(99, Math.round((currentTimeSec / totalDurationSec) * 100));
    } else if (fps > 0 && totalDurationSec > 0 && currentFrame > 0) {
      const totalFrames = Math.ceil(totalDurationSec * fps);
      percent = Math.min(99, Math.round((currentFrame / totalFrames) * 100));
    }

    if (key === 'progress' && value === 'end') {
      percent = 100;
    }

    onProgress({
      percent,
      frame: currentFrame,
      speed: currentSpeed,
      timeSec: currentTimeSec,
    });
  };

  return await runFfmpeg(args, { onProgress: handleRawProgress });
}

export { isTauri, isFfmpegAvailable };
