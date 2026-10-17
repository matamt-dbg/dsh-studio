import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { bindScopeParent, createScope, scopeTarget } from '@deepseek-ai/dsh-scope';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import { installRoleChildPolicies, RoleChildPolicies } from '../src/host/role-child-policy.ts';
import * as rolesPlugin from '../src/host/role-tool.ts';
import * as policyPlugin from '../src/host/preset-policy.ts';

const roles = [
  { name: 'Reviewer', role: 'review', model: 'inherit', reasoning: 'inherit', spawn: 'fresh', persona: 'Review persona', toolFilter: { mode: 'replace', deny: ['read'] } },
  { name: 'Writer', role: 'write', model: 'inherit', reasoning: 'inherit', spawn: 'fork', persona: 'Write persona', toolFilter: { mode: 'replace', deny: ['write'] } },
];
const policy = { tools: ['read', 'write', 'subagent_role'], toolOverrides: { read: { description: 'Edited read' }, write: { description: 'Edited write' } },
  sections: { 'tool:read': 'Read instructions', 'tool:write': 'Write instructions' }, prompt: 'Shared instructions', childToolFilter: { deny: ['read', 'write'] } };

async function runtime(t, ownerFirst = true) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-child-policy-'));
  const root = join(directory, 'studio-data', 'child-policies');
  const ctx = new Context(), live = [], scopes = new Map(), starts = [], executions = [];
  ctx.provide('profileContext', { dir: directory });
  ctx.provide('agents', { list: () => [...live] });
  ctx.provide('llm', {});
  let failStart = false;
  ctx.provide('subagents', {
    getProvider: name => ({ capabilities: { agentPreset: name === 'spawn', agentOptions: true } }),
    resolveMaxDepth: () => 2,
    startActivation: async spec => {
      starts.push(spec);
      if (failStart) throw new Error('Native creation refused');
      await createAgent(spec.childId, spec.request.parent.id);
      return { childId: spec.childId };
    },
  });
  await ctx.plugin(Tools); await ctx.plugin(SystemPrompt);
  for (const name of ['read', 'write']) ctx.tools.register({ name, description: name, parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => { executions.push(name); return 'ok'; } });
  const holder = ctx.inject(['tools', 'systemPrompt'], () => {});
  const presetKey = {}, preset = createScope(holder.ctx, presetKey);
  preset.ctx.systemPrompt.section({ name: 'deployment:persona-prefix', order: 0, text: 'Parent persona' });
  let owner;
  const installOwner = async () => {
    owner = ctx.plugin({ inject: ['tools', 'systemPrompt'], apply: inner => installRoleChildPolicies(inner, root) });
    await owner;
  };
  if (ownerFirst) await installOwner();
  await preset.ctx.plugin(rolesPlugin, { roles });
  await preset.ctx.plugin(policyPlugin, policy);
  if (!ownerFirst) await installOwner();
  async function createAgent(id, parentId, source = 'startup') {
    const agent = { id, session: { header: parentId ? { parentSession: parentId, origin: 'subagent' } : {} } };
    const scope = createScope(holder.ctx, agent); agent.ctx = scope.ctx;
    bindScopeParent(agent, presetKey);
    scopes.set(agent, scope); live.push(agent);
    try { await ctx.serial(scopeTarget(agent, agent), 'agent/created', { agent, source }); }
    catch (error) { await disposeAgent(agent); throw error; }
    return agent;
  }
  async function disposeAgent(agent) {
    live.splice(live.indexOf(agent), 1);
    await scopes.get(agent)?.dispose(); scopes.delete(agent);
    ctx.emit(scopeTarget(agent, agent), 'agent/disposed', { agent });
  }
  const parent = await createAgent('parent');
  let n = 0;
  const execute = (agent, name, args = {}) => ctx.tools.execute({ name, callId: `call-${n++}`, arguments: args, agent, signal: new AbortController().signal });
  async function call(role) {
    const result = await execute(parent, 'subagent_role', { action: 'call', role, task: 'Do the task' });
    assert.equal(result.isError, false, JSON.stringify(result));
    return live.find(agent => agent.id === JSON.parse(result.value.result).subagentId);
  }
  t.after(async () => { for (const agent of [...live]) await disposeAgent(agent); await preset.dispose(); await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); });
  return { ctx, root, parent, starts, executions, live, call, execute, createAgent, disposeAgent, owner,
    failStart: () => { failStart = true; }, text: async agent => renderPrompt(await ctx.systemPrompt.assemble({ scope: agent })) };
}

