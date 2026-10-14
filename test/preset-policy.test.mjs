import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { createScope } from '@deepseek-ai/dsh-scope';
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import { installPolicy } from '../src/host/preset-policy.ts';
import { createPresetBundle } from '../src/preset-export.ts';
import { load } from 'js-yaml';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
const tool = name => ({ name, description: 'Original', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'Original path' } } }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'ok' });
const policy = patch => ({ tools: ['read'], toolOverrides: {}, sections: {}, prompt: '', ...patch });
async function setup() {
  const ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools);
  let parent, child; const parentKey = {}, key = {};
  await ctx.plugin(Object.assign(inner => { parent = createScope(inner, parentKey); child = createScope(inner, key, { parent: parentKey }); }, { inject: ['tools', 'systemPrompt'] }));
  return { ctx, parent, child, key };
}
test('policy preserves executable definitions, patches only descriptions, restores and guards late scoped tools', async () => {
  const {ctx, parent, child, key} = await setup();
  const original = tool('read'); ctx.tools.register(original); ctx.tools.register(tool('write'));
  try {
    const dispose = installPolicy(child.ctx, key, policy({ toolOverrides: { read: { description: '', parameters: { path: 'Edited' } } }, sections: { 'tool:jobs': 'Jobs {{literal}}' }, prompt: 'Extra' }));
    const effective = ctx.tools.get('read', key);
    assert.equal(effective.execute, original.execute); assert.equal(effective.output, original.output);
    assert.equal(effective.description, ''); assert.equal(effective.parameters.properties.path.description, 'Edited');
    assert.deepEqual(effective.parameters.required, ['path']); assert.equal(original.parameters.properties.path.description, 'Original path');
    assert.deepEqual(ctx.tools.schemas(key).map(t => t.name), ['read']);
    assert.ok(renderPrompt(await ctx.systemPrompt.assemble({ scope: key })).endsWith('Extra'));
    child.ctx.tools.register(tool('late'));
    const result = await ctx.tools.execute({ name: 'late', callId: 'test', arguments: {}, agent: key, signal: new AbortController().signal });
    assert.match(JSON.stringify(result), /excluded by Studio/);
    dispose(); dispose();
    assert.equal(ctx.tools.get('read', key), original); assert.ok(ctx.tools.get('write', key));
  } finally { await child.dispose(); await parent.dispose(); }
});
test('invalid overrides and excess scoped tools fail without leaving restrictions', async () => {
  const {ctx, parent, child, key} = await setup(); ctx.tools.register(tool('read')); ctx.tools.register(tool('write'));
  try {
    assert.throws(() => installPolicy(child.ctx, key, policy({ toolOverrides: { read: { parameters: { typo: 'x' } } } })), /Unknown parameter/);
    assert.throws(() => installPolicy(child.ctx, key, policy({ sections: { unknown: 'x' } })), /Unsupported/);
    parent.ctx.tools.register(tool('inherited'));
    const release = installPolicy(child.ctx, key, policy({}));
    assert.equal(ctx.tools.get('inherited', key), undefined);
    release();
    child.ctx.tools.register(tool('scoped'));
    assert.throws(() => installPolicy(child.ctx, key, policy({})), /Unselected scoped tools/);
    assert.ok(ctx.tools.get('write', key));
  } finally { await child.dispose(); await parent.dispose(); }
});
test('a tool this host does not provide is skipped so the preset stays portable', async () => {
  const {ctx, parent, child, key} = await setup(); ctx.tools.register(tool('read'));
  const warnings = []; const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const release = installPolicy(child.ctx, key, policy({ tools: ['read', 'missing'] }));
    assert.deepEqual(ctx.tools.schemas(key).map(t => t.name), ['read']);
    assert.match(warnings.join('\n'), /missing/);
    release();
    assert.ok(ctx.tools.get('read', key));
  } finally { console.warn = originalWarn; await child.dispose(); await parent.dispose(); }
});
test('download bundle adds policy dependency and preset declaration without mutating compiled rows', () => {
  const plugins = load('- name: "@deepseek-ai/dsh-persona"\n  disabled: !!js process.platform === "win32"\n  config:\n    complete: false\n', { schema: entryListSchema });
  const {files} = createPresetBundle({ id: 'my-policy', title: 'My policy', plugins, policy: policy({}) });
  assert.equal(plugins.length, 1);
  assert.equal(JSON.parse(files['package.json']).dependencies['@matamt-dbg/dsh-studio'], '0.2.2');
  assert.match(files['cordis.patch.yml'], /!!js/);
  const config = load(files['cordis.patch.yml'], { schema: entryListSchema })[0].insert[0].config;
  assert.deepEqual(config.plugins[0].disabled, plugins[0].disabled);
  assert.equal(config.id, 'my-policy'); assert.equal(config.plugins.at(-1).name, '@matamt-dbg/dsh-studio/policy');
  assert.deepEqual(config.plugins.at(-1).config, policy({}));
  assert.throws(() => createPresetBundle({ id: '../bad', title: 'x', plugins, policy: policy({}) }), /preset id/);
});
