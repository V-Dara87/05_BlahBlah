# AI Agent Guide for BlahBlah Video Automation

This repository provides both a **CLI tool** and an **MCP server** for AI agents to autonomously build and edit video projects, generate motion scripts, animate keyframes, and render preview frames.

---

## 1. Quick CLI Reference for Agents

All commands are executed inside `blah-blah/`:

```bash
# 1. Inspect project status
npm run cli -- project inspect --json

# 2. Initialize a new project
npm run cli -- project init "Tutorial Video" --res 1080p

# 3. Add video clip to timeline
npm run cli -- clip add --file "./media/screen_recording.mp4" --track "track-1" --start 0 --duration 15

# 4. Create a new canvas script
npm run cli -- script new "TitleCard" --type canvas

# 5. Add script entity to timeline
npm run cli -- entity add --name "Title" --script "TitleCard" --track "track-2" --start 1 --duration 5 --props '{"title":"Welcome!"}'

# 6. Add animation keyframe (easeInOut, bounce, snap, linear)
npm run cli -- keyframe add --id "<entity-id>" --field y --time 0 --value 300 --ease easeInOut
npm run cli -- keyframe add --id "<entity-id>" --field y --time 1 --value 0 --ease easeInOut

# 7. Render frame snapshot to inspect visually
npm run cli -- render frame --time 1.5 --out preview.svg
```

---

## 2. MCP (Model Context Protocol) Server

The MCP server is located at:
`d:/07_Programming/00_Project/05_BlahBlah/blah-blah/packages/blahblah-mcp/bin/mcp-server.mjs`

### Tools Available:
- `blahblah_project_init`: Initialize project
- `blahblah_project_inspect`: Inspect full project state
- `blahblah_track_add`: Add track
- `blahblah_clip_add`: Add media clip
- `blahblah_script_create`: Generate script code
- `blahblah_script_validate`: Check script for errors
- `blahblah_entity_add`: Place script on timeline
- `blahblah_entity_set_prop`: Change component props
- `blahblah_entity_set_transform`: Change position/scale/opacity
- `blahblah_keyframe_add`: Add keyframe animation
- `blahblah_render_frame`: Export SVG preview frame
- `blahblah_live_control`: Seek or reload running app
