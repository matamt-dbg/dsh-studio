/** Pixie requests: what reaches the model, what is streamed back, and what is recorded. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PixieStore } from '../src/host/pixie-store.ts';
import { PixieRuntime } from '../src/host/pixie-runtime.ts';

const model = { provider: 'p', model: 'm', maxTokens: 300 };
const settings = { model, contextMode: 'fresh', systemPrompt: 'BE PIXIE', allowThreadModel: true };

/** Fake llm.stream scripted per call; records every request. */
function fakeLlm(script) {
  const calls = [];
  return {
    calls,
    stream(options) {
      calls.push(options);
      return script(options, calls.length);
    },
  };
}
async function* chunks(...items) { for (const item of items) yield item; }
const text = value => ({ type: 'text-delta', index: 0, text: value });
const finish = { type: 'finish', reason: { kind: 'stop' } };

async function setup(llm, events = []) {
  const store = new PixieStore(await mkdtemp(join(tmpdir(), 'studio-pixie-rt-')));
  const runtime = new PixieRuntime({ store, llm, settings: async () => settings, sessionEvents: async () => events });
  return { store, runtime };
}
async function collect(iterable) { const out = []; for await (const frame of iterable) out.push(frame); return out; }

test('first ask creates the default thread, streams text, and records answer and usage', async () => {
  const llm = fakeLlm(() => chunks(text('Hel'), text('lo'), { type: 'usage', usage: { inputTokens: 7, outputTokens: 2, cacheReadTokens: 3 } }, finish));
  const { store, runtime } = await setup(llm);
  const frames = await collect(runtime.ask('s1', { question: 'hi' }, new AbortController().signal));
  assert.equal(frames[0].type, 'start');
  assert.deepEqual(frames.slice(1), [{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }, { type: 'usage', usage: { inputTokens: 7, outputTokens: 2, cacheReadTokens: 3 } }, { type: 'end', status: 'done' }]);
  assert.equal(llm.calls[0].system, 'BE PIXIE');
  assert.equal(llm.calls[0].provider, 'p');
  assert.equal(llm.calls[0].maxTokens, 300);
  assert.deepEqual(llm.calls[0].messages, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
  const turn = (await store.read('s1')).threads[0].turns[0];
  assert.equal(turn.answer, 'Hello');
  assert.equal(turn.status, 'done');
  assert.equal(turn.usage.inputTokens, 7);
});

test('a follow-up carries earlier completed turns of the active thread', async () => {
  const llm = fakeLlm((_o, n) => chunks(text(`a${n}`), finish));
  const { runtime } = await setup(llm);
  await collect(runtime.ask('s1', { question: 'q1' }, new AbortController().signal));
  await collect(runtime.ask('s1', { question: 'q2' }, new AbortController().signal));
  assert.deepEqual(llm.calls[1].messages.map(m => [m.role, m.content[0].text]), [['user', 'q1'], ['assistant', 'a1'], ['user', 'q2']]);
});

test('a fork thread starts from the session text snapshot', async () => {
  const events = [{ type: 'user/message', seq: 1, time: 1, surfaceOp: 'append', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'main question' }] } }];
  const llm = fakeLlm(() => chunks(text('ok'), finish));
  const { runtime, store } = await setup(llm, events);
  const thread = await runtime.createThread('s1', { mode: 'fork' });
  await collect(runtime.ask('s1', { question: 'explain', threadId: thread.id }, new AbortController().signal));
  assert.deepEqual(llm.calls[0].messages.map(m => m.content[0].text), ['main question', 'explain']);
  assert.equal((await store.read('s1')).threads[0].mode, 'fork');
});

test('cancel stops the stream, keeps the partial answer as cancelled, and late chunks are not recorded', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const llm = fakeLlm(async function* (options) {
    yield text('part');
    await gate;
    if (options.signal.aborted) throw options.signal.reason;
    yield text(' late');
    yield finish;
  });
  const { runtime, store } = await setup(llm);
  const controller = new AbortController();
  const frames = [];
  const running = (async () => { for await (const frame of runtime.ask('s1', { question: 'q' }, controller.signal)) { frames.push(frame); if (frame.type === 'text') controller.abort(); } })();
  await new Promise(resolve => setTimeout(resolve, 10));
  release();
  await running;
  assert.deepEqual(frames.at(-1), { type: 'end', status: 'cancelled' });
  const turn = (await store.read('s1')).threads[0].turns[0];
  assert.equal(turn.status, 'cancelled');
  assert.equal(turn.answer, 'part');
});

