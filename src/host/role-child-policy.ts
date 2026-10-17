import type { Context } from '@deepseek-ai/cordis';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { scopeOf } from '@deepseek-ai/dsh-scope';
import type {} from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-tools';
import { isStudioChild, type RoleChildPolicy, type PolicyAgent, type PreparedRoleChild, type RoleChildPolicyOwner } from './role-child-policy-contract.ts';

const PREFIX = 'studio-child-';
const ID = /^studio-child-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SESSION_ID = /^[\w-]{1,200}$/;

interface PolicyInstallation {
  readonly agent: PolicyAgent;
  readonly policy: RoleChildPolicy;
  pause(): void;
  resume(): void;
}

function parsePolicy(value: unknown, childId: string): RoleChildPolicy {
  const record = value as Partial<RoleChildPolicy> | null;
  if (!record || typeof record !== 'object' || record.version !== 1 || record.childId !== childId
    || !ID.test(childId) || typeof record.parentId !== 'string' || !SESSION_ID.test(record.parentId)
    || !Array.isArray(record.deny) || record.deny.some(name => typeof name !== 'string' || !name || name === 'run_code')
    || new Set(record.deny).size !== record.deny.length
    || (record.persona !== undefined && typeof record.persona !== 'string')) throw new Error(`Invalid Studio child policy for ${childId}`);
  return Object.freeze({ version: 1, childId, parentId: record.parentId, deny: Object.freeze([...record.deny]),
    ...(record.persona === undefined ? {} : { persona: record.persona }) });
}

/**
 * Immutable call-time policies, separate from editable role definitions. Native rc.1 no longer
 * persists persona/toolFilter, so Studio reserves the id and commits its policy before starting.
 * Completed children retain their records for cold resume; only unused reservations are removed.
 */
export class RoleChildPolicies implements RoleChildPolicyOwner {
  private readonly active = new Map<PolicyAgent, PolicyInstallation>();
  private readonly pending = new Map<string, { claimed: boolean }>();
  private closed = false;
  constructor(private readonly root: string) {}

  async prepare(parentId: string, deny: readonly string[], persona?: string): Promise<PreparedRoleChild> {
    if (this.closed) throw new Error('Studio child policy owner is stopped');
    const childId = `${PREFIX}${randomUUID()}`;
    const policy = parsePolicy({ version: 1, childId, parentId, deny: [...new Set(deny)], ...(persona ? { persona } : {}) }, childId);
    await mkdir(this.root, { recursive: true });
    const file = join(this.root, `${childId}.json`), temporary = `${file}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(policy)); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
    const reservation = { claimed: false };
    this.pending.set(childId, reservation);
    const abandon = async () => {
      this.pending.delete(childId);
      if (!reservation.claimed) await rm(file, { force: true });
    };
    if (this.closed) { await abandon(); throw new Error('Studio child policy owner is stopped'); }
    return { childId, abandon };
  }

  forAgent(agent: PolicyAgent): RoleChildPolicy | undefined {
    if (!isStudioChild(agent.id)) return undefined;
    if (this.closed) throw new Error('Studio child policy owner is stopped');
    const existing = this.active.get(agent);
    if (existing) return existing.policy;
    if (!ID.test(agent.id)) throw new Error('Invalid Studio child id');
    let policy: RoleChildPolicy;
    try { policy = parsePolicy(JSON.parse(readFileSync(join(this.root, `${agent.id}.json`), 'utf8')), agent.id); }
    catch { throw new Error(`Studio child policy is missing or invalid for ${agent.id}; refusing unrestricted execution`); }
    if (agent.session.header.origin !== 'subagent' || agent.session.header.parentSession !== policy.parentId
      || scopeOf(agent.ctx) !== agent) throw new Error(`Studio child policy ownership mismatch for ${agent.id}`);
    // A public, Agent-owned service retains the installation across Host reload. Its exact id
    // avoids sharing policy between concurrent children; Agent disposal removes the service.
    const service = `studioChildPolicy:${agent.id}`;
    const retained = agent.ctx.get(service) as PolicyInstallation | undefined;
    if (retained) {
      if (retained.agent !== agent || JSON.stringify(retained.policy) !== JSON.stringify(policy)) {
        throw new Error(`Studio child policy changed during execution for ${agent.id}`);
      }
      this.active.set(agent, retained);
      retained.resume();
      return retained.policy;
    }
    let blockers: Array<() => void> = [];
    const installation: PolicyInstallation = {
      agent, policy,
      pause: () => {
        if (blockers.length) return;
        blockers = [
          agent.ctx.tools.guard(() => 'Studio child policy owner was unloaded; resume after Studio is available'),
          agent.ctx.on('agent/pre-step', async () => ({ kind: 'reject' })),
        ];
      },
      resume: () => { for (const release of blockers.splice(0).reverse()) release(); },
    };
    // tools/change can reconcile the preset synchronously. Publish the immutable policy first,
    // so that reconciliation excludes these names before registering any own-scope overrides.
    this.active.set(agent, installation);
    const reservation = this.pending.get(agent.id);
    if (reservation) { reservation.claimed = true; this.pending.delete(agent.id); }
    const releases: Array<() => void> = [];
    try {
      if (policy.deny.length) {
        releases.push(agent.ctx.tools.restrict({ deny: [...policy.deny] }));
        const denied = new Set(policy.deny);
        releases.push(agent.ctx.tools.guard(exec => denied.has(exec.name) ? `Tool ${exec.name} is excluded by the Studio role` : undefined));
      }
      if (policy.persona !== undefined) releases.push(agent.ctx.systemPrompt.section({
        name: 'deployment:persona-prefix', order: agent.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: policy.persona,
      }));
      releases.push(agent.ctx.provide(service, installation));
      // Registrations belong to the Agent, not to the Host manager. Unloading Studio must never
      // lift a live child's restrictions; the Agent's own disposal unwinds them.
      return policy;
    } catch (error) {
      for (const release of releases.reverse()) release();
      this.active.delete(agent);
      throw error;
    }
  }

  disposed(agent: PolicyAgent): void { this.active.delete(agent); }

  /** Stop live children before unloading the owner; existing scoped policy remains until disposal. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const installation of this.active.values()) installation.pause();
    this.active.clear();
  }
}

/** Install at Host scope so native fresh/fork creation AND resume wait for policy initialization. */
export function installRoleChildPolicies(ctx: Context, root: string): void {
  const owner = new RoleChildPolicies(root);
  ctx.provide('studioChildPolicies', owner);
  ctx.on('agent/created', ({ agent }) => { owner.forAgent(agent); return undefined; });
  ctx.on('agent/disposed', ({ agent }) => { owner.disposed(agent); });
  ctx.effect(() => () => owner.close());
  for (const agent of ctx.get('agents')?.list() ?? []) owner.forAgent(agent);
}
