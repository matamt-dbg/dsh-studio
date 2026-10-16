import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTask, GATE_WHENS, taskProblem } from '../src/pixie-gate-task.ts';
import { validateGateTask, validateGateTasks, parseGateOutput, gateOutputPlan } from '../src/pixie-gate-task-contracts.ts';
import { GateTaskRunner } from '../src/host/pixie-gate-task-runner.ts';
const task = () => ({ ...makeTask('gate', 'user-message', 'Check target'), enabled: true, presetIds: ['p'] });
const model = { provider: 'test', model: 'ordinary' };
const signal = () => new AbortController().signal;
function llm(outputs, calls = []) {
  return { async *stream(options) {
    calls.push(options);
    yield { type: 'text-delta', text: outputs[calls.length - 1] };
    yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
}
test('task validation matches draft problems and isolates detached data', () => {
  const value = task();
  const copy = validateGateTask(value); copy.presetIds.push('other');
  assert.deepEqual(value.presetIds, ['p']);
  for (const change of [t => t.name = '', t => t.instruction = '', t => t.advanced.timeoutMs = 0, t => t.advanced.maxSteers = -1]) {
    const invalid = task(); change(invalid); assert.ok(taskProblem(invalid)); assert.throws(() => validateGateTask(invalid));
  }
  for (const script of ['../test.sh', '/tmp/test.sh', '', 'a/b', 'a\\b']) assert.throws(() => validateGateTask({ ...value, advanced: { ...value.advanced, script } }));
  assert.throws(() => validateGateTask({ definition: value, presetIds: [] }));
  assert.throws(() => validateGateTask({ ...value, advanced: { ...value.advanced, timeoutMs: Infinity } }));
});
test('bindings use when, not the combined input runtime point', () => {
  const a = task(), b = { ...task(), when: 'agent-message' };
  assert.equal(validateGateTasks([a, b]).length, 2);
  assert.throws(() => validateGateTasks([a, { ...b, when: a.when }]));
  assert.throws(() => validateGateTasks([a, { ...b, id: a.id }]));
  assert.equal(validateGateTasks([a, { ...b, when: a.when, enabled: false }]).length, 2);
});
test('per-preset switch: off on one preset never affects another, and only that preset frees its binding', async () => {
  const { taskMatches } = await import('../src/host/pixie-gate-task-executor.ts');
  const shared = { ...task(), presetIds: ['p', 'q'], disabledPresetIds: ['p'] };
  assert.equal(taskMatches(shared, 'p', true), false);
  assert.equal(taskMatches(shared, 'q', true), true);
  assert.equal(taskMatches({ ...shared, enabled: false }, 'q', true), false);
  const other = { ...task(), id: 'other', presetIds: ['p'] };
  assert.equal(validateGateTasks([shared, other]).length, 2);
  assert.throws(() => validateGateTasks([{ ...shared, disabledPresetIds: [] }, other]), /Only one enabled gate/);
  assert.deepEqual(validateGateTask({ ...shared, disabledPresetIds: ['p', 'p', 'gone'] }).disabledPresetIds, ['p']);
  assert.equal('disabledPresetIds' in validateGateTask({ ...shared, disabledPresetIds: ['gone'] }), false);
  assert.throws(() => validateGateTask({ ...shared, disabledPresetIds: 'p' }), /disabledPresetIds/);
});
test('output JSON defaults omitted verdict and rejects invalid explicit verdicts', () => {
  assert.deepEqual(parseGateOutput('{}'), { verdict: 'pass' });
  assert.deepEqual(parseGateOutput('{"append":"a"}'), { verdict: 'pass', append: 'a' });
  for (const text of ['{"verdict":null}', '{"verdict":1}', '{"verdict":true}', '{"verdict":{}}', 'null', '[]', '```json\n{"verdict":"pass"}\n```', '{"verdict":"fail"}', '{"verdict":"pass","append":1}', '{"verdict":"pass","extra":"x"}', '{']) assert.throws(() => parseGateOutput(text));
  assert.deepEqual(parseGateOutput('{"verdict":"pass","replace":"","note":"n"}'), { verdict: 'pass', replace: '', note: 'n' });
});
for (const when of GATE_WHENS) for (const field of ['stop', 'replace', 'append', 'note']) test(`output plan ${when} / ${field}`, () => {
  const value = { ...task(), when };
  const output = field === 'stop' ? { verdict: 'stop', replace: 'r', append: 'a' } : { verdict: 'pass', [field]: 'text' };
  const plan = gateOutputPlan(value, output, 'original');
  const mutable = ['user-message', 'agent-message', 'tool-after'].includes(when);
  if (field === 'stop') {
    const message = ['user-message', 'agent-message'].includes(when);
    assert.deepEqual(plan, message ? { stop: true, notes: ['a'], suggestion: 'r' } : { stop: true, notes: ['r', 'a'] });
  }
  else if (field === 'note' || !mutable) assert.ok(plan.notes.includes('text'));
  else assert.equal(plan[field === 'replace' ? 'replacement' : 'addition'], 'text');
});
test('confirmation only blocks a real message change', () => {
  for (const when of ['user-message', 'agent-message']) {
    const value = { ...task(), when }; value.advanced.confirmReplace = true;
    assert.deepEqual(gateOutputPlan(value, { verdict: 'pass', replace: 'original', append: 'a' }, 'original'), { stop: false, notes: [], addition: 'a' });
    assert.deepEqual(gateOutputPlan(value, { verdict: 'pass', replace: 'changed', append: 'a' }, 'original'), { stop: true, notes: ['a'], suggestion: 'changed' });
  }
});
test('confirmation blocks both replacement and addition and retains suggestion', () => {
  const value = task(); value.advanced.confirmReplace = true;
  assert.deepEqual(gateOutputPlan(value, { verdict: 'pass', replace: 'r', append: 'a' }, 'original'), { stop: true, notes: ['a'], suggestion: 'r' });
});
test('ordinary executor accepts omitted verdict and advertises its default', async () => {
  const calls = [];
  const result = await new GateTaskRunner({ model, llm: llm(['{}'], calls) }).run(task(), 'target', signal());
  assert.deepEqual(result.output, { verdict: 'pass' });
  assert.match(calls[0].system, /optional verdict.*omitted.*pass/);
});
test('ordinary executor makes exactly one call and retains usage on invalid output', async () => {
  const calls = [];
  const runner = new GateTaskRunner({ model, llm: llm(['{"verdict":"pass","replace":"r"}'], calls) });
  const result = await runner.run(task(), 'target', signal());
  assert.equal(result.status, 'done'); assert.equal(calls.length, 1); assert.equal(result.output.replace, 'r');
  assert.match(calls[0].system, /Check target/); assert.equal(calls[0].messages[0].content[0].text, 'target');
  const invalid = await new GateTaskRunner({ model, llm: llm(['not json']) }).run(task(), '', signal());
  assert.equal(invalid.status, 'error'); assert.equal(invalid.output, undefined); assert.deepEqual(invalid.usage, { inputTokens: 2, outputTokens: 3 });
});
test('script is unsupported without a model call; cancellation wins', async () => {
  const value = task(); value.advanced.script = 'script.sh'; const calls = [];
  const runner = new GateTaskRunner({ model, llm: llm([], calls) });
  assert.match((await runner.run(value, '', signal())).error, /hook-script-unsupported/); assert.equal(calls.length, 0);
  const controller = new AbortController(); controller.abort();
  assert.equal((await runner.run(value, '', controller.signal)).status, 'cancelled');
});
test('cancellation during a model call returns no output', async () => {
  const controller = new AbortController();
  const runner = new GateTaskRunner({ model, llm: { async *stream() {
    yield { type: 'text-delta', text: '{"verdict":"pass"}' };
    controller.abort(new Error('cancelled by caller'));
    yield { type: 'finish', reason: { kind: 'stop' } };
  } } });
  const result = await runner.run(task(), '', controller.signal);
  assert.equal(result.status, 'cancelled'); assert.equal(result.output, undefined);
});
test('timeout aborts a stalled stream', async () => {
  const value = task(); value.advanced.timeoutMs = 10;
  const runner = new GateTaskRunner({ model, llm: { async *stream() { await new Promise(() => {}); } } });
  const result = await runner.run(value, '', signal());
  assert.equal(result.status, 'error'); assert.match(result.error, /timed out/);
});

test('the removed judge option is dropped on validation and never adds a model call', async () => {
  const stored = { ...task(), advanced: { ...task().advanced, judge: { question: 'Good?', threshold: 0.9 } } };
  const valid = validateGateTask(stored);
  assert.equal('judge' in valid.advanced, false); assert.equal('judge' in stored.advanced, true);
  const calls = [];
  const result = await new GateTaskRunner({ model, llm: llm(['{"verdict":"pass","note":"n"}'], calls) }).run(stored, 'target', signal());
  assert.equal(calls.length, 1); assert.deepEqual(result.output, { verdict: 'pass', note: 'n' });
});
