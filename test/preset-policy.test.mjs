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
async function setup(mode = 'native') {
  const ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools, { mode });
  let parent, child; const parentKey = {}, key = {};
  await ctx.plugin(Object.assign(inner => { parent = createScope(inner, parentKey); child = createScope(inner, key, { parent: parentKey }); }, { inject: ['tools', 'systemPrompt'] }));
  return { ctx, parent, parentKey, child, key };
}
test('policy preserves executable definitions, patches only descriptions, restores and leaves late scoped tools to DSH', async () => {
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
    assert.equal(result.isError, false);
    dispose(); dispose();
    assert.equal(ctx.tools.get('read', key), original); assert.ok(ctx.tools.get('write', key));
  } finally { await child.dispose(); await parent.dispose(); }
});
test('invalid overrides fail without leaving restrictions; own-scope tools no longer block', async () => {
  const {ctx, parent, child, key} = await setup(); ctx.tools.register(tool('read')); ctx.tools.register(tool('write'));
  try {
    assert.throws(() => installPolicy(child.ctx, key, policy({ toolOverrides: { read: { parameters: { typo: 'x' } } } })), /Unknown parameter/);
    assert.throws(() => installPolicy(child.ctx, key, policy({ sections: { unknown: 'x' } })), /Unsupported/);
    parent.ctx.tools.register(tool('inherited'));
    const release = installPolicy(child.ctx, key, policy({}));
    assert.equal(ctx.tools.get('inherited', key), undefined);
    release();
    child.ctx.tools.register(tool('scoped'));
    const again = installPolicy(child.ctx, key, policy({}));
    assert.deepEqual(ctx.tools.schemas(key).map(t => t.name).sort(), ['read', 'scoped']);
    again();
    assert.ok(ctx.tools.get('write', key));
  } finally { await child.dispose(); await parent.dispose(); }
});
test('missing selected tools are reported and skipped, including overrides and execution defaults', async () => {
  const {ctx, parent, child, key} = await setup(); ctx.tools.register(tool('read')); ctx.tools.register(tool('write'));
  try {
    for (const patch of [{}, { toolOverrides: { missing: { description: 'x' } } }, { execution: { defaults: { missing: { timeoutMs: 100 } } } }]) {
      const warnings = [];
      const release = installPolicy(child.ctx, key, policy({ tools: ['read', 'missing'], ...patch }), message => warnings.push(message));
      assert.deepEqual(warnings, ['Studio policy selected tools unavailable: missing']);
      assert.deepEqual(ctx.tools.schemas(key).map(t => t.name), ['read']);
      release();
      assert.deepEqual(ctx.tools.schemas(key).map(t => t.name), ['read', 'write']);
    }
  } finally { await child.dispose(); await parent.dispose(); }
});
test('own selected tools and own shadows install unpatched and report overrides they cannot take', async () => {
  for (const inherited of [false, true]) {
    const {ctx, parent, child, key} = await setup();
    if (inherited) ctx.tools.register(tool('read'));
    const original = tool('read'); child.ctx.tools.register(original); ctx.tools.register(tool('write'));
    try {
      for (const [overrides, expected] of [[{}, []], [{ read: { description: 'Edited' } }, ['Studio policy cannot apply overrides to agent-scope tools: read']]]) {
        const warnings = [];
        const release = installPolicy(child.ctx, key, policy({ toolOverrides: overrides }), message => warnings.push(message));
        assert.deepEqual(warnings, expected);
        assert.equal(ctx.tools.get('read', key), original);
        assert.equal(ctx.tools.get('write', key), undefined);
        release();
        assert.ok(ctx.tools.get('write', key));
      }
    } finally { await child.dispose(); await parent.dispose(); }
  }
});
test('inherited selections are isolated from siblings and rollback after prompt registration fails', async () => {
  const {ctx, parent, parentKey, child, key} = await setup(); const siblingKey = {};
  const sibling = createScope(parent.ctx, siblingKey, { parent: parentKey });
  const original = tool('read'); parent.ctx.tools.register(original); ctx.tools.register(tool('write'));
  const conflict = child.ctx.systemPrompt.section({ name: 'studio:additional', order: 1, text: 'Existing' });
  try {
    assert.throws(() => installPolicy(child.ctx, key, policy({ toolOverrides: { read: { description: 'Edited' } }, sections: { 'tool:jobs': 'Partial' } })), /studio:additional/);
    assert.equal(ctx.tools.get('read', key), original);
    assert.ok(ctx.tools.get('write', key));
    assert.ok(!(await ctx.systemPrompt.assemble({ scope: key })).sections.some(s => s.text === 'Partial'));
    conflict();
    const release = installPolicy(child.ctx, key, policy({ toolOverrides: { read: { description: 'Edited' } } }));
    assert.deepEqual(ctx.tools.schemas(key).map(t => t.name), ['read']);
    assert.equal(ctx.tools.get('read', siblingKey), original); assert.ok(ctx.tools.get('write', siblingKey));
    release(); release();
    const result = await ctx.tools.execute({ name: 'write', callId: 'restored', arguments: { path: 'x' }, agent: key, signal: new AbortController().signal });
    assert.equal(result.isError, false);
  } finally { await sibling.dispose(); await child.dispose(); await parent.dispose(); }
});
test('PTC and reserved run_code selections fail explicitly without changing other scopes', async () => {
  for (const mode of ['ptc']) {
    const {ctx, parent, child, key} = await setup(mode); ctx.tools.register(tool('read'));
    try {
      const transport = ctx.tools.get('run_code', key);
      assert.ok(transport);
      assert.throws(() => installPolicy(child.ctx, key, policy({})), /does not support PTC presentation/);
      assert.equal(ctx.tools.get('run_code', key), transport);
      assert.ok(ctx.tools.get('read', key));
    } finally { await child.dispose(); await parent.dispose(); }
  }
  const {ctx, parent, child, key} = await setup();
  try {
    assert.throws(() => installPolicy(child.ctx, key, policy({ tools: ['run_code'] })), /reserved run_code/);
  } finally { await child.dispose(); await parent.dispose(); }
});
test('tools registered after installation follow DSH: new names appear and run, removals apply', async () => {
  const {ctx, parent, child, key} = await setup(); let calls = 0;
  ctx.tools.register(tool('read')); ctx.tools.register(tool('write'));
  try {
    const release = installPolicy(child.ctx, key, policy({}));
    assert.deepEqual(ctx.tools.schemas(key).map(t => t.name), ['read']);
    const input = name => ({ name, callId: name, arguments: { path: 'x' }, agent: key, signal: new AbortController().signal });
    // A provider enabled later in the preset scope (an ancestor) and one in the Agent's own scope.
    const lateInherited = parent.ctx.tools.register({ ...tool('schedule_list'), execute: async () => { calls++; return 'ok'; } });
    child.ctx.tools.register({ ...tool('own_late'), execute: async () => { calls++; return 'ok'; } });
    assert.deepEqual(ctx.tools.schemas(key).map(t => t.name).sort(), ['own_late', 'read', 'schedule_list']);
    assert.equal((await ctx.tools.execute(input('schedule_list'))).isError, false);
    assert.equal((await ctx.tools.execute(input('own_late'))).isError, false);
    assert.equal(calls, 2);
    lateInherited();
    assert.equal(ctx.tools.get('schedule_list', key), undefined);
    // Unrelated tools keep working after a provider goes away.
    assert.equal((await ctx.tools.execute(input('read'))).isError, false);
    // The unselected starting tool stays out of the starting surface.
    assert.equal(ctx.tools.get('write', key), undefined);
    release();
  } finally { await child.dispose(); await parent.dispose(); }
});
test('download bundle adds policy dependency and preset declaration without mutating compiled rows', () => {
  const plugins = load('- name: "@deepseek-ai/dsh-persona"\n  disabled: !!js process.platform === "win32"\n  config:\n    complete: false\n', { schema: entryListSchema });
  const {files} = createPresetBundle({ id: 'my-policy', title: 'My policy', plugins, policy: policy({}) });
  assert.equal(plugins.length, 1);
  assert.equal(JSON.parse(files['package.json']).dependencies['@matamt-dbg/dsh-studio'], '0.6.3');
  assert.match(files['cordis.patch.yml'], /!!js/);
  const config = load(files['cordis.patch.yml'], { schema: entryListSchema })[0].insert[0].config;
  assert.deepEqual(config.plugins[0].disabled, plugins[0].disabled);
  assert.equal(config.id, 'my-policy'); assert.equal(config.plugins.at(-1).name, '@matamt-dbg/dsh-studio/policy');
  assert.deepEqual(config.plugins.at(-1).config, policy({}));
  assert.throws(() => createPresetBundle({ id: '../bad', title: 'x', plugins, policy: policy({}) }), /preset id/);
});
