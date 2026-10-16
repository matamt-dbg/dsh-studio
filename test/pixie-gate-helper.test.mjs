/** R2-b2: `pixie ask/judge` helper over a real local HTTP route and real bash + curl. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HELPER_ROUTE, PixieGateHelper } from '../src/host/pixie-gate-helper.ts';
import { GateTaskRunner } from '../src/host/pixie-gate-task-runner.ts';
import { executeTask } from '../src/host/pixie-gate-task-executor.ts';
import { makeTask } from '../src/pixie-gate-task.ts';

async function server(t, handler) {
  const http = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === HELPER_ROUTE || path.startsWith(`${HELPER_ROUTE}/`)) return void handler(req, res);
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => http.close(resolve)));
  return `http://127.0.0.1:${http.address().port}${HELPER_ROUTE}`;
}
function bash(command, env, stdin = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', command], { env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}
async function helperFixture(t, limits) {
  const bin = await mkdtemp(join(tmpdir(), 'pixie-helper-'));
  let url;
  const helper = new PixieGateHelper({ binDirectory: bin, url: () => url, ...(limits ? { limits } : {}) });
  url = await server(t, helper.handle);
  const calls = [];
  const grant = { target: 'TARGET', signal: new AbortController().signal,
    ask: async (instruction, input) => { calls.push(['ask', instruction, input]); return `answer:${instruction}:${input}`; },
    judge: async (question, threshold, input) => { calls.push(['judge', question, threshold, input]); return { noul: 0.8, pass: 0.8 >= threshold }; } };
  return { helper, grant, calls, bin };
}

test('pixie ask answers with the gate target or helper stdin, preserving unicode and newlines', async t => {
  const h = await helperFixture(t); const session = await h.helper.issue(h.grant);
  assert.match(session.env.PIXIE_TOKEN, /^[0-9a-f]{64}$/); assert.ok(session.env.PATH.startsWith(`${h.bin}:`));
  let result = await bash('pixie ask "요약해 & 줘"', session.env);
  assert.deepEqual([result.code, result.stdout], [0, 'answer:요약해 & 줘:TARGET\n']);
  result = await bash('printf "line1\\nline2" | pixie ask "x" --input', session.env);
  assert.deepEqual([result.code, result.stdout], [0, 'answer:x:line1\nline2\n']);
  assert.deepEqual(h.calls[1], ['ask', 'x', 'line1\nline2']);
});
test('pixie judge prints the probability and exits 0 on pass, 1 below threshold', async t => {
  const h = await helperFixture(t); const session = await h.helper.issue(h.grant);
  let result = await bash('pixie judge --question "좋아?" --threshold 0.9', session.env);
  assert.deepEqual([result.code, result.stdout], [1, '0.8\n']);
  result = await bash('pixie judge --question "좋아?"', session.env);
  assert.deepEqual([result.code, result.stdout], [0, '0.8\n']);
  assert.deepEqual(h.calls[1], ['judge', '좋아?', 0.5, 'TARGET']);
  result = await bash('pixie judge --question q --threshold 2', session.env);
  assert.equal(result.code, 2); assert.match(result.stderr, /threshold/);
});
test('revoked, foreign, or missing tokens are rejected and never reach the model', async t => {
  const h = await helperFixture(t); const session = await h.helper.issue(h.grant);
  session.revoke();
  for (const env of [session.env, { ...session.env, PIXIE_TOKEN: 'f'.repeat(64) }]) {
    const result = await bash('pixie ask "x"', env); assert.equal(result.code, 2); assert.match(result.stderr, /401/);
  }
  const unavailable = await bash('pixie ask "x"', { PATH: session.env.PATH });
  assert.equal(unavailable.code, 2); assert.match(unavailable.stderr, /not available/);
  assert.equal(h.calls.length, 0);
});
test('call count and request size limits answer 429 and 413', async t => {
  const h = await helperFixture(t, { calls: 2, bodyBytes: 200 }); const session = await h.helper.issue(h.grant);
  assert.equal((await bash('pixie ask a && pixie ask b', session.env)).code, 0);
  const third = await bash('pixie ask c', session.env); assert.equal(third.code, 2); assert.match(third.stderr, /429/);
  const other = await h.helper.issue(h.grant);
  const big = await bash('pixie ask x --input', other.env, 'y'.repeat(500)); assert.equal(big.code, 2); assert.match(big.stderr, /413/);
  assert.equal(h.calls.length, 2);
});
test('only POST ask/judge with a token is served', async t => {
  const h = await helperFixture(t); const session = await h.helper.issue(h.grant);
  const auth = { authorization: `Bearer ${session.env.PIXIE_TOKEN}` };
  assert.equal((await fetch(`${session.env.PIXIE_URL}/ask`, { headers: auth })).status, 405);
  assert.equal((await fetch(`${session.env.PIXIE_URL}/other`, { method: 'POST', headers: auth, body: 'instruction=x' })).status, 404);
  assert.equal((await fetch(`${session.env.PIXIE_URL}/ask`, { method: 'POST', headers: auth, body: 'instruction=' })).status, 400);
  assert.equal(h.calls.length, 0);
});
test('a helper call aborts when the run signal aborts', async t => {
  const h = await helperFixture(t); const controller = new AbortController(); let seen;
  const session = await h.helper.issue({ ...h.grant, signal: controller.signal, ask: (_i, _input, signal) => new Promise((_, reject) => { seen = signal; signal.addEventListener('abort', () => reject(signal.reason)); setTimeout(() => controller.abort(new Error('run cancelled')), 20); }) });
  const result = await bash('pixie ask x', session.env);
  assert.equal(result.code, 2); assert.equal(seen.aborted, true);
});

async function runnerFixture(t, script) {
  const data = await mkdtemp(join(tmpdir(), 'pixie-helper-run-'));
  const directory = join(data, 'commands'); await mkdir(directory);
  await writeFile(join(directory, 'prepare.sh'), `#!/bin/bash\n${script}\n`, { mode: 0o755 });
  let url; const helper = new PixieGateHelper({ binDirectory: join(data, 'bin'), url: () => url }); url = await server(t, helper.handle);
  const requests = [], calls = [];
  // Unsandboxed local bash stands in for ctx.shell; the sandboxed executor is not exercised here.
  const shell = { resolve(request) { requests.push(request); return request; }, async execute(spec) {
    return { async result() {
      const out = await bash(spec.command, spec.env, spec.stdin);
      return { exitCode: out.code, timedOut: false, aborted: false, stdout: { text: out.stdout, truncated: false }, stderr: { text: out.stderr } };
    } };
  } };
  const llm = { async *stream(options) {
    calls.push(options);
    const helperCall = /hook script helper/.test(options.system);
    const judge = /noul/.test(options.system) && !/gate instruction/.test(options.system);
    yield { type: 'text-delta', text: judge ? '{"answers":{"helper":{"noul":0.9}}}' : helperCall ? 'SUM' : '{}' };
    yield { type: 'usage', usage: helperCall || judge ? { inputTokens: 1, outputTokens: 1 } : { inputTokens: 2, outputTokens: 3 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  const task = makeTask('gate', 'user-message', 'Use {{hooks.prepare.text}}'); task.advanced.script = 'prepare.sh';
  const context = { sessionId: 's', cwd: data, turn: 1, agent: 'root', sandboxPolicy: { mode: 'read-only', workspaceRoot: data, sessionId: 's' } };
  const runner = new GateTaskRunner({ scriptDirectory: directory, scriptSupported: true, shell, helper, llm, model: { provider: 'p', model: 'm' } });
  return { task, context, runner, requests, calls };
}
test('runner exposes the helper to the script, counts usage, records calls and revokes the token afterwards', async t => {
  const h = await runnerFixture(t, 'pixie ask "summarize"; pixie judge --question ok >/dev/null');
  const execution = await executeTask(h.task, 'original', new AbortController().signal, async () => h.runner, () => h.context);
  assert.equal(execution.status, 'done', execution.error);
  assert.match(h.calls.at(-1).system, /Instruction: Use SUM$/);
  assert.equal(h.calls[0].messages[0].content[0].text, 'original');
  assert.deepEqual(execution.usage, { inputTokens: 4, outputTokens: 5 });
  assert.deepEqual(execution.result.records.map(record => [record.id, record.result.verdict]), [['pixie-ask-1', 'note'], ['pixie-judge-2', 'pass']]);
  assert.deepEqual(execution.result.records[1].result.data, { noul: 0.9, threshold: 0.5 });
  const env = h.requests[0].env; assert.ok(env.PIXIE_URL && env.PIXIE_TOKEN);
  const late = await bash('pixie ask x', env); assert.equal(late.code, 2); assert.match(late.stderr, /401/);
});
test('helper failure stays inside the script; the script decides its exit', async t => {
  const h = await runnerFixture(t, 'pixie judge --question ok --threshold 0.95 || exit 10');
  const execution = await h.runner.run(h.task, 'original', new AbortController().signal, h.context);
  assert.equal(execution.skipped, true); assert.deepEqual(execution.usage, { inputTokens: 1, outputTokens: 1 });
  assert.equal(execution.helperCalls[0].result.verdict, 'fail');
});