test('a provider error is recorded as an error, never as an answer', async () => {
  const llm = fakeLlm(async function* () { yield text('x'); throw new Error('rate limited'); });
  const { runtime, store } = await setup(llm);
  const frames = await collect(runtime.ask('s1', { question: 'q' }, new AbortController().signal));
  assert.deepEqual(frames.at(-1), { type: 'end', status: 'error', error: 'rate limited' });
  const turn = (await store.read('s1')).threads[0].turns[0];
  assert.equal(turn.status, 'error');
  assert.equal(turn.error, 'rate limited');
});

test('a stream that ends without finish is an error', async () => {
  const llm = fakeLlm(() => chunks(text('x')));
  const { runtime } = await setup(llm);
  const frames = await collect(runtime.ask('s1', { question: 'q' }, new AbortController().signal));
  assert.equal(frames.at(-1).status, 'error');
});

test('asking without a configured model fails before any model call', async () => {
  const llm = fakeLlm(() => chunks(finish));
  const store = new PixieStore(await mkdtemp(join(tmpdir(), 'studio-pixie-rt-')));
  const runtime = new PixieRuntime({ store, llm, settings: async () => ({ ...settings, model: undefined }), sessionEvents: async () => [] });
  await assert.rejects(collect(runtime.ask('s1', { question: 'q' }, new AbortController().signal)), /Pixie model/);
  assert.equal(llm.calls.length, 0);
});

test('a per-thread model is refused when settings disallow it', async () => {
  const llm = fakeLlm(() => chunks(finish));
  const store = new PixieStore(await mkdtemp(join(tmpdir(), 'studio-pixie-rt-')));
  const runtime = new PixieRuntime({ store, llm, settings: async () => ({ ...settings, allowThreadModel: false }), sessionEvents: async () => [] });
  await assert.rejects(runtime.createThread('s1', { model: { provider: 'x', model: 'y' } }), /per-thread/);
});

test('an error finish reports the provider failure message', async () => {
  const llm = fakeLlm(() => chunks(text('x'), { type: 'finish', reason: { kind: 'error', failure: { message: 'context too long', code: 'x' } } }));
  const { runtime } = await setup(llm);
  const frames = await collect(runtime.ask('s1', { question: 'q' }, new AbortController().signal));
  assert.deepEqual(frames.at(-1), { type: 'end', status: 'error', error: 'context too long' });
});

test('an answer cut at the token limit is kept but marked truncated', async () => {
  const llm = fakeLlm(() => chunks(text('partial'), { type: 'finish', reason: { kind: 'max-tokens' } }));
  const { runtime, store } = await setup(llm);
  const frames = await collect(runtime.ask('s1', { question: 'q' }, new AbortController().signal));
  assert.deepEqual(frames.at(-1), { type: 'end', status: 'done', truncated: true });
  const turn = (await store.read('s1')).threads[0].turns[0];
  assert.equal(turn.status, 'done');
  assert.equal(turn.truncated, true);
});

test('a per-thread model keeps the token limit, and the effort only on the same provider', async () => {
  const llm = fakeLlm(() => chunks(finish));
  const store = new PixieStore(await mkdtemp(join(tmpdir(), 'studio-pixie-rt-')));
  const configured = { ...settings, model: { provider: 'p', model: 'm', reasoningEffort: 'high', maxTokens: 900 } };
  const runtime = new PixieRuntime({ store, llm, settings: async () => configured, sessionEvents: async () => [] });
  const other = await runtime.createThread('s1', { model: { provider: 'q', model: 'n' } });
  assert.deepEqual(other.model, { provider: 'q', model: 'n', maxTokens: 900 });
  const sibling = await runtime.createThread('s1', { model: { provider: 'p', model: 'm2' } });
  assert.deepEqual(sibling.model, { provider: 'p', model: 'm2', reasoningEffort: 'high', maxTokens: 900 });
  const own = await runtime.createThread('s1', { model: { provider: 'p', model: 'm2', reasoningEffort: 'low', maxTokens: 10 } });
  assert.deepEqual(own.model, { provider: 'p', model: 'm2', reasoningEffort: 'low', maxTokens: 10 });
});

test('history sent to the model carries complete assistant messages (id and model source)', async () => {
  const llm = fakeLlm((_o, n) => chunks(text(`a${n}`), finish));
  const { runtime } = await setup(llm);
  await collect(runtime.ask('s1', { question: 'q1' }, new AbortController().signal));
  await collect(runtime.ask('s1', { question: 'q2' }, new AbortController().signal));
  const assistant = llm.calls[1].messages.find(message => message.role === 'assistant');
  assert.equal(typeof assistant.id, 'string');
  assert.deepEqual(assistant.source, { kind: 'model', provider: 'p', model: 'm' });
  // user inputs stay plain request inputs
  assert.equal(llm.calls[1].messages.at(-1).source, undefined);
});
