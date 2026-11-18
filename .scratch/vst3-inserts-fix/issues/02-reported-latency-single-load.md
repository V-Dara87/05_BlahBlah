# 02: Use the Plugin's reported latency and load each Plugin once

**What to build:** Read latency from the Plugin itself and delete the impulse probe. A Plugin is created once per job, so editor, state capture and bounce no longer load a second throw-away copy.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Latency in the process result equals the Plugin's reported value; when it is unavailable the value is 0 and a warning is returned
- [ ] No second Plugin instance is created for any command
- [ ] Wet Bounce alignment is unchanged for Plugins with known latency
- [ ] Opening an editor and capturing state are measurably faster than before