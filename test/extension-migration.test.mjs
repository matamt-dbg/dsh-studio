import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrationPlan } from '../src/extension-migration.ts';
import { classifyInstalled } from '../src/installed-plugins.ts';
import { fieldRoles, isSecretField, maskConfig, redactSecrets } from '../src/secret-fields.ts';

const EXA = '@deepseek-ai/dsh-web-search-exa';

test('secret fields: schema role first, name rule only without a role, credential-ref never masked', () => {
  const schema = { anyOf: [{ type: 'object', properties: { apiKey: { 'x-cordis': { role: 'secret' } }, apiKeyEnv: { 'x-cordis': { role: 'credential-ref' } }, model: {} } }, { $ref: '#/x' }] };
  const roles = fieldRoles(schema);
  assert.deepEqual(roles, { apiKey: 'secret', apiKeyEnv: 'credential-ref' });
  assert.equal(isSecretField('apiKeyEnv', roles), false);
  assert.equal(isSecretField('apiKey', {}), true);
  assert.equal(isSecretField('githubToken', {}), true);
  assert.equal(isSecretField('tokenLimit', {}), false);
  assert.deepEqual(maskConfig({ apiKey: 'sk-real', searchType: 'auto', password: '' }), { apiKey: { secret: true, set: true }, searchType: 'auto', password: { secret: true, set: false } });
  assert.equal(redactSecrets('bad key sk-real-value here', { value: { apiKey: 'sk-real-value' } }), 'bad key <secret> here');
});

test('migration plan lists profile-scoped additions with masked config, overrides and applied presets', () => {
  const extensions = [{ id: 'dsh-web-search-exa', name: EXA, config: { apiKey: 'raw' } }, { id: 'extra-agent', name: '@deepseek-ai/dsh-tool-subagent' }];
  const installed = classifyInstalled({ installed: { [EXA]: '1', '@deepseek-ai/dsh-tool-subagent': '1' }, pluginEntries: { [EXA]: [EXA], '@deepseek-ai/dsh-tool-subagent': ['@deepseek-ai/dsh-tool-subagent'] },
    masterNames: new Set(), addedNames: new Set([EXA, '@deepseek-ai/dsh-tool-subagent']), profileRows: [] });
  assert.equal(installed.find(p => p.entry === EXA).scope, 'profile', 'table wins over the Master addition');
  assert.equal(installed.find(p => p.entry === '@deepseek-ai/dsh-tool-subagent').state, 'in-master');
  const presets = [
    { id: 'a', name: 'A', overrides: { 'studio-added/dsh-web-search-exa': { apiKey: 'k1', searchType: 'neural' } }, appliedNames: [EXA] },
    { id: 'b', name: 'B', overrides: { 'studio-added/dsh-web-search-exa': { apiKey: 'k2' } }, appliedNames: [] },
    { id: 'c', name: 'C', overrides: {}, appliedNames: [] },
  ];
  const plan = migrationPlan({ extensions, installed, presets });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0], { id: 'dsh-web-search-exa', entry: EXA, config: { apiKey: { secret: true, set: true } },
    overrides: [{ preset: 'a', name: 'A', config: { apiKey: { secret: true, set: true }, searchType: 'neural' } }, { preset: 'b', name: 'B', config: { apiKey: { secret: true, set: true } } }],
    appliedIn: [{ preset: 'a', name: 'A' }] });
  assert.ok(!JSON.stringify(plan).includes('raw') && !JSON.stringify(plan).includes('k1'), 'no raw secret leaves the plan');
});

test('an unknown user addition stays in the Master and is not migrated', () => {
  const installed = classifyInstalled({ installed: { mine: '1' }, pluginEntries: { mine: ['mine'] }, masterNames: new Set(), addedNames: new Set(['mine']), profileRows: [] });
  assert.deepEqual({ scope: installed[0].scope, state: installed[0].state }, { scope: 'agent', state: 'in-master' });
  assert.deepEqual(migrationPlan({ extensions: [{ id: 'mine', name: 'mine' }], installed, presets: [] }), []);
});

test('review #1: nested and short secrets never leave the Host', async () => {
  const { maskConfig, redactSecrets, restoreMasked, WITHHELD, fieldRoles } = await import('../src/secret-fields.ts');
  const { configDiff, composeProfileConfig } = await import('../src/profile-config.ts');
  const config = { auth: { apiKey: 'sk-nested-1', user: 'me' }, servers: [{ token: 'tok-in-array' }], password: 'abc' };
  const masked = JSON.stringify(maskConfig(config));
  for (const secret of ['sk-nested-1', 'tok-in-array', 'abc']) assert.ok(!masked.includes(secret), secret);
  assert.match(masked, /"user":"me"/);
  const diff = configDiff({}, config);
  assert.ok(!JSON.stringify(diff).includes('sk-nested-1') && !JSON.stringify(diff).includes('tok-in-array'));
  // Saving the masked diff back keeps the real values instead of writing markers.
  const next = composeProfileConfig({ inherited: {}, current: config, diff, secrets: {} });
  assert.equal(next.auth.apiKey, 'sk-nested-1');
  assert.equal(next.servers[0].token, 'tok-in-array');
  assert.equal(next.password, 'abc', 'top-level secret kept');
  assert.deepEqual(restoreMasked({ apiKey: { secret: true, set: true } }, {}), {}, 'a marker with no current value is dropped');
  assert.equal(redactSecrets('bad sk-nested-1 here', { value: config }), 'bad <secret> here');
  assert.equal(redactSecrets('password abc rejected', { value: config }), WITHHELD, 'a short secret withholds the text');
  assert.equal(redactSecrets('unrelated', { value: config }), 'unrelated');
  const roles = fieldRoles({ anyOf: [{ type: 'object', properties: { auth: { type: 'object', properties: { key: { 'x-cordis': { role: 'secret' } } } } } }] });
  assert.equal(roles.key, 'secret', 'nested schema roles are found');
  assert.ok(!JSON.stringify(maskConfig({ auth: { key: 'deep-role' } }, roles)).includes('deep-role'));
});
