import { validateRoleModel } from './role-validation.ts';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-subagent';
import { executableRoles, parseRoles, type StudioRole } from '../role-settings.ts';
import { ROLE_TOOL } from '../delegation.ts';

export const name = 'studio-role';
export const inject = ['tools', 'subagents', 'llm'];
export interface Config { roles: StudioRole[] }
/** Implicit role used when a preset defines none: same model, reasoning and persona as the parent, new conversation. */
const PARENT_ROLE = { name: 'Subagent', role: 'subagent', model: 'inherit', reasoning: 'inherit', spawn: 'fresh', persona: '' } as const;
export function apply(ctx: Context, config: Config): void {
  const roles = executableRoles(parseRoles(config.roles));
  ctx.tools.register(defineTool({
    name: ROLE_TOOL,
    description: roles.length
      ? 'Discover saved specialist roles or delegate a task to one. Calls return a native child agent id; the child reports back through normal subagent delivery.'
      : 'Delegate a self-contained task to a subagent that starts with the same model and settings as you. Calls return a native child agent id; the child reports back through normal subagent delivery.',
    parameters: {
      action: { type: 'string', enum: ['list', 'call'], required: true, description: 'list discovers role identifiers and settings; call delegates a task.' },
      role: { type: 'string', description: roles.length ? 'Saved role identifier, required for call.' : 'Not needed; no specialist roles are defined, so every call starts a child matching the parent.' },
      task: { type: 'string', description: 'Self-contained task for the specialist, required for call. Fork roles also inherit the conversation.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.result }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.action === 'list') return { result: JSON.stringify({ roles: roles.map(({ persona: _persona, ...role }) => role) }) };
      if (args.action !== 'call') throw new Error('Unknown Studio role action');
      // Without saved roles the tool still replaces generic delegation: the child inherits everything from the parent.
      const role = roles.length ? roles.find(role => role.role === args.role) : PARENT_ROLE;
      if (!role) throw new Error('Unknown Studio role; use action=list to discover roles');
      if (typeof args.task !== 'string' || !args.task.trim()) throw new Error('Role call requires a task');
      if (!exec.agent) throw new Error('Studio role call requires a calling agent');
      exec.signal.throwIfAborted();
      await validateRoleModel(ctx.llm, role, exec.signal);
      const agentOptions: { provider?: string; model?: string; reasoningEffort?: ReturnType<typeof ReasoningEffortId> } = {};
      if (role.model !== 'inherit') {
        const slash = role.model.indexOf('/');
        agentOptions.provider = role.model.slice(0, slash);
        agentOptions.model = role.model.slice(slash + 1);
      }
      if (role.reasoning !== 'inherit') agentOptions.reasoningEffort = ReasoningEffortId(role.reasoning);
      const maxDepth = ctx.subagents.resolveMaxDepth();
      const spec = {
        provider: role.spawn === 'fork' ? 'fork' : 'spawn', label: role.name,
        request: { parent: exec.agent, prompt: [{ type: 'text' as const, text: args.task }],
          ...(Object.keys(agentOptions).length ? { agentOptions } : {}),
          ...(role.persona ? { persona: role.persona } : {}),
          ...(maxDepth === undefined ? {} : { maxDepth }),
        },
        signal: exec.signal,
      };
      // Both methods are public native APIs, but each exists in only one supported runtime:
      // 0.2.0-rc.2 has startContinuable, 0.2.1-alpha.2 unified it into startActivation. Type both as optional.
      type Start<T> = (input: T) => Promise<{ childId: string }>;
      const native = ctx.subagents as unknown as {
        startActivation?: Start<typeof spec & { delivery: 'parent' }>;
        startContinuable?: Start<typeof spec>;
      };
      const started = typeof native.startActivation === 'function'
        ? await native.startActivation({ ...spec, delivery: 'parent' })
        : native.startContinuable ? await native.startContinuable(spec)
          : (() => { throw new Error('This DSH runtime lacks a native child start API'); })();
      return { result: JSON.stringify({ kind: 'activation', subagentId: started.childId, role: role.role }) };
    },
  }));
}
