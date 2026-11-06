# BlahBlah (05_BlahBlah)

Video editor and tutorial overlay motion graphics workspace powered by React, Tauri v2, Remotion-style code scripts, and AI agent automation.

## Project Structure

- `blah-blah/` - Main application workspace (React frontend, Tauri desktop app, and packages)
  - `packages/blahblah-core/` - Core domain models, project state, and rendering pipeline
  - `packages/blahblah-cli/` - CLI tool for autonomous video editing and inspection
  - `packages/blahblah-mcp/` - Model Context Protocol (MCP) server for AI assistants
  - `packages/blahblah-sdk/` - User script runtime SDK and type definitions
  - `scripts/download-sidecars.mjs` - Sidecar installer (run via `npm run sidecars`)
  - `src-tauri/binaries/` - Sidecar binaries (git-ignored, filled by the installer)
- `demo-explainer/` - Example project demonstrating motion scripts, keyframe animation, and custom components
- `AGENTS.md` - AI agent guide for BlahBlah automation via CLI and MCP

## Quick Start

### Web Application

```bash
cd blah-blah
npm install
npm run dev
```

### Tauri Desktop App

The desktop app uses two external tools as Tauri sidecars: **FFmpeg** and **whisper-cli** (Whisper). Install them once before the first run:

```bash
cd blah-blah
npm install
npm run sidecars   # downloads / builds the sidecars for this machine
npm run tauri:dev
```

#### Sidecar binaries

Sidecars are **not committed to Git**. `npm run sidecars` (`scripts/download-sidecars.mjs`) puts the ones for your machine into `blah-blah/src-tauri/binaries/`.

Tauri expects the file name `<name>-<target-triple>[.exe]`:

| Platform | Files |
|---|---|
| Windows (x64) | `ffmpeg-x86_64-pc-windows-msvc.exe`, `whisper-cli-x86_64-pc-windows-msvc.exe` |
| macOS (Apple Silicon) | `ffmpeg-aarch64-apple-darwin`, `whisper-cli-aarch64-apple-darwin` |
| macOS (Intel) | `ffmpeg-x86_64-apple-darwin`, `whisper-cli-x86_64-apple-darwin` |
| Linux (x64) | `ffmpeg-x86_64-unknown-linux-gnu`, `whisper-cli-x86_64-unknown-linux-gnu` |

**Windows only:** `whisper-cli.exe` needs its DLLs next to it. They are kept in `src-tauri/binaries/windows-dlls/` and shipped with the app through `src-tauri/tauri.windows.conf.json`:

- `ggml-base.dll`
- `ggml-cpu.dll`
- `ggml.dll`
- `whisper.dll`

If the app cannot find FFmpeg or Whisper, run `npm run sidecars` again and check the file names above.

### AI Agent Automation

Refer to [AGENTS.md](AGENTS.md) for details on integrating with the BlahBlah CLI and MCP server.