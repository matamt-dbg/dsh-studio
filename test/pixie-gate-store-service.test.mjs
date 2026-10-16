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

test('a session gate switch persists beside the runs, survives a run commit, and reaches followers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-gate-switch-'));
  const store = new PixieGateStore(dir), abort = new AbortController(), frames = [];
  const follow = (async () => { for await (const frame of store.follow('s', abort.signal)) frames.push(frame); })();
  assert.deepEqual(await store.disabledGates('s'), []);
  assert.deepEqual(await store.setGateEnabled('s', 'g', false), ['g']);
  const run = await store.start('s', gate, 'x');
  await store.finish('s', run.id, { status: 'done', applied: 'none' });
  assert.deepEqual(await store.disabledGates('s'), ['g']);
  assert.deepEqual((await store.read('s')).runs.length, 1);
  assert.deepEqual(await store.setGateEnabled('s', 'g', true), []);
  assert.equal('disabledGateIds' in await store.read('s'), false);
  await new Promise(resolve => setImmediate(resolve)); abort.abort(); await follow;
  assert.deepEqual(frames.filter(frame => frame.type === 'session').map(frame => frame.disabledGateIds), [['g'], []]);
  assert.deepEqual(await store.disabledGates('other'), []);
  assert.throws(() => store.setGateEnabled('s', '', false), /Gate id is required/);
});

test('Remote sessionGates lists only gates on for the session preset; setSessionGate switches one', async () => {
  const h = await harness(async () => ({ items: [{ sessionId: 's' }] }));
  const agentCtx = {};
  for (const key of ['agents', 'agentPresets']) h.ctx.provide(key);
  h.ctx.set('agents', { get: id => id === 's' ? { ctx: agentCtx } : undefined, roots: () => [] });
  h.ctx.set('agentPresets', { composedPreset: ctx => ctx === agentCtx ? 'p' : undefined });
  const fiber = h.ctx.plugin(PixieService, h.dir); await fiber;
  const service = h.ctx.get('studioPixie');
  try {
    const task = (id, extra) => ({ id, name: id, enabled: true, when: 'turn-end', instruction: 'Check', presetIds: ['p'], advanced: { confirmReplace: false, onError: 'pass', agents: 'root', timeoutMs: 60000, maxSteers: 1 }, ...extra });
    await service.saveGateDefinitions(JSON.stringify([task('on', { advanced: { confirmReplace: false, onError: 'pass', agents: 'root', timeoutMs: 60000, maxSteers: 1, script: 'translate.sh' } }),
      task('other-preset', { presetIds: ['q'], when: 'user-message' }), task('off-everywhere', { enabled: false, when: 'tool-before' }), task('off-for-preset', { disabledPresetIds: ['p'], when: 'tool-after' })]));
    assert.deepEqual(await service.sessionGates('s'), { preset: 'p', gates: [{ id: 'on', name: 'on', when: 'turn-end', script: 'translate.sh', sessionEnabled: true }] });
    assert.deepEqual(await service.setSessionGate('s', 'on', false), ['on']);
    assert.equal((await service.sessionGates('s')).gates[0].sessionEnabled, false);
    assert.deepEqual(await service.sessionGates('unknown'), { gates: [] });
    await assert.rejects(service.setSessionGate('s', 'on', 'no'), /boolean/);
  } finally { await fiber.dispose(); }
});
