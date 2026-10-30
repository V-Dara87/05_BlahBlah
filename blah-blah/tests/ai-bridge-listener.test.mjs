import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyBridgeToken,
  isOriginAllowed,
  isCommandStale,
  findEntityForSelect,
  calculateDownscaleDimensions,
  formatBridgeResult,
  base64ToUint8Array,
  uint8ArrayToBase64,
  DEFAULT_MAX_COMMAND_AGE_MS,
  MAX_FRAME_LONG_SIDE,
  ALLOWED_BRIDGE_ORIGINS,
} from '../src/utils/aiBridgeCore.js';

test('AI Bridge - verifyBridgeToken security validation', () => {
  const secret = 'test-token-abcdef1234567890';
  assert.equal(verifyBridgeToken(secret, secret), true);
  assert.equal(verifyBridgeToken(`  ${secret}  `, secret), true);
  assert.equal(verifyBridgeToken('wrong-token', secret), false);
  assert.equal(verifyBridgeToken('', secret), false);
  assert.equal(verifyBridgeToken(null, secret), false);
  assert.equal(verifyBridgeToken(secret, null), false);
  assert.equal(verifyBridgeToken(undefined, secret), false);
  assert.equal(verifyBridgeToken(secret, undefined), false);
});

test('AI Bridge - isOriginAllowed enforces origin allowlist', () => {
  assert.equal(ALLOWED_BRIDGE_ORIGINS.includes('tauri://localhost'), true);
  assert.equal(ALLOWED_BRIDGE_ORIGINS.includes('http://tauri.localhost'), true);
  assert.equal(ALLOWED_BRIDGE_ORIGINS.includes('http://localhost:5173'), true);

  assert.equal(isOriginAllowed('tauri://localhost'), true);
  assert.equal(isOriginAllowed('http://tauri.localhost'), true);
  assert.equal(isOriginAllowed('http://localhost:5173'), true);
  assert.equal(isOriginAllowed('http://localhost:5173/'), true); // trailing slash

  assert.equal(isOriginAllowed('http://malicious-site.com'), false);
  assert.equal(isOriginAllowed('http://localhost:3000'), false);
  assert.equal(isOriginAllowed(''), false);
  assert.equal(isOriginAllowed(null), false);
});

test('AI Bridge - isCommandStale detects stale commands beyond 5 minutes', () => {
  const now = 1000000;
  // 30 seconds old -> fresh
  assert.equal(isCommandStale(now - 30 * 1000, now, DEFAULT_MAX_COMMAND_AGE_MS), false);
  // 4 minutes old -> fresh
  assert.equal(isCommandStale(now - 4 * 60 * 1000, now, DEFAULT_MAX_COMMAND_AGE_MS), false);
  // Exactly at boundary
  assert.equal(isCommandStale(now - DEFAULT_MAX_COMMAND_AGE_MS, now, DEFAULT_MAX_COMMAND_AGE_MS), false);
  // 5 minutes + 1ms old -> stale
  assert.equal(isCommandStale(now - (DEFAULT_MAX_COMMAND_AGE_MS + 1), now, DEFAULT_MAX_COMMAND_AGE_MS), true);
  // 1 hour old -> stale
  assert.equal(isCommandStale(now - 3600 * 1000, now, DEFAULT_MAX_COMMAND_AGE_MS), true);
  // Corrupt or missing timestamp -> considered stale for safety
  assert.equal(isCommandStale(null, now), true);
  assert.equal(isCommandStale(undefined, now), true);
  assert.equal(isCommandStale('invalid', now), true);
});

