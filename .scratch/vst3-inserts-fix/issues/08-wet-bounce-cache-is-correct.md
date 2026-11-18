# 08: Wet Bounce cache follows Plugin updates and the size setting

**What to build:** The cache key includes each Plugin file's size and modified time, so updating a Plugin rebuilds the Wet Bounce. The cache is pruned to the size saved in Settings instead of a fixed 2048 MB.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Changing a Plugin file's size or modified time changes the cache key
- [ ] The prune limit equals the Settings value, and changing the setting changes the limit
- [ ] Existing caches are rebuilt once without errors
- [ ] Covered by tests next to the existing cache-key tests