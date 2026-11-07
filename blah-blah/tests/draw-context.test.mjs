import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrawContext, CanvasKit, createDrawContext, CanvasComponent, CanvasNode, RectNode, TextNode, CircleNode } from '../packages/blahblah-sdk/index.js';

// ─── Minimal canvas mock ──────────────────────────────────────────────────────

function createMockCtx(width = 1920, height = 1080) {
  const calls = [];
  const state = { globalAlpha: 1, globalCompositeOperation: 'source-over', font: '', textAlign: 'left', textBaseline: 'alphabetic', fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 };
  const stack = [];

  const ctx = {
    _calls: calls,
    _state: state,
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(v) { state.globalAlpha = v; calls.push(['globalAlpha', v]); },
    get globalCompositeOperation() { return state.globalCompositeOperation; },
    set globalCompositeOperation(v) { state.globalCompositeOperation = v; calls.push(['globalCompositeOperation', v]); },
    get font() { return state.font; },
    set font(v) { state.font = v; },
    get textAlign() { return state.textAlign; },
    set textAlign(v) { state.textAlign = v; },
    get textBaseline() { return state.textBaseline; },
    set textBaseline(v) { state.textBaseline = v; },
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v) { state.fillStyle = v; calls.push(['fillStyle', v]); },
    get strokeStyle() { return state.strokeStyle; },
    set strokeStyle(v) { state.strokeStyle = v; },
    get lineWidth() { return state.lineWidth; },
    set lineWidth(v) { state.lineWidth = v; },
    get lineCap() { return state.lineCap; },
    set lineCap(v) { state.lineCap = v; },
    get lineJoin() { return state.lineJoin; },
    set lineJoin(v) { state.lineJoin = v; },
    get shadowColor() { return state.shadowColor; },
    set shadowColor(v) { state.shadowColor = v; },
    get shadowBlur() { return state.shadowBlur; },
    set shadowBlur(v) { state.shadowBlur = v; },
    get shadowOffsetX() { return state.shadowOffsetX; },
    set shadowOffsetX(v) { state.shadowOffsetX = v; },
    get shadowOffsetY() { return state.shadowOffsetY; },
    set shadowOffsetY(v) { state.shadowOffsetY = v; },

    save() { stack.push({ ...state }); calls.push(['save']); },
    restore() { const s = stack.pop(); if (s) Object.assign(state, s); calls.push(['restore']); },
    translate(x, y) { calls.push(['translate', x, y]); },
    rotate(a) { calls.push(['rotate', a]); },
    scale(sx, sy) { calls.push(['scale', sx, sy]); },
    setTransform(a, b, c, d, e, f) { calls.push(['setTransform', a, b, c, d, e, f]); },
    clearRect(x, y, w, h) { calls.push(['clearRect', x, y, w, h]); },
    fillRect(x, y, w, h) { calls.push(['fillRect', x, y, w, h]); },
    strokeRect(x, y, w, h) { calls.push(['strokeRect', x, y, w, h]); },
    beginPath() { calls.push(['beginPath']); },
    closePath() { calls.push(['closePath']); },
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    arc(x, y, r, a0, a1) { calls.push(['arc', x, y, r, a0, a1]); },
    ellipse(x, y, rx, ry, rot, a0, a1) { calls.push(['ellipse', x, y, rx, ry, rot, a0, a1]); },
    rect(x, y, w, h) { calls.push(['rect', x, y, w, h]); },
    roundRect(x, y, w, h, r) { calls.push(['roundRect', x, y, w, h, r]); },
    quadraticCurveTo(cpx, cpy, x, y) { calls.push(['quadraticCurveTo', cpx, cpy, x, y]); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    clip() { calls.push(['clip']); },
    setLineDash(d) { calls.push(['setLineDash', d]); },
    fillText(t, x, y) { calls.push(['fillText', t, x, y]); },
    strokeText(t, x, y) { calls.push(['strokeText', t, x, y]); },
    measureText(t) { return { width: t.length * 8, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }; },
  };
  return ctx;
}

