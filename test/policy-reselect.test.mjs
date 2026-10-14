/** A session picks a Studio preset after its Agent was created under the default preset. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { createScope, bindScopeParent, scopeTarget } from '@deepseek-ai/dsh-scope';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import * as policyPlugin from '../src/host/preset-policy.ts';

const tool = name => ({ name, description: `${name} original`, parameters: { type: 'object', properties: {} },
  output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }, execute: async () => 'ok' });
const config = { tools: ['read'], toolOverrides: { read: { description: 'Studio read' } }, sections: {}, prompt: 'Studio rules' };

/** Mirrors agent-preset-registry: preset scopes, an Agent registry, and recompose = rebind + tools/change. */
async function runtime(policy = config) {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools);
  for (const name of ['read', 'write', 'todo_write', 'ask_user_question']) ctx.tools.register(tool(name));
  const live = [], owned = new Set();
  ctx.provide('agents'); ctx.set('agents', { list: () => [...live], roots: () => live.filter(agent => !owned.has(agent)) });
  const holder = ctx.inject(['tools', 'systemPrompt'], () => {});
  const presetScope = () => { const key = {}; return { key, scope: createScope(holder.ctx, key) }; };
  const standard = presetScope(), studio = presetScope();
  await studio.scope.ctx.plugin(policyPlugin, policy);
  // `filter` mirrors DSH applyChildComposition: a child joins the parent preset, then restrict(toolFilter).
  const createAgent = async (preset, { owner, filter } = {}) => {
    const agent = { id: `a${live.length}` };
    const scope = createScope(holder.ctx, agent);
    agent.ctx = scope.ctx; agent.binding = bindScopeParent(agent, preset.key);
    if (filter) agent.ctx.tools.restrict(filter);
    if (owner) owned.add(agent);
    live.push(agent);
    await ctx.serial(scopeTarget(agent, agent), 'agent/created', { agent, source: 'startup' }).catch(() => {});
    return agent;
  };
  const recompose = (agent, preset) => { agent.binding.rebind(preset.key); ctx.emit('tools/change'); };
  return { ctx, standard, studio, createAgent, recompose };
}

test('selecting a Studio preset after creation installs its policy; switching away releases it', async () => {
  const { ctx, standard, studio, createAgent, recompose } = await runtime();
  const agent = await createAgent(standard);
  assert.deepEqual(ctx.tools.schemas(agent).map(t => t.name).sort(), ['ask_user_question', 'read', 'todo_write', 'write']);

  recompose(agent, studio);
  assert.deepEqual(ctx.tools.schemas(agent).map(t => t.name), ['read']);
  assert.equal(ctx.tools.get('read', agent).description, 'Studio read');
  const denied = await ctx.tools.execute({ name: 'write', callId: 'c', arguments: {}, agent, signal: new AbortController().signal });
  assert.match(JSON.stringify(denied), /excluded by Studio|not found|unknown/i);

  recompose(agent, standard);
  assert.deepEqual(ctx.tools.schemas(agent).map(t => t.name).sort(), ['ask_user_question', 'read', 'todo_write', 'write']);
  assert.equal(ctx.tools.get('read', agent).description, 'read original');
});

test('an Agent created directly under the Studio preset gets the policy exactly once', async () => {
  const { ctx, studio, createAgent } = await runtime();
  const agent = await createAgent(studio);
  ctx.emit('tools/change');
  assert.deepEqual(ctx.tools.schemas(agent).map(t => t.name), ['read']);
  assert.equal(ctx.tools.get('read', agent).description, 'Studio read');
});

test('an Agent that joins but cannot take the policy fails closed', async () => {
  const { ctx, standard, studio, createAgent, recompose } = await runtime();
  const agent = await createAgent(standard);
  agent.ctx.tools.register(tool('own'));  // own-scope tools are rejected by installPolicy
  recompose(agent, studio);
  const result = await ctx.tools.execute({ name: 'read', callId: 'c', arguments: {}, agent, signal: new AbortController().signal });
  assert.match(JSON.stringify(result), /could not be installed/);
});

