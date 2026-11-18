# BlahBlah

A video and animation editor. This glossary holds the project's own terms.

## Language

### VST3 Inserts

**Insert**:
One effect placed on a track's signal path.
_Avoid_: Slot, FX, VST

**Insert Chain**:
The ordered list of Inserts on a track.
_Avoid_: FX chain, rack

**Plugin**:
A VST3 effect found by scanning and available to become an Insert.
_Avoid_: VST, VSTi

**Wet Bounce**:
The cached audio of a track after it has passed through its Insert Chain; preview and export play this instead of the track's source audio.
_Avoid_: Render, freeze, bake

**VST Host**:
The separate process that scans for Plugins, runs Insert Chains and shows Plugin editors.
_Avoid_: Sidecar, spike