// ─── DrawContext constructor ───────────────────────────────────────────────────

test('DrawContext — constructor stores ctx, width, height, aspect', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  assert.equal(draw.ctx, ctx);
  assert.equal(draw.width, 1920);
  assert.equal(draw.height, 1080);
  assert.ok(Math.abs(draw.aspect - 1920 / 1080) < 1e-6);
});

test('CanvasKit is an alias for DrawContext', () => {
  assert.equal(CanvasKit, DrawContext);
});

test('createDrawContext factory returns a DrawContext', () => {
  const ctx = createMockCtx();
  const draw = createDrawContext(ctx, { width: 100, height: 100 });
  assert.ok(draw instanceof DrawContext);
});

test('DrawContext — _sync updates dimensions and aspect', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  draw._sync(null, 1280, 720);
  assert.equal(draw.width, 1280);
  assert.equal(draw.height, 720);
  assert.ok(Math.abs(draw.aspect - 1280 / 720) < 1e-6);
  assert.equal(draw.ctx, ctx, 'ctx unchanged when null passed');
});

// ─── clear ────────────────────────────────────────────────────────────────────

test('DrawContext.clear — calls clearRect with full canvas size', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 400, height: 200 });
  draw.clear();
  const clearCall = ctx._calls.find(c => c[0] === 'clearRect');
  assert.ok(clearCall, 'clearRect should be called');
  assert.equal(clearCall[1], 0);
  assert.equal(clearCall[2], 0);
  assert.equal(clearCall[3], 400);
  assert.equal(clearCall[4], 200);
});

test('DrawContext.clear — fills with color when provided', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 400, height: 200 });
  draw.clear('#ff0000');
  assert.ok(ctx._calls.some(c => c[0] === 'fillRect'), 'fillRect should be called with a color');
  assert.ok(!ctx._calls.some(c => c[0] === 'clearRect'), 'clearRect should NOT be called with a color');
});

// ─── isolate ──────────────────────────────────────────────────────────────────

test('DrawContext.isolate — wraps fn in save/restore', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 400, height: 200 });
  ctx._calls.length = 0;
  draw.isolate(() => {});
  assert.equal(ctx._calls[0][0], 'save');
  assert.equal(ctx._calls[ctx._calls.length - 1][0], 'restore');
});

test('DrawContext.isolate — restores even when fn throws', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 400, height: 200 });
  ctx._calls.length = 0;
  assert.throws(() => draw.isolate(() => { throw new Error('boom'); }));
  assert.equal(ctx._calls[ctx._calls.length - 1][0], 'restore');
});

// ─── transform helpers ────────────────────────────────────────────────────────

test('DrawContext.center — calls translate(w/2, h/2)', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  ctx._calls.length = 0;
  draw.center();
  const t = ctx._calls.find(c => c[0] === 'translate');
  assert.ok(t, 'translate called');
  assert.equal(t[1], 960);
  assert.equal(t[2], 540);
});

test('DrawContext.rotate — converts degrees to radians', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 100, height: 100 });
  ctx._calls.length = 0;
  draw.rotate(90);
  const r = ctx._calls.find(c => c[0] === 'rotate');
  assert.ok(r, 'rotate called');
  assert.ok(Math.abs(r[1] - Math.PI / 2) < 1e-6, 'angle in radians');
});

test('DrawContext.rotate — passes radians through when unit=rad', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 100, height: 100 });
  ctx._calls.length = 0;
  draw.rotate(Math.PI, 'rad');
  const r = ctx._calls.find(c => c[0] === 'rotate');
  assert.ok(Math.abs(r[1] - Math.PI) < 1e-6);
});

test('DrawContext.alpha — clamps to [0,1]', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 100, height: 100 });
  draw.alpha(-5);
  assert.equal(ctx._state.globalAlpha, 0);
  draw.alpha(999);
  assert.equal(ctx._state.globalAlpha, 1);
});

// ─── toScreen / fromScreen ────────────────────────────────────────────────────

