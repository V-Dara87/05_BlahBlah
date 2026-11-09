# vsthost-spike — Phase 0

A standalone Windows spike that proves BlahBlah can host **VST3 effects** out of
process. It is intentionally **not** wired into the Tauri app and makes no app
changes. If this spike works with real plugins, Phase 1 can build the full
`vsthost` sidecar on the same protocol and backend boundary.

Phase 0 proves:

- **(a)** scanning VST3 folders for effect classes;
- **(b)** loading one plugin and processing a WAV offline with latency
  compensation and a rendered tail;
- **(c)** `get_state` / `set_state` round-tripping through a file;
- **(d)** opening a plugin editor inside a native window and writing state when
  the window closes;
- built-in **IMPULSE** and **TAIL** self-tests.

## Requirements

- Windows 10/11 x64.
- Rust 1.90 or newer with the **MSVC** toolchain
  (`rustup default stable-x86_64-pc-windows-msvc`).
- No CMake, no Steinberg SDK, no extra system libraries. `truce-rack` uses the
  pure-Rust `vst3` bindings.
- A few real `.vst3` effects to test (the checklist below names the categories).

## Build

Run from this directory:

```bash
cd src-tauri/vsthost-spike
cargo build --release
```

The binary is:

```text
src-tauri\vsthost-spike\target\release\vsthost-spike.exe
```

For a faster iteration build, use `cargo build` and
`target\debug\vsthost-spike.exe`.

Run the logger's unit test with:

```bash
cargo test
```

## Output contract

`stdout` is **JSON lines only**. At startup the spike duplicates the original
stdout for protocol events and points CRT stdout (fd 1) at stderr. A plugin's
own `printf`/`std::cout` therefore lands in the log stream instead of
corrupting the JSON. This is the same rule the Phase 1 sidecar needs:

```json
{"event":"progress","pct":42}
{"event":"result","command":"process","latencySamples":0,...}
{"event":"error","code":"LOAD_FAILED","message":"...","plugin":"..."}
```

Error codes: `PLUGIN_CRASH`, `PLUGIN_MISSING`, `LOAD_FAILED`, `TIMEOUT`,
`BAD_ARGS`, `IO`. Exit code is `0` on success and non-zero on error. Logs and
help go to `stderr`. Plugin instances are intentionally **not unloaded** after
a job: some real plugins crash in `terminate()`/`DllMain` even when their audio
result was correct. The process flushes its result and exits, which is the same
lifetime model the out-of-process sidecar uses. A crash *during load or
processing* is still a real crash; the spike does not pretend to contain it
in-process (see limitations).

Every command accepts `--log-file <absolute path>`. The logger keeps
`vsthost.log` plus one rotated `vsthost.log.1`, each capped at 5 MB, and never
logs audio.

The eventual app protocol is versioned. `info` prints the contract this binary
speaks:

```bash
target\release\vsthost-spike.exe info
```

```json
{"event":"result","command":"info","protocolVersion":1,"sidecarVersion":"0.1.0","backend":"truce-rack","backendVersion":"1.1.5","platform":"windows","supportsEditor":true}
```

`protocolVersion` is currently **1**.

## 1. Scan

Scan the standard VST3 locations:

```bash
target\release\vsthost-spike.exe scan --out "C:\temp\vst-scan.json"
```

Scan explicit folders (repeat `--dir` as needed):

```bash
target\release\vsthost-spike.exe scan ^
  --dir "C:\Program Files\Common Files\VST3" ^
  --dir "C:\Users\me\AppData\Local\Programs\Common\VST3" ^
  --out "C:\temp\vst-scan.json"
```

This Phase 0 scanner accepts `--dir` and `--out`. The Phase 1 contract's
`--per-plugin-timeout-ms` and child-process probing are deliberately not
implemented yet (see limitation 8).

The scan result (and the `--out` file) contains every returned effect class with
`name`, `vendor`, `version`, `category`, `path`, `classId`, `format`,
`hasEditor`, and `acceptsMidi`. Use `classId` with the other commands. The
`vendor`, `version`, and `hasEditor` fields come from `truce-rack`'s scanner and
can be placeholders in this spike; see limitation 9.

> The current `truce-rack` scanner reports classes it can load as effects.
> Bundles that produce no effect class are listed in `failed`; that includes
> instruments and bundles that failed to load. Distinguishing instruments is a
> Phase 1 requirement.

## 2. Process a WAV

Input may be mono or stereo, PCM (8/16/24/32-bit) or IEEE float. Output is
always stereo **32-bit float** and is never clamped. The plugin runs at the
input WAV's sample rate; if you pass `--sample-rate`, it must match the file.

```bash
target\release\vsthost-spike.exe process ^
  --plugin "C:\Program Files\Common Files\VST3\OTT.vst3" ^
  --class-id "0123456789abcdef0123456789abcdef" ^
  --in  "C:\temp\in.wav" ^
  --out "C:\temp\out.wav" ^
  --sample-rate 48000 ^
  --block-size 1024 ^
  --tail-max-ms 5000 ^
  --log-file "C:\temp\vsthost.log"
```

