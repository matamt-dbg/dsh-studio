/** SettingsX credential supply: stored keys, token commands, and OAuth (PKCE sign-in, storage, refresh) with fakes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { ProviderAuth, jwtClaims } from '../src/host/provider-auth.ts';
import { StudioProviderAdapter } from '../src/host/provider-adapter.ts';

/** In-memory DSH credentials with the record lock reduced to sequential calls. */
function fakeCredentials() {
  const refs = new Map(); const records = new Map();
  return { refs, records,
    resolve: async ref => (refs.has(ref) ? { value: refs.get(ref), source: 'store' } : undefined),
    describe: async ref => ({ configured: refs.has(ref), writable: true, ...(refs.has(ref) ? { source: 'store' } : {}) }),
    set: async (ref, value) => { refs.set(ref, value); }, unset: async ref => { refs.delete(ref); },
    readRecord: async key => records.get(key), deleteRecord: async key => { records.delete(key); },
    modifyRecord: async (key, mutate) => { const next = await mutate(records.get(key)); if (next) records.set(key, next); return records.get(key); },
  };
}
const definition = credential => ({ version: 1, id: 'route', name: 'Route', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', models: [{ id: 'm' }], credential });
const jwt = payload => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

test('stored keys are read per request, sent as Bearer or a custom header, and never echoed', async () => {
  const credentials = fakeCredentials();
  const auth = new ProviderAuth({ credentials: () => credentials });
  const def = definition({ kind: 'credential', ref: 'ROUTE_KEY' });
  await assert.rejects(auth.headers(def), error => error.code === 'AUTHENTICATION' && /ROUTE_KEY is not set/.test(error.message));
  await auth.setKey(def, '  sk-1  ');
  assert.deepEqual(await auth.headers(def), { Authorization: 'Bearer sk-1' });
  assert.deepEqual(await auth.state(def), { kind: 'credential', configured: true, writable: true, source: 'store' });
  assert.deepEqual(await auth.headers(definition({ kind: 'credential', ref: 'ROUTE_KEY', header: 'x-api-key' })), { 'x-api-key': 'sk-1' });
  await auth.setKey(def, '');
  assert.equal(credentials.refs.has('ROUTE_KEY'), false);
});

test('token commands are cached until expiry and re-run after a rejection', async () => {
  let now = 1_000_000; const runs = [];
  const outputs = [JSON.stringify({ token: 't1', expiresAt: now + 120_000, headers: { 'x-account': 'a1' } }), JSON.stringify({ token: 't2' }), 'not json'];
  const auth = new ProviderAuth({ credentials: () => undefined, now: () => now, run: async (command, timeout) => { runs.push([command, timeout]); return outputs.shift(); } });
  const def = definition({ kind: 'command', command: ['token-cli', '--json'] });
  assert.deepEqual(await auth.headers(def), { 'x-account': 'a1', Authorization: 'Bearer t1' });
  assert.deepEqual(await auth.headers(def), { 'x-account': 'a1', Authorization: 'Bearer t1' });
  now += 70_000; // inside the refresh skew
  assert.deepEqual(await auth.headers(def), { Authorization: 'Bearer t2' });
  await assert.rejects(auth.headers(def, { retry: true }), error => error.code === 'AUTHENTICATION' && /did not print JSON/.test(error.message) && !/t2/.test(error.message));
  assert.deepEqual(runs, [[['token-cli', '--json'], 15000], [['token-cli', '--json'], 15000], [['token-cli', '--json'], 15000]]);
});

/** A token endpoint that records every form it receives. */
async function tokenServer(t, reply) {
  const forms = [];
  const server = createServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += chunk; });
    request.on('end', () => { const form = Object.fromEntries(new URLSearchParams(body)); forms.push(form); const [status, json] = reply(form, forms.length); response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(json)); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { forms, url: `http://127.0.0.1:${server.address().port}/oauth/token` };
}
const freePort = () => new Promise(resolve => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });

