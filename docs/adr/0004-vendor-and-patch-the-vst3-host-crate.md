# Vendor and Patch the VST3 Host Crate

Status: accepted

The VST Host builds on `truce-rack-vst3`, which skips parts of the VST3 host contract that real plugins depend on (host context, component handler, plug frame) and scans only one folder level. We decided to copy that crate into the repo and patch it, instead of rewriting a host from scratch or switching to another crate. Our own code keeps talking to the existing `PluginBackend` trait, so the crate stays replaceable.

## Considered Options

- Write a host on the raw `vst3` bindings: rejected for now, because it repeats work the crate already does correctly.
- Switch to another host crate: rejected, because it would still need evaluation and patches.

## Consequences

- We own the fixes and must re-apply them if we ever update the upstream crate.