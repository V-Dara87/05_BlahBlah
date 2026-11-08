/**
 * Drag performance log. Prints ONE summary to the console when a timeline
 * drag ends, so nobody has to read the Performance tab:
 *
 *   [perf] move drag: 84 frames, 41.3 fps (avg 24.2 ms, worst 312 ms)
 *   <table: where the time went, per frame>
 *
 * Sections are added with perfTime('name', fn) and React's <Profiler>
 * (perfProfilerOnRender). "other (not measured)" is whatever is left of the
 * frame: React work in parts of the app that are not instrumented.
 *
 * On by default in dev (`npm run dev`). Force it on/off with
 *   localStorage.setItem('blahblah.perf', '1')   /   '0'   then reload.
 * Everything is a no-op when off or when no drag is running.
 */
let session = null;

function enabled() {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem('blahblah.perf') : null;
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* storage blocked: fall through */ }
  try { return Boolean(import.meta.env?.DEV); } catch { return false; }
}

const now = () => performance.now();

function add(name, ms) {
  if (!session) return;
  let s = session.sections.get(name);
  if (!s) { s = { total: 0, count: 0, max: 0 }; session.sections.set(name, s); }
  s.total += ms;
  s.count += 1;
  if (ms > s.max) s.max = ms;
}

/** Start measuring a drag. Safe to call when a session is already running (the old one is dropped). */
export function perfBegin(label) {
  if (!enabled()) return;
  const s = { label, start: now(), sections: new Map(), frames: [], last: now(), raf: 0, stopped: false };
  const tick = () => {
    if (s.stopped) return;
    const t = now();
    s.frames.push(t - s.last);
    s.last = t;
    s.raf = requestAnimationFrame(tick);
  };
  s.raf = requestAnimationFrame(tick);
  session = s;
}

/** Time `fn` under `name` while a drag is being measured; otherwise just run it. */
export function perfTime(name, fn) {
  if (!session) return fn();
  const t = now();
  try { return fn(); } finally { add(name, now() - t); }
}

/** <Profiler onRender={perfProfilerOnRender}> callback: React render+commit time of a subtree. */
export function perfProfilerOnRender(id, _phase, actualDuration) {
  if (session) add(`react: ${id}`, actualDuration);
}

/** Stop and print the summary. */
export function perfEnd() {
  const s = session;
  if (!s) return;
  session = null;
  s.stopped = true;
  cancelAnimationFrame(s.raf);

  const frames = s.frames.slice(1); // the first interval includes the drag start
  if (frames.length < 3) return;
  const total = frames.reduce((a, b) => a + b, 0);
  const avg = total / frames.length;
  const worst = Math.max(...frames);
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const n = frames.length;

  let measured = 0;
  const rows = [];
  for (const [name, v] of s.sections) {
    measured += v.total;
    rows.push({ section: name, 'ms / frame': +(v.total / n).toFixed(2), calls: v.count, 'avg ms / call': +(v.total / v.count).toFixed(2), 'max ms': +v.max.toFixed(1) });
  }
  rows.sort((a, b) => b['ms / frame'] - a['ms / frame']);
  // React <Profiler> sections overlap the timed sections inside them, so "other" is only a hint.
  rows.push({ section: 'FRAME TOTAL', 'ms / frame': +avg.toFixed(2), calls: n, 'avg ms / call': +avg.toFixed(2), 'max ms': +worst.toFixed(1) });

  // eslint-disable-next-line no-console
  console.log(`[perf] ${s.label}: ${n} frames, ${(1000 / avg).toFixed(1)} fps (avg ${avg.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, worst ${worst.toFixed(0)} ms)`);
  // eslint-disable-next-line no-console
  console.table(rows);
}