#!/usr/bin/env node
/**
 * Downloads (or builds) the FFmpeg and whisper-cli sidecar binaries that Tauri
 * bundles, and puts them in src-tauri/binaries/ under the name Tauri expects:
 *
 *     <name>-<target-triple>[.exe]      e.g. ffmpeg-x86_64-pc-windows-msvc.exe
 *
 * Usage (from the repo root, Node 18+, no npm dependencies):
 *
 *     node scripts/download-sidecars.mjs                 # host platform, skips files that exist
 *     node scripts/download-sidecars.mjs --force         # re-download everything
 *     node scripts/download-sidecars.mjs --only ffmpeg   # or: --only whisper
 *     node scripts/download-sidecars.mjs --target aarch64-apple-darwin
 *     node scripts/download-sidecars.mjs --whisper-tag v1.8.2
 *
 * Where the binaries come from
 *   FFmpeg      eugeneware/ffmpeg-static release builds (single static file per
 *               platform), SHA-256 pinned below.
 *   whisper-cli Windows x64: the official ggml-org/whisper.cpp release zip
 *               (SHA-256 pinned). That build is NOT a single exe - it needs
 *               whisper.dll, ggml.dll, ggml-base.dll and ggml-cpu.dll next to
 *               it - so the DLLs go to src-tauri/binaries/windows-dlls/ and are
 *               listed in src-tauri/tauri.windows.conf.json as bundle resources.
 *               macOS / Linux: there is no official prebuilt CLI, so it is
 *               built from the release source tarball with cmake as a static,
 *               portable binary (needs cmake + a C/C++ compiler).
 *
 * Set SKIP_SIDECAR_DOWNLOAD=1 to make this script a no-op (CI that provides
 * its own binaries).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// ─── Pinned versions ─────────────────────────────────────────────────────────

const FFMPEG_TAG = 'b6.1.1';
const FFMPEG_SHA256 = {
  'ffmpeg-win32-x64.gz': '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
  'ffmpeg-darwin-x64.gz': '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106',
  'ffmpeg-darwin-arm64.gz': '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
  'ffmpeg-linux-x64.gz': 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
  'ffmpeg-linux-arm64.gz': '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0',
};

// The newest whisper.cpp tags ship source only; v1.8.2 is the latest tag that
// still has the Windows binary zip. Works for the source build too.
const DEFAULT_WHISPER_TAG = 'v1.8.2';
const WHISPER_WIN_ZIP = 'whisper-bin-x64.zip';
const WHISPER_WIN_SHA256 = {
  'v1.8.2/whisper-bin-x64.zip': 'b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732',
};
/** Libraries whisper-cli.exe loads at start-up; SDL2.dll is only for the streaming demos. */
const WINDOWS_DLL_EXCLUDE = new Set(['SDL2.dll']);

// ─── Paths ───────────────────────────────────────────────────────────────────

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAURI_DIR = path.join(ROOT, 'src-tauri');
const BIN_DIR = path.join(TAURI_DIR, 'binaries');
const DLL_DIR = path.join(BIN_DIR, 'windows-dlls');
const WINDOWS_CONF = path.join(TAURI_DIR, 'tauri.windows.conf.json');

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { force: false, only: null, target: null, whisperTag: DEFAULT_WHISPER_TAG, verify: true, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === '--force') opts.force = true;
    else if (arg === '--only') opts.only = next();
    else if (arg === '--target') opts.target = next();
    else if (arg === '--whisper-tag') opts.whisperTag = next();
    else if (arg === '--no-verify') opts.verify = false;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`Unknown option: ${arg} (try --help)`);
  }
  if (opts.only && !['ffmpeg', 'whisper'].includes(opts.only)) {
    throw new Error('--only must be "ffmpeg" or "whisper"');
  }
  return opts;
}

const HELP = `Usage: node scripts/download-sidecars.mjs [options]

  --force               Re-download / rebuild even if the file already exists
  --only ffmpeg|whisper Only handle one of the two binaries
  --target <triple>     Rust target triple (default: the host from \`rustc -vV\`)
  --whisper-tag <tag>   whisper.cpp release tag (default: ${DEFAULT_WHISPER_TAG})
  --no-verify           Skip SHA-256 checks (they only apply to the pinned versions anyway)
  -h, --help            Show this help
`;