for (const ownerFirst of [true, false]) test(`rc.1 fresh/fork keep exact role policies despite tool overrides (owner first: ${ownerFirst})`, async t => {
  const h = await runtime(t, ownerFirst);
  const [reviewer, writer] = await Promise.all([h.call('review'), h.call('write')]);
  assert.notEqual(reviewer.id, writer.id);
  for (const [agent, denied, allowed, persona] of [[reviewer, 'read', 'write', 'Review persona'], [writer, 'write', 'read', 'Write persona']]) {
    assert.equal(h.ctx.tools.get(denied, agent), undefined);
    assert.equal(h.ctx.tools.get(allowed, agent).description, `Edited ${allowed}`);
    assert.equal((await h.execute(agent, denied)).isError, true);
    assert.equal((await h.execute(agent, allowed)).isError, false);
    assert.match(await h.text(agent), new RegExp(persona));
    assert.doesNotMatch(await h.text(agent), new RegExp(`${denied === 'read' ? 'Read' : 'Write'} instructions`));
  }
  assert.equal(h.ctx.tools.get('read', h.parent).description, 'Edited read');
  assert.match(await h.text(h.parent), /Parent persona/);
  for (const spec of h.starts) {
    assert.equal(spec.request.persona, undefined); assert.equal(spec.request.toolFilter, undefined);
    assert.match(spec.childId, /^studio-child-/);
  }
  // A later own-scope registration cannot execute the denied capability either.
  reviewer.ctx.tools.register({ ...h.ctx.tools.get('read', h.parent), execute: async () => { throw new Error('must not run'); } });
  assert.equal((await h.execute(reviewer, 'read')).isError, true);
});

test('a new policy owner restores a cold child from its immutable snapshot', async t => {
  const h = await runtime(t);
  const child = await h.call('review'), id = child.id;
  const snapshot = JSON.parse(await readFile(join(h.root, `${id}.json`), 'utf8'));
  assert.deepEqual(snapshot.deny, ['read']); assert.equal(snapshot.persona, 'Review persona');
  await h.disposeAgent(child);
  await h.owner.dispose();
  const replacement = h.ctx.plugin({ inject: ['tools', 'systemPrompt'], apply: inner => installRoleChildPolicies(inner, h.root) });
  await replacement;
  const restored = await h.createAgent(id, h.parent.id, 'resume');
  assert.equal(h.ctx.tools.get('read', restored), undefined);
  assert.equal((await h.execute(restored, 'read')).isError, true);
  assert.match(await h.text(restored), /Review persona/);
});

test('missing, malformed and wrong-parent snapshots reject restoration', async t => {
  const h = await runtime(t);
  for (const invalid of ['missing', 'malformed', 'wrong-parent']) {
    const child = await h.call('review'), id = child.id, file = join(h.root, `${id}.json`);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    await h.disposeAgent(child);
    if (invalid === 'missing') await rm(file);
    else await writeFile(file, invalid === 'malformed' ? '{' : JSON.stringify({ ...saved, parentId: 'someone-else' }));
    await assert.rejects(h.createAgent(id, h.parent.id, 'resume'), /Studio child policy/);
  }
});

test('unloading the policy owner never relaxes a live child restriction', async t => {
  const h = await runtime(t);
  const child = await h.call('review');
  await h.owner.dispose();
  assert.equal(h.ctx.tools.get('read', child), undefined);
  assert.equal((await h.execute(child, 'read')).isError, true);
  assert.equal((await h.execute(child, 'write')).isError, true);
  assert.match(await h.text(child), /Review persona/);
  const replacement = h.ctx.plugin({ inject: ['tools', 'systemPrompt'], apply: inner => installRoleChildPolicies(inner, h.root) });
  await replacement;
  assert.equal(h.ctx.tools.get('read', child), undefined);
  assert.equal((await h.execute(child, 'read')).isError, true);
  assert.equal((await h.execute(child, 'write')).isError, false, 'Reload must release the temporary pause on the same live child');
  assert.match(await h.text(child), /Review persona/);
});

test('native rejection before initialization cleans the unused reservation', async t => {
  const h = await runtime(t);
  h.failStart();
  const result = await h.execute(h.parent, 'subagent_role', { action: 'call', role: 'review', task: 'x' });
  assert.equal(result.isError, true);
  assert.deepEqual(await readdir(h.root), []);
});

test('policy snapshots copy the caller data and reject invalid restrictions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-policy-record-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const owner = new RoleChildPolicies(root), deny = ['read'];
  const prepared = await owner.prepare('parent', deny, 'Persona');
  deny.push('write');
  const saved = JSON.parse(await readFile(join(root, `${prepared.childId}.json`), 'utf8'));
  assert.deepEqual(saved.deny, ['read']);
  await assert.rejects(owner.prepare('../parent', []), /Invalid Studio child policy/);
  await assert.rejects(owner.prepare('parent', ['run_code']), /Invalid Studio child policy/);
  await prepared.abandon(); assert.deepEqual(await readdir(root), []);
});
