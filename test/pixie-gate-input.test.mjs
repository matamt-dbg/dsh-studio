import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTask } from '../src/pixie-gate-task.ts';
import { gateInput } from '../src/host/pixie-gate-input.ts';
import { gateTools } from '../src/host/pixie-gate-tools.ts';
import { gateTurn } from '../src/host/pixie-gate-turn.ts';
import { PixieGateStore } from '../src/host/pixie-gate-store.ts';
const task = (when, advanced = {}) => ({ ...makeTask(when, when, 'Check'), id: when, enabled: true, presetIds: ['p'], advanced: { confirmReplace: false, onError: 'pass', agents: 'any', timeoutMs: 1000, maxSteers: 2, ...advanced } });
const message = (kind, text = kind) => ({ id: kind, role: 'user', source: { kind }, content: [{ type: 'text', text }] });
async function fixture(tasks, output = { verdict: 'pass' }) {
  const recorder = new PixieGateStore(await mkdtemp(join(tmpdir(), 'task-runtime-')));
  const controller = new AbortController(), calls = [], events = [], steers = [];
  const agent = { id: 's', ctx: {}, session: { header: {}, snapshotEvents: () => [], deriveMessages: () => [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }, inbox: { nextStep: [] }, steer: m => steers.push(m) };
  const deps = { definitions: async () => tasks, preset: () => 'p', isRoot: () => true, recorder, emit: (name, run) => events.push([name, run]), runner: async () => ({ run: async (task, text) => { calls.push([task.when, text]); return typeof output === 'function' ? output(controller) : { status: 'done', output, usage: { inputTokens: 2, outputTokens: 3 } }; } }) };
  const payload = { agent, turn: 1, signal: controller.signal };
  return { deps, payload, controller, calls, events, steers, runs: async () => (await recorder.read('s')).runs };
}
for (const when of ['user-message', 'agent-message', 'tool-before', 'tool-after', 'turn-end']) test(`task middleware ${when} records output and usage`, async () => {
  const h = await fixture([task(when)]);
  if (when.endsWith('message')) await gateInput(h.deps)(h.payload, async () => ({ kind: 'enter', messages: [message(when === 'user-message' ? 'user' : 'agent-message')] }));
  else if (when === 'turn-end') await gateTurn(h.deps)(h.payload);
  else {
    const tools = gateTools(h.deps), exec = { agent: h.payload.agent, signal: h.controller.signal, name: 'test', callId: 'c', arguments: {} };
    if (when === 'tool-before') await tools.before(exec, async () => ({ kind: 'allow' }));
    else await tools.after(exec, { content: [{ type: 'text', text: 'result' }], isError: false }, async () => ({ kind: 'accept' }));
  }
  assert.equal(h.calls.length, 1); const [run] = await h.runs();
  assert.equal(run.when, when); assert.deepEqual(run.output, { verdict: 'pass' }); assert.deepEqual(run.usage, { inputTokens: 2, outputTokens: 3 });
  assert.deepEqual(run.result.stages, {}); assert.equal(run.status, 'done');
});
test('message gates coexist and exclude protected sources', async () => {
  const h = await fixture([task('user-message'), task('agent-message')], { verdict: 'pass', replace: 'new', append: 'context' });
  const result = await gateInput(h.deps)(h.payload, async () => ({ kind: 'enter', messages: ['user', 'agent-message', 'runtime-context', 'studio-pixie-gate'].map(k => message(k)) }));
  assert.deepEqual(h.calls.map(c => c[0]), ['user-message', 'agent-message']); assert.equal(result.messages[0].content[0].text, 'new'); assert.equal(result.messages[1].content[0].text, 'new'); assert.equal(result.messages.length, 6);
});
for (const agents of ['root', 'child', 'any']) test(`agents ${agents} filter`, async () => {
  const h = await fixture([task('user-message', { agents })]);
  await gateInput(h.deps)(h.payload, async () => ({ kind: 'enter', messages: [message('user')] }));
  assert.equal(h.calls.length, agents === 'child' ? 0 : 1);
});
for (const onError of ['pass', 'block']) test(`execution errors obey ${onError}`, async () => {
  const h = await fixture([task('user-message', { onError })], () => ({ status: 'error', error: '스크립트 미지원', usage: { inputTokens: 0, outputTokens: 0 } }));
  const result = await gateInput(h.deps)(h.payload, async () => ({ kind: 'enter', messages: [message('user')] }));
  assert.equal(result.kind, onError === 'block' ? 'reject' : 'enter'); assert.equal((await h.runs())[0].status, 'error');
});
test('confirmReplace yields pending rejection with suggestion', async () => {
  const h = await fixture([task('user-message', { confirmReplace: true })], { verdict: 'pass', replace: 'proposal' });
  assert.equal((await gateInput(h.deps)(h.payload, async () => ({ kind: 'enter', messages: [message('user')] }))).kind, 'reject');
  assert.deepEqual((await h.runs())[0].rejection, { original: 'user', reason: 'Revision requires confirmation', suggestion: 'proposal', status: 'pending' });
});
test('next decisions take precedence and prevent gate calls', async () => {
  const h = await fixture([task('user-message'), task('tool-before'), task('tool-after')]);
  const reject = { kind: 'reject' }, deny = { kind: 'deny', reason: 'other' }, block = { kind: 'block', feedback: [] };
  assert.equal(await gateInput(h.deps)(h.payload, async () => reject), reject);
  const tools = gateTools(h.deps), exec = { agent: h.payload.agent, signal: h.controller.signal };
  assert.equal(await tools.before(exec, async () => deny), deny); assert.equal(await tools.after(exec, {}, async () => block), block); assert.equal(h.calls.length, 0);
});
test('turn budget accumulates and resets only on a new turn', async () => {
  const h = await fixture([task('turn-end')], { verdict: 'stop', reason: 'correct' }); const run = gateTurn(h.deps);
  await run(h.payload); await run(h.payload); await run(h.payload); assert.equal(h.steers.length, 2);
  await run({ ...h.payload, turn: 2 }); assert.equal(h.steers.length, 3);
});
test('cancellation before commit applies no rewrite', async () => {
  const h = await fixture([task('user-message')], controller => { controller.abort(); return { status: 'done', output: { verdict: 'pass', replace: 'new' }, usage: { inputTokens: 0, outputTokens: 0 } }; });
  const decision = { kind: 'enter', messages: [message('user')] };
  assert.equal(await gateInput(h.deps)(h.payload, async () => decision), decision); const [run] = await h.runs(); assert.equal(run.status, 'cancelled'); assert.equal(run.applied, 'none');
});

for (const when of ['tool-before', 'tool-after', 'turn-end']) for (const onError of ['pass', 'block']) test(`${when} error policy ${onError}`, async () => {
 const h = await fixture([task(when, { onError })], () => { throw new Error('execution failed'); });
 if (when === 'turn-end') { await gateTurn(h.deps)(h.payload); assert.equal(h.steers.length, onError === 'block' ? 1 : 0); }
 else {
  const tools = gateTools(h.deps), exec = { agent: h.payload.agent, signal: h.controller.signal, name: 'test', callId: 'c', arguments: {} };
  const result = when === 'tool-before' ? await tools.before(exec, async () => ({ kind: 'allow' })) : await tools.after(exec, { content: [], isError: false }, async () => ({ kind: 'accept' }));
  assert.equal(result.kind, onError === 'block' ? when === 'tool-before' ? 'deny' : 'block' : when === 'tool-before' ? 'allow' : 'accept');
 }
 assert.equal((await h.runs())[0].status, 'error');
});
test('tool-after applies replacement and addition while preserving contexts', async () => {
 const h = await fixture([task('tool-after')], { verdict: 'pass', replace: 'new', append: 'extra' });
 const old = message('hooks-claude-code'); const exec = { agent: h.payload.agent, signal: h.controller.signal, name: 'test', callId: 'c', arguments: {} };
 const result = await gateTools(h.deps).after(exec, { content: [], isError: false }, async () => ({ kind: 'accept', additionalContexts: [old] }));
 assert.deepEqual(result.content, [{ type: 'text', text: 'new' }]); assert.equal(result.additionalContexts[0], old); assert.equal(result.additionalContexts[1].content[0].text, 'extra');
});
test('cancellation during finish does not reopen committed input decision', async () => {
 const h = await fixture([task('user-message')], { verdict: 'pass', replace: 'new' }); const finish = h.deps.recorder.finish.bind(h.deps.recorder);
 h.deps.recorder.finish = async (...args) => { h.controller.abort(); return finish(...args); };
 const result = await gateInput(h.deps)(h.payload, async () => ({ kind: 'enter', messages: [message('user')] }));
 assert.equal(result.messages[0].content[0].text, 'new'); assert.equal((await h.runs())[0].applied, 'replaced');
});
test('disabled or unbound tasks never execute', async () => {
 for (const patch of [{ enabled: false }, { presetIds: ['other'] }]) {
  const h = await fixture([{ ...task('user-message'), ...patch }]);
  await gateInput(h.deps)(h.payload, async () => ({ kind: 'enter', messages: [message('user')] })); assert.equal(h.calls.length, 0);
 }
});
test('input runs record the checked message id so the chat can place the result under it', async () => {
  const h = await fixture([task('user-message', { showInChat: false })]);
  await gateInput(h.deps)(h.payload, async () => ({ kind: 'enter', messages: [message('user')] }));
  const [run] = await h.runs();
  assert.equal(run.messageId, 'user'); assert.equal(run.showInChat, false);
  assert.equal(h.events.find(([name]) => name === 'pixie-gate/end')[1].messageId, 'user');
});