test('DrawContext.toScreen — maps (0,0) to canvas center', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const p = draw.toScreen(0, 0);
  assert.equal(p.x, 960);
  assert.equal(p.y, 540);
});

test('DrawContext.fromScreen — maps canvas center to (0,0)', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const p = draw.fromScreen(960, 540);
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
});

test('DrawContext.toScreen/fromScreen — round-trip identity', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const origin = { x: 123, y: -456 };
  const screen = draw.toScreen(origin.x, origin.y);
  const back = draw.fromScreen(screen.x, screen.y);
  assert.ok(Math.abs(back.x - origin.x) < 1e-6);
  assert.ok(Math.abs(back.y - origin.y) < 1e-6);
});

// ─── rect ────────────────────────────────────────────────────────────────────

test('DrawContext.rect — center anchor places rect centered on (x,y)', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const result = draw.rect({ x: 0, y: 0, width: 100, height: 60, fill: '#fff', anchor: 'center' });
  assert.equal(result.x, -50);
  assert.equal(result.y, -30);
  assert.equal(result.width, 100);
  assert.equal(result.height, 60);
  assert.equal(result.right, 50);
  assert.equal(result.bottom, 30);
});

test('DrawContext.rect — top-left anchor uses (x,y) directly', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const result = draw.rect({ x: 10, y: 20, width: 100, height: 60, fill: '#fff', anchor: 'top-left' });
  assert.equal(result.x, 10);
  assert.equal(result.y, 20);
});

test('DrawContext.rect — calls fill when fill provided', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  ctx._calls.length = 0;
  draw.rect({ x: 0, y: 0, width: 50, height: 50, fill: '#ff0' });
  assert.ok(ctx._calls.some(c => c[0] === 'fill'), 'fill should be called');
  assert.ok(!ctx._calls.some(c => c[0] === 'stroke'), 'stroke should NOT be called without stroke option');
});

test('DrawContext.rect — calls stroke when stroke provided', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  ctx._calls.length = 0;
  draw.rect({ x: 0, y: 0, width: 50, height: 50, stroke: '#f00', lineWidth: 2 });
  assert.ok(ctx._calls.some(c => c[0] === 'stroke'), 'stroke should be called');
});

// ─── circle ──────────────────────────────────────────────────────────────────

test('DrawContext.circle — calls arc with correct params', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  ctx._calls.length = 0;
  draw.circle({ x: 10, y: 20, radius: 50, fill: '#fff' });
  const arc = ctx._calls.find(c => c[0] === 'arc');
  assert.ok(arc, 'arc should be called');
  assert.equal(arc[1], 10); // x
  assert.equal(arc[2], 20); // y
  assert.equal(arc[3], 50); // radius
});

// ─── text ────────────────────────────────────────────────────────────────────

test('DrawContext.text — calls fillText with the string content', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  ctx._calls.length = 0;
  draw.text('Hello', { x: 0, y: 0, color: '#fff' });
  const fillText = ctx._calls.find(c => c[0] === 'fillText');
  assert.ok(fillText, 'fillText should be called');
  assert.equal(fillText[1], 'Hello');
});

test('DrawContext.text — coerces numbers to string', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  ctx._calls.length = 0;
  draw.text(42, { x: 0, y: 0, color: '#fff' });
  const fillText = ctx._calls.find(c => c[0] === 'fillText');
  assert.equal(fillText[1], '42');
});

test('DrawContext._formatFont — builds font string from parts', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 100, height: 100 });
  const font = draw._formatFont({ size: 24, weight: 700, family: 'Inter' });
  assert.ok(font.includes('700'), 'weight present');
  assert.ok(font.includes('24px'), 'size present');
  assert.ok(font.includes('Inter'), 'family present');
});

test('DrawContext._formatFont — returns raw font string when font option given', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 100, height: 100 });
  const font = draw._formatFont({ font: '800 32px "Roboto", sans-serif', size: 16, family: 'sans-serif' });
  assert.equal(font, '800 32px "Roboto", sans-serif');
});

// ─── textWrap ────────────────────────────────────────────────────────────────

