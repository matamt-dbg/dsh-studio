import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInstalled, masterRefusal, packageOf } from '../src/installed-plugins.ts';
import { declaredEntries, exportsPlugin } from '../src/host/installed-plugins.ts';

const EXA = '@deepseek-ai/dsh-web-search-exa';
const classify = (extra = {}) => classifyInstalled({
  installed: { [EXA]: '0.2.1-rc.2', 'my-tools': '1.0.0', 'lib-only': '2.0.0', '@deepseek-ai/dsh-llm-retry': '0.2.1-rc.2', ...extra.installed },
  pluginEntries: { [EXA]: [EXA], 'my-tools': ['my-tools', 'my-tools/extra'], 'lib-only': [], '@deepseek-ai/dsh-llm-retry': ['@deepseek-ai/dsh-llm-retry'], ...extra.pluginEntries },
  masterNames: new Set(extra.masterNames ?? []),
  profileRows: extra.profileRows ?? [],
});
const by = (list, entry) => list.find(item => item.entry === entry);

test('compatibility table classifies an installed, not-running provider as profile-scoped (S1 Exa)', () => {
  const exa = by(classify(), EXA);
  assert.deepEqual(exa, { package: EXA, entry: EXA, version: '0.2.1-rc.2', scope: 'profile', evidence: 'compatibility', state: 'installed' });
  assert.match(masterRefusal(exa), /Host service shared by every session/);
});

test('an unknown plugin stays unknown; libraries without a plugin export are dropped', () => {
  const list = classify();
  assert.equal(by(list, 'my-tools').scope, 'unknown');
  assert.equal(by(list, 'my-tools').evidence, 'none');
  assert.equal(by(list, 'my-tools/extra').package, 'my-tools');
  assert.equal(list.some(item => item.package === 'lib-only'), false);
  assert.equal(masterRefusal(by(list, 'my-tools')), undefined);
});

test('a row the profile runs is profile-scoped regardless of the table, with its state', () => {
  const rows = [{ moduleName: EXA, enabled: true, fiberPhase: 'active', patchId: 'web-search-exa' }, { moduleName: 'my-tools', enabled: false, fiberPhase: null, patchId: 'mine' }];
  const list = classify({ profileRows: rows });
  assert.deepEqual(by(list, EXA), { package: EXA, entry: EXA, version: '0.2.1-rc.2', scope: 'profile', evidence: 'profile-row', state: 'profile-active', patchId: 'web-search-exa' });
  assert.equal(by(list, 'my-tools').state, 'profile-inactive');
  assert.match(masterRefusal(by(list, EXA)), /already runs in the profile/);
});

test('profile row states: failed, unaddressable (duplicate or no patch id)', () => {
  const failed = classify({ profileRows: [{ moduleName: 'my-tools', enabled: true, fiberPhase: 'failed', patchId: 'm' }] });
  assert.equal(by(failed, 'my-tools').state, 'profile-failed');
  const dup = classify({ profileRows: [{ moduleName: 'my-tools', enabled: true, fiberPhase: 'active', patchId: 'a' }, { moduleName: 'my-tools', enabled: true, fiberPhase: 'active', patchId: 'b' }] });
  assert.equal(by(dup, 'my-tools').state, 'profile-unaddressable');
  assert.equal(by(dup, 'my-tools').patchId, undefined);
  const nested = classify({ profileRows: [{ moduleName: 'my-tools', enabled: true, fiberPhase: 'active', readOnlyReason: 'unaddressable' }] });
  assert.equal(by(nested, 'my-tools').state, 'profile-unaddressable');
});

test('a Master row is agent-scoped and wins over profile and table evidence', () => {
  const list = classify({ masterNames: ['my-tools'], profileRows: [{ moduleName: 'my-tools', enabled: true, fiberPhase: 'active', patchId: 'm' }] });
  assert.deepEqual({ scope: by(list, 'my-tools').scope, evidence: by(list, 'my-tools').evidence, state: by(list, 'my-tools').state }, { scope: 'agent', evidence: 'master', state: 'in-master' });
});

test('probe-passing Host plugins (llm-retry) are profile-scoped by the table, not by probe', () => {
  assert.equal(by(classify(), '@deepseek-ai/dsh-llm-retry').scope, 'profile');
});

test('entries the profile does not declare are ignored', () => {
  const list = classifyInstalled({ installed: {}, pluginEntries: { [EXA]: [EXA] }, masterNames: new Set(), profileRows: [] });
  assert.deepEqual(list, []);
});

test('package and entry helpers', () => {
  assert.equal(packageOf('@scope/pkg/sub/path'), '@scope/pkg');
  assert.equal(packageOf('pkg/sub'), 'pkg');
  assert.deepEqual(declaredEntries('p', {}), ['p']);
  assert.deepEqual(declaredEntries('p', { exports: { '.': './a.js', './tools': './t.js', './src/*': './src/*', './package.json': './package.json' } }), ['p', 'p/tools']);
  assert.deepEqual(declaredEntries('p', { exports: { import: './a.js' } }), ['p']);
  assert.equal(exportsPlugin({ apply() {} }), true);
  assert.equal(exportsPlugin({ default: class {} }), true);
  assert.equal(exportsPlugin({ helper: 1 }), false);
  assert.equal(exportsPlugin(undefined), false);
});
