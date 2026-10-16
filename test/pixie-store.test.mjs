/** Pixie history: per-session file, threads, turns, usage, and lifetime following the session. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PixieStore } from '../src/host/pixie-store.ts';
import { totalUsage } from '../src/pixie-contracts.ts';

const model = { provider: 'p', model: 'm' };
const dir = () => mkdtemp(join(tmpdir(), 'studio-pixie-'));

test('creating a thread makes it active and survives a restart', async () => {
  const root = await dir();
  const store = new PixieStore(root);
  const first = await store.createThread('s1', { mode: 'fresh', model });
  const second = await store.createThread('s1', { mode: 'fork', model, forked: [{ role: 'user', text: 'hi' }] });
  assert.equal((await store.read('s1')).activeThreadId, second.id);
  await store.activate('s1', first.id);
  const reopened = await new PixieStore(root).read('s1');
  assert.equal(reopened.activeThreadId, first.id);
  assert.deepEqual(reopened.threads.map(thread => thread.mode), ['fresh', 'fork']);
  assert.deepEqual(reopened.threads[1].forked, [{ role: 'user', text: 'hi' }]);
});

test('an unknown session reads as empty and is not written', async () => {
  const root = await dir();
  const store = new PixieStore(root);
  assert.deepEqual(await store.read('none'), { sessionId: 'none', threads: [] });
  assert.deepEqual(await readdir(root).catch(() => []), []);
});

test('turns record answers and usage; totals add across threads', async () => {
  const store = new PixieStore(await dir());
  const a = await store.createThread('s1', { mode: 'fresh', model });
  const turn = await store.startTurn('s1', a.id, 'q1');
  await store.finishTurn('s1', a.id, turn.id, { status: 'done', answer: 'a1', usage: { inputTokens: 10, outputTokens: 2, reasoningTokens: 1 } });
  const b = await store.createThread('s1', { mode: 'fresh', model });
  const other = await store.startTurn('s1', b.id, 'q2');
  await store.finishTurn('s1', b.id, other.id, { status: 'cancelled', answer: '', usage: { inputTokens: 5, outputTokens: 0 } });
  const record = await store.read('s1');
  assert.equal(record.threads[0].turns[0].answer, 'a1');
  assert.equal(record.threads[1].turns[0].status, 'cancelled');
  assert.deepEqual(totalUsage(record), { requests: 2, inputTokens: 15, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 1 });
});

test('a finished turn cannot be finished again', async () => {
  const store = new PixieStore(await dir());
  const thread = await store.createThread('s1', { mode: 'fresh', model });
  const turn = await store.startTurn('s1', thread.id, 'q');
  await store.finishTurn('s1', thread.id, turn.id, { status: 'cancelled', answer: 'partial' });
  await store.finishTurn('s1', thread.id, turn.id, { status: 'done', answer: 'late' });
  const saved = (await store.read('s1')).threads[0].turns[0];
  assert.equal(saved.status, 'cancelled');
  assert.equal(saved.answer, 'partial');
});

test('a turn interrupted by a restart reads as cancelled', async () => {
  const root = await dir();
  const store = new PixieStore(root);
  const thread = await store.createThread('s1', { mode: 'fresh', model });
  await store.startTurn('s1', thread.id, 'q');
  const turn = (await new PixieStore(root).read('s1')).threads[0].turns[0];
  assert.equal(turn.status, 'cancelled');
});

test('pruning keeps records of existing sessions (archived included) and deletes the rest', async () => {
  const root = await dir();
  const store = new PixieStore(root);
  await store.createThread('kept', { mode: 'fresh', model });
  await store.createThread('gone', { mode: 'fresh', model });
  const removed = await store.prune(async id => id === 'kept');
  assert.deepEqual(removed, ['gone']);
  assert.equal((await store.read('kept')).threads.length, 1);
  assert.deepEqual((await store.read('gone')).threads, []);
});

test('session ids cannot escape the store directory', async () => {
  const store = new PixieStore(await dir());
  await assert.rejects(store.createThread('../x', { mode: 'fresh', model }), /Invalid session id/);
});

test('settings default when missing, round-trip, and reject malformed values', async () => {
  const { PixieSettingsStore } = await import('../src/host/pixie-store.ts');
  const root = await dir();
  const store = new PixieSettingsStore(join(root, 'pixie-settings.json'));
  assert.equal((await store.read()).contextMode, 'fresh');
  assert.equal((await store.read()).model, undefined);
  const saved = await store.save({ model: { provider: 'p', model: 'm', reasoningEffort: 'high', maxTokens: 512 }, contextMode: 'fork', systemPrompt: 'S', allowThreadModel: false });
  assert.deepEqual(await new PixieSettingsStore(join(root, 'pixie-settings.json')).read(), saved);
  await assert.rejects(store.save({ contextMode: 'sideways', systemPrompt: '', allowThreadModel: true }), /contextMode/);
  await assert.rejects(store.save({ model: { provider: '', model: 'm' }, contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }), /provider/);
  await assert.rejects(store.save({ model: { provider: 'p', model: 'm', maxTokens: -1 }, contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }), /maxTokens/);
});

test('deleting a thread removes it and moves the active thread to the latest remaining one', async () => {
  const store = new PixieStore(await dir());
  const a = await store.createThread('s1', { mode: 'fresh', model });
  const b = await store.createThread('s1', { mode: 'fresh', model });
  await store.deleteThread('s1', b.id);
  let record = await store.read('s1');
  assert.deepEqual(record.threads.map(thread => thread.id), [a.id]);
  assert.equal(record.activeThreadId, a.id);
  await store.deleteThread('s1', a.id);
  record = await store.read('s1');
  assert.deepEqual(record.threads, []);
  assert.equal(record.activeThreadId, undefined);
  await assert.rejects(store.deleteThread('s1', 'nope'), /Unknown Pixie thread/);
});

test('turns record the command that started them', async () => {
  const store = new PixieStore(await dir());
  const thread = await store.createThread('s1', { mode: 'fresh', model });
  const turn = await store.startTurn('s1', thread.id, 'q', 'cmd-1');
  assert.equal((await store.read('s1')).threads[0].turns[0].commandId, 'cmd-1');
  assert.equal(turn.commandId, 'cmd-1');
});

test('judge engine settings accept llm/jev and a Jev model ID only', async () => {
  const { parsePixieSettings } = await import('../src/host/pixie-store.ts');
  const base = { contextMode: 'fresh', systemPrompt: '', allowThreadModel: true };
  assert.deepEqual(parsePixieSettings({ ...base, judgeEngine: 'jev', jevModel: 'jev-1.13.0' }), { ...base, judgeEngine: 'jev', jevModel: 'jev-1.13.0' });
  assert.throws(() => parsePixieSettings({ ...base, judgeEngine: 'box' }), /judgeEngine/);
  assert.throws(() => parsePixieSettings({ ...base, jevModel: 'jev latest' }), /jevModel/);
});
