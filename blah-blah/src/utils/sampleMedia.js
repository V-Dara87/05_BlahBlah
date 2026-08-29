/**
 * Utility to generate procedural sample audio (synth chords/beats)
 * and procedural sample canvas videos for instant testing without external downloads.
 */

// Generate a sample synthetic audio track (synth beat/chords) as a WAV Blob URL
export function createSyntheticAudio(durationSec = 8, sampleRate = 44100) {
  const numChannels = 2;
  const numFrames = sampleRate * durationSec;
  const buffer = new ArrayBuffer(44 + numFrames * numChannels * 2);
  const view = new DataView(buffer);

  // Write WAV header
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numFrames * numChannels * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(36, 'data');
  view.setUint32(40, numFrames * numChannels * 2, true);

  // Synthesize musical tones: chords (C-E-G-A progression) with subtle beat
  const chordFreqs = [
    [261.63, 329.63, 392.0], // C major
    [220.0, 261.63, 329.63], // A minor
    [174.61, 220.0, 261.63], // F major
    [196.0, 246.94, 293.66], // G major
  ];

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const t = i / sampleRate;
    const chordIndex = Math.floor((t / 2) % chordFreqs.length);
    const freqs = chordFreqs[chordIndex];

    // Synth pad
    let sampleVal = 0;
    freqs.forEach((f, idx) => {
      const vibrato = Math.sin(2 * Math.PI * 4 * t) * 1.5;
      sampleVal += Math.sin(2 * Math.PI * (f + vibrato) * t) * (0.15 / (idx + 1));
    });

    // Rhythmic kick / percussion click
    const beatTime = t % 0.5;
    if (beatTime < 0.1) {
      const env = Math.exp(-beatTime * 40);
      const kick = Math.sin(2 * Math.PI * (120 * Math.exp(-beatTime * 30)) * beatTime) * env;
      sampleVal += kick * 0.4;
    }

    // Hi-hat tick
    const hatTime = (t + 0.25) % 0.5;
    if (hatTime < 0.05) {
      const hatEnv = Math.exp(-hatTime * 80);
      sampleVal += (Math.random() * 2 - 1) * hatEnv * 0.15;
    }

    // Clamp
    sampleVal = Math.max(-1, Math.min(1, sampleVal));
    const intVal = sampleVal < 0 ? sampleVal * 0x8000 : sampleVal * 0x7fff;

    // Left channel
    view.setInt16(offset, intVal, true);
    // Right channel
    view.setInt16(offset + 2, intVal, true);
    offset += 4;
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

// Generate animated colorful motion clip as WebM video Blob
export function createSyntheticVideo(durationSec = 6, width = 640, height = 360) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const stream = canvas.captureStream(30);
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
        ? 'video/webm; codecs=vp9'
        : 'video/webm'
    });

    const chunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      resolve(URL.createObjectURL(blob));
    };

    mediaRecorder.start();

    const startTime = performance.now();
    const fps = 30;
    const interval = 1000 / fps;

    const timer = setInterval(() => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed >= durationSec) {
        clearInterval(timer);
        mediaRecorder.stop();
        return;
      }

      // Draw beautiful dynamic motion graphic
      const t = elapsed;
      
      // Gradient background
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, `hsl(${(t * 40) % 360}, 65%, 20%)`);
      grad.addColorStop(1, `hsl(${(t * 40 + 120) % 360}, 60%, 10%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Rotating glowing rings
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        const r = 40 + i * 25 + Math.sin(t * 3 + i) * 15;
        const cx = width / 2 + Math.sin(t * 1.5 + i) * 80;
        const cy = height / 2 + Math.cos(t * 1.5 + i) * 40;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${(t * 60 + i * 40) % 360}, 85%, 65%, 0.6)`;
        ctx.lineWidth = 4 + i;
        ctx.stroke();
      }

      // Central stylized title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 10;
      ctx.fillText('Sample Motion Video', width / 2, height / 2 - 15);

      ctx.fillStyle = '#38bdf8';
      ctx.font = '600 18px monospace';
      ctx.fillText(`TIME: ${t.toFixed(2)}s / ${durationSec.toFixed(1)}s`, width / 2, height / 2 + 25);
      ctx.shadowBlur = 0;
    }, interval);
  });
}

// Default stock clips array for immediate testing
export const DEFAULT_STOCK_MEDIA = [
  {
    id: 'stock-vid-1',
    name: 'Abstract Waves (60fps)',
    type: 'video',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    duration: 15,
    size: 2400000,
    thumbnail: '🎬'
  },
  {
    id: 'stock-vid-2',
    name: 'Ocean Coastline',
    type: 'video',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    duration: 15,
    size: 3100000,
    thumbnail: '🌊'
  },
  {
    id: 'stock-aud-1',
    name: 'Cinematic Ambient Beat',
    type: 'audio',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    duration: 30,
    size: 980000,
    thumbnail: '🎵'
  }
];
