import { Context } from '@deepseek-ai/cordis';
import { createScope } from '@deepseek-ai/dsh-scope';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';

/** Mock preset persistence with real scopes/tools/policy; not a Loader deployment test. */
export async function storeRuntime({ document = '- name: "@deepseek-ai/dsh-persona"\n  config: {complete: true}\n', base = 'minimal' } = {}) {
  const ctx = new Context();
  await ctx.plugin(Tools); await ctx.plugin(SystemPrompt);
  const registrations = new Map(), scopes = new Map(); let broken = false;
  const releases = new Map();
  for (const name of ['read', 'subagent_role']) releases.set(name, ctx.tools.register({ name, description: name,
    parameters: { type: 'object', properties: {} }, execute: async () => 'ok',
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] } }));
  ctx.provide('llm'); ctx.provide('agentPresets');
  ctx.set('llm', { listProviders: () => [], resolveCallConfig: async config => config });
  ctx.set('agentPresets', {
    list: async () => [{ id: base }, ...registrations.values()],
    readDocument: async () => ({ content: document }),
    register: async definition => {
      if (registrations.has(definition.id)) throw Error('duplicate');
      const key = {}, scope = createScope(ctx, key);
      registrations.set(definition.id, definition); scopes.set(definition.id, { key, scope });
      return async () => { registrations.delete(definition.id); scopes.delete(definition.id); await scope.dispose(); };
    },
    resolve: async id => ({ ...registrations.get(id), broken: broken ? 'activation failed' : undefined }),
    acquireScope: async id => ({ key: scopes.get(id)?.key ?? {}, [Symbol.asyncDispose]: async () => {} }),
  });
  const consumer = ctx.inject(['tools', 'systemPrompt', 'agentPresets', 'llm'], () => {});
  return { ctx: consumer.ctx, registrations, fail: () => { broken = true; }, removeTool: name => releases.get(name)?.() };
}
