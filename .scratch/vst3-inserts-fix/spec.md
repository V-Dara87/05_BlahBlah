# VST3 Inserts that actually work

Triage label (to apply on publish): `ready-for-agent`

## Problem Statement

The experimental VST3 feature does not work for the author on Windows:

- The Plugin list is incomplete. Adding a custom scan folder silently drops the standard folders, only the top level of a folder is read (vendor sub-folders are missed), and the per-user VST3 folder is skipped because it is built from the `HOME` variable that Windows does not set.
- One Plugin that crashes while scanning breaks the whole scan, and the author never sees which Plugins were skipped or why.
- Instruments are listed as if they were effects.
- Clicking an Insert opens no editor. The VST Host exits with `0xC0000005` (access violation) before the editor window exists, shown to the author only as "Could not open editor".
- Adding a Plugin does not open its editor, and when the Plugin cannot be prepared the Insert is added anyway, so the failure shows up later.
- The Wet Bounce cache ignores Plugin updates, and the cache-size setting is ignored.

## Solution

Keep the cached offline design (ADR 0003): each track's Insert Chain is rendered by the VST Host into a Wet Bounce that preview and export both play. Make it dependable:

- The VST Host is built on a vendored, patched copy of the VST3 host crate (ADR 0004) that supplies the host pieces real Plugins expect, so editors open and Plugins load without crashing.
- Scanning finds every Plugin in the standard folders plus the author's folders (searched 4 levels deep), one Plugin per child process with a 30 second limit. Plugins that fail are listed as skipped with a reason, and Plugins that crashed before are marked unstable.
- Instruments are shown greyed out in a collapsible section with a warning; only effects can become Inserts.
- Adding a Plugin either works and opens its editor, or shows the error and adds nothing.
- Closing the editor saves the Plugin state and rebuilds the Wet Bounce.
- A failed Insert Chain never produces a partly processed result: preview plays the dry track with a red status dot, and export asks before writing dry audio.

Windows only. Vocabulary: Insert, Insert Chain, Plugin, Wet Bounce, VST Host (see `CONTEXT.md`).

## User Stories

1. As an author, I want every Plugin in my VST3 folders to appear in the picker, including ones inside vendor sub-folders, so that I can find the Plugin I own.
2. As an author, I want adding my own folder to add to the standard folders, not replace them, so that nothing disappears when I add a folder.
3. As an author, I want my per-user VST3 folder scanned too, so that Plugins installed there appear.
4. As an author, I want one broken Plugin not to break the scan, so that the rest of the list still loads.
5. As an author, I want to see which Plugins were skipped and why, so that I know whether a missing Plugin is broken or just not found.
6. As an author, I want a Plugin that crashed before to carry a warning, so that I am not surprised, while still being allowed to try again.
7. As an author, I want Instruments shown greyed out in a folded section with a warning, so that I know why I cannot use them and do not think the scan missed them.
8. As an author, I want a Plugin's editor to open when I click its Insert, so that I can change its settings.
9. As an author, I want the editor to open right after I add a Plugin, so that I can set it up immediately.
10. As an author, I want an Insert to be added only if its Plugin could be prepared, so that a broken Plugin never sits on my track.
11. As an author, I want a clear error when adding fails, so that I know what happened.
12. As an author, I want the editor window to be sharp on a high-DPI screen and resizable, so that Plugin interfaces are usable.
13. As an author, I want closing the editor to save the settings and rebuild the Wet Bounce, and the editor to tell me so, so that I know when to expect the new sound.
14. As an author, I want the Wet Bounce to be rebuilt when I update a Plugin, so that I do not hear stale audio.
15. As an author, I want the cache-size setting to be respected, so that disk use stays under the limit I chose.
16. As an author, I want a failed Insert Chain to fall back to the dry track with a red status dot in preview, so that I see the problem and still hear my audio.
17. As an author, I want export to list tracks whose Insert Chain failed and let me choose to export anyway or cancel, so that I never ship dry audio by accident.
18. As an author, I want preview and export never to skip just one failed Plugin, so that they always sound the same.

## Implementation Decisions

- The VST Host's Plugin backend stays behind the existing `PluginBackend` trait; only the vendored crate changes (ADR 0004).
- The vendored crate adds: a host context, a component handler, a plug frame (editor resize request), the component state hand-off for split controllers, class sub-category and vendor reading, and no editor-view probe at load.
- Latency comes from the Plugin's own reported value; if unavailable it is 0 and a warning is recorded. The impulse-probe path and the second throw-away Plugin instance are removed.
- Scan paths are built from the environment: `%CommonProgramFiles%\VST3` and `%LOCALAPPDATA%\Programs\Common\VST3`, plus the author's folders. A folder is searched 4 levels deep; `.vst3` is matched case-insensitively.
- Scanning runs one child process per bundle with a 30 second limit. The result keeps the existing shape (plugins, failed) so the UI contract changes only by showing `failed`. Crashes are recorded in the scan cache as unstable.
- Wet Bounce cache key additionally includes the Plugin file's size and modified time. The cache limit comes from the saved setting.
- A single Insert Chain failure fails that track's bounce as a whole.

## Testing Decisions

- Good tests check external behaviour: which folders are searched, which bundles are found, what the cache key depends on, what the UI shows for a failed or unstable Plugin.
- Test: folder discovery (defaults plus custom, depth limit, case-insensitive match) against a temporary folder tree; the environment values are passed in so the test runs on any OS.
- Test: cache key changes when Plugin size or modified time changes; cache limit is read from settings (extend `fxChain.test.js`).
- Test: add flow does not add an Insert when state capture fails (mock the host runner).
- Test: export reports tracks with failed Insert Chains.
- Real-Plugin behaviour (editor opens, no crash, bounce matches export) cannot run in CI; it is covered by the manual acceptance pass in the last issue.
- **Prior art:** `src/utils/fxChain.test.js`.

## Out of Scope

- Live (real-time) Plugin hosting; baking effects into the project audio (ADR 0003).
- Instrument Plugins and MIDI.
- macOS and Linux.
- Per-Plugin sandboxing beyond the scan (processing and editors already run in their own VST Host process).
- Replacing the host crate with a self-written host (ADR 0004).

## Further Notes

- Related decisions: ADR 0003 (cached offline bounce) and ADR 0004 (vendored host crate). Glossary: the VST3 Inserts section of `CONTEXT.md`.
- Root causes found in review: the host crate loads Plugins with no host context, no component handler and no plug frame, and probes the editor view at load; the VST Host loads each Plugin twice (a second copy for a latency probe) and drops it normally; the add flow swallows state-capture errors.
- Not yet decided: the editor window details (DPI awareness, forwarding resize to the Plugin) follow the usual Windows approach and were not discussed in detail; confirm when implementing.
- The author's three acceptance Plugins (including the one whose name starts with "Sid") are still to be named before the final issue.