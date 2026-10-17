import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChatgptUsage, fetchProviderUsage } from '../src/host/provider-usage.ts';
import { providerTemplate } from '../src/provider-templates.ts';
test('usage keeps validated windows, timestamps and plan, never response secrets', () => {
  const result = parseChatgptUsage({ plan_type: 'plus', token: 'secret', rate_limit: { primary_window: { used_percent: 42, reset_at: 2000 }, secondary_window: { used_percent: 0 } } }, 100);
  assert.deepEqual(result, { status: 'ready', checkedAt: 100, plan: 'plus', windows: [{ id: 'primary', usedPercent: 42, resetAt: 2000000 }, { id: 'secondary', usedPercent: 0 }] });
  for (const value of [null, {}, { rate_limit: { primary_window: { used_percent: -1 } } }, { rate_limit: { primary_window: { used_percent: Infinity } } }]) assert.equal(parseChatgptUsage(value).status, 'unavailable');
});
test('usage fetch is fixed-origin, authenticated, bounded and errors are sanitized', async () => {
  const definition = providerTemplate('chatgpt');
  const result = await fetchProviderUsage(definition, async () => ({ authorization: 'Bearer secret' }), async (url, init) => {
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage'); assert.equal(init.headers.authorization, 'Bearer secret'); assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    return new Response('server leaked secret', { status: 401 });
  });
  assert.equal(result.status, 'unavailable'); assert.ok(!JSON.stringify(result).includes('secret'));
  for (const changed of [providerTemplate('claude'), { ...definition, baseURL: 'https://other.example' }]) assert.equal((await fetchProviderUsage(changed, () => { throw Error('must not access token'); })).status, 'unsupported');
});
