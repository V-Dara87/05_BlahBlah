# 04: Scan one Plugin per process; keep skipped and unstable Plugins

**What to build:** The scan checks each Plugin bundle in its own child process with a 30 second limit. A bundle that crashes, hangs or fails is returned as skipped with a reason, and a Plugin that crashed is marked unstable in the scan cache. The rest of the list is unaffected.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] A Plugin that crashes while scanning does not stop the scan; the others are listed
- [ ] A Plugin that takes longer than 30 seconds is skipped with a timeout reason
- [ ] Skipped Plugins are returned with their path and reason
- [ ] A crashed Plugin is stored as unstable and stays marked across restarts until retried
- [ ] The total scan time with many Plugins does not hit a single global limit