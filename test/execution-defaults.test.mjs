import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executionDefaultFields, validateExecutionDefault, validateExecutionDefaults, applyExecutionDefaults, batchLimitFields, validateBatchLimit } from '../src/execution-defaults.ts';
import { parsePreviewRequest } from '../src/prompt-composition.ts';
import { installPolicy } from '../src/host/preset-policy.ts';
import { Context } from '@deepseek-ai/cordis';
import { createScope } from '@deepseek-ai/dsh-scope';

const schema = { type: 'object', properties: { timeoutMs: { type: 'integer', minimum: 5, maximum: 100 }, timeout_ms: { type: 'number' }, wait: { type: 'boolean' } } };
test('discovery and default validation share conservative eligibility', () => {
  assert.deepEqual(executionDefaultFields(schema), ['timeoutMs', 'timeout_ms']);
  assert.deepEqual(executionDefaultFields({ ...schema, required: ['timeoutMs'] }), ['timeout_ms']);
  assert.deepEqual(executionDefaultFields({ ...schema, oneOf: [] }), []);
  for (const value of [0, -1, Infinity, NaN, 4, 101, 5.5]) assert.throws(() => validateExecutionDefault(schema, 'timeoutMs', value));
  validateExecutionDefault(schema, 'timeoutMs', 20);
  assert.throws(() => validateExecutionDefault(schema, 'wait', 20));
  assert.throws(() => validateExecutionDefaults({ defaults: { arbitrary: { wait: 20 } } }));
  assert.throws(() => validateExecutionDefaults({ defaults: { arbitrary: { timeoutMs: Infinity } } }));
});
test('only omitted fields receive defaults without mutating arguments', () => {
  const args = { timeoutMs: undefined, wait: true };
  assert.deepEqual(applyExecutionDefaults(args, { timeoutMs: 20, timeout_ms: 30 }), { ...args, timeout_ms: 30 });
  assert.deepEqual(args, { timeoutMs: undefined, wait: true });
  assert.deepEqual(applyExecutionDefaults({ timeoutMs: null }, { timeoutMs: 20 }), { timeoutMs: null });
  assert.equal(applyExecutionDefaults(null, { timeoutMs: 20 }), null);
});
test('batch override only tightens a discovered published bound', () => {
  const parameters = { type: 'object', properties: { calls: { type: 'array', minItems: 1, maxItems: 8 } } };
  assert.deepEqual(batchLimitFields('read_batch', parameters), ['calls']);
  assert.deepEqual(batchLimitFields('other', parameters), []);
  validateBatchLimit(parameters, { tool: 'read_batch', parameter: 'calls', maxItems: 4 });
  for (const maxItems of [0, 9, 1.5]) assert.throws(() => validateBatchLimit(parameters, { tool: 'read_batch', parameter: 'calls', maxItems }));
});
test('request codec retains execution configuration and rejects invalid defaults', () => {
  const request = { preset: 'minimal', providers: [], tools: ['arbitrary'], model: '', prompt: '', execution: { defaults: { arbitrary: { timeoutMs: 20 } } } };
  assert.deepEqual(parsePreviewRequest(request).execution, request.execution);
  assert.throws(() => parsePreviewRequest({ ...request, execution: { defaults: { arbitrary: { timeoutMs: -2 } } } }));
});
test('scoped adapter preserves definition callbacks, original receiver, and disposal', async () => {
  const ctx = new Context();
  const key = {};
  const child = createScope(ctx, key);
  const registrations = [];
  const releases = [];
  let observed;
  const original = { name: 'arbitrary', description: 'test', parameters: schema, output: {}, timeoutMs: 123,
    execute(args, exec) { assert.equal(this, original); observed = { args, exec }; return Promise.resolve(args); },
    presentCall() {}, presentResult() {}, finalizeContent() {}, projectContent() {}, isConcurrencySafe() { return false; } };
  ctx.provide('tools');
  ctx.provide('systemPrompt');
  ctx.set('tools', { get: () => original, schemas: () => [original],
    restrict: () => () => releases.push('restrict'), guard: () => () => releases.push('guard'),
    register: definition => { registrations.push(definition); return () => releases.push('tool'); } });
  ctx.set('systemPrompt', { section: () => () => releases.push('section') });
  try {
    const dispose = installPolicy(child.ctx, key, { tools: ['arbitrary'], toolOverrides: {}, sections: {}, prompt: '', execution: { defaults: { arbitrary: { timeoutMs: 20 } } } });
    const wrapped = registrations[0];
    for (const key of ['output', 'timeoutMs', 'presentCall', 'presentResult', 'finalizeContent', 'projectContent', 'isConcurrencySafe']) assert.equal(wrapped[key], original[key]);
    const exec = {};
    await wrapped.execute({}, exec);
    assert.deepEqual(observed, { args: { timeoutMs: 20 }, exec });
    await wrapped.execute({ timeoutMs: 50 }, exec);
    assert.equal(observed.args.timeoutMs, 50);
    assert.equal(original.parameters.properties.timeoutMs.default, undefined);
    dispose(); dispose();
    assert.deepEqual(releases, ['section', 'tool', 'guard', 'restrict']);
    original.name = 'read_batch';
    original.parameters = { type: 'object', properties: { calls: { type: 'array', minItems: 1, maxItems: 8 } } };
    const disposeBatch = installPolicy(child.ctx, key, { tools: ['read_batch'], toolOverrides: {}, sections: {}, prompt: '', execution: { defaults: {}, batch: { tool: 'read_batch', parameter: 'calls', maxItems: 2 } } });
    const batched = registrations[1];
    assert.equal(batched.parameters.properties.calls.maxItems, 2);
    assert.equal(original.parameters.properties.calls.maxItems, 8);
    assert.throws(() => batched.execute({ calls: [1, 2, 3] }, exec), /batch limit/);
    await batched.execute({ calls: [1, 2] }, exec);
    assert.deepEqual(observed.args.calls, [1, 2]);
    disposeBatch();
  } finally { await child.dispose(); }
});
