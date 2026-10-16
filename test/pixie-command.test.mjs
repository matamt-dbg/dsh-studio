/** /pixie: a command that asks Pixie, leaves only a status line, and never writes a message event. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PixieStore } from '../src/host/pixie-store.ts';
import { PixieRuntime } from '../src/host/pixie-runtime.ts';
import { PixieLive } from '../src/host/pixie-live.ts';
import { pixieCommand } from '../src/host/pixie-command.ts';

const model = { provider: 'p', model: 'm' };
async function* answer() { yield { type: 'text-delta', index: 0, text: 'pong' }; yield { type: 'finish', reason: { kind: 'stop' } }; }

async function setup(settings = { model, contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }) {
  const store = new PixieStore(await mkdtemp(join(tmpdir(), 'studio-pixie-cmd-')));
  const runtime = new PixieRuntime({ store, llm: { stream: answer }, settings: async () => settings, sessionEvents: async () => [] });
  const live = new PixieLive(runtime);
  return { store, live, command: pixieCommand(live) };
}
const invoke = (command, rawInput, sessionId = 's1') => command.handler({ commandId: 'c1', agent: { id: sessionId }, rawInput, attachments: [], signal: new AbortController().signal });

test('declares an input hint and records the question line', async () => {
  const { command } = await setup();
  assert.equal(command.name, 'pixie');
  assert.ok(command.input.hint.length > 0);
  assert.notEqual(command.recordInput, false);
});

test('asks in the active thread and returns a status line, not the answer', async () => {
  const { command, store, live } = await setup();
  const result = await invoke(command, ' ping');
  assert.equal(result.kind, 'success');
  assert.match(result.text, /Pixie/);
  assert.match(result.text, /Thread 1/);
  assert.doesNotMatch(result.text, /pong/);
  await live.idle('s1');
  const turn = (await store.read('s1')).threads[0].turns[0];
  assert.equal(turn.question, 'ping');
  assert.equal(turn.answer, 'pong');
});

test('an empty question is an error and starts nothing', async () => {
  const { command, store } = await setup();
  const result = await invoke(command, '   ');
  assert.equal(result.kind, 'error');
  assert.deepEqual((await store.read('s1')).threads, []);
});

test('a missing Pixie model is reported as an error', async () => {
  const { command } = await setup({ contextMode: 'fresh', systemPrompt: '', allowThreadModel: true });
  const result = await invoke(command, ' ping');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /model/);
});

test('live subscribers see the frames of a command-started ask', async () => {
  const { command, live } = await setup();
  const seen = [];
  const stop = live.subscribe('s1', frame => seen.push(frame));
  await invoke(command, ' ping');
  await live.idle('s1');
  stop();
  assert.deepEqual(seen.map(frame => frame.type), ['start', 'text', 'end']);
});

test('cancel (회수) ends a running request as cancelled and frees the session', async () => {
  const store = new PixieStore(await mkdtemp(join(tmpdir(), 'studio-pixie-cmd-')));
  const llm = { stream: async function* (options) {
    yield { type: 'text-delta', index: 0, text: 'part' };
    await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
  } };
  const live = new PixieLive(new PixieRuntime({ store, llm, settings: async () => ({ model, contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }), sessionEvents: async () => [] }));
  await live.start('s1', { question: 'q' });
  await assert.rejects(live.start('s1', { question: 'again' }), /already running/);
  assert.equal(live.cancel('s1'), true);
  await live.idle('s1');
  assert.equal(live.cancel('s1'), false);
  const turn = (await store.read('s1')).threads[0].turns[0];
  assert.equal(turn.status, 'cancelled');
  assert.equal(turn.answer, 'part');
});

test('a /pixie answer is findable by its command id for the conversation row', async () => {
  const { command, live, store } = await setup();
  await invoke(command, ' ping');
  await live.idle('s1');
  const turn = (await store.read('s1')).threads[0].turns[0];
  assert.equal(turn.commandId, 'c1');
  assert.equal(turn.answer, 'pong');
});

test('a thread with a running request cannot be deleted', async () => {
  const store = new PixieStore(await mkdtemp(join(tmpdir(), 'studio-pixie-cmd-')));
  const llm = { stream: async function* (options) {
    yield { type: 'text-delta', index: 0, text: 'x' };
    await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
  } };
  const live = new PixieLive(new PixieRuntime({ store, llm, settings: async () => ({ model, contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }), sessionEvents: async () => [] }));
  const { threadId } = await live.start('s1', { question: 'q' });
  await assert.rejects(live.deleteThread('s1', threadId), /pixie\/busy/);
  live.cancel('s1'); await live.idle('s1');
  await live.deleteThread('s1', threadId);
  assert.deepEqual((await store.read('s1')).threads, []);
});