test('AI Bridge - findEntityForSelect resolves by id, name, and case-insensitive name', () => {
  const entities = [
    { id: 'ent-1', name: 'IntroTitle' },
    { id: 'ent-2', name: 'Background Video' },
    { id: 'ent-3', name: 'Lower Third' },
  ];

  // By exact ID
  assert.deepEqual(findEntityForSelect(entities, 'ent-1'), entities[0]);
  assert.deepEqual(findEntityForSelect(entities, 'ent-3'), entities[2]);

  // By exact Name
  assert.deepEqual(findEntityForSelect(entities, 'IntroTitle'), entities[0]);
  assert.deepEqual(findEntityForSelect(entities, 'Background Video'), entities[1]);

  // By case-insensitive Name
  assert.deepEqual(findEntityForSelect(entities, 'introtitle'), entities[0]);
  assert.deepEqual(findEntityForSelect(entities, 'BACKGROUND VIDEO'), entities[1]);
  assert.deepEqual(findEntityForSelect(entities, 'lower third'), entities[2]);

  // Non-existent target
  assert.equal(findEntityForSelect(entities, 'NonExistent'), null);
  assert.equal(findEntityForSelect(entities, ''), null);
  assert.equal(findEntityForSelect([], 'ent-1'), null);
  assert.equal(findEntityForSelect(null, 'ent-1'), null);
});

test('AI Bridge - calculateDownscaleDimensions caps long side and preserves even dimensions', () => {
  // Standard 1080p landscape -> 1280x720
  const d1080p = calculateDownscaleDimensions(1920, 1080, MAX_FRAME_LONG_SIDE);
  assert.equal(d1080p.width, 1280);
  assert.equal(d1080p.height, 720);
  assert.equal(d1080p.width % 2, 0);
  assert.equal(d1080p.height % 2, 0);

  // 4K landscape (3840x2160) -> 1280x720
  const d4k = calculateDownscaleDimensions(3840, 2160, MAX_FRAME_LONG_SIDE);
  assert.equal(d4k.width, 1280);
  assert.equal(d4k.height, 720);

  // Vertical Reels / Shorts (1080x1920) -> 720x1280
  const dReels = calculateDownscaleDimensions(1080, 1920, MAX_FRAME_LONG_SIDE);
  assert.equal(dReels.width, 720);
  assert.equal(dReels.height, 1280);

  // Square (1080x1080) -> 1080x1080 (already <= 1280)
  const dSquare = calculateDownscaleDimensions(1080, 1080, MAX_FRAME_LONG_SIDE);
  assert.equal(dSquare.width, 1080);
  assert.equal(dSquare.height, 1080);

  // Smaller than max (800x600) -> stays 800x600 without upscaling
  const dSmall = calculateDownscaleDimensions(800, 600, MAX_FRAME_LONG_SIDE);
  assert.equal(dSmall.width, 800);
  assert.equal(dSmall.height, 600);

  // Odd dimensions get rounded down to even
  const dOdd = calculateDownscaleDimensions(801, 599, MAX_FRAME_LONG_SIDE);
  assert.equal(dOdd.width % 2, 0);
  assert.equal(dOdd.height % 2, 0);
});

test('AI Bridge - formatBridgeResult structures success and error responses correctly', () => {
  const success = formatBridgeResult('cmd-123', true, { command: 'seek', time: 5.5 });
  assert.equal(success.id, 'cmd-123');
  assert.equal(success.ok, true);
  assert.equal(success.command, 'seek');
  assert.equal(success.time, 5.5);
  assert.ok(typeof success.timestamp === 'number');
  assert.equal(success.error, undefined);

  const failure = formatBridgeResult('cmd-456', false, { command: 'select' }, 'Entity not found');
  assert.equal(failure.id, 'cmd-456');
  assert.equal(failure.ok, false);
  assert.equal(failure.command, 'select');
  assert.equal(failure.error, 'Entity not found');
});

test('AI Bridge - base64ToUint8Array and uint8ArrayToBase64 round-trip', () => {
  const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const b64 = uint8ArrayToBase64(original);
  assert.ok(b64.length > 0);
  const roundtrip = base64ToUint8Array(b64);
  assert.deepEqual([...roundtrip], [...original]);

  // Strip data URL scheme prefix
  const withPrefix = `data:image/png;base64,${b64}`;
  const parsed = base64ToUint8Array(withPrefix);
  assert.deepEqual([...parsed], [...original]);
});