test('DrawContext.textWrap — splits long text into multiple lines', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  // Each character is 8px wide in the mock, so a 5-char word = 40px.
  // maxWidth=50 means two 5-char words (100px) must split.
  const result = draw.textWrap('Hello World', { x: 0, y: 0, maxWidth: 50, size: 16, color: '#fff' });
  assert.ok(result.count >= 2, `Expected >=2 lines, got ${result.count}: ${result.lines}`);
});

test('DrawContext.textWrap — single word never exceeds maxLines', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const result = draw.textWrap('one two three four five', { x: 0, y: 0, maxWidth: 30, size: 12, color: '#fff', maxLines: 2 });
  assert.ok(result.count <= 2, `Expected <=2 lines, got ${result.count}`);
});

// ─── badge ────────────────────────────────────────────────────────────────────

test('DrawContext.badge — returns bounding box', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const box = draw.badge('OK', { x: 0, y: 0, bg: '#38bdf8', color: '#fff' });
  assert.ok(typeof box.x === 'number');
  assert.ok(box.width > 0, 'badge should have positive width');
  assert.ok(box.height > 0, 'badge should have positive height');
});

// ─── progressBar ─────────────────────────────────────────────────────────────

test('DrawContext.progressBar — normalizes 0-100 progress', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const result = draw.progressBar({ progress: 75 });
  assert.ok(Math.abs(result.progress - 0.75) < 1e-6, `Expected 0.75, got ${result.progress}`);
});

test('DrawContext.progressBar — passes through 0-1 progress unchanged', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const result = draw.progressBar({ progress: 0.42 });
  assert.ok(Math.abs(result.progress - 0.42) < 1e-6, `Expected 0.42, got ${result.progress}`);
});

test('DrawContext.progressBar — clamps progress to [0,1]', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  assert.equal(draw.progressBar({ progress: -10 }).progress, 0);
  assert.equal(draw.progressBar({ progress: 150 }).progress, 1);
});

// ─── row / column layout ─────────────────────────────────────────────────────

test('DrawContext.row — returns total width = sum of item widths + gaps', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const result = draw.row({
    x: 0, y: 0, gap: 10,
    items: [
      { width: 100, height: 40, render: () => {} },
      { width: 100, height: 40, render: () => {} },
    ],
  });
  assert.equal(result.width, 210, 'width = 100 + 10 + 100');
});

test('DrawContext.column — returns total height = sum of item heights + gaps', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const result = draw.column({
    x: 0, y: 0, gap: 8,
    items: [
      { width: 200, height: 30, render: () => {} },
      { width: 200, height: 30, render: () => {} },
      { width: 200, height: 30, render: () => {} },
    ],
  });
  assert.equal(result.height, 30 * 3 + 8 * 2);
});

test('DrawContext.row — empty items returns zero dimensions', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  const result = draw.row({ items: [] });
  assert.equal(result.width, 0);
  assert.equal(result.height, 0);
});

// ─── CanvasNode scene graph ────────────────────────────────────────────────────

test('CanvasNode.add — sets parent reference', () => {
  const parent = new CanvasNode();
  const child = new CanvasNode();
  parent.add(child);
  assert.equal(child.parent, parent);
  assert.ok(parent.children.includes(child));
});

test('CanvasNode.remove — clears parent and removes from children', () => {
  const parent = new CanvasNode();
  const child = new CanvasNode();
  parent.add(child);
  parent.remove(child);
  assert.equal(child.parent, null);
  assert.ok(!parent.children.includes(child));
});

test('CanvasNode.add — re-parents child from old parent', () => {
  const p1 = new CanvasNode();
  const p2 = new CanvasNode();
  const child = new CanvasNode();
  p1.add(child);
  p2.add(child);
  assert.equal(child.parent, p2);
  assert.ok(!p1.children.includes(child));
  assert.ok(p2.children.includes(child));
});

