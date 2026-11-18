# 06: Adding an Insert either works and opens its editor, or adds nothing

**What to build:** Choosing a Plugin prepares its state file. If that fails, no Insert is added and the error is shown. If it works, the Insert is added and its editor opens right away.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] When state capture fails, the Insert Chain is unchanged and the error text is visible
- [ ] When it works, the Insert is added and the editor opens without another click
- [ ] Adding an Insert is still one undo step
- [ ] The failure case is tested with a mocked host runner