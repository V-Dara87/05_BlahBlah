# 09: A failed Insert Chain falls back to dry and export asks first

**What to build:** If any Insert in a track's chain fails to bounce, the whole chain fails: preview plays the dry track and the status dot turns red with the error. Export lists every track whose Insert Chain failed and lets the author choose "export anyway" or "cancel". A single failed Plugin is never skipped silently.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] One failing Insert makes the whole track play dry in preview, with a red dot and the message
- [ ] Export with failed chains shows the track names and two choices
- [ ] Choosing cancel exports nothing; choosing export anyway uses dry audio for those tracks only
- [ ] Tracks with working chains are unaffected
- [ ] The failed-track report is tested