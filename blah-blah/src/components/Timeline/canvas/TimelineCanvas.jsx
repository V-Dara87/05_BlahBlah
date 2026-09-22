import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildTimelineScene } from '../../../utils/timelineScene';
import { readTimelineTheme, drawTimelineScene, waveformRectFor, wantsWaveform } from './drawTimeline';
import { bucketsForCard } from './drawWaveform';
import { getWaveformPeaks } from '../../../utils/audioWaveform';
import { subscribePeaksUpdated } from '../../../services/peakCache';
import { usePlaybackStore } from '../../../hooks/PlaybackContext';
import './canvas-timeline.css';

/**
 * TimelineCanvas — the clip/lane area drawn on ONE canvas instead of one
 * React component per clip.
 *
 * WHY. Every clip used to be a `ClipItem` with its own pointer handlers,
 * sub-lane maths and waveform canvas, so a project with thousands of clips
 * meant thousands of components re-rendering on every drag tick and every
 * scroll. Here the tracks' clips are drawn by a single viewport-sized canvas:
 * cost tracks what is ON SCREEN (a scene range query plus a handful of fills),
 * not how long the project is.
 *
 * HOW IT SITS. The canvas is a viewport-pinned overlay inside
 * `.timeline-scroll-area`, offset past the ruler (top) and the track-header
 * column (left), over a full-size spacer that keeps the scrollable extent
 * identical to the DOM path. It never moves with scrolling — only what it
 * draws changes — so there is no one-frame lag between native scroll and the
 * picture, and native scrolling, the minimap scrollbar and zoom anchoring all
 * keep working unchanged. Track headers stay React (see Timeline.jsx) and line
 * up because both read the same row Y values from utils/timelineScene.js.
 *
 * THIS STEP IS VIEW-ONLY (plan step 3): the overlay is pointer-events: none,
 * so clicks fall through to the existing lane handlers (seek, pan, lasso) and
 * nothing about editing changes yet. Selection, hover, menus, moving, trimming
 * and dropping are the following steps.
 *
 * REDRAW MODEL. Nothing here re-renders React per frame: mutations mark the
 * canvas dirty and a single rAF draws at most once per frame, reading the
 * scroll offsets off the scroll element at draw time. Peaks are requested only
 * for the audio clips that are actually visible and wide enough to read.
 */
