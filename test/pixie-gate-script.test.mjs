import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateTaskRunner } from '../src/host/pixie-gate-task-runner.ts';
import { makeTask } from '../src/pixie-gate-task.ts';

async function fixture(t, output = {}) {
  const data = await mkdtemp(join(tmpdir(), 'pixie-script-'));
  const directory = join(data, 'pixie-gate/commands'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'prepare.sh'), '#!/bin/bash\n'); await chmod(join(directory, 'prepare.sh'), 0o755);
  const calls = [], requests = [];
  const shell = { resolve(request) { requests.push(request); return request; }, async execute() { return { async result() { return { exitCode: 0, timedOut: false, stdout: { text: '\n{"ok":true}\n', truncated: false }, stderr: { text: '' }, ...output }; } }; } };
  const task = makeTask('gate', 'user-message', '{{hooks.prepare.text}} / {{hooks.prepare.data}}'); task.advanced.script = 'prepare.sh';
  const context = { sessionId: 'session', cwd: '/workspace', turn: 3, agent: 'root', sandboxPolicy: { mode: 'read-only', workspaceRoot: '/workspace', sessionId: 'session' } };
  const deps = { scriptDirectory: directory, shell, scriptSupported: true, model: { provider: 'p', model: 'm' }, llm: { async *stream(options) { calls.push(options); yield { type: 'text-delta', text: '{}' }; yield { type: 'finish', reason: { kind: 'stop' } }; } } };
  return { directory, data, task, context, calls, requests, deps, run: (signal = new AbortController().signal) => new GateTaskRunner(deps).run(task, 'target', signal, context) };
}
for (const [label, output, expected] of [
  ['skip', { exitCode: 10 }, 'done'], ['other exit', { exitCode: 3 }, 'error'],
  ['timeout', { timedOut: true }, 'error'], ['truncation', { stdout: { text: '', truncated: true } }, 'error'],
  ['byte limit', { stdout: { text: '한'.repeat(90000), truncated: false } }, 'error'],
]) test(`hook ${label} never calls model`, async t => {
  const h = await fixture(t, output); const result = await h.run();
  assert.equal(result.status, expected); assert.equal(h.calls.length, 0);
  if (label === 'skip') { assert.equal(result.skipped, true); assert.equal(result.output.note, 'skipped by hook'); }
});
for (const name of ['../outside.sh', '/tmp/outside.sh', 'a/b', 'a\\\\b', 'a..sh', 'escape.sh']) test(`script path rejects ${name}`, async t => {
  const h = await fixture(t); await writeFile(join(h.data, 'outside.sh'), '', { mode: 0o755 });
  await symlink(join(h.data, 'outside.sh'), join(h.directory, 'escape.sh'));
  h.task.advanced.script = name; assert.equal((await h.run()).status, 'error'); assert.equal(h.requests.length, 0);
});
for (const unsupported of [true, false]) for (const onError of ['pass', 'block']) test(`hook unavailable unsupported=${unsupported} onError=${onError}`, async t => {
  const { executeTask } = await import('../src/host/pixie-gate-task-executor.ts');
  const h = await fixture(t); h.task.advanced.onError = onError;
  if (unsupported) h.deps.scriptSupported = false; else delete h.context.sandboxPolicy;
  const result = await executeTask(h.task, 'original', new AbortController().signal, async () => new GateTaskRunner(h.deps), () => h.context);
  assert.equal(result.status, 'error'); assert.equal(result.plan.stop, onError === 'block'); assert.equal(h.requests.length, 0);
  assert.match(result.error, unsupported ? /hook-script-unsupported/ : /sandbox policy/);
});
for (const when of ['user-message', 'agent-message', 'tool-before', 'tool-after', 'turn-end']) test(`hook environment at ${when}`, async t => {
  const h = await fixture(t); h.task.when = when; h.context.agent = 'child';
  if (when.startsWith('tool-')) h.context.tool = { name: 'search', arguments: { query: 'hello' } };
  await h.run(); const env = h.requests[0].env; assert.equal(env.PIXIE_POINT, when); assert.equal(env.PIXIE_AGENT, 'child');
  assert.equal(env.PIXIE_TOOL_NAME, when.startsWith('tool-') ? 'search' : undefined);
  assert.equal(env.PIXIE_TOOL_ARGS, when.startsWith('tool-') ? '{"query":"hello"}' : undefined);
  assert.equal(env.PIXIE_URL, undefined); assert.equal(env.PIXIE_TOKEN, undefined);
});
test('hook deadline aborts shell with configured timeout and follows onError', async t => {
  const h = await fixture(t); h.task.advanced.timeoutMs = 10;
  h.deps.shell.execute = async spec => ({ result: () => new Promise(resolve => {
    const finish = () => resolve({ timedOut: true, exitCode: null, stdout: { text: '', truncated: false } });
    if (spec.signal.aborted) finish(); else spec.signal.addEventListener('abort', finish, { once: true });
  }) });
  const result = await h.run(); assert.equal(result.status, 'error'); assert.match(result.error, /timed out/); assert.equal(h.requests[0].timeoutMs, 10); assert.equal(h.calls.length, 0);
});
test('plain text stdout preserves spaces, removes boundary newlines and has no JSON data', async t => {
  const h = await fixture(t, { stdout: { text: '\n  hello  \r\n', truncated: false } });
  await h.run(); assert.match(h.calls[0].system, /Instruction:   hello   \/ $/);
});
test('shell execution failure becomes error without model', async t => {
  const h = await fixture(t); h.deps.shell.execute = async () => { throw Error('spawn failed'); };
  assert.match((await h.run()).error, /spawn failed/); assert.equal(h.calls.length, 0);
});

