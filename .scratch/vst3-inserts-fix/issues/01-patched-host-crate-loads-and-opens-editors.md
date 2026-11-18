# 01: Vendored VST3 host crate that loads Plugins and opens editors

**What to build:** Copy the VST3 host crate into the repo and use it from the VST Host. Give Plugins the host pieces they expect (host context, component handler, plug frame, component state for split controllers) and stop probing the editor view at load. A Plugin that used to exit the VST Host with an access violation can now be loaded and its editor opened. `PluginBackend` and the JSON-lines protocol do not change. ADR 0004 records the decision.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The crate lives in the repo and the VST Host builds against it
- [ ] Loading a Plugin does not create or probe an editor view
- [ ] The editor opens for the Plugin that crashed before, and a state file is written when the editor closes
- [ ] The editor can ask for a different size and the window follows
- [ ] Loading and processing a chain still works for Plugins that already worked
- [ ] `docs/adr/0004-vendor-and-patch-the-vst3-host-crate.md` is in the repo