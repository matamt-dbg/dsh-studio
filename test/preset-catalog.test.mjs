import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPresetCatalog, mergePresetTools } from '../src/preset-catalog.ts';
const tool = name => ({ name, description: name });
test('catalog combines global and every preset registration; leases dispose on failure', async () => {
  const disposed = [];
  const result = await readPresetCatalog({
    agentPresets: {
      async list() { return [{ id: 'standard' }, { id: 'ptc' }, { id: 'broken' }]; },
      async readDocument(id) { return { content: id }; },
      async acquireScope(id) { return { key: { id }, async [Symbol.asyncDispose]() { disposed.push(id); } }; },
    },
    tools: { schemas(scope) { return [tool(scope?.id ?? 'global')]; } },
    systemPrompt: { async assemble({ scope }) { if (scope.id === 'broken') throw Error('assembly failed'); return { sections: [{ name: scope.id, text: 'real default' }], tools: [tool('run_code')] }; } },
  });
  assert.deepEqual(disposed, ['standard', 'ptc', 'broken']);
  assert.deepEqual(result.tools.map(t => t.name), ['global', 'ptc', 'run_code', 'standard']);
  assert.match(result.presets[2].error, /assembly failed/);
  assert.equal(result.presets[0].sections[0].text, 'real default');
});
test('preset unions retain shared and manual tools when toggled off', () => {
  const presets = [{ id: 'standard', tools: [tool('read'), tool('bash')] }, { id: 'ptc', tools: [tool('read'), tool('run_code')] }];
  assert.deepEqual(mergePresetTools(['bash'], presets, ['standard', 'ptc']), ['bash', 'read', 'run_code']);
  assert.deepEqual(mergePresetTools(['bash'], presets, ['ptc']), ['bash', 'read', 'run_code']);
  assert.deepEqual(mergePresetTools(['bash'], presets, []), ['bash']);
  assert.deepEqual(mergePresetTools(['bash'], presets, ['ptc'], ['read']), ['bash', 'run_code']);
});
