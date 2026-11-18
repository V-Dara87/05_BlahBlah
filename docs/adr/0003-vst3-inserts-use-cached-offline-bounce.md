# VST3 Inserts Use a Cached Offline Bounce

Status: accepted

Plugins on a track are not run live during playback. Each track's Insert Chain is rendered offline by the VST Host into a Wet Bounce, cached by a key that includes the chain and its saved Plugin state, and preview and export both play that cache. We chose this over live hosting because BlahBlah has no native real-time audio engine, and one cached result guarantees preview and export sound the same. We also decided not to add a "bake into the project" step: the cache is rebuilt whenever the chain or the audio changes, so the source audio and the Insert Chain always stay editable.

## Considered Options

- Live hosting inside a native audio engine: rejected for now, because it needs a real-time engine that does not exist and is a much larger project.
- Bake the effect into a new audio file and replace the clip: rejected, because the cache already gives the same sound and nothing needs to be undone.

## Consequences

- Changing a Plugin setting is silent until the Wet Bounce is rebuilt; the author hears the result through Audition or after the rebuild.
- Cache size and invalidation (Plugin state, Plugin file version) are part of correctness, not just performance.