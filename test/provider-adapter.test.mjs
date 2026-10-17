/** SettingsX adapter against a fake HTTP server: request shape, attribution, stream translation, failures, reload. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attributionHeaders } from '@deepseek-ai/dsh-llm';
import { StudioProviderAdapter, StudioProviders } from '../src/host/provider-adapter.ts';
import { ProviderAuth } from '../src/host/provider-auth.ts';

/** One server per test; each request records the body and replies with the queued SSE frames or status. */
async function fakeServer(t, reply) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push({ url: request.url, headers: request.headers, body: JSON.parse(body) });
      const next = reply(requests.length);
      if (next.status) { response.writeHead(next.status, { 'content-type': 'application/json', ...(next.headers ?? {}) }); response.end(JSON.stringify(next.body ?? {})); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const frame of next.frames) response.write(typeof frame === 'string' ? `data: ${frame}\n\n` : `data: ${JSON.stringify(frame)}\n\n`);
      response.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { requests, baseURL: `http://127.0.0.1:${server.address().port}/v1` };
}

const definition = (baseURL, protocol, patch = {}) => ({ version: 1, id: 'fake', name: 'Fake', protocol, baseURL, headers: { 'X-Team': 'studio' },
  models: [{ id: 'm1', name: 'Model One', contextWindow: 1000, maxTokens: 64 }], credential: { kind: 'none' }, ...patch });
const request = (patch = {}) => ({ provider: 'fake', model: 'm1', system: 'Be brief.', messages: [
  { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'calling' }, { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"path":"a"}' }], source: { kind: 'model', provider: 'fake', model: 'm1' } },
  { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'file text' }], source: { kind: 'tool', callId: 'call_1' } },
], tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object' } }], ...patch });
const collect = async iterable => { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks; };
const adapterFor = def => { const adapter = new StudioProviderAdapter(); adapter.definitions = new Map([[def.id, def]]); return adapter; };

test('chat completions: history, tools, attribution, and streamed text plus a tool call', async t => {
  const server = await fakeServer(t, () => ({ frames: [
    { choices: [{ index: 0, delta: { content: 'Hel' } }] },
    { choices: [{ index: 0, delta: { content: 'lo' } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_2', function: { name: 'read', arguments: '{"pa' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"b"}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 50, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 20 } } },
    '[DONE]',
  ] }));
  const chunks = await collect(adapterFor(definition(server.baseURL, 'openai-chat')).stream(request()));
  const [sent] = server.requests;
  assert.equal(sent.url, '/v1/chat/completions');
  for (const [name, value] of Object.entries(attributionHeaders())) assert.equal(sent.headers[name.toLowerCase()], value);
  assert.equal(sent.headers['x-team'], 'studio');
  assert.equal(sent.body.max_tokens, 64);
  assert.deepEqual(sent.body.messages.map(message => message.role), ['system', 'user', 'assistant', 'tool']);
  assert.deepEqual(sent.body.messages[2].tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }]);
  assert.equal(sent.body.tools[0].function.name, 'read');
  const ends = chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block);
  assert.deepEqual(ends, [{ type: 'text', text: 'Hello' }, { type: 'tool-call', id: 'call_2', name: 'read', arguments: '{"path":"b"}' }]);
  assert.deepEqual(chunks.at(-2), { type: 'usage', usage: { inputTokens: 30, outputTokens: 7, totalTokens: 57, cacheReadTokens: 20 } });
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } });
});

test('responses: stateless body and reasoning, text, and function-call items', async t => {
  const server = await fakeServer(t, () => ({ frames: [
    { type: 'response.created', response: {} },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'think' },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning' } },
    { type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: 'Answer' },
    { type: 'response.output_item.done', output_index: 1, item: { type: 'message' } },
    { type: 'response.output_item.added', output_index: 2, item: { type: 'function_call', call_id: 'call_9', name: 'read' } },
    { type: 'response.function_call_arguments.delta', output_index: 2, delta: '{}' },
    { type: 'response.output_item.done', output_index: 2, item: { type: 'function_call', arguments: '{}' } },
    { type: 'response.completed', response: { output: [{ type: 'function_call' }], usage: { input_tokens: 10, output_tokens: 5, output_tokens_details: { reasoning_tokens: 2 } } } },
  ] }));
  const chunks = await collect(adapterFor(definition(server.baseURL, 'openai-responses')).stream(request({ reasoningEffort: 'low' })));
  const [sent] = server.requests;
  assert.equal(sent.url, '/v1/responses');
  assert.equal(sent.body.store, false);
  assert.equal(sent.body.instructions, 'Be brief.');
  assert.equal(sent.body.max_output_tokens, 64);
  assert.deepEqual(sent.body.reasoning, { effort: 'low' });
  assert.deepEqual(sent.body.input.map(item => item.type ?? item.role), ['user', 'assistant', 'function_call', 'function_call_output']);
  const ends = chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block);
  assert.deepEqual(ends, [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'Answer' }, { type: 'tool-call', id: 'call_9', name: 'read', arguments: '{}' }]);
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } });
});

