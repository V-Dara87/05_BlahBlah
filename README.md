# BlahBlah (05_BlahBlah)

Video editor and tutorial overlay motion graphics workspace powered by React, Tauri v2, Remotion-style code scripts, and AI agent automation.

## Project Structure

- `blah-blah/` - Main application workspace (React frontend, Tauri desktop app, and packages)
  - `packages/blahblah-core/` - Core domain models, project state, and rendering pipeline
  - `packages/blahblah-cli/` - CLI tool for autonomous video editing and inspection
  - `packages/blahblah-mcp/` - Model Context Protocol (MCP) server for AI assistants
  - `packages/blahblah-sdk/` - User script runtime SDK and type definitions
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

```bash
cd blah-blah
npm run tauri:dev
```

> **Note on Desktop Sidecar Binaries**:
> Precompiled FFmpeg and Whisper binaries for Tauri sidecars should be placed in `blah-blah/src-tauri/binaries/` (see `blah-blah/src-tauri/binaries/.gitkeep` for platform naming).

### AI Agent Automation

Refer to [AGENTS.md](AGENTS.md) for details on integrating with the BlahBlah CLI and MCP server.
