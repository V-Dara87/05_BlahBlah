# 05: Picker and Settings show instruments, skipped and unstable Plugins

**What to build:** The Plugin picker lists effects normally and puts Instruments in a collapsible section, greyed out, with a warning that they are not supported yet. Plugins that crashed before show a warning but can still be added. Settings > Audio > Plugins lists skipped Plugins with their reasons and has a retry button that clears the unstable mark and rescans that Plugin.

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] Instruments appear in a folded section, greyed out, with a warning, and cannot be picked
- [ ] An unstable Plugin shows "crashed last time" and can still be added
- [ ] Skipped Plugins and their reasons are visible in Settings
- [ ] Retry on a Plugin rescans it and clears the unstable mark when it works
- [ ] The "No effects found" message is shown only when the scan really found none