import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTask } from '../src/pixie-gate-task.ts';
import { gateTools } from '../src/host/pixie-gate-tools.ts';
import { gateTurn } from '../src/host/pixie-gate-turn.ts';
import { gateInput } from '../src/host/pixie-gate-input.ts';

const text = value => [{ type: 'text', text: value }];
const context = value => ({ id: value, role: 'user', source: { kind: 'user' }, content: text(value) });
function harness(when, output = { verdict: 'pass' }, options = {}) {
  const controller = new AbortController(), runs = [], events = [], steers = [], calls = [];
  const task = { ...makeTask('gate', when, 'Check'), enabled: true, presetIds: ['p'] };
  if (options.enabled === false) task.enabled = false;
  if (options.preset) task.presetIds = [options.preset];
  Object.assign(task.advanced, { confirmReplace: false, maxSteers: 2 }, options.advanced);
  const agent = { id: 'session', session: { header: {}, snapshotEvents: () => [{ type: 'turn/start', data: { turn: 7 } }], deriveMessages: () => [{ role: 'assistant', content: text('original') }] }, inbox: { nextStep: options.inbox ?? [] }, steer: m => steers.push(m) };
  const deps = { definitions: async () => [task], preset: () => 'p', isRoot: () => options.root ?? true,
    runner: async () => ({ run: async () => { calls.push(when); if (options.cancel === 'before') controller.abort(); return options.error ? { status: 'error', error: 'failure' } : { status: 'done', output, usage: { inputTokens: 2, outputTokens: 3 } }; } }),
    recorder: { start: async (_id, gate, original) => ({ id: 'run', when: gate.when, original }), finish: async (_id, _run, data) => { runs.push(structuredClone(data)); if (options.cancel === 'finish') controller.abort(); } },
    emit: (name, event) => events.push([name, structuredClone(event)]) };
  const tools = gateTools(deps), turn = gateTurn(deps);
  const exec = { agent, signal: controller.signal, name: 'lookup', callId: 'call-1', arguments: { query: 'original' } };
  const decision = options.decision ?? { kind: when === 'tool-before' ? 'allow' : 'accept' };
  const outcome = { content: text('original'), isError: false, ...options.outcome };
  const invoke = (n = 7) => when === 'turn-end' ? turn({ agent, turn: n, signal: controller.signal }) : when === 'user-message' ? gateInput(deps)({ agent, turn: n, signal: controller.signal }, async () => ({ kind: 'enter', messages: [context('original')] })) : when === 'tool-before' ? tools.before(exec, async () => decision) : tools.after(exec, outcome, async () => decision);
  return { invoke, runs, events, steers, calls, exec, decision };
}
for (const when of ['tool-before', 'tool-after', 'turn-end']) {
  for (const cancel of ['before', 'finish']) test(`${when} cancellation ${cancel}`, async () => {
    const h = harness(when, { verdict: 'stop', reason: 'correct', replace: 'replacement', append: 'addition' }, { cancel });
    const decision = await h.invoke();
    const run = projection(h, when === 'tool-before' ? '{"query":"original"}' : 'original', cancel === 'before' || when === 'turn-end' ? 'original' : 'none');
    assert.equal(run.applied, cancel === 'before' ? 'none' : when === 'tool-before' ? 'denied' : when === 'tool-after' ? 'blocked' : 'steered');
    assert.equal(run.status, cancel === 'before' ? 'cancelled' : 'done');
    assert.deepEqual(run.result.notes, ['replacement', 'addition']);
    if (cancel === 'before') assert.equal(run.reason, 'cancelled');
    if (when === 'turn-end') assert.equal(h.steers.length, cancel === 'before' ? 0 : 1);
    else assert.equal(decision.kind, cancel === 'before' ? h.decision.kind : when === 'tool-before' ? 'deny' : 'block');
  });
  for (const verdict of when === 'tool-after' ? ['stop'] : ['pass', 'stop']) test(`${when} ${verdict} settles unsupported output`, async () => {
    const h = harness(when, { verdict, reason: 'correct', replace: 'replacement', append: 'addition' });
    const decision = await h.invoke();
    const run = projection(h, when === 'tool-before' ? '{"query":"original"}' : 'original', verdict === 'stop' && when !== 'turn-end' ? 'none' : 'original');
    assert.deepEqual(run.result.notes, ['replacement', 'addition']);
    if (verdict === 'stop') {
      if (when === 'tool-before') assert.deepEqual(decision, { kind: 'deny', reason: 'correct' });
      if (when === 'tool-after') assert.deepEqual(decision, { kind: 'block', feedback: text('correct') });
      if (when === 'turn-end') assert.deepEqual(h.steers[0].content, text('correct'));
    }
    assert.equal(run.turn, 7); assert.deepEqual(run.output, { verdict, reason: 'correct', replace: 'replacement', append: 'addition' });
    assert.deepEqual(run.usage, { inputTokens: 2, outputTokens: 3 }); assert.equal(h.events.at(-1)[1].when, when);
    if (when !== 'turn-end') assert.deepEqual(run.tool, { name: 'lookup', callId: 'call-1' });
  });
  for (const onError of ['pass', 'block']) test(`${when} onError ${onError}`, async () => {
    const h = harness(when, undefined, { error: true, advanced: { onError } });
    const decision = await h.invoke(); assert.equal(h.runs[0].status, 'error');
    if (when === 'turn-end') assert.equal(h.steers.length, onError === 'block' ? 1 : 0);
    else assert.equal(decision.kind, onError === 'pass' ? h.decision.kind : when === 'tool-before' ? 'deny' : 'block');
  });
  for (const options of [{ advanced: { agents: 'child' } }, { advanced: { agents: 'root' }, root: false }, { preset: 'outside' }, { enabled: false }]) test(`${when} filter ${JSON.stringify(options)}`, async () => {
    const h = harness(when, undefined, options); await h.invoke(); assert.equal(h.calls.length, 0); assert.equal(h.runs.length, 0);
  });
  test(`${when} child gate runs for child`, async () => {
    const h = harness(when, undefined, { advanced: { agents: 'child' }, root: false }); await h.invoke(); assert.equal(h.calls.length, 1);
  });
}
for (const kind of ['deny', 'cancel', 'ask']) test(`tool-before preserves downstream ${kind}`, async () => {
  const decision = { kind, reason: 'other', questions: [] };
  const h = harness('tool-before', { verdict: 'pass', replace: 'unused', append: 'unused' }, { decision });
  assert.deepEqual(await h.invoke(), decision);
  assert.equal(h.calls.length, kind === 'ask' ? 1 : 0);
  if (kind === 'ask') assert.equal(h.runs.at(-1).hooksInput, 'observed');
});
test('tool-after preserves downstream block', async () => {
  const decision = { kind: 'block', feedback: text('other') };
  const h = harness('tool-after', undefined, { decision }); assert.deepEqual(await h.invoke(), decision); assert.equal(h.calls.length, 0);
});
for (const append of [false, true]) test(`tool-after replace and append=${append} preserve identity and contexts`, async () => {
  const existing = context('existing');
  const h = harness('tool-after', { verdict: 'pass', replace: 'replacement', ...(append ? { append: 'addition' } : {}) }, { decision: { kind: 'accept', additionalContexts: [existing] } });
  const decision = await h.invoke(); assert.deepEqual(decision.content, text('replacement')); assert.equal(h.exec.callId, 'call-1');
  assert.deepEqual(decision.additionalContexts[0], existing); assert.equal(decision.additionalContexts.length, append ? 2 : 1);
  const run = projection(h, 'replacement', append ? 'append' : 'replace');
  assert.equal(run.result.forward.text, 'replacement'); assert.deepEqual(run.result.notes, []);
  if (append) assert.deepEqual(decision.additionalContexts[1].content, text('addition'));
});
test('tool-after cancellation discards proposed replacement and append', async () => {
  const h = harness('tool-after', { verdict: 'pass', replace: 'replacement', append: 'addition' }, { cancel: 'before' });
  assert.deepEqual(await h.invoke(), { kind: 'accept' });
  const run = projection(h, 'original', 'original'); assert.equal(run.applied, 'none'); assert.equal(run.reason, 'cancelled'); assert.deepEqual(run.result.notes, ['replacement', 'addition']);
});
test('tool-after append keeps downstream content and does not duplicate base contexts', async () => {
  const existing = context('existing'), base = context('base');
  const h = harness('tool-after', { verdict: 'pass', append: 'addition' }, { decision: { kind: 'accept', content: text('downstream'), additionalContexts: [existing] }, outcome: { additionalContexts: [base] } });
  const decision = await h.invoke(); assert.deepEqual(decision.content, text('downstream')); assert.deepEqual(decision.additionalContexts[0], existing); assert.equal(decision.additionalContexts.length, 2);
  const run = projection(h, 'downstream', 'append'); assert.equal(run.hooksInput, 'observed'); assert.deepEqual(run.result.forward.contexts, ['addition']);
});
test('turn budget accumulates, resets next turn, and records actual forwarding', async () => {
  const h = harness('turn-end', { verdict: 'stop', replace: 'unused' });
  await h.invoke(); await h.invoke(); await h.invoke(); await h.invoke(8);
  assert.equal(h.steers.length, 3); assert.deepEqual(h.runs.map(r => r.steerCount), [1, 2, 2, 1]);
  assert.equal(h.runs[2].reason, 'maxSteersPerTurn reached'); assert.equal(h.runs[2].applied, 'none');
  assert.equal(h.runs[2].result.forward.kind, 'original');
});
test('turn observes existing steering without duplicate correction', async () => {
  const h = harness('turn-end', { verdict: 'stop', append: 'unused' }, { inbox: [context('existing')] });
  await h.invoke(); assert.equal(h.calls.length, 1); assert.equal(h.steers.length, 0);
  const run = projection(h, 'original', 'original'); assert.equal(run.applied, 'none'); assert.equal(run.reason, 'existing steering'); assert.equal(run.hooksInput, 'observed'); assert.equal(run.steerCount, 0);
});
test('input confirmation rejection records original and preserves suggestion as note', async () => {
  const h = harness('user-message', { verdict: 'pass', replace: 'replacement', append: 'addition' }, { advanced: { confirmReplace: true } });
  assert.equal((await h.invoke()).kind, 'reject'); const run = projection(h, 'original', 'none');
  assert.deepEqual(run.result.notes, ['replacement', 'addition']); assert.equal(run.rejection.suggestion, 'replacement');
});
test('input cancellation rolls back projection and preserves proposed output', async () => {
  const h = harness('user-message', { verdict: 'pass', replace: 'replacement', append: 'addition' }, { cancel: 'before' });
  assert.equal((await h.invoke()).messages[0].content[0].text, 'original');
  const run = projection(h, 'original', 'original'); assert.equal(run.applied, 'none'); assert.deepEqual(run.result.notes, ['replacement', 'addition']);
});
function projection(h, subject, kind) {
  const run = h.runs.at(-1), end = h.events.at(-1)[1];
  assert.equal(run.result.subject, subject);
  assert.equal(run.result.forward.kind, kind);
  assert.equal(end.finalText, subject);
  return run;
}
for (const value of [null, 'structured', { data: 1 }]) test(`value-bearing replacement becomes note: ${JSON.stringify(value)}`, async () => {
  const h = harness('tool-after', { verdict: 'pass', replace: 'replacement', note: 'memo' }, { outcome: { value } });
  assert.deepEqual(await h.invoke(), { kind: 'accept' });
  const run = projection(h, 'original', 'original');
  assert.equal(run.applied, 'none'); assert.equal(run.reason, 'value-bearing result');
  assert.deepEqual(run.result.notes, ['memo', 'replacement']);
});