test('CanvasNode.render — calls drawSelf and recurses into children', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 100, height: 100 });

  const calls = [];
  const parent = new CanvasNode();
  parent.drawSelf = () => calls.push('parent');
  const child = new CanvasNode();
  child.drawSelf = () => calls.push('child');
  parent.add(child);

  parent.render(draw);
  assert.deepEqual(calls, ['parent', 'child']);
});

test('CanvasNode.render — skips invisible nodes and their children', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 100, height: 100 });

  const calls = [];
  const parent = new CanvasNode({ visible: false });
  parent.drawSelf = () => calls.push('parent');
  const child = new CanvasNode();
  child.drawSelf = () => calls.push('child');
  parent.add(child);

  parent.render(draw);
  assert.equal(calls.length, 0, 'invisible node and children should not render');
});

test('CanvasNode — supports reactive function props', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 100, height: 100 });

  let currentX = 0;
  const node = new RectNode({ x: () => currentX, fill: '#fff' });
  node.width = 10;
  node.height = 10;

  ctx._calls.length = 0;
  node.render(draw);
  const t0 = ctx._calls.find(c => c[0] === 'translate');
  assert.equal(t0[1], 0);

  currentX = 50;
  ctx._calls.length = 0;
  node.render(draw);
  const t1 = ctx._calls.find(c => c[0] === 'translate');
  assert.equal(t1[1], 50);
});

test('RectNode draws a rect via DrawContext', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 400, height: 300 });
  const node = new RectNode({ fill: '#ff0', width: 100, height: 50 });
  ctx._calls.length = 0;
  node.render(draw);
  assert.ok(ctx._calls.some(c => c[0] === 'fill'), 'RectNode should trigger fill');
});

test('TextNode draws text via DrawContext', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 400, height: 300 });
  const node = new TextNode({ text: 'Test', color: '#fff' });
  ctx._calls.length = 0;
  node.render(draw);
  assert.ok(ctx._calls.some(c => c[0] === 'fillText'), 'TextNode should trigger fillText');
});

test('CircleNode draws a circle via DrawContext', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 400, height: 300 });
  const node = new CircleNode({ fill: '#fff', radius: 40 });
  ctx._calls.length = 0;
  node.render(draw);
  assert.ok(ctx._calls.some(c => c[0] === 'arc'), 'CircleNode should trigger arc');
});

// ─── CanvasComponent integration: draw is auto-created ───────────────────────

test('CanvasComponent — draw property is created by _ensureDraw', () => {
  const comp = new CanvasComponent();
  comp.canvasWidth = 1920;
  comp.canvasHeight = 1080;
  comp.ctx = createMockCtx();
  comp.draw = null;
  comp._ensureDraw();
  assert.ok(comp.draw instanceof DrawContext, 'draw should be a DrawContext after _ensureDraw');
  assert.equal(comp.draw.width, 1920);
  assert.equal(comp.draw.height, 1080);
});

test('CanvasComponent — draw is resynced when _ensureDraw called again', () => {
  const comp = new CanvasComponent();
  comp.canvasWidth = 1920;
  comp.canvasHeight = 1080;
  comp.ctx = createMockCtx();
  comp.draw = null;
  comp._ensureDraw();

  comp.canvasWidth = 1280;
  comp.canvasHeight = 720;
  comp._ensureDraw();
  assert.equal(comp.draw.width, 1280);
  assert.equal(comp.draw.height, 720);
});

// ─── High-Level Motion / Video Primitives Tests ───────────────────────────────

test('DrawContext.spotlight — uses destination-out to punch hole', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  draw.spotlight({ x: 0, y: 0, width: 400, height: 300, radius: 10 });

  assert.ok(ctx._calls.some(c => c[0] === 'roundRect'), 'roundRect should be called for rect cutout');
  assert.ok(ctx._calls.some(c => c[0] === 'fillRect'), 'fillRect should draw backdrop');
  // Check that destination-out was used
  assert.equal(ctx.globalCompositeOperation, 'source-over'); // restored after save/restore or reset
});