test('OAuth sign-in: PKCE authorize URL, loopback redirect, stored grant, claim headers, refresh, sign-out', async t => {
  const account = { 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_42' } };
  const tokens = await tokenServer(t, (form, count) => form.grant_type === 'authorization_code'
    ? [200, { access_token: jwt(account), refresh_token: 'r1', expires_in: 3600, id_token: jwt(account) }]
    : [200, { access_token: `access-${count}`, expires_in: 3600 }]);
  const port = await freePort();
  const credentials = fakeCredentials();
  let now = Date.now();
  const auth = new ProviderAuth({ credentials: () => credentials, now: () => now });
  const def = definition({ kind: 'oauth', authorizeURL: 'https://auth.example.com/oauth/authorize', tokenURL: tokens.url, clientId: 'app_1', scopes: ['openid', 'offline_access'],
    redirectPort: port, redirectPath: '/auth/callback', authorizeParams: { originator: 'studio' }, claimHeaders: { 'chatgpt-account-id': ['https://api.openai.com/auth', 'chatgpt_account_id'] } });
  await assert.rejects(auth.headers(def), /not signed in/);
  const { url } = await auth.startSignIn(def);
  const authorize = new URL(url);
  const params = Object.fromEntries(authorize.searchParams);
  assert.equal(authorize.origin + authorize.pathname, 'https://auth.example.com/oauth/authorize');
  assert.deepEqual({ ...params, state: '-', code_challenge: '-' }, { response_type: 'code', client_id: 'app_1', redirect_uri: `http://localhost:${port}/auth/callback`, state: '-',
    code_challenge: '-', code_challenge_method: 'S256', scope: 'openid offline_access', originator: 'studio' });
  assert.equal((await auth.state(def)).pending.url, url);
  // A redirect with the wrong state is refused and ends the attempt.
  const wrong = await fetch(`http://127.0.0.1:${port}/auth/callback?code=c&state=nope`);
  assert.equal(wrong.status, 400);
  await assert.rejects(auth.waitSignIn('route'), /did not match/);
  // A new attempt completes through the browser redirect.
  const second = new URL((await auth.startSignIn(def)).url);
  const done = await fetch(`http://127.0.0.1:${port}/auth/callback?code=the-code&state=${second.searchParams.get('state')}`);
  assert.equal(done.status, 200);
  assert.match(await done.text(), /Signed in/);
  await auth.waitSignIn('route');
  const exchange = tokens.forms[0];
  assert.equal(exchange.grant_type, 'authorization_code');
  assert.equal(exchange.code, 'the-code');
  assert.equal(createHash('sha256').update(exchange.code_verifier).digest('base64url'), second.searchParams.get('code_challenge'));
  assert.equal(credentials.records.get('studio-providers/route').kind, 'grant');
  assert.deepEqual(await auth.headers(def), { 'chatgpt-account-id': 'acct_42', Authorization: `Bearer ${jwt(account)}` });
  assert.equal((await auth.state(def)).signedIn, true);
  // Expired tokens refresh with the stored refresh token and keep it and the claims.
  now += 3600_000;
  assert.deepEqual(await auth.headers(def), { 'chatgpt-account-id': 'acct_42', Authorization: 'Bearer access-2' });
  assert.deepEqual(tokens.forms[1], { grant_type: 'refresh_token', refresh_token: 'r1', client_id: 'app_1' });
  assert.equal([...credentials.records.entries()].find(([key]) => key.startsWith('studio-provider-accounts/'))[1].payload.refresh, 'r1');
  await auth.signOut('route');
  assert.equal(credentials.records.has('studio-providers/route'), false);
  assert.equal((await auth.state(def)).signedIn, false);
});

test('a busy redirect port and failed refresh are reported without token values', async t => {
  const blocker = createServer(); await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  const tokens = await tokenServer(t, () => [400, { error: 'invalid_grant', error_description: 'refresh token revoked' }]);
  const credentials = fakeCredentials();
  const auth = new ProviderAuth({ credentials: () => credentials });
  const def = definition({ kind: 'oauth', authorizeURL: 'https://a.example/authorize', tokenURL: tokens.url, clientId: 'c', redirectPort: blocker.address().port });
  await assert.rejects(auth.startSignIn(def), /is in use/);
  credentials.records.set('studio-providers/route', { kind: 'grant', payload: { access: 'secret-access', refresh: 'secret-refresh', expiresAt: 1 } });
  await assert.rejects(auth.headers(def), error => error.code === 'AUTHENTICATION' && /invalid_grant: refresh token revoked/.test(error.message) && !/secret/.test(error.message));
  assert.equal(jwtClaims('not-a-jwt'), undefined);
});

test('the adapter retries once with a fresh token after 401', async t => {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push(request.headers.authorization);
    request.resume(); request.on('end', () => {
      if (seen.length === 1) { response.writeHead(401).end('{}'); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const tokens = ['first', 'second'];
  const auth = new ProviderAuth({ credentials: () => undefined, run: async () => JSON.stringify({ token: tokens.shift() }) });
  const adapter = new StudioProviderAdapter(fetch, auth);
  const def = { ...definition({ kind: 'command', command: ['token'] }), baseURL: `http://127.0.0.1:${server.address().port}/v1` };
  adapter.definitions = new Map([[def.id, def]]);
  const chunks = []; for await (const chunk of adapter.stream({ provider: 'route', model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) chunks.push(chunk);
  assert.deepEqual(seen, ['Bearer first', 'Bearer second']);
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } });
});
