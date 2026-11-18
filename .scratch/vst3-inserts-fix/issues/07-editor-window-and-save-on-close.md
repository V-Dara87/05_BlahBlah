# 07: Editor window behaves like a real plugin window

**What to build:** The editor window is sharp on high-DPI screens, follows resize requests from the Plugin and forwards manual resizing to it. The window says that closing it saves the settings and rebuilds the Wet Bounce. Closing saves the state; the changed state hash rebuilds the Wet Bounce.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The window is not blurry at 150% display scaling
- [ ] Resizing the window resizes the Plugin interface, and a Plugin resize request resizes the window
- [ ] A note in the editor window says that closing rebuilds the Wet Bounce
- [ ] After closing, the Insert's state hash changes if settings changed and the Wet Bounce rebuilds once
- [ ] Closing without changes does not trigger a rebuild