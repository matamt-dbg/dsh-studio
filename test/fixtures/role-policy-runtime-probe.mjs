// Diagnostic wrapper for a packaged Studio on an unmodified DSH runtime. Never shipped.
// It uses a local deterministic LLM adapter; no provider credentials or network model calls.
import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';

const route = 'studio-compat-local';
const parentMarker = 'STUDIO_COMPAT_PARENT_HISTORY';
const roles = [
  { name: 'Default', role: 'default', model: 'inherit', reasoning: 'inherit', spawn: 'fresh', persona: 'STUDIO_DEFAULT_PERSONA' },
  { name: 'Extend', role: 'extend', model: 'inherit', reasoning: 'inherit', spawn: 'fork', persona: 'STUDIO_EXTEND_PERSONA', toolFilter: { mode: 'extend', deny: ['write'] } },
  { name: 'Replace', role: 'replace', model: 'inherit', reasoning: 'inherit', spawn: 'fresh', persona: 'STUDIO_REPLACE_PERSONA', toolFilter: { mode: 'replace', deny: ['write'] } },
];
const expectedDeny = { default: ['read'], extend: ['read', 'write'], replace: ['write'] };

class LocalAdapter extends LlmAdapter {
  requests = new Map();
  counts = new Map();
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(options) {
    this.counts.set(options.sessionId, (this.counts.get(options.sessionId) ?? 0) + 1);
    this.requests.set(options.sessionId, {
      model: options.model, tools: options.tools?.map(tool => ({ name: tool.name, description: tool.description })) ?? [],
      messages: JSON.stringify(options.messages),
    });
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'Local compatibility check complete.' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Local compatibility check complete.' } };
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function until(predicate, description) {
  const deadline = Date.now() + 20000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

export async function runRolePolicyProbe(ctx, catalog) {
  const root = process.env.STUDIO_COMPAT_DIR;
  assert.ok(root && process.env.DSH_HOME?.startsWith(root), 'Only a disposable isolated DSH home is allowed');
  const phase = process.env.STUDIO_COMPAT_PHASE ?? 'create';
  const statePath = join(root, 'probe-state.json');
  const outputPath = join(root, `${phase}-result.json`);
  const adapter = new LocalAdapter(), observations = new Map(), errors = [];
  const releaseAdapter = ctx.llm.registerAdapter([route], adapter);
  let parent, parkParent = false;
  const off = ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (agent.id === parent?.agent.id && parkParent) return { kind: 'reject' };
    if (agent.id.startsWith('studio-child-')) {
      try {
        const policy = ctx.get('studioChildPolicies').forAgent(agent);
        const denied = [];
        for (const name of policy.deny) {
          assert.equal(ctx.tools.get(name, agent), undefined, `${name} must not be visible`);
          const result = await ctx.tools.execute({ name, callId: randomUUID(), arguments: {}, agent, signal: new AbortController().signal });
          assert.equal(result.isError, true, `${name} must not execute`);
          denied.push(name);
        }
        observations.set(agent.id, { denied, isSeeded: agent.session.header.isSeeded });
      } catch (error) { errors.push(String(error)); return { kind: 'reject' }; }
    }
    return next();
  });
  try {
    await catalog.listPresets();
    let state;
    if (phase === 'create') {
      const saved = await catalog.savePreset(JSON.stringify({ name: '__rc1_role_compatibility__', description: 'Disposable compatibility test',
        request: { preset: 'studio-master', providers: [], tools: ['read', 'write', 'subagent_role'], prompt: '', model: 'testLLM',
          toolOverrides: { read: { description: 'STUDIO_READ_OVERRIDE' }, write: { description: 'STUDIO_WRITE_OVERRIDE' } },
          subagentToolFilter: { deny: ['read'] } }, agents: roles }));
      assert.equal((await catalog.applyPreset(saved.id)).status, 'applied');
      state = { presetId: saved.id, parentId: `compat-parent-${randomUUID()}`, children: [] };
      parent = await ctx.agents.create({ sessionId: state.parentId, meta: { cwd: root, agentPreset: saved.id },
        agentOptions: { provider: route, model: 'local' }, setup: async childCtx => { await ctx.agentPresets.mount(childCtx, saved.id); } });
      parent.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: parentMarker }] }));
      await parent.agent.whenIdle();
      assert.ok(adapter.requests.has(state.parentId), 'The local parent turn must complete before forking');
      parkParent = true;
      const tool = ctx.tools.get('subagent_role', parent.agent);
      state.children = await Promise.all(roles.map(async role => {
        const result = await tool.execute({ action: 'call', role: role.role, task: `PROBE_${role.role}` },
          { agent: parent.agent, signal: AbortSignal.timeout(20000) });
        return { ...role, childId: JSON.parse(result.result).subagentId };
      }));
    } else {
      state = JSON.parse(await readFile(statePath, 'utf8'));
      // Later edits must affect future calls, never a previously created child's fixed policy.
      const saved = (await catalog.listPresets()).find(item => item.id === state.presetId);
      await catalog.savePreset(JSON.stringify({ ...saved, agents: roles.map(role => ({ ...role, persona: 'CHANGED_AFTER_CREATION', toolFilter: { mode: 'replace', deny: [] } })) }));
      assert.equal((await catalog.applyPreset(saved.id)).status, 'applied');
      parent = await ctx.agents.resume({ resumeSessionId: state.parentId, agentOptions: { provider: route, model: 'local' },
        setup: async childCtx => { await ctx.agentPresets.mount(childCtx, state.presetId); } });
      parkParent = true;
      for (const child of state.children) await ctx.subagents.sendMessage(parent.agent, child.childId,
        [{ type: 'text', text: `RESUME_${child.role}` }], { signal: AbortSignal.timeout(20000) });
    }
    await until(() => errors.length || state.children.every(child => adapter.requests.has(child.childId)), 'local child requests');
    assert.deepEqual(errors, []);
    const results = state.children.map(child => {
      const request = adapter.requests.get(child.childId), observation = observations.get(child.childId);
      assert.deepEqual(observation.denied, expectedDeny[child.role]);
      assert.equal(observation.isSeeded, child.spawn === 'fork');
      assert.ok(request.messages.includes(child.persona), 'Role persona must reach the actual model request');
      assert.equal(request.messages.includes(parentMarker), child.spawn === 'fork', 'Only fork inherits the parent conversation');
      assert.ok(!request.messages.includes('CHANGED_AFTER_CREATION'));
      for (const name of ['read', 'write']) {
        const actual = request.tools.find(tool => tool.name === name);
        if (expectedDeny[child.role].includes(name)) assert.equal(actual, undefined);
        else assert.equal(actual?.description, `STUDIO_${name.toUpperCase()}_OVERRIDE`);
      }
      return { role: child.role, spawn: child.spawn, childId: child.childId, denied: observation.denied, persona: true, history: observation.isSeeded, modelRequest: true };
    });
    assert.ok(ctx.tools.get('read', parent.agent)); assert.ok(ctx.tools.get('write', parent.agent));
    let missingPolicyRejected;
    if (phase === 'resume') {
      const child = state.children[0];
      await ctx.subagents.drainChildren(parent.agent, [child.childId]);
      const file = join(process.env.DSH_HOME, 'profiles', 'rc1-compat-fixed', 'studio-data', 'child-policies', `${child.childId}.json`);
      await rename(file, `${file}.backup`);
      const before = adapter.counts.get(child.childId);
      try {
        await assert.rejects(ctx.subagents.sendMessage(parent.agent, child.childId, [{ type: 'text', text: 'must fail closed' }],
          { signal: AbortSignal.timeout(20000) }), error => {
            assert.equal(error.code, 'NOT_RESUMABLE');
            assert.match(String(error.cause), /Studio child policy/);
            return true;
          });
        assert.equal(adapter.counts.get(child.childId), before, 'A missing snapshot must not reach the model');
        missingPolicyRejected = true;
      } finally { await rename(`${file}.backup`, file); }
      await ctx.subagents.sendMessage(parent.agent, child.childId, [{ type: 'text', text: 'policy restored' }], { signal: AbortSignal.timeout(20000) });
      await until(() => adapter.counts.get(child.childId) > before, 'resume after restoring the policy');
    }
    await parent.dispose(); parent = undefined;
    await writeFile(statePath, JSON.stringify(state, null, 2));
    await writeFile(outputPath, JSON.stringify({ phase, results, parentUnchanged: true, missingPolicyRejected, externalModelCalls: 0 }, null, 2));
  } catch (error) {
    await writeFile(outputPath, JSON.stringify({ phase, error: String(error), stack: error.stack, observations: [...observations], errors }, null, 2));
    throw error;
  } finally {
    await parent?.dispose(); off(); releaseAdapter();
  }
}
