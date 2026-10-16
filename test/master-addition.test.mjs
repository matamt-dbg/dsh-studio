import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseComposition } from '../src/host/composition-plan.ts';
import { masterAddition } from '../src/host/shell.ts';
import { disabledHere, masterComposition, pluginOrigins, standardFallback, studioLayer } from '../src/host/master-composition.ts';
import { configEntries } from '../src/config-overrides.ts';

const standard = parseComposition(readFileSync(new URL('./fixtures/standard.patch.yml', import.meta.url), 'utf8'))[0].insert[0].config.plugins;
const names = rows => rows.flatMap(row => row.group ? names(row.config) : [row.name]);

test('platform gates are evaluated only in the process.platform form; anything else counts as off', () => {
  assert.equal(disabledHere({ name: 'a', disabled: { __jsExpr: "process.platform === 'win32'" } }, 'darwin'), false);
  assert.equal(disabledHere({ name: 'a', disabled: { __jsExpr: "process.platform !== 'win32'" } }, 'darwin'), true);
  assert.equal(disabledHere({ name: 'a', disabled: { __jsExpr: 'someFlag()' } }, 'darwin'), true);
  assert.equal(disabledHere({ name: 'a', disabled: true }), true);
  assert.equal(disabledHere({ name: 'a' }), false);
});

test('the Master follows the running standard: its rows, ids and groups, plus the Studio layer and role plugin', () => {
  const master = masterComposition(standard);
  // Standard ids stay addressable for Config overrides.
  for (const id of ['persona', 'tool-fs', 'compaction/compaction-basic', 'delegation/tool-subagent', 'planning/plan-mode']) assert.ok(configEntries(master).some(entry => entry.id === id), id);
  assert.ok(names(master).includes('@deepseek-ai/dsh-tool-schedule'), 'whatever standard declares is followed');
  assert.ok(!JSON.stringify(master).includes('__jsExpr'), 'platform gates are resolved, not carried');
  assert.equal(names(master).filter(name => name === '@deepseek-ai/dsh-tool-bash' || name === '@deepseek-ai/dsh-tool-pwsh').length, 1);
  assert.ok(master.find(row => row.id === 'delegation').config.some(row => row.id === 'studio-master-roles'), 'role plugin joins the delegation group');
  for (const row of studioLayer()) assert.ok(master.some(top => top.id === row.id), row.id);
  // A disabled standard row (plugin-manager tools) stays out; Studio adds its own copy.
  assert.equal(names(master).filter(name => name === '@deepseek-ai/dsh-plugin-manager/tools').length, 1);
  const origins = pluginOrigins(standard, masterComposition(standard, [{ id: 'mine', name: 'my-plugin' }]));
  assert.equal(origins.get('tool-fs'), 'standard'); assert.equal(origins.get('spill-policy'), 'studio');
  assert.equal(origins.get('delegation/studio-master-roles'), 'studio'); assert.equal(origins.get('studio-added/mine'), 'added');
});

test('the bundled standard copy is used when the running one cannot be read', () => {
  const master = masterComposition();
  assert.deepEqual(names(master).slice(0, 3), names(standardFallback()).slice(0, 3));
});

test('adding by package name gives a unique id and rejects invalid names', () => {
  assert.deepEqual(masterAddition('@scope/my-plugin', [{ id: 'my-plugin', name: 'x' }]), { id: 'my-plugin-2', name: '@scope/my-plugin' });
  assert.throws(() => masterAddition('../evil', []), /Invalid package name/);
});