// ─── Target triple ───────────────────────────────────────────────────────────

function hostTriple() {
  try {
    const out = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
    const match = /^host:\s*(\S+)/m.exec(out.stdout ?? '');
    if (match) return match[1];
  } catch {
    // fall through to the guess below
  }
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}

function describeTarget(triple) {
  const os_ = triple.includes('windows') ? 'win32' : triple.includes('apple-darwin') ? 'darwin' : triple.includes('linux') ? 'linux' : null;
  const arch = triple.startsWith('x86_64') ? 'x64' : triple.startsWith('aarch64') ? 'arm64' : null;
  if (!os_ || !arch) throw new Error(`Unsupported target triple: ${triple}`);
  return { triple, os: os_, arch, exe: os_ === 'win32' ? '.exe' : '' };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const log = (msg) => console.log(`[sidecars] ${msg}`);

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function verifyHash(buf, expected, label, verify) {
  const actual = sha256(buf);
  if (!expected) {
    log(`${label}: no pinned hash for this version (sha256 ${actual})`);
    return;
  }
  if (!verify) return;
  if (actual !== expected) {
    throw new Error(`${label}: SHA-256 mismatch\n  expected ${expected}\n  actual   ${actual}\nRefusing to use it. Re-run, or pass --no-verify if you changed the version on purpose.`);
  }
  log(`${label}: SHA-256 ok`);
}

async function download(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const total = Number(res.headers.get('content-length')) || 0;
      const chunks = [];
      let received = 0;
      let lastPrint = 0;
      for await (const chunk of res.body) {
        chunks.push(chunk);
        received += chunk.length;
        const now = Date.now();
        if (process.stdout.isTTY && now - lastPrint > 200) {
          lastPrint = now;
          const pct = total ? ` ${Math.floor((received / total) * 100)}%` : '';
          process.stdout.write(`\r[sidecars] downloading ${label}: ${(received / 1048576).toFixed(1)} MB${pct}   `);
        }
      }
      if (process.stdout.isTTY) process.stdout.write('\n');
      return Buffer.concat(chunks);
    } catch (err) {
      lastError = err;
      log(`download failed (${err.message}), attempt ${attempt}/3`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw new Error(`Could not download ${url}: ${lastError?.message}`);
}

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (res.error) throw new Error(`Could not run "${cmd}": ${res.error.message}`);
  if (res.status !== 0) throw new Error(`"${cmd} ${args.join(' ')}" exited with code ${res.status}`);
}

function writeExecutable(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  if (process.platform !== 'win32') fs.chmodSync(file, 0o755);
}

/** Minimal ZIP reader (stored + deflate), enough for the whisper.cpp release zip. */
function openZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`"${name}" is not in the zip`);
      const lo = entry.localOffset;
      const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
      const data = buf.subarray(start, start + entry.compSize);
      if (entry.method === 0) return data;
      if (entry.method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Unsupported zip compression method ${entry.method}`);
    },
  };
}

// ─── FFmpeg ──────────────────────────────────────────────────────────────────

async function installFfmpeg(target, opts) {
  const dest = path.join(BIN_DIR, `ffmpeg-${target.triple}${target.exe}`);
  if (fs.existsSync(dest) && !opts.force) {
    log(`ffmpeg: ${path.relative(ROOT, dest)} already exists (use --force to replace)`);
    return dest;
  }
  const asset = `ffmpeg-${target.os}-${target.arch}.gz`;
  if (!(asset in FFMPEG_SHA256)) {
    throw new Error(`No prebuilt FFmpeg for ${target.triple}. Put your own build at ${path.relative(ROOT, dest)}.`);
  }
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_TAG}/${asset}`;
  const gz = await download(url, asset);
  verifyHash(gz, FFMPEG_SHA256[asset], asset, opts.verify);
  writeExecutable(dest, zlib.gunzipSync(gz));
  log(`ffmpeg: wrote ${path.relative(ROOT, dest)}`);
  return dest;
}