test('hook cancellation reaches shell and returns cancelled without model', async t => {
  const h = await fixture(t), controller = new AbortController();
  h.deps.shell.execute = async spec => { controller.abort('cancel'); assert.equal(spec.signal.aborted, true); return { result: async () => ({ exitCode: null, aborted: true, stdout: { text: '', truncated: false } }) }; };
  assert.equal((await h.run(controller.signal)).status, 'cancelled'); assert.equal(h.calls.length, 0);
});
test('script listing filters nonexecutable files, directories and escaping links; missing directory is not created', async t => {
  const { listGateScripts } = await import('../src/host/pixie-gate-script.ts');
  const h = await fixture(t); await writeFile(join(h.directory, 'plain.sh'), ''); await mkdir(join(h.directory, 'dir'));
  await symlink('/bin/bash', join(h.directory, 'escape.sh'));
  assert.deepEqual(await listGateScripts(h.directory, true), { directory: h.directory, supported: true, scripts: ['prepare.sh'] });
  const missing = join(h.data, 'missing'); assert.deepEqual(await listGateScripts(missing, false), { directory: missing, supported: false, scripts: [] });
  const { stat } = await import('node:fs/promises'); await assert.rejects(stat(missing), { code: 'ENOENT' });
});

for (const when of ['user-message', 'agent-message', 'tool-before', 'tool-after', 'turn-end']) test(`exit ten preserves original flow and applied none at ${when}`, async t => {
  const { gateInput } = await import('../src/host/pixie-gate-input.ts');
  const { gateTools } = await import('../src/host/pixie-gate-tools.ts');
  const { gateTurn } = await import('../src/host/pixie-gate-turn.ts');
  const { PixieGateStore } = await import('../src/host/pixie-gate-store.ts');
  const h = await fixture(t, { exitCode: 10 }); h.task.when = when; h.task.enabled = true; h.task.presetIds = ['p']; h.task.advanced.agents = 'any';
  const recorder = new PixieGateStore(join(h.data, 'runs')), steers = [];
  const agent = { id: 'session', session: { header: { cwd: '/workspace' }, snapshotEvents: () => [{ type: 'turn/start', data: { turn: 9 } }], deriveMessages: () => [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }, inbox: { nextStep: [] }, steer: m => steers.push(m) };
  const signal = new AbortController().signal;
  const deps = { definitions: async () => [h.task], preset: () => 'p', isRoot: () => true, emit() {}, recorder, runner: async () => new GateTaskRunner(h.deps), hookContext: (actual, turn, tool) => { assert.equal(actual, agent); return { ...h.context, turn, ...(tool ? { tool } : {}) }; } };
  if (when.endsWith('message')) {
    const decision = { kind: 'enter', messages: [{ role: 'user', source: { kind: when === 'user-message' ? 'user' : 'agent-message' }, content: [{ type: 'text', text: 'original' }] }] };
    assert.equal(await gateInput(deps)({ agent, turn: 9, signal }, async () => decision), decision);
    assert.equal(h.requests[0].stdin, 'original');
  } else if (when === 'turn-end') { await gateTurn(deps)({ agent, turn: 9, signal }); assert.deepEqual(steers, []); assert.equal(h.requests[0].stdin, 'answer'); }
  else {
    const exec = { agent, signal, name: 'search', arguments: { q: 'x' } }, tools = gateTools(deps);
    const decision = { kind: when === 'tool-before' ? 'allow' : 'accept' };
    const result = when === 'tool-before' ? await tools.before(exec, async () => decision) : await tools.after(exec, { content: [{ type: 'text', text: 'result' }], isError: false }, async () => decision);
    assert.equal(result, decision); assert.equal(h.requests[0].env.PIXIE_TOOL_NAME, 'search'); assert.equal(h.requests[0].env.PIXIE_TOOL_ARGS, '{"q":"x"}');
    assert.equal(h.requests[0].stdin, when === 'tool-before' ? '{"q":"x"}' : 'result');
  }
  assert.equal(h.requests[0].env.PIXIE_TURN, '9');
  assert.equal(h.calls.length, 0); const run = (await recorder.read('session')).runs[0];
  assert.equal(run.applied, 'none'); assert.equal(run.status, 'done'); assert.ok(run.result.notes.includes('skipped by hook'));
});

test('unknown instruction variables and dotted traversal filenames are rejected on save', async () => {
  const { validateGateTask } = await import('../src/pixie-gate-task-contracts.ts');
  const task = makeTask('gate', 'user-message', '{{hooks.other.text}}'); task.advanced.script = 'prepare.sh';
  assert.throws(() => validateGateTask(task), /variable/i);
  task.instruction = 'check'; task.advanced.script = 'a..sh';
  assert.throws(() => validateGateTask(task), /filename/i);
});

test('hook exit zero supplies stdin, bounded session shell policy, text and JSON instruction variables', async t => {
  const h = await fixture(t); const result = await h.run();
  assert.equal(result.status, 'done'); assert.equal(h.requests[0].stdin, 'target');
  assert.equal(h.requests[0].workdir, '/workspace'); assert.deepEqual(h.requests[0].sandboxPolicy, h.context.sandboxPolicy);
  assert.equal(h.requests[0].stdoutMaxBytes, 256 * 1024); assert.equal(h.requests[0].onExpiry, 'kill');
  assert.match(h.calls[0].system, /Instruction: {"ok":true} \/ {"ok":true}/);
  assert.deepEqual(h.requests[0].env, { PIXIE_POINT: 'user-message', PIXIE_AGENT: 'root', PIXIE_SESSION_ID: 'session', PIXIE_TURN: '3', PIXIE_GATE_NAME: 'gate' });
});

/** Exit 11 (#27 S5): the script's stdout is the gate output, applied by the point rules without a Pixie call. */
const directCases = {
  'user-message': [{ verdict: 'stop', reason: 'missing fields' }, plan => { assert.equal(plan.stop, true); assert.equal(plan.reason, 'missing fields'); }],
  'agent-message': [{ replace: 'normalized' }, plan => { assert.equal(plan.stop, false); assert.equal(plan.replacement, 'normalized'); }],
  'tool-before': [{ verdict: 'stop', reason: 'outside scope', append: 'ignored' }, plan => { assert.equal(plan.stop, true); assert.deepEqual(plan.notes, ['ignored']); }],
  'tool-after': [{ append: 'summary' }, plan => { assert.equal(plan.addition, 'summary'); }],
  'turn-end': [{ note: '번역: 안녕하세요', replace: 'not applied' }, plan => { assert.equal(plan.stop, false); assert.deepEqual(plan.notes, ['번역: 안녕하세요', 'not applied']); }],
};
for (const [when, [output, check]] of Object.entries(directCases)) test(`hook exit 11 concludes at ${when} without the model`, async t => {
  const { executeTask } = await import('../src/host/pixie-gate-task-executor.ts');
  const h = await fixture(t, { exitCode: 11, stdout: { text: `${JSON.stringify(output)}\n`, truncated: false } });
  h.task.when = when; if (when.startsWith('tool-')) h.context.tool = { name: 'bash', arguments: {} };
  const result = await executeTask(h.task, 'original', new AbortController().signal, async () => new GateTaskRunner(h.deps), () => h.context);
  assert.equal(result.status, 'done'); assert.equal(h.calls.length, 0);
  assert.equal(result.result.concludedBy, 'script');
  assert.deepEqual(result.output, { verdict: 'pass', ...output });
  check(result.plan);
});
for (const [label, text] of [['non-JSON', 'stop'], ['an unknown field', '{"verdict":"stop","score":1}'], ['a bad verdict', '{"verdict":"maybe"}']]) {
  test(`hook exit 11 with ${label} is an error that follows onError`, async t => {
    const { executeTask } = await import('../src/host/pixie-gate-task-executor.ts');
    const h = await fixture(t, { exitCode: 11, stdout: { text, truncated: false } }); h.task.advanced.onError = 'block';
    const result = await executeTask(h.task, 'original', new AbortController().signal, async () => new GateTaskRunner(h.deps), () => h.context);
    assert.equal(result.status, 'error'); assert.match(result.error, /exit 11 needs a gate output JSON/); assert.equal(result.plan.stop, true); assert.equal(h.calls.length, 0);
  });
}
test('a script gate may omit the task; exit 0 then fails instead of calling Pixie', async t => {
  const { taskProblem } = await import('../src/pixie-gate-task.ts');
  const h = await fixture(t); h.task.instruction = '';
  assert.equal(taskProblem(h.task), undefined);
  const result = await h.run();
  assert.equal(result.status, 'error'); assert.match(result.error, /no instruction/); assert.equal(h.calls.length, 0);
  delete h.task.advanced.script; assert.equal(taskProblem(h.task), 'instruction');
});
test('exit 0 and 10 record who concluded', async t => {
  const pixie = await fixture(t); assert.equal((await pixie.run()).concludedBy, 'pixie'); assert.equal(pixie.calls.length, 1);
  const skipped = await fixture(t, { exitCode: 10 }); assert.equal((await skipped.run()).concludedBy, 'skipped');
});