// Production: standard's tool-subagent leaves its own-scope `subagent` on the Agent and removes
// it asynchronously after the same tools/change that reparented the Agent.
test('a blocked Agent takes the policy once the previous preset releases its own-scope tool', async () => {
  const { ctx, standard, studio, createAgent, recompose } = await runtime();
  const agent = await createAgent(standard);
  const releaseSubagent = agent.ctx.tools.register(tool('subagent'));
  recompose(agent, studio);
  const blocked = await ctx.tools.execute({ name: 'read', callId: 'c', arguments: {}, agent, signal: new AbortController().signal });
  assert.match(JSON.stringify(blocked), /could not be installed/);

  releaseSubagent();  // unregistering emits tools/change
  assert.deepEqual(ctx.tools.schemas(agent).map(t => t.name), ['read']);
  assert.equal(ctx.tools.get('read', agent).description, 'Studio read');
  const allowed = await ctx.tools.execute({ name: 'read', callId: 'c', arguments: {}, agent, signal: new AbortController().signal });
  assert.doesNotMatch(JSON.stringify(allowed), /could not be installed|excluded/);
});

test('a preset subagent filter hides tools from children while the parent keeps them', async () => {
  const policy = { ...config, tools: ['read', 'ask_user_question'], toolOverrides: { read: { description: 'Studio read' }, ask_user_question: { description: 'Ask' } }, childToolFilter: { deny: ['ask_user_question'] } };
  const { ctx, studio, createAgent } = await runtime(policy);
  const parent = await createAgent(studio);
  assert.deepEqual(ctx.tools.schemas(parent).map(t => t.name).sort(), ['ask_user_question', 'read']);
  for (const spawn of ['fresh', 'fork']) {
    const child = await createAgent(studio, { owner: parent, filter: policy.childToolFilter });
    assert.deepEqual(ctx.tools.schemas(child).map(t => t.name), ['read'], spawn);
    assert.equal(ctx.tools.get('read', child).description, 'Studio read');
    const denied = await ctx.tools.execute({ name: 'ask_user_question', callId: 'c', arguments: {}, agent: child, signal: new AbortController().signal });
    assert.match(JSON.stringify(denied), /excluded by Studio|not found|unknown/i);
  }
  // A resumed child is a root again, but DSH re-applies its persisted filter: it still gets the child policy.
  const resumed = await createAgent(studio, { filter: policy.childToolFilter });
  assert.deepEqual(ctx.tools.schemas(resumed).map(t => t.name), ['read']);
});

test('each child hides only its own list and loses usage guidance that belonged to those tools', async () => {
  const policy = { ...config, tools: ['read', 'write', 'ask_user_question'], toolOverrides: {},
    sections: { 'tool:write': 'Edited write guidance' }, childToolFilter: { deny: ['ask_user_question', 'write'] } };
  const { ctx, studio, createAgent } = await runtime(policy);
  ctx.systemPrompt.section({ name: 'tool:write', order: ctx.systemPrompt.getSectionOrder('TOOL_WRITE'), text: 'Native write guidance' });
  const text = async agent => (await ctx.systemPrompt.assemble({ scope: agent })).sections.map(s => s.text).join('\n');
  const parent = await createAgent(studio);
  assert.match(await text(parent), /Edited write guidance/);
  const worker = await createAgent(studio, { owner: parent, filter: { deny: ['ask_user_question'] } });
  assert.deepEqual(ctx.tools.schemas(worker).map(t => t.name).sort(), ['read', 'write']);
  assert.match(await text(worker), /Edited write guidance/);
  const reviewer = await createAgent(studio, { owner: parent, filter: { deny: ['write'] } });
  assert.deepEqual(ctx.tools.schemas(reviewer).map(t => t.name).sort(), ['ask_user_question', 'read']);
  assert.doesNotMatch(await text(reviewer), /write guidance/);
  // The parent keeps its own guidance; only the reviewer's copy was blanked.
  assert.match(await text(parent), /Edited write guidance/);
});

