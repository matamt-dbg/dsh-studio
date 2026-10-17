import type { Context } from '@deepseek-ai/cordis';

export interface RoleChildPolicy {
  readonly version: 1;
  readonly childId: string;
  readonly parentId: string;
  readonly deny: readonly string[];
  readonly persona?: string;
}
export interface PolicyAgent {
  readonly id: string;
  readonly ctx: Context;
  readonly session: { readonly header: { readonly parentSession?: string; readonly origin?: string } };
}
export interface PreparedRoleChild {
  readonly childId: string;
  /** Remove an unused reservation; a child that reached initialization keeps its restart record. */
  abandon(): Promise<void>;
}
export interface RoleChildPolicyOwner {
  prepare(parentId: string, deny: readonly string[], persona?: string): Promise<PreparedRoleChild>;
  /** Apply once before Studio can register per-agent overrides; also used during cold resume. */
  forAgent(agent: PolicyAgent): RoleChildPolicy | undefined;
}
declare module '@deepseek-ai/cordis' {
  interface Context { studioChildPolicies: RoleChildPolicyOwner }
}

/** Reserved ids make a missing policy an error, rather than an unrestricted restored child. */
export function isStudioChild(id: unknown): id is string { return typeof id === 'string' && id.startsWith('studio-child-'); }

/** Called by preset reconciliation too: missing Host support must never silently drop a policy. */
export function roleChildPolicy(ctx: Context, agent: { id?: unknown }): RoleChildPolicy | undefined {
  if (!isStudioChild(agent.id)) return undefined;
  const owner = ctx.get('studioChildPolicies');
  if (!owner) throw new Error('Studio child policy owner is unavailable');
  return owner.forAgent(agent as PolicyAgent);
}
