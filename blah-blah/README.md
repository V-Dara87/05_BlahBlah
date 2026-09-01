# blah-blah

Browser-based tutorial overlay editor — timeline + Inspector + code-driven motion (Remotion-style) on video.

## Docs (repo root)

- **[ARCHITECTURE.md](../ARCHITECTURE.md)** — strategy, strengths/weaknesses, phases, Tauri, external IDE, render pipeline
- **[roadmap.md](../roadmap.md)** — feature checklist and known flaws

## Develop

```bash
npm install
npm run dev
```

Requires a Chromium browser with File System Access API (Chrome, Edge, Brave) for on-disk projects.

## Project layout (on disk)

```
my-project/
  project.json
  scripts/       # edit here or in VS Code / Cursor
  prefabs/
  media/
```
