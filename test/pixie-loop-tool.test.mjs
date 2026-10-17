/** `pixie_loop` through the real DSH tool runtime: items from a file via `read`, results via `write`, summary only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { installLoop, LOOP_TOOL, renderSummary } from '../src/host/pixie-loop-tool.ts';
import { PixieLoopStore } from '../src/host/pixie-loop-store.ts';
import { createLifetime } from '../src/host/tool-lifetime.ts';
import { LOOP_PLUGIN } from '../src/package-name.ts';
import { studioLayer } from '../src/host/master-composition.ts';

const checks = { questions: { ok: { type: 'noul', instructions: 'Is `output` an acceptable Korean translation of `input`?' } }, pass: { ok: { min: 0.7 } } };
const spec = extra => ({ work: { instruction: 'Translate to Korean.' }, checks, codeChecks: [{ type: 'placeholders' }],
  calibration: { pass: [{ input: 'Save', output: '저장' }], fail: [{ input: 'Save', output: 'Save' }] }, limits: { tokens: 100000, timeMs: 60000 }, ...extra });

async function runtime(t, { work = input => `번역 ${input}`, files = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pixie-loop-'));
  const ctx = new Context();
  const prompt = ctx.plugin(SystemPrompt); await prompt;
  const fiber = ctx.plugin(ToolRuntime); await fiber;
  const written = {}, reads = [];
  // Stand-ins for the session's read/write tools: same names and value shapes as dsh-tool-fs.
  const out = { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
  const disposeRead = ctx.tools.register({ name: 'read', description: 'r', output: out, parameters: { type: 'object', properties: { file_path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['file_path'] },
    async execute(args) { reads.push(args); const all = (files[args.file_path] ?? '').split('\n'); const offset = args.offset ?? 1;
      return { path: args.file_path, offset, totalLines: all.length, lines: all.slice(offset - 1, offset - 1 + (args.limit ?? 2000)).map((text, index) => ({ number: offset + index, text })) }; } });
  const disposeWrite = ctx.tools.register({ name: 'write', description: 'w', output: out, parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] },
    async execute(args) { written[args.file_path] = args.content; return { ok: true }; } });
  const llm = { stream: options => (async function* () {
    const text = options.system.startsWith('A worker') ? 'keep it Korean' : work(options.messages[0].content[0].text, options);
    yield { type: 'text-delta', text }; yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } }; yield { type: 'finish', reason: { kind: 'stop' } };
  })() };
  const store = new PixieLoopStore(dir);
  const jobsStarted = [];
  const jobs = { start(jobSpec) { const id = `pixie-loop-${jobsStarted.length + 1}`; const hooks = jobSpec.run({ id, append() {}, updateProgress() {} }); jobsStarted.push({ id, spec: jobSpec, hooks }); return id; }, async wait() {} };
  const life = createLifetime();
  const judge = async request => ({ ok: true, answers: { ok: { type: 'noul', noul: /[가-힣]/.test(request.state.output) ? 0.95 : 0.1 } }, usage: { inputTokens: 2, outputTokens: 1 } });
  const dispose = installLoop(ctx, life, {
    settings: async () => ({ model: { provider: 'p', model: 'pixie' }, judgeEngine: 'llm', contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }),
    store, llm: () => ({ stream: options => options.system.startsWith('You are a judgment component')
      ? (async function* () { const state = JSON.parse(/State:\n([\s\S]*?)\n\nQuestions:/.exec(options.messages[0].content[0].text)[1]); const result = await judge({ state });
        yield { type: 'text-delta', text: JSON.stringify({ answers: { ok: { noul: result.answers.ok.noul } } }) }; yield { type: 'finish', reason: { kind: 'stop' } }; })()
      : llm.stream(options) }),
    credentials: () => undefined, jobs: () => jobs,
  });
  t.after(async () => { dispose(); disposeRead(); disposeWrite(); await life.dispose(); await fiber.dispose(); await prompt.dispose(); await rm(dir, { recursive: true, force: true }); });
  let n = 0;
  const agent = { id: 'session-1' };
  const call = args => ctx.tools.execute({ callId: ToolCallId(`c${n++}`), name: LOOP_TOOL, arguments: args, agent, signal: new AbortController().signal });
  return { ctx, call, written, reads, store, jobsStarted };
}

test('the tool is registered with its schema and joins the Studio Master layer', async t => {
  const { ctx } = await runtime(t);
  const schema = ctx.tools.schemas().find(item => item.name === LOOP_TOOL);
  assert.ok(schema); assert.deepEqual(schema.parameters.required, ['items']);
  assert.match(schema.description, /escalated/);
  assert.ok(studioLayer().some(row => row.name === LOOP_PLUGIN && row.id === 'studio-loop'));
});

test('items from a JSONL file; results written; the model sees only the summary and failures', async t => {
  const files = { 'work/items.jsonl': ['{"id":"k1","input":"Save {name}"}', '{"id":"k2","input":"Open"}', '{"id":"k3","input":"Close"}'].join('\n') };
  const { call, written, reads, store } = await runtime(t, { files, work: input => input === 'Close' ? 'Close' : input === 'Save {name}' ? '{name} 저장' : '열기' });
  const result = await call(spec({ items: { path: 'work/items.jsonl' }, output: 'work/done.jsonl', maxAttempts: 2 }));
  assert.equal(result.isError, false, JSON.stringify(result.content));
  assert.equal(reads[0].file_path, 'work/items.jsonl');
  assert.equal(result.value.passed, 2);
  assert.deepEqual(result.value.escalated.map(item => [item.id, item.attempts, item.failed]), [['k3', 2, ['ok']]]);
  const text = result.content[0].text;
  assert.match(text, /^pixie_loop done\npassed 2, escalated 1, errors 0, skipped 0\nresults: work\/done.jsonl/);
  assert.doesNotMatch(text, /열기/, 'passed outputs stay in the results file, not the model context');
  const rows = written['work/done.jsonl'].trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => [row.id, row.status]).sort(), [['k1', 'passed'], ['k2', 'passed'], ['k3', 'escalated']]);
  assert.equal(rows.find(row => row.id === 'k1').output, '{name} 저장');
  const record = await store.read('session-1');
  assert.equal(record.runs.length, 1); assert.equal(record.runs[0].status, 'done'); assert.equal(record.runs[0].items.length, 3);
});

test('an invalid spec is a tool error before any model call', async t => {
  const { call } = await runtime(t);
  const result = await call(spec({ items: { inline: [{ id: 'a', input: 'x' }] }, maxAttempts: 0 }));
  assert.equal(result.isError, true);
});

test('background runs become owned jobs whose result is the summary', async t => {
  const { call, jobsStarted } = await runtime(t);
  const result = await call(spec({ items: { inline: [{ id: 'a', input: 'Save' }] }, run_in_background: true }));
  assert.equal(result.isError, false, JSON.stringify(result.content));
  assert.equal(result.value.kind, 'background'); assert.equal(result.value.jobId, 'pixie-loop-1');
  assert.equal(jobsStarted[0].spec.owner, 'session-1'); assert.equal(jobsStarted[0].spec.kind, 'pixie-loop');
  const outcome = await jobsStarted[0].hooks.done;
  assert.equal(outcome.status, 'completed'); assert.match(outcome.result, /passed 1, escalated 0/);
});

test('cancelling a background job settles killed', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { call, jobsStarted } = await runtime(t, { work: input => input });
  const result = await call(spec({ items: { inline: Array.from({ length: 5 }, (_, index) => ({ id: `i${index}`, input: `x${index}` })) }, concurrency: 1, run_in_background: true }));
  jobsStarted[0].hooks.cancel('stop now');
  release();
  await gate;
  const outcome = await jobsStarted[0].hooks.done;
  assert.equal(outcome.status, 'killed', JSON.stringify(outcome));
  assert.ok(result.value.runId);
});

test('summary rendering is bounded', () => {
  const big = { runId: 'r', status: 'done', passed: 0, skipped: 0, errors: [], usage: { pixie: { inputTokens: 0, outputTokens: 0 }, judge: { inputTokens: 0, outputTokens: 0 } },
    escalated: Array.from({ length: 2000 }, (_, index) => ({ id: `item-${index}`, attempts: 3, failed: ['ok'], feedback: 'x'.repeat(40) })) };
  const text = renderSummary(big);
  assert.ok(text.length < 20_200); assert.match(text, /\[truncated/);
});

test('a promoted (timed-out) act command is killed and awaited before the next act', async () => {
  const { installLoop } = await import('../src/host/pixie-loop-tool.ts');
  const { createLifetime } = await import('../src/host/tool-lifetime.ts');
  let tool; const killed = []; const waits = [];
  const tools = { register(definition) { tool = definition; return () => {}; }, async execute(call) {
    if (call.name === 'bash') return { isError: false, content: [], value: { kind: 'promoted', jobId: 'bash-7', timeoutMs: 1000 } };
    throw new Error(`unexpected ${call.name}`);
  } };
  const views = ['running', 'killed'];
  const jobs = { start() { throw new Error('no'); }, kill(id, owner, reason) { killed.push([id, owner, reason]); }, async wait(id) { waits.push(id); return { status: views.shift() }; } };
  const life = createLifetime();
  const judgeReply = { stream: options => (async function* () {
    const text = options.system.startsWith('You are a judgment component') ? JSON.stringify({ answers: { ok: { noul: /timed out/.test(options.messages[0].content[0].text) ? 0.1 : 0.9 } } }) : '#x';
    yield { type: 'text-delta', text }; yield { type: 'finish', reason: { kind: 'stop' } };
  })() };
  installLoop({ get: name => name === 'tools' ? tools : undefined, logger: {} }, life, { settings: async () => ({ model: { provider: 'p', model: 'm' }, judgeEngine: 'llm', contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }),
    store: { put: async () => {} }, llm: () => judgeReply, credentials: () => undefined, jobs: () => jobs });
  const value = await tool.execute({ items: { inline: [{ id: 'a', input: 'x' }] }, work: { instruction: 'w' }, maxAttempts: 1, limits: { tokens: 100000, timeMs: 60000 },
    checks: { questions: { ok: { type: 'noul', instructions: 'ok?' } }, pass: { ok: { min: 0.5 } } }, act: { tool: 'bash', command: 'sleep {{output}}', safeToRepeat: true },
    calibration: { pass: [{ input: 'x', output: '1', observation: 'fine' }], fail: [{ input: 'x', output: '1', observation: '[timed out]' }] } },
    { agent: { id: 'session-1' }, signal: new AbortController().signal, callId: 'c', token: {} });
  assert.deepEqual(killed, [['bash-7', 'session-1', 'pixie_loop act timed out']]);
  assert.deepEqual(waits, ['bash-7', 'bash-7']);
  assert.equal(value.escalated.length, 1);
  await life.dispose();
});
