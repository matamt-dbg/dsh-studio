import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { createScope } from '@deepseek-ai/dsh-scope';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import { assemblePreview } from '../src/host/prompt-preview.ts';

test('preview uses real tools/prompt services and cleans temporary preset on rendering failure', async () => {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools);
  const calls = [];
  let broken = false;
  ctx.systemPrompt.section({ name: 'test:baseline', order: 0, text: () => broken ? '{{missing}}' : 'Baseline' });
  ctx.tools.register({ name: 'read', description: 'Read', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'ok' });
  const agentPresets = {
    async list() { return [{ id: 'minimal' }]; },
    async readDocument() { return { content: '- name: "@deepseek-ai/dsh-persona"\n  config:\n    prefix: Base\n' }; },
    async register(definition) { calls.push(['register', definition]); return async () => calls.push(['unregister']); },
    async acquireScope() {
      const key = {}; const scope = createScope(ctx, key);
      return { key, async [Symbol.asyncDispose]() { await scope.dispose(); calls.push(['lease-dispose']); } };
    },
  };
  ctx.provide('agentPresets'); ctx.set('agentPresets', agentPresets);
  const request = { preset: 'minimal', providers: [], tools: [], prompt: 'Literal {{value}}', model: '' };
  let previewCtx;
  await ctx.plugin(Object.assign(inner => { previewCtx = inner; }, { inject: ['tools', 'systemPrompt', 'agentPresets'] }));
  const result = await assemblePreview(previewCtx, request);
  assert.ok(result.prompt.includes('Baseline'));
  assert.ok(result.prompt.endsWith('Literal {{value}}'));
  assert.deepEqual(result.tools, []);
  assert.equal(calls.find(c => c[0] === 'register')[1].plugins.length, 0);
  assert.deepEqual(calls.slice(-2).map(c => c[0]), ['lease-dispose', 'unregister']);
  assert.ok(ctx.tools.get('read'));
  assert.ok(!(await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'studio:additional'));
  broken = true;
  await assert.rejects(assemblePreview(previewCtx, request), /missing/);
  assert.deepEqual(calls.slice(-2).map(c => c[0]), ['lease-dispose', 'unregister']);
  assert.ok(ctx.tools.get('read'));
});