Optional pre-roll discard, matching the future `--discard-head-ms` contract:

```bash
  --discard-head-ms 0
```

The output WAV is the input **with the chain's summed latency removed**. After
the input ends, the renderer keeps feeding silence until the output has stayed
below -80 dBFS for 250 ms or `--tail-max-ms` is reached. The result reports
`latencySamples`, `tailSamples`, `tailMs`, `tailLimitReached`, `elapsedMs`, and
`realTimeFactor` (processing time divided by output audio duration).

Multiple slots use the same `chain.json` shape the app will send. `stateFile`
is an absolute path or `null`:

```json
[
  {
    "plugin": "C:\\Program Files\\Common Files\\VST3\\OTT.vst3",
    "classId": "0123456789abcdef0123456789abcdef",
    "stateFile": null,
    "bypass": false
  }
]
```

```bash
target\release\vsthost-spike.exe process ^
  --chain "C:\temp\chain.json" ^
  --in "C:\temp\in.wav" ^
  --out "C:\temp\out.wav"
```

Bypassed slots pass audio through and contribute no latency. Up to 8 slots are
accepted, matching the app's per-track limit.

## 3. State round trip

```bash
target\release\vsthost-spike.exe state ^
  --plugin "C:\Program Files\Common Files\VST3\OTT.vst3" ^
  --class-id "0123456789abcdef0123456789abcdef" ^
  --state-in none ^
  --state-out "C:\temp\ott-state.bin"
```

Then load that state back and verify:

```bash
target\release\vsthost-spike.exe state ^
  --plugin "C:\Program Files\Common Files\VST3\OTT.vst3" ^
  --class-id "0123456789abcdef0123456789abcdef" ^
  --state-in "C:\temp\ott-state.bin" ^
  --state-out "C:\temp\ott-state-2.bin"
```

`roundTripEqual` compares the bytes saved by the first instance with the bytes
read back from a freshly loaded instance. A few plugins intentionally produce
non-deterministic state; record that instead of treating it as a host failure.

## 4. Editor

```bash
target\release\vsthost-spike.exe editor ^
  --plugin "C:\Program Files\Common Files\VST3\OTT.vst3" ^
  --class-id "0123456789abcdef0123456789abcdef" ^
  --state-in "C:\temp\ott-state.bin" ^
  --state-out "C:\temp\ott-state-after-editor.bin" ^
  --title "OTT test"
```

The native frame opens, the plugin's editor is attached to a child window, and
the message loop runs until you close the frame. Keeping the plugin on a child
window means a plugin that subclasses its parent cannot swallow the frame's
close message. On close the host calls the plugin's editor `close()`, then
writes `get_state` to `--state-out`. The editor command is Windows-only in this
spike.

For automated smoke tests, add `--auto-close-ms 5000` to make the spike post a
`WM_CLOSE` to the outer frame after five seconds. Leaving it at `0` (the
default) waits for a person to close the window. A watchdog ends the loop 1.5 s
after the requested close time if a plugin editor traps the message; the normal
path closes through `WM_CLOSE`.

## 5. Built-in self-tests

**IMPULSE** processes a one-sample impulse, finds the output peak, and checks
that the peak lands at the measured latency (after compensation, index 0) within
±1 sample:

```bash
target\release\vsthost-spike.exe impulse ^
  --plugin "C:\Program Files\Common Files\VST3\OTT.vst3" ^
  --class-id "0123456789abcdef0123456789abcdef" ^
  --sample-rate 48000 ^
  --block-size 1024
```

**TAIL** feeds a 100 ms burst, then silence, and reports the measured tail until
-80 dBFS has held for 250 ms:

```bash
target\release\vsthost-spike.exe tail ^
  --plugin "C:\Program Files\Common Files\VST3\OTT.vst3" ^
  --class-id "0123456789abcdef0123456789abcdef" ^
  --tail-max-ms 30000
```

Both:

```bash
target\release\vsthost-spike.exe selftest ^
  --plugin "C:\Program Files\Common Files\VST3\OTT.vst3" ^
  --class-id "0123456789abcdef0123456789abcdef"
```

Both commands emit JSON results; the logger's human-readable timing lines go
to stderr.

## Results checklist

Fill this in on the Windows machine that will run BlahBlah. Use `scan`, then
copy the `classId`, then run `process`, `state`, `editor`, `impulse`, and
`tail` for each plugin.

| # | Plugin type | Scan OK | Load OK | Reported latency (samples/ms) | Tail length (ms) | State size (KB) | Editor opens/closes | Crash/hang behavior | Real-time factor |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Plain EQ |  |  |  |  |  |  |  |  |
| 2 | Compressor |  |  |  |  |  |  |  |  |
| 3 | Long-tail reverb |  |  |  |  |  |  |  |  |
| 4 | Look-ahead limiter |  |  |  |  |  |  |  |  |
| 5 | Very large state |  |  |  |  |  |  |  |  |
| 6 | License/login window at startup |  |  |  |  |  |  |  |  |

