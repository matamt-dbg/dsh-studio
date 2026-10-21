import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import { WebRuntime } from '@deepseek-ai/dsh-web';
import * as plugin from '../src/index.ts';
import { ExaContentsFetchProvider, EXA_CONTENTS_PROVIDER_ID, mapContentsResponse } from '../src/provider.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const options = { apiKey: 'exa-key', baseURL: 'https://api.exa.ai', maxCharacters: 50, timeoutMs: 5000 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function stub(respond) {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return respond(url, init); };
  return calls;
}
const code = expected => error => { assert.equal(error.code, expected, error.message); return true; };

test('sends one URL to /contents with the key header, text cap and no redirects', async () => {
  const calls = stub(() => json({ results: [{ url: 'https://example.com/final', text: 'hello' }], statuses: [{ id: 'https://example.com/', status: 'success' }] }));
  const result = await new ExaContentsFetchProvider({ ...options, maxAgeHours: 0, livecrawlTimeoutMs: 8000 }).fetch({ url: 'https://example.com/' });
  assert.deepEqual(result, { url: 'https://example.com/final', statusCode: 200, body: { kind: 'text', content: 'hello' }, truncated: false });
  assert.equal(calls[0].url, 'https://api.exa.ai/contents');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers['x-api-key'], 'exa-key');
  assert.deepEqual(JSON.parse(calls[0].init.body), { urls: ['https://example.com/'], text: { maxCharacters: 51 }, maxAgeHours: 0, livecrawlTimeout: 8000 });
});

test('omits optional crawl controls and caps the returned text', async () => {
  const calls = stub(() => json({ results: [{ url: 'https://example.com/', text: 'x'.repeat(60) }] }));
  const result = await new ExaContentsFetchProvider(options).fetch({ url: 'https://example.com/' });
  assert.deepEqual(JSON.parse(calls[0].init.body), { urls: ['https://example.com/'], text: { maxCharacters: 51 } }, 'one extra character reveals a cut at the cap');
  assert.equal(result.body.content.length, 50);
  assert.equal(result.truncated, true);
  assert.equal(mapContentsResponse({ results: [{ text: 'y'.repeat(50) }] }, 'https://a.test/', 50).truncated, false, 'exactly at the cap is not truncated');
});

test('a crawl failure with the page status resolves as a result; without one it throws', async () => {
  assert.deepEqual(mapContentsResponse({ results: [], statuses: [{ status: 'error', error: { tag: 'CRAWL_NOT_FOUND', httpStatusCode: 404 } }] }, 'https://a.test/x', 50),
    { url: 'https://a.test/x', statusCode: 404, body: { kind: 'text', content: '' }, truncated: false });
  assert.throws(() => mapContentsResponse({ results: [], statuses: [{ status: 'error', error: { tag: 'CRAWL_TIMEOUT', httpStatusCode: null } }] }, 'https://a.test/', 50),
    error => code('WEB_PROVIDER_ERROR')(error) && /CRAWL_TIMEOUT/.test(error.message));
  assert.throws(() => mapContentsResponse({ results: [] }, 'https://a.test/', 50), code('WEB_PROVIDER_ERROR'));
});

test('an Exa HTTP error becomes WEB_PROVIDER_ERROR with its tag and message, JSON or not', async () => {
  stub(() => json({ requestId: 'r', error: 'Invalid API key', tag: 'INVALID_API_KEY' }, 401));
  await assert.rejects(new ExaContentsFetchProvider(options).fetch({ url: 'https://example.com/' }),
    error => code('WEB_PROVIDER_ERROR')(error) && /401, INVALID_API_KEY\): Invalid API key/.test(error.message) && !error.message.includes('exa-key'));
  stub(() => new Response('<html>bad gateway</html>', { status: 502 }));
  await assert.rejects(new ExaContentsFetchProvider(options).fetch({ url: 'https://example.com/' }), error => code('WEB_PROVIDER_ERROR')(error) && /HTTP 502/.test(error.message));
});

test('upstream errors that echo the key never surface it', async () => {
  stub(() => json({ error: 'Invalid key exa-key for this team', tag: 'INVALID_API_KEY' }, 401));
  await assert.rejects(new ExaContentsFetchProvider(options).fetch({ url: 'https://example.com/' }),
    error => code('WEB_PROVIDER_ERROR')(error) && !error.message.includes('exa-key') && /\[redacted\]/.test(error.message));
  stub(() => { throw new TypeError('connect failed for key exa-key'); });
  await assert.rejects(new ExaContentsFetchProvider(options).fetch({ url: 'https://example.com/' }),
    error => code('WEB_PROVIDER_ERROR')(error) && !error.message.includes('exa-key') && error.cause === undefined);
  assert.throws(() => mapContentsResponse({ statuses: [{ status: 'error', error: { tag: 'leak exa-key' } }] }, 'https://a.test/', 50),
    error => code('WEB_PROVIDER_ERROR')(error) && /\(unknown\)/.test(error.message));
});

test('a 200 body with an unexpected shape is WEB_PROVIDER_ERROR, not a TypeError', async () => {
  for (const body of [null, [], 'text', { results: 'x' }, { statuses: {} }, { results: [null] }]) {
    stub(() => json(body));
    await assert.rejects(new ExaContentsFetchProvider(options).fetch({ url: 'https://example.com/' }), code('WEB_PROVIDER_ERROR'), JSON.stringify(body));
  }
  stub(() => json(null, 500));
  await assert.rejects(new ExaContentsFetchProvider(options).fetch({ url: 'https://example.com/' }), error => code('WEB_PROVIDER_ERROR')(error) && /HTTP 500/.test(error.message));
});

