import { test } from 'node:test';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PixieGateStore, MAX_GATE_RUNS } from '../src/host/pixie-gate-store.ts';
import { PixieStore } from '../src/host/pixie-store.ts';
import { totalUsage } from '../src/pixie-contracts.ts';

const gate = { id: 'g', name: 'Gate snapshot', point: 'input' };
const root = () => mkdtemp(join(tmpdir(), 'studio-gate-store-'));
const result = () => ({ verdict: 'revise', original: 'original', subject: 'final', notes: [], stages: {}, records: [], hooks: {}, forward: { kind: 'replace', text: 'final' } });
const done = { status: 'done', applied: 'replaced', result: result() };
const rejected = { status: 'done', applied: 'rejected', result: result(), rejection: { reason: 'reason', suggestion: 'suggestion' } };

test('gate commits replace the file atomically and leave no temporary files', async () => {
  const dir = await root(); const store = new PixieGateStore(dir);
  const run = await store.start('s', gate, 'original');
  const path = join(dir, 'gates', 's.json'); const before = await stat(path);
  const finishing = store.finish('s', run.id, done);
  for (let i = 0; i < 20; i++) {
    const record = JSON.parse(await readFile(path, 'utf8'));
    assert.ok(['running', 'done'].includes(record.runs[0].status));
  }
  await finishing;
  assert.notEqual((await stat(path)).ino, before.ino);
  assert.deepEqual(await readdir(join(dir, 'gates')), ['s.json']);
  assert.equal((await store.read('s')).runs[0].finalText, 'final');
});

test('concurrent starts and finishes serialize without lost records and snapshots are detached', async () => {
  const store = new PixieGateStore(await root());
  const runs = await Promise.all(Array.from({ length: 30 }, () => store.start('s', gate, 'original')));
  runs[0].original = 'mutated';
  await Promise.all(runs.map(run => store.finish('s', run.id, done)));
  const record = await store.read('s');
  assert.equal(record.runs.length, 30);
  assert.ok(record.runs.every(run => run.status === 'done' && run.original === 'original' && run.gateName === gate.name));
});

test('first settlement wins and late answers do not overwrite cancellation', async () => {
  const store = new PixieGateStore(await root()); const run = await store.start('s', gate, 'original');
  assert.deepEqual(await Promise.all([
    store.finish('s', run.id, { status: 'cancelled', applied: 'none' }), store.finish('s', run.id, done),
  ]), [true, false]);
  const saved = (await store.read('s')).runs[0];
  assert.equal(saved.status, 'cancelled'); assert.equal(saved.finalText, 'original'); assert.ok(saved.endedAt);
});

test('restart reads interrupted work as cancelled and refuses late settlement', async () => {
  const dir = await root(); const store = new PixieGateStore(dir); const run = await store.start('s', gate, 'original');
  const restarted = new PixieGateStore(dir);
  assert.equal((await store.read('s')).runs[0].status, 'running');
  assert.equal((await restarted.read('s')).runs[0].status, 'cancelled');
  assert.equal(await restarted.finish('s', run.id, done), false);
});

test('retention removes oldest eligible records but protects pending input and running work', async () => {
  const store = new PixieGateStore(await root());
  const pending = await store.start('s', gate, 'original'); await store.finish('s', pending.id, rejected);
  const running = await store.start('s', gate, 'original');
  const ids = [];
  for (let i = 0; i < MAX_GATE_RUNS + 2; i++) {
    const run = await store.start('s', gate, 'original'); ids.push(run.id); await store.finish('s', run.id, done);
  }
  const runs = (await store.read('s')).runs;
  assert.equal(runs.length, MAX_GATE_RUNS);
  assert.ok(runs.some(run => run.id === pending.id)); assert.ok(runs.some(run => run.id === running.id));
  assert.ok(!runs.some(run => run.id === ids[0])); assert.equal(runs.at(-1).id, ids.at(-1));
});

test('protected records may exceed the cap until pending rejection is resolved', async () => {
  const store = new PixieGateStore(await root());
  const runs = await Promise.all(Array.from({ length: MAX_GATE_RUNS + 1 }, () => store.start('s', gate, 'original')));
  await Promise.all(runs.map(run => store.finish('s', run.id, rejected)));
  assert.equal((await store.read('s')).runs.length, MAX_GATE_RUNS + 1);
  await store.resolveRejection('s', runs[0].id, 'dismissed');
  assert.equal((await store.read('s')).runs.length, MAX_GATE_RUNS);
});

test('prune preserves archived and live sessions and failed listing deletes nothing', async () => {
  const store = new PixieGateStore(await root());
  for (const id of ['archived', 'gone', 'live']) {
    const run = await store.start(id, gate, 'original'); if (id !== 'live') await store.finish(id, run.id, done);
  }
  assert.deepEqual(await store.prune(async () => { throw Error('offline'); }), []);
  assert.equal((await store.read('gone')).runs.length, 1);
  assert.deepEqual(await store.prune(async () => [{ sessionId: 'archived' }]), ['gone']);
  assert.equal((await store.read('archived')).runs.length, 1); assert.equal((await store.read('live')).runs.length, 1);
  const live = (await store.read('live')).runs[0]; await store.finish('live', live.id, done);
  assert.deepEqual(await store.prune(async () => [{ sessionId: 'archived' }]), ['live']);
});

