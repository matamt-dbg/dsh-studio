/** Pixie service in a real Cordis context with fake llm, sessionController, and commands. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { PixieService } from '../src/host/pixie-service.ts';
import { makeTask } from '../src/pixie-gate-task.ts';

test('gate trial service uses the ordinary Pixie model once and reports its plan and usage', async () => {
  const h = await harness(), calls = [];
  h.ctx.set('llm', { stream: async function* (options) {
    calls.push(options);
    yield { type: 'text-delta', index: 0, text: '{"replace":"replacement","append":"addition"}' };
    yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } });
  const fiber = await start(h);
  try {
    const service = h.ctx.get('studioPixie');
    await service.saveSettings(JSON.stringify({ model: { provider: 'p', model: 'ordinary' }, judgeModel: { provider: 'p', model: 'judge' }, contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }));
    const task = makeTask('Trial', 'tool-after', 'Check');
    const result = await service.trialGate(JSON.stringify({ task, text: 'original' }), new AbortController().signal);
    assert.equal(result.output.verdict, 'pass'); assert.equal(result.plan.replacement, 'replacement'); assert.equal(result.plan.addition, 'addition');
    assert.equal(calls.length, 1); assert.equal(calls[0].model, 'ordinary');
    assert.deepEqual(result.usage, { inputTokens: 2, outputTokens: 3 });
  } finally { await fiber.dispose(); }
});

async function harness({ sessions = ['s1'] } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'studio-pixie-svc-'));
  const ctx = new Context();
  const commands = new Map();
  for (const key of ['llm', 'sessionController', 'commands']) ctx.provide(key);
  ctx.set('commands', { register: definition => { commands.set(definition.name, definition); return () => commands.delete(definition.name); } });
  ctx.set('llm', {
    stream: async function* () { yield { type: 'text-delta', index: 0, text: 'pong' }; yield { type: 'finish', reason: { kind: 'stop' } }; },
    resolveModelInfo: async () => ({ context: { contextWindow: 64000 } }),
  });
  ctx.set('sessionController', {
    inspect: async id => { if (!sessions.includes(id)) throw new Error(`session "${id}" not found`); return { events: [] }; },
    list: async () => ({ items: sessions.map(sessionId => ({ sessionId })) }),
    modelCatalog: async () => ({ groups: [] }),
  });
  return { ctx, dataDir, commands };
}
for (const mode of ['read-only', 'workspace-write']) test(`hook service restores session policy and cwd composition: ${mode}`, async () => {
  const h = await harness(); const requests = [], policies = [];
  const session = { header: { cwd: '/session/workspace' } };
  const agent = { id: 's1', ctx: h.ctx, session };
  for (const key of ['shell', 'sandboxPolicy', 'agentPresets', 'agents']) h.ctx.provide(key);
  h.ctx.set('agents', { roots: () => [agent] });
  h.ctx.set('agentPresets', { composedPreset: () => 'p' });
  h.ctx.set('sandboxPolicy', { resolve(request) { policies.push(request); return { mode, workspaceRoot: '/session/workspace', sessionId: 's1' }; } });
  h.ctx.set('shell', { resolve(request) { requests.push(request); return request; }, async execute() { return { async result() { return { exitCode: 10, timedOut: false, stdout: { text: '', truncated: false }, stderr: { text: '' } }; } }; } });
  const directory = join(h.dataDir, 'pixie-gate/commands'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'skip.sh'), '#!/bin/bash\n', { mode: 0o755 });
  const fiber = await start(h);
  try {
    const service = h.ctx.get('studioPixie'); const task = makeTask('gate', 'user-message', 'check');
    task.enabled = true; task.presetIds = ['p']; task.advanced.script = 'skip.sh';
    await service.saveGateDefinitions(JSON.stringify([task]));
    const decision = { kind: 'enter', messages: [{ id: 'm', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'original' }] }] };
    const result = await h.ctx.waterfall('agent/pre-step', { agent, turn: 7, signal: new AbortController().signal }, async () => decision);
    assert.equal(result, decision); assert.equal(requests.length, 1);
    assert.equal(policies[0].session, session); assert.equal(requests[0].workdir, '/session/workspace');
    assert.deepEqual(requests[0].sandboxPolicy, { mode, workspaceRoot: '/session/workspace', sessionId: 's1' });
    assert.equal(requests[0].env.PIXIE_TURN, '7');
    const run = (await service.gateRuns('s1')).runs[0]; assert.equal(run.applied, 'none'); assert.ok(run.result.notes.includes('skipped by hook'));
    assert.deepEqual(await service.gateScripts(), { directory, defaultDirectory: directory, custom: false, supported: true, scripts: ['skip.sh'] });
  } finally { await fiber.dispose(); }
});

test('hook service registers the helper route on webServer and passes PIXIE_URL/PIXIE_TOKEN only while it runs', async () => {
  const h = await harness(); const requests = [], routes = new Map();
  const session = { header: { cwd: '/w' } }, agent = { id: 's1', ctx: h.ctx, session };
  for (const key of ['shell', 'sandboxPolicy', 'agentPresets', 'agents', 'webServer']) h.ctx.provide(key);
  h.ctx.set('agents', { roots: () => [agent] }); h.ctx.set('agentPresets', { composedPreset: () => 'p' });
  h.ctx.set('sandboxPolicy', { resolve: () => ({ mode: 'read-only', workspaceRoot: '/w', sessionId: 's1' }) });
  h.ctx.set('shell', { resolve(request) { requests.push(structuredClone({ ...request, signal: undefined })); return request; }, async execute() { return { async result() { return { exitCode: 10, timedOut: false, stdout: { text: '', truncated: false }, stderr: { text: '' } }; } }; } });
  h.ctx.set('webServer', { host: '127.0.0.1', port: 4321, protocol: 'http:', register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } });
  const directory = join(h.dataDir, 'pixie-gate/commands'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'skip.sh'), '#!/bin/bash\n', { mode: 0o755 });
  const fiber = await start(h);
  try {
    await until(() => routes.size === 1);
    const route = routes.get('/studio/pixie-gate/helper'); assert.equal(route.kind, 'prefix');
    const service = h.ctx.get('studioPixie'); const task = makeTask('gate', 'user-message', 'check');
    task.enabled = true; task.presetIds = ['p']; task.advanced.script = 'skip.sh';
    await service.saveGateDefinitions(JSON.stringify([task]));
    const decision = { kind: 'enter', messages: [{ id: 'm', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'original' }] }] };
    await h.ctx.waterfall('agent/pre-step', { agent, turn: 1, signal: new AbortController().signal }, async () => decision);
    assert.equal(requests[0].env.PIXIE_URL, 'http://127.0.0.1:4321/studio/pixie-gate/helper');
    assert.match(requests[0].env.PIXIE_TOKEN, /^[0-9a-f]{64}$/);
    assert.ok(requests[0].env.PATH.startsWith(join(h.dataDir, 'pixie-gate/bin')));
    assert.deepEqual(await readdir(join(h.dataDir, 'pixie-gate/bin')), ['pixie']);
  } finally { await fiber.dispose(); }
  assert.equal(routes.size, 0);
});

test('helper URL works on rc.2 web servers without a protocol getter and reads the listened port lazily', async () => {
  const h = await harness(); const routes = new Map();
  h.ctx.provide('webServer');
  const server = { host: '0.0.0.0', port: undefined, register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } };
  h.ctx.set('webServer', server);
  const fiber = await start(h);
  try {
    await until(() => routes.size === 1);
    server.port = 5555;
    const service = h.ctx.get('studioPixie');
    assert.equal(service.helperUrl, 'http://127.0.0.1:5555/studio/pixie-gate/helper');
    server.host = '::'; assert.equal(service.helperUrl, 'http://[::1]:5555/studio/pixie-gate/helper');
    server.host = '192.168.0.4'; server.protocol = 'https:'; assert.equal(service.helperUrl, 'https://192.168.0.4:5555/studio/pixie-gate/helper');
    server.port = undefined; assert.equal(service.helperUrl, undefined);
  } finally { await fiber.dispose(); }
});

test('script folder setting: default, custom absolute or ~ path used by runs, relative rejected, reset', async () => {
  const { homedir } = await import('node:os');
  const h = await harness(); const requests = [];
  const session = { header: { cwd: '/w' } }, agent = { id: 's1', ctx: h.ctx, session };
  for (const key of ['shell', 'sandboxPolicy', 'agentPresets', 'agents']) h.ctx.provide(key);
  h.ctx.set('agents', { roots: () => [agent] }); h.ctx.set('agentPresets', { composedPreset: () => 'p' });
  h.ctx.set('sandboxPolicy', { resolve: () => ({ mode: 'read-only', workspaceRoot: '/w', sessionId: 's1' }) });
  h.ctx.set('shell', { resolve(request) { requests.push(request.command); return request; }, async execute() { return { async result() { return { exitCode: 10, timedOut: false, stdout: { text: '', truncated: false }, stderr: { text: '' } }; } }; } });
  const custom = join(h.dataDir, 'my-gates'); await mkdir(custom);
  await writeFile(join(custom, 'mine.sh'), '#!/bin/bash\n', { mode: 0o755 });
  const fiber = await start(h);
  try {
    const service = h.ctx.get('studioPixie'); const defaultDirectory = join(h.dataDir, 'pixie-gate/commands');
    assert.deepEqual(await service.gateScripts(), { directory: defaultDirectory, defaultDirectory, custom: false, supported: true, scripts: [] });
    assert.deepEqual(await service.saveGateScriptDirectory(JSON.stringify({ scriptDirectory: custom })), { directory: custom, defaultDirectory, custom: true, supported: true, scripts: ['mine.sh'] });
    const task = makeTask('gate', 'user-message', 'check'); task.enabled = true; task.presetIds = ['p']; task.advanced.script = 'mine.sh';
    await service.saveGateDefinitions(JSON.stringify([task]));
    const decision = { kind: 'enter', messages: [{ id: 'm', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] }] };
    await h.ctx.waterfall('agent/pre-step', { agent, turn: 1, signal: new AbortController().signal }, async () => decision);
    assert.match(requests[0], new RegExp(`${custom.replace(/[/.]/g, m => `\\${m}`)}/mine\\.sh`));
    assert.equal((await service.saveGateScriptDirectory(JSON.stringify({ scriptDirectory: '~/x' }))).directory, join(homedir(), 'x'));
    await assert.rejects(service.saveGateScriptDirectory(JSON.stringify({ scriptDirectory: 'relative/path' })), /absolute path/);
    assert.equal((await service.gateScripts()).directory, join(homedir(), 'x'));
    assert.deepEqual(await service.saveGateScriptDirectory(JSON.stringify({ scriptDirectory: '' })), { directory: defaultDirectory, defaultDirectory, custom: false, supported: true, scripts: [] });
  } finally { await fiber.dispose(); }
});

const start = async (h) => { const fiber = h.ctx.plugin(PixieService, h.dataDir); await fiber; return fiber; };
const until = async (check) => { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('timed out'); };

test('follow replays an in-flight request and syncs after a disconnected completion', async () => {
  const h = await harness();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  h.ctx.set('llm', {
    stream: async function* () { yield { type: 'text-delta', index: 0, text: 'first' }; await gate; yield { type: 'text-delta', index: 0, text: ' second' }; },
    resolveModelInfo: async () => ({ context: { contextWindow: 64000 } }),
  });
  const fiber = await start(h);
  const service = h.ctx.get('studioPixie');
  const abort = new AbortController();
  try {
    await service.saveSettings(JSON.stringify({ model: { provider: 'p', model: 'm' }, contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }));
    await service.ask('s1', JSON.stringify({ question: 'ping' }));
    await until(async () => (await service.view('s1')).frames.some(f => f.type === 'text'));
    const stream = service.follow('s1', abort.signal);
    assert.equal((await stream.next()).value.type, 'sync');
    assert.equal((await stream.next()).value.type, 'start');
    assert.deepEqual((await stream.next()).value, { type: 'text', text: 'first' });
    await stream.return();
    release();
    await until(async () => !(await service.view('s1')).running);
    const reconnected = service.follow('s1', abort.signal);
    assert.equal((await reconnected.next()).value.type, 'sync');
    assert.equal((await service.view('s1')).record.threads[0].turns[0].answer, 'first second');
    await reconnected.return();
  } finally { release(); abort.abort(); await fiber.dispose(); }
});

test('registers /pixie and withdraws it on dispose', async () => {
  const h = await harness();
  const fiber = await start(h);
  assert.ok(h.commands.has('pixie'));
  await fiber.dispose();
  assert.equal(h.commands.has('pixie'), false);
});

test('settings, ask, and view go through the service', async () => {
  const h = await harness();
  const fiber = await start(h);
  const service = h.ctx.get('studioPixie');
  await service.saveSettings(JSON.stringify({ model: { provider: 'p', model: 'm' }, contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }));
  await service.ask('s1', JSON.stringify({ question: 'ping' }));
  await until(async () => (await service.view('s1')).record.threads[0]?.turns[0]?.status === 'done');
  const view = await service.view('s1');
  assert.equal(view.record.threads[0].turns[0].answer, 'pong');
  assert.equal(view.contextWindow, 64000);
  assert.equal(view.running, false);
  await fiber.dispose();
});

test('records of deleted sessions are pruned on start; listed (including archived) ones stay', async () => {
  const h = await harness({ sessions: ['kept'] });
  await mkdir(join(h.dataDir, 'pixie'), { recursive: true });
  for (const id of ['kept', 'gone']) await writeFile(join(h.dataDir, 'pixie', `${id}.json`), JSON.stringify({ sessionId: id, threads: [] }));
  const fiber = await start(h);
  await until(async () => (await readdir(join(h.dataDir, 'pixie'))).length === 1);
  assert.deepEqual(await readdir(join(h.dataDir, 'pixie')), ['kept.json']);
  await fiber.dispose();
});

test('a failed session listing prunes nothing', async () => {
  const h = await harness();
  h.ctx.set('sessionController', { inspect: async () => ({ events: [] }), list: async () => { throw new Error('disk busy'); }, modelCatalog: async () => ({}) });
  await mkdir(join(h.dataDir, 'pixie'), { recursive: true });
  await writeFile(join(h.dataDir, 'pixie', 'x.json'), JSON.stringify({ sessionId: 'x', threads: [] }));
  const fiber = await start(h);
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(await readdir(join(h.dataDir, 'pixie')), ['x.json']);
  await fiber.dispose();
});

test('a /pixie turn can be read by command id, and threads can be deleted', async () => {
  const h = await harness();
  const fiber = await start(h);
  const service = h.ctx.get('studioPixie');
  await service.saveSettings(JSON.stringify({ model: { provider: 'p', model: 'm' }, contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }));
  await h.commands.get('pixie').handler({ commandId: 'cmd-9', agent: { id: 's1' }, rawInput: ' ping', attachments: [], signal: new AbortController().signal });
  await until(async () => (await service.commandTurn('s1', 'cmd-9'))?.status === 'done');
  assert.equal((await service.commandTurn('s1', 'cmd-9')).answer, 'pong');
  assert.equal(await service.commandTurn('s1', 'other'), null);
  const threadId = (await service.view('s1')).record.threads[0].id;
  await service.deleteThread('s1', threadId);
  assert.deepEqual((await service.view('s1')).record.threads, []);
  await fiber.dispose();
});

test('Jev key Remote stores through DSH credentials and never returns the value', async () => {
  const h = await harness(), store = new Map(), shadow = new Map();
  h.ctx.provide('credentials');
  h.ctx.set('credentials', {
    resolve: async ref => shadow.has(ref) ? { value: shadow.get(ref), source: 'env' } : store.has(ref) ? { value: store.get(ref), source: 'store' } : undefined,
    describe: async ref => shadow.has(ref) ? { configured: true, source: 'env', writable: false } : { configured: store.has(ref), ...(store.has(ref) ? { source: 'store' } : {}), writable: true },
    set: async (ref, value) => { if (shadow.has(ref)) throw new Error('shadowed'); store.set(ref, value); },
    unset: async ref => { store.delete(ref); },
  });
  const fiber = await start(h);
  try {
    const service = h.ctx.get('studioPixie');
    assert.deepEqual(await service.jevKeyStatus(), { available: true, configured: false, writable: true });
    const saved = await service.saveJevKey(JSON.stringify({ value: '  ts-secret  ' }));
    assert.deepEqual(saved, { available: true, configured: true, writable: true, source: 'store' });
    assert.equal(store.get('TYPESAFE_API_KEY'), 'ts-secret');
    assert.doesNotMatch(JSON.stringify(saved), /ts-secret/);
    await assert.rejects(service.saveJevKey(JSON.stringify({ value: ' ' })), /required/);
    assert.deepEqual(await service.deleteJevKey(), { available: true, configured: false, writable: true });
    shadow.set('TYPESAFE_API_KEY', 'from-env');
    assert.deepEqual(await service.jevKeyStatus(), { available: true, configured: true, writable: false, source: 'env' });
    await assert.rejects(service.saveJevKey(JSON.stringify({ value: 'x' })), /shadowed/);
  } finally { await fiber.dispose(); }
});

test('without DSH credentials the Jev key is reported unavailable and cannot be stored', async () => {
  const h = await harness();
  const fiber = await start(h);
  try {
    const service = h.ctx.get('studioPixie');
    assert.deepEqual(await service.jevKeyStatus(), { available: false, configured: false, writable: false });
    await assert.rejects(service.saveJevKey(JSON.stringify({ value: 'x' })), /credentials service is unavailable/);
  } finally { await fiber.dispose(); }
});

test('a bare refs: line in the DSH credentials file becomes a coded error that keeps the original text', async () => {
  const h = await harness();
  h.ctx.provide('credentials');
  const shape = new Error('Expected YAML collection at refs. Remaining path: TYPESAFE_API_KEY');
  h.ctx.set('credentials', { resolve: async () => undefined, describe: async () => ({ configured: false, writable: true }), set: async () => { throw shape; }, unset: async () => { throw shape; } });
  const fiber = await start(h);
  try {
    const service = h.ctx.get('studioPixie');
    await assert.rejects(service.saveJevKey(JSON.stringify({ value: 'k' })), /^Error: \[pixie\/credentials-refs\] Expected YAML collection at refs\. Remaining path: TYPESAFE_API_KEY$/);
    await assert.rejects(service.deleteJevKey(), /\[pixie\/credentials-refs\]/);
    h.ctx.get('credentials').set = async () => { throw new Error('disk full'); };
    await assert.rejects(service.saveJevKey(JSON.stringify({ value: 'k' })), /^Error: disk full$/);
  } finally { await fiber.dispose(); }
});