test('rejects non-http(s) and credentialed target URLs before calling Exa', async () => {
  const calls = stub(() => json({}));
  for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'not a url', 'https://user:pw@example.com/']) {
    await assert.rejects(new ExaContentsFetchProvider(options).fetch({ url }), code('WEB_INVALID_URL'));
  }
  assert.equal(calls.length, 0);
});

test('a redirect from the Exa endpoint is refused and its target is never contacted', async () => {
  let targetHits = 0;
  const target = createServer((_req, res) => { targetHits++; res.end('{}'); });
  const api = createServer((_req, res) => { res.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/contents` }); res.end(); });
  await Promise.all([new Promise(r => target.listen(0, '127.0.0.1', r)), new Promise(r => api.listen(0, '127.0.0.1', r))]);
  try {
    await assert.rejects(new ExaContentsFetchProvider({ ...options, baseURL: `http://127.0.0.1:${api.address().port}` }).fetch({ url: 'https://example.com/' }), code('WEB_PROVIDER_ERROR'));
    assert.equal(targetHits, 0);
  } finally { target.close(); api.close(); }
});

test('caller cancellation is WEB_ABORTED and the provider deadline is WEB_FETCH_TIMEOUT', async () => {
  const hang = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  stub(hang);
  const controller = new AbortController();
  const pending = new ExaContentsFetchProvider(options).fetch({ url: 'https://example.com/' }, controller.signal);
  controller.abort();
  await assert.rejects(pending, code('WEB_ABORTED'));
  await assert.rejects(new ExaContentsFetchProvider(options).fetch({ url: 'https://example.com/' }, AbortSignal.abort()), code('WEB_ABORTED'));
  stub(hang);
  await assert.rejects(new ExaContentsFetchProvider({ ...options, timeoutMs: 20 }).fetch({ url: 'https://example.com/' }), code('WEB_FETCH_TIMEOUT'));
});

test('availability needs a key and valid limits', () => {
  assert.equal(new ExaContentsFetchProvider(options).available(), true);
  for (const bad of [{ apiKey: '' }, { baseURL: 'nope' }, { maxCharacters: 0 }, { timeoutMs: 1.5 }, { maxAgeHours: 721 }, { maxAgeHours: -2 }, { livecrawlTimeoutMs: 90001 }]) {
    assert.equal(new ExaContentsFetchProvider({ ...options, ...bad }).available(), false, JSON.stringify(bad));
  }
});

test('plugin export shape: name, inject web, schemastery Config with a secret apiKey, no default export', () => {
  assert.equal(plugin.name, 'web-fetch-exa');
  assert.deepEqual(plugin.inject, ['web']);
  assert.equal('default' in plugin, false);
  assert.equal(plugin.EXA_CONTENTS_PROVIDER_ID, 'exa-contents');
  assert.equal(plugin.Config[Symbol.for('schemastery')], true);
  assert.equal(plugin.Config.dict.apiKey.meta.role, 'secret');
});

test('registers exa-contents into ctx.web, falls back to $EXA_API_KEY, and unregisters on dispose', async () => {
  const calls = stub(() => json({ results: [{ url: 'https://example.com/', text: 'body' }] }));
  const previous = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = 'env-key';
  try {
    const ctx = new Context();
    await ctx.plugin(WebRuntime, { fetchProvider: EXA_CONTENTS_PROVIDER_ID });
    const fiber = await ctx.plugin(plugin, {});
    assert.equal((await ctx.web.fetch({ url: 'https://example.com/' })).body.content, 'body');
    assert.equal(calls[0].init.headers['x-api-key'], 'env-key');
    assert.deepEqual(JSON.parse(calls[0].init.body).text, { maxCharacters: 100001 });
    await fiber.dispose();
    await assert.rejects(ctx.web.fetch({ url: 'https://example.com/' }), code('WEB_PROVIDER_CONFIGURED_MISSING'));
  } finally { if (previous === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = previous; }
});

test('without any key the configured provider is unavailable', async () => {
  const previous = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;
  try {
    const ctx = new Context();
    await ctx.plugin(WebRuntime, { fetchProvider: EXA_CONTENTS_PROVIDER_ID });
    const fiber = await ctx.plugin(plugin, {});
    await assert.rejects(ctx.web.fetch({ url: 'https://example.com/' }), code('WEB_PROVIDER_CONFIGURED_UNAVAILABLE'));
    await fiber.dispose();
  } finally { if (previous !== undefined) process.env.EXA_API_KEY = previous; }
});

test('package is a DSH bundle that inserts only its own row (Plugins page install)', async () => {
  const { readFileSync } = await import('node:fs');
  const { default: yaml } = await import('js-yaml');
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.ok(manifest.files.includes('cordis.patch.yml'));
  const patch = yaml.load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'));
  assert.deepEqual(patch, [{ insert: [{ id: 'web-fetch-exa', name: manifest.name }] }], 'no provider selection or config is changed by installing');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /Do not use `npm i`/);
  assert.match(readme, /dsh plugin --profile \w+ add @matamt-dbg\/dsh-web-fetch-exa/);
});
