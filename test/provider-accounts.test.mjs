import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderAuth } from '../src/host/provider-auth.ts';

const jwt = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const definition = { version: 1, id: 'accounts', name: 'Accounts', protocol: 'openai-chat', baseURL: 'https://example.test', models: [{ id: 'm' }], credential: { kind: 'oauth', authorizeURL: 'https://example.test/authorize', tokenURL: 'https://example.test/token', clientId: 'c', redirectPort: 0 } };
function store() {
  const records = new Map();
  // Mirror the public service's global document lock: nested writes deadlock.
  let tail = Promise.resolve();
  const locked = fn => { const next = tail.then(fn); tail = next.catch(() => {}); return next; };
  return { records, readRecord: async key => records.get(key),
    modifyRecord: (key, mutate) => locked(async () => { const next = await mutate(records.get(key)); if (next) records.set(key, next); return records.get(key); }),
    deleteRecord: key => locked(async () => { records.delete(key); }),
  };
}
async function login(auth, code) {
  const url = new URL((await auth.startSignIn(definition)).url);
  const callback = new URL(url.searchParams.get('redirect_uri'));
  callback.hostname = '127.0.0.1'; callback.searchParams.set('state', url.searchParams.get('state')); callback.searchParams.set('code', code);
  assert.equal((await fetch(callback)).status, 200);
  await auth.waitSignIn(definition.id);
}
const grant = id => ({ access: jwt({ sub: id, email: `${id}@example.test`, 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' }, private_claim: 'private-secret' }), refresh: `refresh-${id}`, expiresAt: Date.now() + 3600000 });

test('legacy migration is idempotent and exposes only safe metadata', async () => {
  const credentials = store(); const old = grant('one');
  credentials.records.set('studio-providers/accounts', { kind: 'grant', payload: old });
  const auth = new ProviderAuth({ credentials: () => credentials });
  const [first, second] = await Promise.all([auth.accounts(definition), auth.accounts(definition)]);
  assert.deepEqual(first, second); assert.equal(first.length, 1);
  assert.deepEqual(Object.keys(first[0]).sort(), ['email', 'expiresAt', 'id', 'isDefault', 'label', 'plan']);
  assert.equal(first[0].isDefault, true); assert.equal(first[0].email, 'one@example.test');
  assert.equal(JSON.stringify(first).includes('private-secret'), false);
  assert.equal(JSON.stringify(first).includes(old.refresh), false);
  assert.equal(JSON.stringify(first).includes(old.access), false);
  assert.equal(credentials.records.get('studio-providers/accounts').payload.access, undefined);
  assert.equal(credentials.records.size, 2);
  assert.equal((await auth.headers(definition)).Authorization, `Bearer ${old.access}`);
});

test('sign-in adds identities, updates the same identity, and selection/removal never falls back', async t => {
  const credentials = store();
  const auth = new ProviderAuth({ credentials: () => credentials, fetch: async (_url, init) => {
    const id = new URLSearchParams(init.body).get('code'); const value = grant(id);
    return Response.json({ access_token: value.access, refresh_token: value.refresh, expires_in: 3600 });
  } }); t.after(() => auth.dispose());
  await login(auth, 'one'); await login(auth, 'two'); await login(auth, 'two');
  let accounts = await auth.accounts(definition);
  assert.equal(accounts.length, 2); assert.equal(accounts.find(a => a.isDefault).email, 'one@example.test');
  const two = accounts.find(a => a.email === 'two@example.test');
  await auth.selectAccount(definition, two.id);
  assert.equal((await auth.accounts(definition)).find(a => a.isDefault).id, two.id);
  await auth.removeAccount(definition, two.id);
  assert.equal((await auth.accounts(definition)).some(a => a.isDefault), false);
  await assert.rejects(auth.headers(definition), /not signed in/);
  await assert.rejects(auth.headers(definition, { accountId: two.id }), /not signed in/);
  await assert.rejects(auth.selectAccount(definition, two.id), /not connected/);
  await auth.signOut(definition.id); assert.equal(credentials.records.size, 0);
});

test('retry refresh is pinned to explicit account and removal cannot resurrect in-flight refresh', async t => {
  const credentials = store(); const refreshes = []; let release; let entered;
  let gate; let started;
  const auth = new ProviderAuth({ credentials: () => credentials, fetch: async (_url, init) => {
    const form = new URLSearchParams(init.body);
    if (form.get('grant_type') === 'authorization_code') { const value = grant(form.get('code')); return Response.json({ access_token: value.access, refresh_token: value.refresh, expires_in: 3600 }); }
    refreshes.push(form.get('refresh_token')); entered?.(); if (gate) await gate;
    return Response.json({ access_token: 'refreshed', expires_in: 3600 });
  } }); t.after(() => auth.dispose());
  await login(auth, 'one'); await login(auth, 'two');
  const [one, two] = await auth.accounts(definition);
  await auth.headers(definition, { accountId: one.id });
  await auth.selectAccount(definition, two.id);
  await auth.headers(definition, { accountId: one.id, retry: true });
  assert.deepEqual(refreshes, ['refresh-one']);
  gate = new Promise(resolve => { release = resolve; }); started = new Promise(resolve => { entered = resolve; });
  const refreshing = auth.headers(definition, { accountId: one.id, retry: true });
  await started;
  const removing = auth.removeAccount(definition, one.id);
  release(); await refreshing; await removing;
  await assert.rejects(auth.headers(definition, { accountId: one.id, retry: true }), /not signed in/);
  assert.equal([...credentials.records.keys()].some(key => key.endsWith(one.id)), false);
  assert.equal((await auth.accounts(definition))[0].id, two.id);
});

test('Claude account response contributes safe email metadata', async t => {
  const credentials = store(); const auth = new ProviderAuth({ credentials: () => credentials, fetch: async () => Response.json({ access_token: 'opaque-token', account: { email_address: 'claude@example.test', uuid: 'claude-id', secret: 'never-display' } }) });
  t.after(() => auth.dispose()); await login(auth, 'claude');
  const accounts = await auth.accounts(definition);
  assert.equal(accounts[0].email, 'claude@example.test'); assert.equal(accounts[0].label, 'claude@example.test');
  assert.equal(JSON.stringify(accounts).includes('opaque-token'), false); assert.equal(JSON.stringify(accounts).includes('never-display'), false);
});