// ─── whisper-cli ─────────────────────────────────────────────────────────────

async function installWhisperWindows(target, opts, dest) {
  if (target.arch !== 'x64') {
    throw new Error('whisper.cpp publishes no Windows ARM64 build. Use --target x86_64-pc-windows-msvc (runs under emulation) or build it yourself.');
  }
  const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${opts.whisperTag}/${WHISPER_WIN_ZIP}`;
  const zipBuf = await download(url, `${opts.whisperTag}/${WHISPER_WIN_ZIP}`);
  verifyHash(zipBuf, WHISPER_WIN_SHA256[`${opts.whisperTag}/${WHISPER_WIN_ZIP}`], WHISPER_WIN_ZIP, opts.verify);

  const zip = openZip(zipBuf);
  const exeEntry = zip.names.find((n) => /(^|\/)whisper-cli\.exe$/.test(n));
  if (!exeEntry) throw new Error(`whisper-cli.exe is not in ${WHISPER_WIN_ZIP} for ${opts.whisperTag}`);
  writeExecutable(dest, zip.read(exeEntry));

  const prefix = exeEntry.slice(0, exeEntry.length - 'whisper-cli.exe'.length);
  const dlls = zip.names.filter((n) => n.startsWith(prefix) && n.toLowerCase().endsWith('.dll') && !n.slice(prefix.length).includes('/'));
  fs.rmSync(DLL_DIR, { recursive: true, force: true });
  const dllNames = [];
  for (const entry of dlls) {
    const name = entry.slice(prefix.length);
    if (WINDOWS_DLL_EXCLUDE.has(name)) continue;
    fs.mkdirSync(DLL_DIR, { recursive: true });
    fs.writeFileSync(path.join(DLL_DIR, name), zip.read(entry));
    dllNames.push(name);
  }
  writeWindowsConf(dllNames);
  log(`whisper-cli: wrote ${path.relative(ROOT, dest)} + ${dllNames.length} DLLs in ${path.relative(ROOT, DLL_DIR)}`);
}

/**
 * Tauri's externalBin copies only the exe, so each DLL is declared as a bundle
 * resource (same "source": "target" form already used for esbuild.wasm). The
 * file is merged into tauri.conf.json on Windows only.
 */
function writeWindowsConf(dllNames) {
  const resources = {};
  for (const name of [...dllNames].sort()) resources[`binaries/windows-dlls/${name}`] = name;
  const text = `${JSON.stringify({ bundle: { resources } }, null, 2)}\n`;
  const existing = fs.existsSync(WINDOWS_CONF) ? fs.readFileSync(WINDOWS_CONF, 'utf8').replace(/\r\n/g, '\n') : null;
  if (existing !== text) {
    fs.writeFileSync(WINDOWS_CONF, text);
    log(`updated ${path.relative(ROOT, WINDOWS_CONF)} (commit it)`);
  }
}

function findFile(dir, fileName) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, fileName);
      if (hit) return hit;
    } else if (entry.name === fileName) {
      return full;
    }
  }
  return null;
}

async function buildWhisperFromSource(target, opts, dest) {
  if (target.os === 'win32') throw new Error('Source builds are only supported for macOS and Linux targets.');
  if (spawnSync('cmake', ['--version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('cmake was not found. Install it (macOS: `brew install cmake`, Debian/Ubuntu: `sudo apt install cmake build-essential`) and run again.');
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'blahblah-whisper-'));
  try {
    const url = `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${opts.whisperTag}.tar.gz`;
    const tarball = path.join(work, 'src.tar.gz');
    fs.writeFileSync(tarball, await download(url, `whisper.cpp ${opts.whisperTag} source`));
    run('tar', ['-xzf', tarball, '-C', work]);
    const srcDir = fs.readdirSync(work, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.startsWith('whisper.cpp'));
    if (!srcDir) throw new Error('Could not find the extracted whisper.cpp source');
    const src = path.join(work, srcDir.name);
    const build = path.join(src, 'build');

    // Static + no OpenMP: one self-contained executable (nothing to bundle next
    // to it). GGML_NATIVE=OFF keeps the binary portable to other CPUs instead of
    // tuned to this machine; AVX2/FMA/F16C cover every x86-64 CPU since ~2013.
    const flags = [
      '-DCMAKE_BUILD_TYPE=Release',
      '-DBUILD_SHARED_LIBS=OFF',
      '-DWHISPER_BUILD_EXAMPLES=ON',
      '-DWHISPER_BUILD_TESTS=OFF',
      '-DGGML_NATIVE=OFF',
      '-DGGML_OPENMP=OFF',
    ];
    if (target.arch === 'x64') flags.push('-DGGML_AVX2=ON', '-DGGML_FMA=ON', '-DGGML_F16C=ON');
    if (target.os === 'darwin') {
      flags.push(`-DCMAKE_OSX_ARCHITECTURES=${target.arch === 'arm64' ? 'arm64' : 'x86_64'}`);
      flags.push('-DGGML_METAL_EMBED_LIBRARY=ON'); // no separate .metallib to ship
      if (target.arch === 'x64') flags.push('-DGGML_METAL=OFF');
    }

    log('whisper-cli: configuring (cmake)...');
    run('cmake', ['-S', src, '-B', build, ...flags]);
    log('whisper-cli: compiling - this takes a few minutes...');
    run('cmake', ['--build', build, '--config', 'Release', '--target', 'whisper-cli', '-j', String(Math.max(1, os.cpus().length))]);

    const built = findFile(path.join(build, 'bin'), 'whisper-cli') ?? findFile(build, 'whisper-cli');
    if (!built) throw new Error('Build finished but whisper-cli was not found in the build directory');
    writeExecutable(dest, fs.readFileSync(built));
    log(`whisper-cli: wrote ${path.relative(ROOT, dest)}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function installWhisper(target, opts) {
  const dest = path.join(BIN_DIR, `whisper-cli-${target.triple}${target.exe}`);
  if (fs.existsSync(dest) && !opts.force) {
    log(`whisper-cli: ${path.relative(ROOT, dest)} already exists (use --force to replace)`);
    return dest;
  }
  if (target.os === 'win32') await installWhisperWindows(target, opts, dest);
  else await buildWhisperFromSource(target, opts, dest);
  return dest;
}

// ─── Smoke test ──────────────────────────────────────────────────────────────

function canRunOnThisMachine(target) {
  const hostOs = process.platform;
  const hostArch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return target.os === hostOs && (target.arch === hostArch || (hostOs === 'win32' || hostOs === 'darwin'));
}

function smokeTest(file, args, label, target) {
  if (!file || !canRunOnThisMachine(target)) return;
  const env = { ...process.env };
  if (target.os === 'win32') env.PATH = `${DLL_DIR}${path.delimiter}${env.PATH ?? ''}`;
  const res = spawnSync(file, args, { encoding: 'utf8', env });
  if (res.error || res.status === null) {
    log(`${label}: WARNING - could not start it (${res.error?.message ?? 'signal'})`);
    return;
  }
  const first = `${res.stdout}${res.stderr}`.split(/\r?\n/).find((l) => l.trim()) ?? '';
  log(`${label}: runs ok -> ${first.trim().slice(0, 90)}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (process.env.SKIP_SIDECAR_DOWNLOAD === '1') {
    log('SKIP_SIDECAR_DOWNLOAD=1, nothing to do');
    return;
  }
  const target = describeTarget(opts.target ?? hostTriple());
  log(`target: ${target.triple}`);
  fs.mkdirSync(BIN_DIR, { recursive: true });

  let ffmpeg = null;
  let whisper = null;
  if (opts.only !== 'whisper') ffmpeg = await installFfmpeg(target, opts);
  if (opts.only !== 'ffmpeg') whisper = await installWhisper(target, opts);

  smokeTest(ffmpeg, ['-version'], 'ffmpeg', target);
  smokeTest(whisper, ['--help'], 'whisper-cli', target);
  log('done');
}

main().catch((err) => {
  console.error(`\n[sidecars] ERROR: ${err.message}`);
  process.exit(1);
});