test('an extend role child hides the default and its own tools; a replace role child only its own', async () => {
  const { roleToolFilter } = await import('../src/role-settings.ts');
  const presetDefault = ['ask_user_question'];
  const extend = roleToolFilter({ toolFilter: { mode: 'extend', deny: ['write'] } }, presetDefault);
  const replace = roleToolFilter({ toolFilter: { mode: 'replace', deny: ['write'] } }, presetDefault);
  assert.deepEqual(extend, ['ask_user_question', 'write']); assert.deepEqual(replace, ['write']);
  const policy = { ...config, tools: ['read', 'write', 'ask_user_question'], toolOverrides: {}, sections: { 'tool:write': 'Edited write guidance' },
    childToolFilter: { deny: [...new Set([...presetDefault, ...extend, ...replace])] } };
  const { ctx, studio, createAgent } = await runtime(policy);
  const parent = await createAgent(studio);
  const reviewer = await createAgent(studio, { owner: parent, filter: { deny: extend } });
  const other = await createAgent(studio, { owner: parent, filter: { deny: replace } });
  assert.deepEqual(ctx.tools.schemas(reviewer).map(t => t.name), ['read']);
  assert.deepEqual(ctx.tools.schemas(other).map(t => t.name).sort(), ['ask_user_question', 'read']);
  const text = async agent => (await ctx.systemPrompt.assemble({ scope: agent })).sections.map(s => s.text).join('\n');
  assert.doesNotMatch(await text(reviewer), /write guidance/);
  assert.match(await text(parent), /Edited write guidance/);
});

test('the guide example: worker uses the default, reviewer adds write, edit and bash', async () => {
  const { roleToolFilter } = await import('../src/role-settings.ts');
  const tools = ['read', 'write', 'edit', 'bash', 'ask_user_question'];
  const presetDefault = ['ask_user_question'];
  const worker = roleToolFilter(undefined, presetDefault);
  const reviewer = roleToolFilter({ toolFilter: { mode: 'extend', deny: ['write', 'edit', 'bash'] } }, presetDefault);
  const policy = { ...config, tools, toolOverrides: {}, prompt: 'Run tests with bash.', childToolFilter: { deny: [...new Set([...worker, ...reviewer])] } };
  const { ctx, studio, createAgent } = await runtime(policy);
  for (const name of ['edit', 'bash']) ctx.tools.register(tool(name));
  for (const [name, order] of [['tool:bash', 'TOOL_BASH'], ['tool:write', 'TOOL_WRITE'], ['tool:edit', 'TOOL_EDIT']]) ctx.systemPrompt.section({ name, order: ctx.systemPrompt.getSectionOrder(order), text: `${name} guidance` });
  const text = async agent => (await ctx.systemPrompt.assemble({ scope: agent })).sections.map(s => s.text).join('\n');
  const parent = await createAgent(studio);
  const w = await createAgent(studio, { owner: parent, filter: { deny: worker } });
  const r = await createAgent(studio, { owner: parent, filter: { deny: reviewer } });
  assert.deepEqual(ctx.tools.schemas(parent).map(t => t.name).sort(), [...tools].sort());
  assert.deepEqual(ctx.tools.schemas(w).map(t => t.name).sort(), ['bash', 'edit', 'read', 'write']);
  assert.deepEqual(ctx.tools.schemas(r).map(t => t.name), ['read']);
  for (const section of ['tool:bash', 'tool:write', 'tool:edit']) {
    assert.match(await text(parent), new RegExp(`${section} guidance`));
    assert.match(await text(w), new RegExp(`${section} guidance`));
    assert.doesNotMatch(await text(r), new RegExp(`${section} guidance`));
  }
  // Additional Studio instructions reach every subagent unchanged, even when they name a filtered tool.
  for (const agent of [parent, w, r]) assert.match(await text(agent), /Run tests with bash\./);
});
