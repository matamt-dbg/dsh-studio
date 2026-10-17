import { validateRoleModel } from './role-validation.ts';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { dirname } from 'node:path';

import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-subagent';
import { executableRoles, parseRoles, roleToolFilter, type StudioRole } from '../role-settings.ts';
import { emptySessionRoles, mergeRoles, selectRole, type SessionRoles } from '../session-roles.ts';
import { ROLE_TOOL } from '../delegation.ts';
import { studioStorePath } from './preset-store.ts';
import { readSessionRoles, sessionRolesRoot } from './session-role-store.ts';
import { headerLookup, resolveRootSession, type SessionLineage } from './session-root.ts';
import type { PreparedRoleChild } from './role-child-policy-contract.ts';

export const name = 'studio-role';
export const inject = ['tools', 'subagents', 'llm'];
export interface Config { roles: StudioRole[]; toolFilter?: { deny: string[] } }
/** The calling agent as the tool sees it: its session header decides whose session roles apply. */
interface CallingAgent { id?: string; session?: { header?: SessionLineage } }

/** Model-visible text. It does not depend on the preset or the session, so a session role never changes the schema. */
export const ROLE_TOOL_DESCRIPTION = 'Delegate a self-contained task to a subagent. Use action=list to see the specialist roles; when none are listed, a call starts a child with the same model and settings as you. Calls return a native child agent id; the child reports back through normal subagent delivery.';
export const ROLE_PARAMETER_DESCRIPTION = 'Role identifier from action=list; required for call when roles are listed.';

/** `<profile>/studio-data/session-roles`, or undefined where no profile is known (session roles then never apply). */
function sessionRolesDirectory(ctx: Context): string | undefined {
  try { return sessionRolesRoot(dirname(studioStorePath(process.env, ctx.get?.('profileContext') as { dir: string } | undefined))); }
  catch { return undefined; }
}

export function apply(ctx: Context, config: Config): void {
  const roles = executableRoles(parseRoles(config.roles));
  const deny = config.toolFilter?.deny;
  if (deny !== undefined && (!Array.isArray(deny) || deny.some(name => typeof name !== 'string' || !name))) throw new Error('Invalid subagent tool filter');
  const presetDefault = deny ?? [];
  const directory = sessionRolesDirectory(ctx);
  /** Read per call so an edit applies to the next call. Children follow their root session. */
  async function sessionRoles(agent: CallingAgent | undefined, signal: AbortSignal): Promise<SessionRoles> {
    if (!directory || !agent?.id) return emptySessionRoles();
    const root = await resolveRootSession(agent.id, headerLookup(ctx, signal), agent.session?.header);
    signal.throwIfAborted();
    return readSessionRoles(directory, root);
  }
  ctx.tools.register(defineTool({
    name: ROLE_TOOL,
    description: ROLE_TOOL_DESCRIPTION,
    parameters: {
      action: { type: 'string', enum: ['list', 'call'], required: true, description: 'list discovers role identifiers and settings; call delegates a task.' },
      role: { type: 'string', description: ROLE_PARAMETER_DESCRIPTION },
      task: { type: 'string', description: 'Self-contained task for the specialist, required for call. Fork roles also inherit the conversation.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.result }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.action !== 'list' && args.action !== 'call') throw new Error('Unknown Studio role action');
      const merged = mergeRoles(roles, await sessionRoles(exec.agent as CallingAgent | undefined, exec.signal));
      if (args.action === 'list') return { result: JSON.stringify({ roles: merged.map(({ persona: _persona, ...role }) => role) }) };
      // Without any role the tool still replaces generic delegation: the child inherits everything from the parent.
      const role = selectRole(merged, args.role);
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
      // A role's list extends or replaces the preset default; roles without one use the default.
      const hidden = roleToolFilter(role, presetDefault);
      const toolFilter = hidden.length ? { deny: hidden } : undefined;
      const provider = role.spawn === 'fork' ? 'fork' : 'spawn';
      // rc.1 replaces native persona/toolFilter with preset selection, which fork cannot use.
      // The public provider capabilities distinguish that API from the two legacy runtimes.
      const backend = ctx.subagents.getProvider?.(provider);
      const capabilities = backend?.capabilities as { persona?: boolean; toolFilter?: boolean; agentPreset?: boolean } | undefined;
      const needsPolicyOwner = capabilities !== undefined && 'agentPreset' in capabilities
        && (capabilities.persona !== true || capabilities.toolFilter !== true);
      let prepared: PreparedRoleChild | undefined;
      if (needsPolicyOwner) {
        const owner = ctx.get('studioChildPolicies');
        if (!owner) throw new Error('Studio child policy owner is unavailable; no child was started');
        prepared = await owner.prepare(exec.agent.id, hidden, role.persona || undefined);
      }
      const spec = {
        provider, label: role.name,
        ...(prepared ? { childId: prepared.childId } : {}),
        request: { parent: exec.agent, prompt: [{ type: 'text' as const, text: args.task }],
          ...(Object.keys(agentOptions).length ? { agentOptions } : {}),
          ...(!prepared && role.persona ? { persona: role.persona } : {}),
          ...(maxDepth === undefined ? {} : { maxDepth }),
          ...(!prepared && toolFilter ? { toolFilter } : {}),
        },
        signal: exec.signal,
      };
      // 0.2.0-rc.2 has startContinuable; alpha.2 and rc.1 use startActivation.
      // Their public capability declarations decide who owns per-child policy.
      type Start<T> = (input: T) => Promise<{ childId: string }>;
      const native = ctx.subagents as unknown as {
        startActivation?: Start<typeof spec & { delivery: 'parent' }>;
        startContinuable?: Start<typeof spec>;
      };
      try {
        exec.signal.throwIfAborted();
        const started = typeof native.startActivation === 'function'
          ? await native.startActivation({ ...spec, delivery: 'parent' })
          : native.startContinuable ? await native.startContinuable(spec)
            : (() => { throw new Error('This DSH runtime lacks a native child start API'); })();
        if (prepared && started.childId !== prepared.childId) throw new Error('DSH did not preserve the Studio child policy identity');
        return { result: JSON.stringify({ kind: 'activation', subagentId: started.childId, role: role.role }) };
      } catch (error) {
        await prepared?.abandon();
        throw error;
      }
    },
  }));
}