test('rejections preserve original, reason and suggestion; only pending to resent/dismissed is legal', async () => {
  const store = new PixieGateStore(await root());
  for (const status of ['resent', 'dismissed']) {
    const run = await store.start('s', gate, 'original'); await store.finish('s', run.id, rejected);
    await assert.rejects(store.resolveRejection('s', run.id, 'pending'), /transition/);
    const resolved = await store.resolveRejection('s', run.id, status);
    assert.deepEqual(resolved.rejection, { original: 'original', reason: 'reason', suggestion: 'suggestion', status });
    await assert.rejects(store.resolveRejection('s', run.id, status), /not pending/);
  }
  const run = await store.start('s', gate, 'original');
  await assert.rejects(store.finish('s', run.id, { ...rejected, applied: 'pass' }), /rejected input/);
  await assert.rejects(store.resolveRejection('s', run.id, 'resent'), /not pending/);
  await assert.rejects(store.finish('s', run.id, { status: 'done', applied: 'rejected' }), /requires rejection details/);
});

test('follow sync, in-flight replay and committed events have no duplicates', async () => {
  const store = new PixieGateStore(await root()); const run = await store.start('s', gate, 'original');
  await store.start('other', gate, 'original');
  const abort = new AbortController(); const stream = store.follow('s', abort.signal);
  assert.deepEqual((await stream.next()).value, { type: 'sync' });
  await store.finish('s', run.id, rejected);
  assert.equal((await stream.next()).value.run.status, 'running');
  assert.equal((await stream.next()).value.run.status, 'done');
  await store.resolveRejection('s', run.id, 'dismissed');
  assert.equal((await stream.next()).value.run.rejection.status, 'dismissed');
  await store.finish('s', run.id, done);
  const waiting = stream.next(); abort.abort(); assert.equal((await waiting).done, true);
  const reconnectAbort = new AbortController(); const reconnect = store.follow('s', reconnectAbort.signal);
  assert.equal((await reconnect.next()).value.type, 'sync');
  const empty = reconnect.next(); reconnectAbort.abort(); assert.equal((await empty).done, true);
});

test('gate usage sums calls once, preserving optional fields and never touching #25 usage', async () => {
  const dir = await root(); const store = new PixieGateStore(dir); const pixie = new PixieStore(dir);
  const thread = await pixie.createThread('s', { mode: 'fresh', model: { provider: 'p', model: 'm' } });
  const turn = await pixie.startTurn('s', thread.id, 'question');
  await pixie.finishTurn('s', thread.id, turn.id, { status: 'done', answer: 'answer', usage: { inputTokens: 100, outputTokens: 50 } });
  const outcome = { ...result(), records: ['a', 'b'].map(id => ({ id, result: { verdict: 'note', usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 1 } }, subjectBytes: 8, textBytes: 4 })) };
  const run = await store.start('s', gate, 'original'); await store.finish('s', run.id, { ...done, result: outcome });
  assert.deepEqual((await store.read('s')).runs[0].usage, { inputTokens: 4, outputTokens: 6, cacheReadTokens: 2 });
  assert.equal(totalUsage(await pixie.read('s')).inputTokens, 100);
});

test('invalid session ids are rejected at every file boundary', async () => {
  const store = new PixieGateStore(await root());
  for (const id of ['../escape', '', 'a/b', 'x'.repeat(201)]) {
    await assert.rejects(store.start(id, gate, 'original'), /Invalid session id/);
    await assert.rejects(store.read(id), /Invalid session id/);
    await assert.rejects(store.follow(id, new AbortController().signal).next(), /Invalid session id/);
  }
});

for (const [label, content] of [
  ['envelope mismatch', JSON.stringify({ sessionId: 'b', runs: [] })],
  ['run session mismatch', JSON.stringify({ sessionId: 'a', runs: [{ id: 'r', sessionId: 'b', status: 'done' }] })],
  ['non-array runs', JSON.stringify({ sessionId: 'a', runs: {} })],
  ['null envelope', 'null'], ['array envelope', '[]'], ['null run', JSON.stringify({ sessionId: 'a', runs: [null] })],
  ['broken JSON', '{'],
]) test(`corrupt records fail closed without touching either session: ${label}`, async () => {
  const dir = await root(); const store = new PixieGateStore(dir);
  const other = await store.start('b', gate, 'original'); await store.finish('b', other.id, done);
  const a = join(dir, 'gates', 'a.json'); const b = join(dir, 'gates', 'b.json');
  await writeFile(a, content); const before = await readFile(b, 'utf8');
  await assert.rejects(store.read('a'));
  await assert.rejects(store.start('a', gate, 'original'));
  await assert.rejects(store.finish('a', 'r', done));
  await assert.rejects(store.resolveRejection('a', 'r', 'dismissed'));
  assert.equal(await readFile(a, 'utf8'), content);
  assert.equal(await readFile(b, 'utf8'), before);
  assert.deepEqual((await readdir(join(dir, 'gates'))).sort(), ['a.json', 'b.json']);
});

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

