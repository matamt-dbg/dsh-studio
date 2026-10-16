import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTask } from '../src/pixie-gate-task.ts';
import { trialGate } from '../src/host/pixie-gate-trial.ts';
const task = () => makeTask('Trial', 'tool-after', 'Check');
test('trial returns output plan and usage without applying', async () => {
 const output = { verdict: 'pass', replace: 'replacement', append: 'addition', note: 'note' }, usage = { inputTokens: 2, outputTokens: 3 }; let calls = 0;
 const result = await trialGate({ task: task(), text: 'sample', toolName: 'test' }, { runner: async () => ({ run: async (_task, text) => { calls++; assert.equal(text, 'sample'); return { status: 'done', output, usage }; } }) }, new AbortController().signal);
 assert.equal(calls, 1); assert.deepEqual(result, { output, plan: { stop: false, replacement: 'replacement', addition: 'addition', notes: ['note'] }, usage });
});
test('trial skips scripts before constructing runner', async () => {
 const value = task(); value.advanced.script = 'test.sh';
 const result = await trialGate({ task: value, text: '' }, { runner: async () => { throw new Error('must not call'); } }, new AbortController().signal);
 assert.equal(result.skipped, 'script'); assert.equal(result.output.note, 'skipped: script');
});
test('trial validates task and toolName and surfaces execution errors', async () => {
 const deps = { runner: async () => ({ run: async () => ({ status: 'error', error: 'bad output', usage: {} }) }) };
 await assert.rejects(trialGate({ task: {}, text: '' }, deps, new AbortController().signal));
 await assert.rejects(trialGate({ task: task(), text: '', toolName: 5 }, deps, new AbortController().signal));
 await assert.rejects(trialGate({ task: task(), text: '' }, deps, new AbortController().signal), /bad output/);
});