test('DrawContext.spotlight — supports circle shape and stroke', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  draw.spotlight({ x: 100, y: 50, shape: 'circle', radius: 80, stroke: '#ffff00', lineWidth: 4 });

  assert.ok(ctx._calls.some(c => c[0] === 'arc'), 'arc should be called for circle cutout');
  assert.ok(ctx._calls.some(c => c[0] === 'stroke'), 'stroke should be called when stroke option given');
});

test('DrawContext.traceRect — sets line dash proportional to progress', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  draw.traceRect({ x: 0, y: 0, width: 200, height: 100, progress: 0.5, stroke: '#3b82f6' });

  const dashCall = ctx._calls.find(c => c[0] === 'setLineDash');
  assert.ok(dashCall, 'setLineDash should be called');
  // perimeter for 200x100 is 2*(200+100) = 600. progress 0.5 => 300
  const dashArray = dashCall[1];
  assert.equal(dashArray[0], 300);
  assert.ok(ctx._calls.some(c => c[0] === 'stroke'));
});

test('DrawContext.traceRect — does nothing when progress <= 0', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  ctx._calls.length = 0;
  draw.traceRect({ x: 0, y: 0, width: 200, height: 100, progress: 0 });
  assert.equal(ctx._calls.length, 0);
});

test('DrawContext.traceCircle — strokes arc up to progress angle', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  draw.traceCircle({ x: 0, y: 0, radius: 50, progress: 0.25, stroke: '#10b981' });

  const arcCall = ctx._calls.find(c => c[0] === 'arc');
  assert.ok(arcCall, 'arc should be called');
  assert.ok(ctx._calls.some(c => c[0] === 'stroke'));
});

test('DrawContext.callout — draws arrow line, arrow head, ping and label badge', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  draw.callout({
    fromX: 100,
    fromY: -200,
    toX: 0,
    toY: 0,
    text: 'Look Here!',
    color: '#f59e0b',
    ping: true,
  });

  assert.ok(ctx._calls.some(c => c[0] === 'lineTo'), 'arrow path should use lineTo');
  assert.ok(ctx._calls.some(c => c[0] === 'arc'), 'ping circle should use arc');
  assert.ok(ctx._calls.some(c => c[0] === 'fillText' && c[1] === 'Look Here!'), 'text should be drawn');
});

test('DrawContext.counter — formats numbers with prefix, suffix, and underline', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  draw.counter({
    value: 12500,
    prefix: '$',
    suffix: ' USD',
    label: 'REVENUE',
    underline: true,
  });

  assert.ok(ctx._calls.some(c => c[0] === 'fillText' && c[1] === 'REVENUE'), 'label should be drawn');
  assert.ok(ctx._calls.some(c => c[0] === 'fillText' && c[1] === '$12,500 USD'), 'formatted number should be drawn');
  assert.ok(ctx._calls.some(c => c[0] === 'stroke'), 'underline stroke should be called');
});

test('DrawContext.windowBar — draws title bar with traffic lights and title', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  draw.windowBar({ x: 0, y: 0, width: 400, height: 36, title: 'demo.jsx', controls: true });

  assert.ok(ctx._calls.some(c => c[0] === 'roundRect'), 'header bar should use roundRect');
  const arcCalls = ctx._calls.filter(c => c[0] === 'arc');
  assert.ok(arcCalls.length >= 3, 'traffic light buttons should draw at least 3 circles');
  assert.ok(ctx._calls.some(c => c[0] === 'fillText' && c[1] === 'demo.jsx'), 'title text should be drawn');
});

test('DrawContext.cornerBrackets — draws 4 L-shaped brackets', () => {
  const ctx = createMockCtx();
  const draw = new DrawContext(ctx, { width: 1920, height: 1080 });
  draw.cornerBrackets({ x: 0, y: 0, width: 300, height: 200, length: 40, progress: 1 });

  const lineToCalls = ctx._calls.filter(c => c[0] === 'lineTo');
  // 4 corners * 2 arms = 8 lineTo calls
  assert.equal(lineToCalls.length, 8);
  assert.ok(ctx._calls.some(c => c[0] === 'stroke'));
});