// Intercept only the chosen file; restore the builtin binding even when an assertion fails.
function interceptRename(t, target, hook) {
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => to === target ? hook(from, to, rename) : rename(from, to));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

for (const scenario of ['A: pending start is not replayed', 'B: failed start leaves no ghost running', 'C: committed start is delivered exactly once']) {
  test(`follow ${scenario}`, async t => {
    const dir = await root(); const store = new PixieGateStore(dir);
    const entered = deferred(); const release = deferred();
    const fail = scenario.startsWith('B:');
    interceptRename(t, join(dir, 'gates', 's.json'), async (from, to, rename) => {
      entered.resolve(); await release.promise;
      if (fail) throw Error('injected rename failure');
      await rename(from, to);
    });
    const abort = new AbortController();
    const frames = []; let consuming;
    const starting = store.start('s', gate, 'original').then(run => ({ run }), error => ({ error }));
    try {
      await entered.promise;
      const stream = store.follow('s', abort.signal);
      frames.push((await stream.next()).value);
      consuming = (async () => { for await (const frame of stream) frames.push(frame); })();
      // Drain subscriber microtasks while rename is explicitly blocked, without a timing race.
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual((await store.read('s')).runs, []);
      if (scenario.startsWith('A:')) assert.deepEqual(frames, [{ type: 'sync' }]);
      release.resolve();
      const outcome = await starting;
      await new Promise(resolve => setImmediate(resolve));
      if (fail) {
        assert.match(outcome.error.message, /injected rename failure/);
        assert.deepEqual(frames, [{ type: 'sync' }]);
        assert.deepEqual((await store.read('s')).runs, []);
      } else {
        assert.deepEqual(frames, [{ type: 'sync' }, { type: 'run', run: outcome.run }]);
        assert.equal((await store.read('s')).runs[0].status, 'running');
      }
    } finally {
      release.resolve(); await starting;
      abort.abort(); await consuming;
    }
  });
}

test('published start stays running while save cleanup is delayed', async t => {
  const dir = await root(); const store = new PixieGateStore(dir);
  const published = deferred(); const release = deferred();
  interceptRename(t, join(dir, 'gates', 's.json'), async (from, to, rename) => {
    await rename(from, to); published.resolve(); await release.promise;
  });
  const starting = store.start('s', gate, 'original');
  try {
    await published.promise;
    assert.equal((await store.read('s')).runs[0].status, 'running');
  } finally { release.resolve(); await starting; }
});

test('failed start rolls back live reservation and permits retry', async t => {
  const dir = await root(); const store = new PixieGateStore(dir); const path = join(dir, 'gates', 's.json');
  let failedRecord;
  interceptRename(t, path, async from => { failedRecord = await readFile(from, 'utf8'); throw Error('injected save failure'); });
  await assert.rejects(store.start('s', gate, 'original'), /injected save failure/);
  // A disk remnant must not be mistaken for a live run after a failed start.
  await writeFile(path, failedRecord);
  assert.equal((await store.read('s')).runs[0].status, 'cancelled');
  const abort = new AbortController(); const stream = store.follow('s', abort.signal);
  assert.equal((await stream.next()).value.type, 'sync');
  const next = stream.next(); abort.abort(); assert.equal((await next).done, true);
  assert.deepEqual(await store.prune(async () => []), ['s']);
  t.mock.restoreAll(); syncBuiltinESMExports();
  assert.equal((await store.start('s', gate, 'original')).status, 'running');
});

test('prune waits behind an in-flight save in the same session queue', async t => {
  const dir = await root(); const store = new PixieGateStore(dir);
  const run = await store.start('s', gate, 'original');
  const saving = deferred(); const release = deferred(); const listed = deferred();
  interceptRename(t, join(dir, 'gates', 's.json'), async (from, to, rename) => {
    saving.resolve(); await release.promise; await rename(from, to);
  });
  const readdir = fs.readdir;
  t.mock.method(fs, 'readdir', async path => { const names = await readdir(path); listed.resolve(); return names; });
  syncBuiltinESMExports();
  const finishing = store.finish('s', run.id, done); await saving.promise;
  let settled = false;
  const pruning = store.prune(async () => []).then(value => { settled = true; return value; });
  try {
    await listed.promise;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally { release.resolve(); await finishing; }
  assert.deepEqual(await pruning, ['s']);
  assert.deepEqual((await store.read('s')).runs, []);
  assert.deepEqual(await readdir(join(dir, 'gates')), []);
});
