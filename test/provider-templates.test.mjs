import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerTemplate, claudeSubscriptionHeaders } from '../src/provider-templates.ts';
import { parseProviderDefinition } from '../src/provider-contract.ts';
import { StudioProviders } from '../src/host/provider-adapter.ts';
import { ProviderAuth } from '../src/host/provider-auth.ts';

test('subscription templates validate; Claude identity is endpoint-scoped', () => {
  for (const id of ['chatgpt', 'claude']) assert.equal(parseProviderDefinition(providerTemplate(id)).ok, true);
  const claude = providerTemplate('claude');
  assert.match(claudeSubscriptionHeaders(claude)['user-agent'], /^claude-cli\//);
  assert.deepEqual(claudeSubscriptionHeaders({ ...claude, baseURL: 'https://other.example/v1' }), {});
  assert.deepEqual(claudeSubscriptionHeaders(providerTemplate('chatgpt')), {});
  assert.throws(() => providerTemplate('../escape'));
  assert.equal(parseProviderDefinition({ ...claude, credential: { ...claude.credential, tokenFormat: 'bad' } }).ok, false);
});

test('template creation never overwrites user files, even invalid ones', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-template-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = Object.create(StudioProviders.prototype);
  Object.assign(service, { directory, list: async () => ({ entries: [] }), reload: async () => ({ entries: [] }) });
  await service.addTemplate('chatgpt');
  const path = join(directory, 'studio-chatgpt.json');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).id, 'studio-chatgpt');
  await writeFile(path, 'user content');
  await assert.rejects(service.addTemplate('chatgpt'), { code: 'EEXIST' });
  assert.equal(await readFile(path, 'utf8'), 'user content');
});

test('Claude JSON OAuth uses an actual ephemeral redirect and echoes state; refresh stays JSON', async t => {
  const records = new Map(); const requests = [];
  const credentials = { readRecord: async key => records.get(key), modifyRecord: async (key, fn) => { records.set(key, await fn(records.get(key))); }, deleteRecord: async key => { records.delete(key); } };
  const auth = new ProviderAuth({ credentials: () => credentials, fetch: async (_, init) => {
    assert.equal(init.headers['content-type'], 'application/json');
    const body = JSON.parse(init.body); requests.push(body);
    return Response.json({ access_token: `secret-${requests.length}`, refresh_token: 'refresh', expires_in: 3600 });
  } });
  t.after(() => auth.dispose());
  const definition = providerTemplate('claude');
  const { url } = await auth.startSignIn(definition);
  const authorize = new URL(url); const redirect = new URL(authorize.searchParams.get('redirect_uri'));
  assert.notEqual(redirect.port, '0');
  redirect.hostname = '127.0.0.1';
  redirect.searchParams.set('state', authorize.searchParams.get('state')); redirect.searchParams.set('code', 'test-code');
  assert.equal((await fetch(redirect)).status, 200);
  await auth.waitSignIn(definition.id);
  assert.equal(requests[0].state, authorize.searchParams.get('state'));
  assert.equal(requests[0].redirect_uri, authorize.searchParams.get('redirect_uri'));
  assert.equal(requests[0].code_verifier.length > 30, true);
  await auth.headers(definition, { retry: true });
  assert.equal(requests[1].grant_type, 'refresh_token');
  assert.equal(requests[1].refresh_token, 'refresh');
  assert.equal(requests[1].scope, definition.credential.scopes.join(' '));
  assert.equal(JSON.stringify(await auth.state(definition)).includes('secret'), false);
});
