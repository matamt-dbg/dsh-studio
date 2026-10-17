/** `subagent_role` through the real DSH tool runtime: session roles of the root session decide the child it starts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { apply, ROLE_PARAMETER_DESCRIPTION, ROLE_TOOL_DESCRIPTION } from '../src/host/role-tool.ts';
import { SessionRoleStore, sessionRolesRoot } from '../src/host/session-role-store.ts';
import { ROLE_TOOL } from '../src/delegation.ts';
import { addSessionRole, editSessionRole } from '../src/session-roles.ts';

const reviewer = { name: 'Reviewer', role: 'review', model: 'route/a', reasoning: 'high', spawn: 'fresh', persona: 'Preset persona' };

async function runtime(t, roles) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-role-session-'));
  const ctx = new Context();
  const starts = [];
  // Profile layout: <profile>/studio-data/presets.json is the Studio store; session roles sit beside it.
  ctx.provide('profileContext'); ctx.set('profileContext', { dir });
  for (const key of ['llm', 'subagents', 'sessions']) ctx.provide(key);
  ctx.set('llm', { listProviders: () => [{ id: 'route' }], resolveCallConfig: async config => config });
  ctx.set('subagents', { resolveMaxDepth: () => undefined, startActivation: async spec => { starts.push(spec); return { childId: `child-${starts.length}` }; } });
  const headers = new Map();
  ctx.set('sessions', { get: id => headers.has(id) ? { header: headers.get(id) } : undefined });
  const prompt = ctx.plugin(SystemPrompt); await prompt;
  const tools = ctx.plugin(ToolRuntime); await tools;
  const role = ctx.plugin({ name: 'studio-role', inject: ['tools', 'subagents', 'llm'], apply }, { roles }); await role;
  t.after(async () => { await role.dispose(); await tools.dispose(); await prompt.dispose(); });
  const store = new SessionRoleStore(sessionRolesRoot(join(dir, 'studio-data')));
  const agent = (id, header = {}) => { headers.set(id, header); return { id, session: { header } }; };
  let n = 0;
  const call = (agentValue, args) => ctx.tools.execute({ callId: ToolCallId(`c${n++}`), name: ROLE_TOOL, arguments: args, signal: new AbortController().signal, agent: agentValue });
  return { ctx, starts, store, agent, call };
}
const parsed = result => { assert.equal(result.isError, false, JSON.stringify(result.content)); return JSON.parse(result.value.result); };

test('the model-visible tool text does not depend on roles', async t => {
  for (const roles of [[], [reviewer]]) {
    const { ctx } = await runtime(t, roles);
    const schema = ctx.tools.schemas().find(item => item.name === ROLE_TOOL);
    assert.equal(schema.description, ROLE_TOOL_DESCRIPTION);
    assert.equal(schema.parameters.properties.role.description, ROLE_PARAMETER_DESCRIPTION);
  }
  assert.equal(ROLE_TOOL_DESCRIPTION, 'Delegate a self-contained task to a subagent. Use action=list to see the specialist roles; when none are listed, a call starts a child with the same model and settings as you. Calls return a native child agent id; the child reports back through normal subagent delivery.');
  assert.equal(ROLE_PARAMETER_DESCRIPTION, 'Role identifier from action=list; required for call when roles are listed.');
});

test('a session copy changes model, reasoning and persona of the next child; other sessions keep the preset', async t => {
  const h = await runtime(t, [reviewer]);
  const root = h.agent('root'), other = h.agent('other');
  parsed(await h.call(root, { action: 'call', role: 'review', task: 'before' }));
  await h.store.update('root', record => editSessionRole(record, [reviewer], 'review', { model: 'route/b', reasoning: 'low', persona: 'Session persona' }));
  const listed = parsed(await h.call(root, { action: 'list' }));
  assert.deepEqual(listed.roles, [{ name: 'Reviewer', role: 'review', model: 'route/b', reasoning: 'low', spawn: 'fresh', source: 'session' }]);
  parsed(await h.call(root, { action: 'call', role: 'review', task: 'after' }));
  parsed(await h.call(other, { action: 'call', role: 'review', task: 'other' }));
  assert.deepEqual(h.starts.map(s => [s.request.agentOptions, s.request.persona]), [
    [{ provider: 'route', model: 'a', reasoningEffort: 'high' }, 'Preset persona'],
    [{ provider: 'route', model: 'b', reasoningEffort: 'low' }, 'Session persona'],
    [{ provider: 'route', model: 'a', reasoningEffort: 'high' }, 'Preset persona'],
  ]);
});

test('children and grandchildren follow the root; a user fork does not', async t => {
  const h = await runtime(t, [reviewer]);
  h.agent('root');
  const child = h.agent('child', { origin: 'subagent', parentSession: 'root' });
  const grandchild = h.agent('grandchild', { origin: 'subagent', parentSession: 'child' });
  const fork = h.agent('fork', { parentSession: 'root' });
  await h.store.update('root', record => editSessionRole(record, [reviewer], 'review', { persona: 'Root persona' }));
  for (const caller of [child, grandchild, fork]) parsed(await h.call(caller, { action: 'call', role: 'review', task: 'x' }));
  assert.deepEqual(h.starts.map(s => s.request.persona), ['Root persona', 'Root persona', 'Preset persona']);
});

test('a temporary role is callable in a preset without roles, and an empty merge falls back to the parent', async t => {
  const h = await runtime(t, []);
  const root = h.agent('root');
  parsed(await h.call(root, { action: 'call', task: 'parent-like' }));
  assert.equal(h.starts[0].request.agentOptions, undefined);
  await h.store.update('root', record => addSessionRole(record, [], { name: 'Scout', role: 'scout', model: 'route/c', persona: 'Scout around' }));
  assert.deepEqual(parsed(await h.call(root, { action: 'list' })).roles.map(r => [r.role, r.source]), [['scout', 'session']]);
  assert.equal(parsed(await h.call(root, { action: 'call', role: 'scout', task: 'look' })).role, 'scout');
  assert.deepEqual([h.starts[1].provider, h.starts[1].request.agentOptions, h.starts[1].request.persona], ['spawn', { provider: 'route', model: 'c' }, 'Scout around']);
  const missing = await h.call(root, { action: 'call', role: 'nope', task: 'x' });
  assert.equal(missing.isError, true);
});

test('a session role whose provider disappeared is refused at call time', async t => {
  const h = await runtime(t, [reviewer]);
  const root = h.agent('root');
  await h.store.update('root', record => editSessionRole(record, [reviewer], 'review', { model: 'gone/model' }));
  const result = await h.call(root, { action: 'call', role: 'review', task: 'x' });
  assert.equal(result.isError, true);
  assert.match(result.content.map(block => block.text).join(''), /provider "gone" is not registered/);
  assert.equal(h.starts.length, 0);
});