test('HTTP failures map to retryable or terminal codes; truncated streams fail', async t => {
  const replies = [{ status: 429, headers: { 'retry-after': '2' }, body: { error: { message: 'slow down' } } }, { status: 401 }, { frames: [{ choices: [{ index: 0, delta: { content: 'x' } }] }] }];
  const server = await fakeServer(t, n => replies[n - 1]);
  const adapter = adapterFor(definition(server.baseURL, 'openai-chat'));
  await assert.rejects(collect(adapter.stream(request())), error => error.code === 'RATE_LIMIT' && error.failure.status === 429 && error.failure.providerRetryAfterMs === 2000 && /slow down/.test(error.message));
  await assert.rejects(collect(adapter.stream(request())), error => error.code === 'AUTHENTICATION');
  await assert.rejects(collect(adapter.stream(request())), error => error.code === 'STREAM_CLOSED');
});

test('model catalog comes from the definition; unknown routes fail', async () => {
  const adapter = adapterFor(definition('http://127.0.0.1:1/v1', 'openai-chat'));
  assert.deepEqual(await adapter.listModels('fake'), [{ provider: 'fake', id: 'm1', name: 'Model One', inputModalities: ['text'] }]);
  assert.deepEqual((await adapter.resolveModel('fake', 'm1')).context, { contextWindow: 1000 });
  assert.equal(adapter.providerInfo('fake').name, 'Fake');
  await assert.rejects(adapter.listModels('other'), error => error.code === 'UNKNOWN_PROVIDER');
});

test('reload registers valid files, reports invalid and conflicting ones, and replaces routes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-providers-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  let routes = [];
  const llm = {
    listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }, ...routes.map(id => ({ id, name: id }))],
    registerAdapter(providers) { routes = [...providers]; calls.push(['register', providers]); const handle = () => { routes = []; calls.push(['dispose']); }; handle.replace = next => { routes = [...next]; calls.push(['replace', next]); }; return handle; },
  };
  const disposers = [];
  const ctx = { get: name => (name === 'llm' ? llm : undefined), effect: fn => { disposers.push(fn()); }, logger: {} };
  await writeFile(join(dir, 'a.json'), JSON.stringify(definition('http://127.0.0.1:1/v1', 'openai-chat', { id: 'alpha' })));
  await writeFile(join(dir, 'b.json'), '{ broken');
  await writeFile(join(dir, 'c.json'), JSON.stringify(definition('http://127.0.0.1:1/v1', 'openai-chat', { id: 'deepseek' })));
  await writeFile(join(dir, 'd.json'), JSON.stringify(definition('http://127.0.0.1:1/v1', 'openai-chat', { id: 'alpha' })));
  const service = Object.create(StudioProviders.prototype);
  const auth = new ProviderAuth({ credentials: () => undefined });
  Object.assign(service, { ctx, directory: dir, auth, adapter: new StudioProviderAdapter(fetch, auth), entries: [] });
  const first = await service.reload();
  assert.deepEqual(first.entries.map(entry => `${entry.file}:${entry.status}${entry.detail ? `:${entry.detail}` : ''}`), ['a.json:registered', 'b.json:invalid', 'c.json:conflict:route', 'd.json:conflict:duplicate']);
  assert.deepEqual(routes, ['alpha']);
  // Its own routes are not conflicts on the next reload; removing a file removes its route.
  await unlink(join(dir, 'd.json'));
  await writeFile(join(dir, 'e.json'), JSON.stringify(definition('http://127.0.0.1:1/v1', 'openai-chat', { id: 'beta' })));
  await service.reload();
  assert.deepEqual(routes, ['alpha', 'beta']);
  await unlink(join(dir, 'a.json'));
  await service.reload();
  assert.deepEqual(routes, ['beta']);
  assert.deepEqual(calls.map(call => call[0]), ['register', 'replace', 'replace']);
  assert.deepEqual([...service.adapter.definitions.keys()], ['beta']);
  assert.deepEqual((await service.list()).auth, { beta: { kind: 'none' } });
});


test('adapter pins the selected OAuth account across 401 and applies session priority on wire', async () => {
  const seen = []; const authCalls = []; let selected = 'a';
  const auth = { accounts: async () => [{ id: selected, isDefault: true }], headers: async (_, options) => { authCalls.push(options); return { Authorization: `Bearer ${options.accountId}` }; } };
  const adapter = new StudioProviderAdapter(async (_, init) => {
    seen.push(JSON.parse(init.body));
    if (seen.length === 1) { selected = 'b'; return new Response('', { status: 401 }); }
    return new Response('data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n');
  }, auth, { get: async id => id === 'session' });
  adapter.definitions.set('studio-chatgpt', definition('https://chatgpt.com/backend-api/codex', 'openai-responses', { id: 'studio-chatgpt', credential: { kind: 'oauth' } }));
  await collect(adapter.stream(request({ provider: 'studio-chatgpt', model: 'gpt-5.5', sessionId: 'session' })));
  assert.equal(seen[0].service_tier, 'priority'); assert.deepEqual(seen[0], seen[1]);
  assert.deepEqual(authCalls.map(call => [call.accountId, call.retry]), [['a', false], ['a', true]]);
});