export const TimelineCanvas = memo(function TimelineCanvas({
  tracks = [],
  clips = [],
  mediaAssets = [],
  pixelsPerSecond = 40,
  selectedIds = [],
  exportRange = null,
  recordingTrackId = null,
  recordingStartTime = 0,
  recordingLevel = 0,
  silenceCuts = null,
  /** The `.lanes-wrapper` scroll element — source of scrollLeft/scrollTop. */
  scrollRef,
  className = '',
}) {
  const playbackStore = usePlaybackStore();
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  // windowKey -> { status: 'pending' | 'ready' | 'empty', envelope }. A per-key
  // status (rather than one global "something is loading" flag) is what makes
  // the hatched placeholder mean "peaks for THIS clip are still being built" —
  // with a global flag, every clip whose peaks came back empty (long media on
  // Tauri) also showed a hatch whenever any other clip was still decoding.
  const envelopeRef = useRef(new Map());
  const pendingRef = useRef(new Set()); // windowKeys in flight
  const [stateVersion, setStateVersion] = useState(0); // bumps when async peaks land

  // The scene depends ONLY on what changes geometry. `selectedIds` is
  // deliberately NOT here: selection is a draw-time highlight (state.selectedIds
  // below), and keying the layout on it meant every click and every lasso tick
  // re-ran computeTrackLanes (O(tracks x clips)) + computeClipSubLanes over the
  // whole project just to recolour one card. On a long project that is the
  // difference between one rAF redraw and a full re-layout per pointer move.
  const scene = useMemo(
    () => buildTimelineScene({ tracks, clips, pixelsPerSecond, mediaAssets }),
    [tracks, clips, pixelsPerSecond, mediaAssets]
  );

  // Latest inputs, read by the rAF draw without making it a dependency (so
  // scroll/peaks redraws don't need React state churn). Updated in an effect
  // rather than during render: a ref written while rendering is invisible to
  // React's own bookkeeping, and it also has to be the freshest value by the
  // time the drawing effect below schedules a frame.
  const latestRef = useRef({});
  useEffect(() => {
    latestRef.current = {
      scene,
      tracks,
      clips,
      pixelsPerSecond,
      selectedIds,
      exportRange,
      recordingTrackId,
      recordingStartTime,
      recordingLevel,
      silenceCuts,
    };
  });
  const themeRef = useRef(null);

  /**
   * Everything needed to identify one clip's waveform request, or null.
   *
   * The url and the media window (the clip's in-point through the amount of
   * SOURCE it consumes) now come straight off the scene item, which resolves
   * them with ClipItem's own rules — see timelineScene.js mediaInfoFor /
   * audioSpeedFor. Deriving them here as well meant two places to keep in step,
   * and the old derivation re-scanned the WHOLE clip array for the parent's
   * Transform speed once per visible audio clip per frame (O(visible x clips) at
   * 60fps on a project with thousands of clips).
   *
   * The bucket count has to match the box WaveformCanvas would have asked for —
   * same width/height, same detailForHeight curve — or every clip would build a
   * second, redundant set of peaks for a card it is already showing.
   */
  const waveformRequestFor = useCallback((item) => {
    if (!wantsWaveform(item)) return null;
    const rect = waveformRectFor(item);
    if (!rect) return null;
    const numPeaks = bucketsForCard(rect.width, rect.height);
    const startSec = item.audioStartSec;
    const endSec = item.audioEndSec;
    const url = item.audioUrl;
    return { url, numPeaks, startSec, endSec, key: `${url}::${numPeaks}::${startSec}::${endSec}` };
  }, []);

  /** The envelope for this clip if it is ready, else null (and start loading). */
  const ensureEnvelope = useCallback((item) => {
    const request = waveformRequestFor(item);
    if (!request) return null;
    const { url, numPeaks, startSec, endSec, key } = request;

    const entry = envelopeRef.current.get(key);
    if (entry) {
      if (entry.status === 'ready') return entry.envelope;
      if (entry.status === 'empty') return null; // genuinely no peaks: draw nothing
      // 'pending' falls through so the caller can hatch the card.
    }

    if (!pendingRef.current.has(key)) {
      // Bound the mirror cache: envelopes are small (a few KB) but a long
      // project of hundreds of clips would otherwise accumulate forever.
      if (envelopeRef.current.size > 600) envelopeRef.current.clear();
      pendingRef.current.add(key);
      envelopeRef.current.set(key, { status: 'pending', envelope: null });
      getWaveformPeaks(url, numPeaks, startSec, endSec)
        .then((envelope) => {
          const ready = Boolean(envelope?.mins?.length);
          envelopeRef.current.set(key, {
            status: ready ? 'ready' : 'empty',
            envelope: ready ? envelope : null,
          });
        })
        .catch(() => {
          envelopeRef.current.set(key, { status: 'empty', envelope: null });
        })
        .finally(() => {
          pendingRef.current.delete(key);
          setStateVersion((v) => v + 1); // schedule a redraw with the real shape
        });
    }
    return null; // hatched placeholder until it arrives
  }, [waveformRequestFor]);

  /** True while THIS clip's waveform is still being fetched/built. */
  const isEnvelopePending = useCallback(
    (item) => {
      const request = waveformRequestFor(item);
      if (!request) return false;
      const entry = envelopeRef.current.get(request.key);
      return !entry || entry.status === 'pending';
    },
    [waveformRequestFor]
  );

  /** Draw one frame from the latest inputs. */
  const draw = useCallback(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const scrollEl = scrollRef?.current;
    if (!host || !canvas || !scrollEl) return;

    const { scene: currentScene, exportRange: range, recordingTrackId: recTrack, recordingStartTime: recStart, recordingLevel: recLevel, silenceCuts: cuts } = latestRef.current;
    if (!currentScene) return;

    if (!themeRef.current) themeRef.current = readTimelineTheme(host);

    // Size the backing store to the VISIBLE CONTENT area in device pixels; only
    // touch it when it actually changes (assigning width/height clears the
    // canvas).
    //
    // clientWidth/clientHeight are the content box — the area the scroll offsets
    // apply to — whereas getBoundingClientRect() includes the scrollbar gutters.
    // Sizing from the rect (as this used to) made the canvas 6px taller and
    // wider than the visible content, which painted the lane background straight
    // over .lanes-wrapper's own horizontal scrollbar and drew 6px of lane that
    // is actually scrolled out of view.
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(scrollEl.clientWidth));
    const height = Math.max(1, Math.round(scrollEl.clientHeight));
    const size = sizeRef.current;
    if (size.width !== width || size.height !== height || size.dpr !== dpr) {
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    drawTimelineScene(ctx, {
      scene: currentScene,
      theme: themeRef.current,
      view: { scrollLeft: scrollEl.scrollLeft, scrollTop: scrollEl.scrollTop, width, height },
      state: {
        selectedIds: latestRef.current.selectedIds,
        exportRange: range,
        recording: recTrack
          ? {
              trackId: recTrack,
              startTime: recStart,
              // Live playhead time, so the recording bar keeps growing while the
              // user records (LiveRecordingClipPreview reads the same store).
              currentTime: playbackStore?.getCurrentTime?.() ?? recStart,
              level: recLevel,
            }
          : null,
        silenceCuts: cuts,
        peaksFor: (item) => (wantsWaveform(item) ? ensureEnvelope(item) : null),
        peaksPending: (item) => (wantsWaveform(item) ? isEnvelopePending(item) : false),
      },
    });
  }, [scrollRef, ensureEnvelope, isEnvelopePending, playbackStore]);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);

  // Redraw when anything structural changes, and keep the canvas sized to its
  // box (dockview shows/hides panels, so the size can change without a scroll).
  useEffect(() => {
    schedule();
  }, [schedule, scene, selectedIds, exportRange, recordingTrackId, recordingStartTime, recordingLevel, silenceCuts, stateVersion]);

  // While recording, the preview bar grows with the playhead, which moves
  // without any React re-render — so subscribe to the playback store's frame
  // callbacks exactly like LiveRecordingClipPreview does and redraw. Without
  // this the bar would be frozen at whatever time the layer last re-rendered.
  useEffect(() => {
    if (!recordingTrackId || !playbackStore?.registerFrameCallback) return undefined;
    return playbackStore.registerFrameCallback(() => schedule());
  }, [playbackStore, recordingTrackId, schedule]);

  useEffect(() => {
    const scrollEl = scrollRef?.current;
    const host = hostRef.current;
    if (!scrollEl || !host) return undefined;

    const onScroll = () => schedule();
    scrollEl.addEventListener('scroll', onScroll, { passive: true });

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => schedule());
      observer.observe(host);
    } else {
      window.addEventListener('resize', onScroll);
    }

    // Peaks generated in the background (peakCache) arrive after the first
    // draw — redraw so a clip swaps its placeholder for the real waveform.
    const unsubscribePeaks = subscribePeaksUpdated(() => schedule());

    schedule();
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', onScroll);
      unsubscribePeaks();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [scrollRef, schedule]);

  return (
    <div ref={hostRef} className={`timeline-canvas-layer ${className}`.trim()} aria-hidden="true">
      <canvas ref={canvasRef} className="timeline-canvas" />
    </div>
  );
});
