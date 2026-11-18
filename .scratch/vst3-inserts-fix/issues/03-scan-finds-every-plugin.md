# 03: Scan finds every Plugin in the standard and custom folders

**What to build:** Scanning always includes the standard folders (`%CommonProgramFiles%\VST3` and `%LOCALAPPDATA%\Programs\Common\VST3`) plus the author's folders, searches each 4 levels deep, matches `.vst3` case-insensitively, and returns each Plugin's vendor and whether it is an effect or an instrument.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Adding a custom folder keeps the standard folders in the scan
- [ ] A Plugin inside a vendor sub-folder up to 4 levels deep is found; deeper is not
- [ ] A Plugin in the per-user folder is found even though `HOME` is not set
- [ ] `.VST3` and `.vst3` are both found
- [ ] Each Plugin reports a vendor and an effect-or-instrument category
- [ ] Folder discovery is tested against a temporary folder tree