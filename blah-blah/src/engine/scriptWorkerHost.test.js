import test from 'node:test';
import assert from 'node:assert/strict';
import { ScriptWorkerHost, ScriptHangError } from './scriptWorkerHost.js';

test('ScriptWorkerHost - normal message resolves properly before timeout', async () => {
  // Mock worker that responds immediately
  const mockWorker = {
    postMessage(data) {
      setTimeout(() => {
        this.onmessage({ data: { id: data.id, type: `${data.type}_ok` } });
      }, 5);
    },
    terminate() {},
    onmessage: null,
    onerror: null,
  };

  const host = new ScriptWorkerHost({
    scriptCode: 'export default {}',
    scriptName: 'TestScript',
    timeoutMs: 100,
    workerFactory: () => mockWorker,
  });

  const res = await host.callWorker('ping', {});
  assert.equal(res.type, 'ping_ok');
  assert.equal(host.isHanging, false);
});

test('ScriptWorkerHost - watchdog triggers on infinite loop / hang and kills worker', async () => {
  let terminated = false;
  // Mock worker that simulates infinite loop: never responds
  const mockFrozenWorker = {
    postMessage(_data) {
      // Simulating while(true): Never calls this.onmessage!
    },
    terminate() {
      terminated = true;
    },
    onmessage: null,
    onerror: null,
  };

  const host = new ScriptWorkerHost({
    scriptCode: 'while (true) {}',
    scriptName: 'FrozenScript',
    timeoutMs: 50, // Short timeout for test
    workerFactory: () => mockFrozenWorker,
  });

  await assert.rejects(
    async () => {
      await host.callWorker('update', { time: 1.0 });
    },
    (err) => {
      assert.ok(err instanceof ScriptHangError, 'Must throw ScriptHangError');
      assert.ok(err.message.includes('FrozenScript'), 'Error message must include script name');
      return true;
    }
  );

  assert.equal(terminated, true, 'Worker must be forcefully terminated on hang');
  assert.equal(host.isHanging, true, 'Host must be marked as hanging');
});
