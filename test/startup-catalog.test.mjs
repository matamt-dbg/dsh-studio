import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStartupCatalog } from '../src/preset-catalog.ts';
test('startup discovery snapshots registered schemas without acquiring scopes or assembling prompts', async () => {
  const tools = [{ name: 'custom', description: 'Custom tool', parameters: { type: 'object', properties: {} } }];
  const result = await readStartupCatalog({ tools: { schemas: () => tools }, agentPresets: { list: async () => [{ id: 'minimal' }, { id: 'broken' }], readDocument: async id => { if (id === 'broken') throw new Error('unavailable'); return { content: '- name: example' }; }, acquireScope() { throw new Error('must not mount'); } }, systemPrompt: { assemble() { throw new Error('must not assemble'); } } });
  tools[0].description = 'Changed after startup';
  assert.equal(result.tools[0].description, 'Custom tool');
  assert.equal(result.presets[0].declaration, '- name: example');
  assert.deepEqual(result.presets[0].tools, []);
  assert.match(result.presets[1].error, /unavailable/);
});
