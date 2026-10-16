import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { PixieService } from '../src/host/pixie-service.ts';
import { PixieGateStore } from '../src/host/pixie-gate-store.ts';

const gate = { id: 'g', name: 'Gate', point: 'input' };
async function harness(list) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-gate-service-'));
  const ctx = new Context();
  for (const key of ['llm', 'sessionController', 'commands']) ctx.provide(key);
  ctx.set('commands', { register: () => () => {} });
  ctx.set('llm', {});
  ctx.set('sessionController', { list });
  return { ctx, dir };
}

test('Remote gate read, follow and rejection resolution share the internal recorder', async () => {
  const h = await harness(async () => ({ items: [{ sessionId: 's' }] }));
  const fiber = h.ctx.plugin(PixieService, h.dir); await fiber;
  const service = h.ctx.get('studioPixie'); const abort = new AbortController();
  try {
    const run = await service.gateRecorder.start('s', gate, 'original');
    const stream = service.followGates('s', abort.signal);
    assert.equal((await stream.next()).value.type, 'sync');
    assert.equal((await stream.next()).value.run.id, run.id);
    await service.gateRecorder.finish('s', run.id, { status: 'done', applied: 'rejected', rejection: { reason: 'fix it' } });
    assert.equal((await stream.next()).value.run.rejection.status, 'pending');
    await service.resolveGateRejection('s', run.id, 'dismissed');
    assert.equal((await stream.next()).value.run.rejection.status, 'dismissed');
    assert.equal((await service.gateRuns('s')).runs[0].original, 'original');
    await assert.rejects(service.resolveGateRejection('s', run.id, 'resent'), /not pending/);
    await stream.return();
  } finally { abort.abort(); await fiber.dispose(); }
});

for (const fails of [false, true]) test(`service startup prune includes gates; listing failure=${fails}`, async () => {
  let listed; const observed = new Promise(resolve => { listed = resolve; });
  const h = await harness(async () => { listed(); if (fails) throw Error('offline'); return { items: [{ sessionId: 'archived' }] }; });
  const store = new PixieGateStore(join(h.dir, 'pixie'));
  for (const id of ['archived', 'gone']) {
    const run = await store.start(id, gate, 'original'); await store.finish(id, run.id, { status: 'done', applied: 'pass' });
  }
  const fiber = h.ctx.plugin(PixieService, h.dir); await fiber;
  await observed;
  // Disposer awaits the in-flight prune, no timer polling required.
  await fiber.dispose();
  assert.equal((await store.read('archived')).runs.length, 1);
  assert.equal((await store.read('gone')).runs.length, fails ? 1 : 0);
});

for (const id of [null, 123, undefined, {}, { toString: () => 's' }]) {
  test(`Remote gate methods reject non-string session ID: ${String(id)}`, async () => {
    const h = await harness(async () => ({ items: [] }));
    const fiber = h.ctx.plugin(PixieService, h.dir); await fiber;
    const service = h.ctx.get('studioPixie'); const abort = new AbortController();
    try {
      await assert.rejects(service.gateRuns(id), /Invalid session id/);
      await assert.rejects(service.resolveGateRejection(id, 'r', 'dismissed'), /Invalid session id/);
      await assert.rejects(service.followGates(id, abort.signal).next(), /Invalid session id/);
    } finally { abort.abort(); await fiber.dispose(); }
  });
}