For the **license/login** plugin, note whether the editor window opens a modal
child, whether the spike stays responsive, and what happens when the modal is
closed. For a **crash/hang**, note whether the spike exits, prints a
`PLUGIN_CRASH`/error event, or must be killed; Phase 1 must never hang on a real
plugin.

Record `realTimeFactor` only from the `process` result. Do not estimate it by
hand.

## Observed smoke test

Recorded on one Windows 11 x64 machine with OTT (VST3) in
`C:\temp\vst-spike-test\OTT.vst3`. These numbers are evidence that the Phase 0
path works end to end, not a substitute for the six-plugin checklist above.

- **Scan:** exit 0, one effect found, `elapsedMs: 5`; `failed: []`. The scanner
  reported `hasEditor: false` for OTT even though its editor opens (limitation 9).
- **Process:** a chain with one active OTT and one bypassed OTT, 144,000 input
  frames at 48 kHz, 1024-frame blocks, `--discard-head-ms 10`: 156,563 output
  frames, 480 discarded head samples, 269 samples of latency, 907-sample
  (18.90 ms) tail, no tail-limit hit, `realTimeFactor: 0.0223`.
- **IMPULSE:** `peakIndex: 269`, `alignedIndex: 0`, `passed: true`.
- **TAIL:** 965 samples / 20.10 ms until -80 dBFS held for 250 ms.
- **State:** 80-byte state, `roundTripEqual: true` after reloading it into a
  fresh instance.
- **Editor:** 900x650 native window, plugin attached, closed by the
  `--auto-close-ms 2500` `WM_CLOSE` path in 2.9 s, and wrote 80 state bytes.
- **Build/tests:** `cargo build --release` and `cargo test` pass (1 test).

A separate iZotope **VEA** scan succeeded, but state/process/impulse/tail
segfaulted during load with exit 139. That is recorded here as crash behavior;
containing it is Phase 1 work (limitation 2).

## Honest limitations of this spike

These are deliberate Phase 0 boundaries, not hidden production behavior:

1. **Latency is estimated, not reported.** `truce-rack` 1.1.5 exposes no
   `IAudioProcessor::getLatencySamples` method. `backend.rs` therefore measures
   latency with a throw-away impulse probe. That is marked `// VERIFY:` in
   `backend.rs` and is the single biggest thing Phase 1 must replace. A
   linear-phase EQ, a wet-only reverb, or a plugin with internal pre-delay can
   make the probe disagree with the plugin's own reported latency.
2. **Scanning is in-process.** A plugin that crashes or hangs while its module
   is loaded can take the spike down. The Phase 1 sidecar must probe each
   plugin in a child process with a timeout, as the fixed protocol requires.
3. **The scanner cannot distinguish instruments yet.** `truce-rack`'s VST3
   scanner returns a single "Audio Module Class" effect category. The
   `failed` list is inferred from `.vst3` bundles that produced no effect
   class. The Phase 1 picker must show instruments disabled, not failed.
4. **Editor state uses `IComponent::getState`.** Controller-only parameters may
   not round-trip for every plugin. Record what the editor writes; this is why
   Phase 0 tests a plugin with a license window and a plugin with large state.
5. **No missing-plugin pass-through yet.** A missing chain plugin is a hard
   error in this spike. The production sidecar's rule (keep the slot, warn, and
   pass audio through) belongs to Phase 2 when `track.fx` is persistent.
6. **No app integration.** No mixer UI, no Tauri commands, no `externalBin`
   entry, no JS, no change to the project format. Those are later phases.
7. **Plugins are not unloaded after a successful job.** This is deliberate for
   the spike and the sidecar process model, but it means `editor` state is
   saved before the process exits rather than after a clean plugin shutdown.
8. **Scan has no per-plugin timeout yet.** The Phase 1 protocol's
   `--per-plugin-timeout-ms` is not accepted by this spike, and each bundle is
   scanned in-process. A plugin that hangs or crashes while its module is
   loaded can take the whole scan down. Child-process probing is required
   before this becomes the production sidecar.
9. **Scan metadata is incomplete.** `truce-rack` 1.1.5 did not return OTT's
   vendor or version, and reported `hasEditor: false` even though the editor
   opens. Do not use `hasEditor` to decide whether an editor exists until
   Phase 1 resolves it by a safe, bounded probe.

## Why the crate is standalone

`src-tauri/vsthost-spike/Cargo.toml` has an empty `[workspace]` table so Cargo
does not treat the spike as part of the Tauri app's package. It is not a
dependency of `src-tauri/Cargo.toml`, and nothing under `src/` or the app crate
references it.
