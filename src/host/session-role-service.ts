import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import { ROLE_PLUGIN } from '../package-name.ts';
import type { CompositionRow } from '../prompt-composition.ts';
import { executableRoles, parseRoles } from '../role-settings.ts';
import { addSessionRole, editSessionRole, mergeRoles, removeSessionRole, type ExecutableRole, type SessionRolePatch, type SessionRolesView, type TemporaryRoleInput } from '../session-roles.ts';
import { parseComposition } from './composition-plan.ts';
import { validateRoleModel } from './role-validation.ts';
import { SessionRoleStore, sessionRolesRoot } from './session-role-store.ts';
import { headerLookup, resolveRootSession, type SessionLineage } from './session-root.ts';

export type { SessionRolesView };
export type SessionRolesFrame = { type: 'sync' };

interface SessionControllerSlice {
  list(request: Record<string, never>, signal: AbortSignal): Promise<{ items: readonly { sessionId: string }[] }>;
}

/** How often records of deleted sessions are pruned while the Host runs. */
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
const json = <T>(payload: string): T => JSON.parse(payload) as T;
const rolesRow = (rows: CompositionRow[]): CompositionRow | undefined => {
  for (const row of rows) {
    if (row.disabled === true) continue;
    if (row.group && Array.isArray(row.config)) { const found = rolesRow(row.config as CompositionRow[]); if (found) return found; }
    else if (row.name === ROLE_PLUGIN) return row;
  }
  return undefined;
};

/**
 * Remote `studioSessionRoles`: roles one root session owns, edited from the Subagents tab.
 * Records follow the session: archived sessions keep them, deleted sessions lose them.
 */
export class SessionRoleService extends TypertRemoteService {
  static inject = ['agentPresets', 'sessionController'];
  private store: SessionRoleStore;
  constructor(ctx: Context, dataDir: string) {
    super(ctx, 'studioSessionRoles');
    this.store = new SessionRoleStore(sessionRolesRoot(dataDir));
    ctx.effect(() => {
      const lifetime = new AbortController();
      let running: Promise<unknown> = Promise.resolve();
      const prune = () => {
        running = this.store.prune(async () => (await this.controller().list({}, lifetime.signal)).items)
          .catch(error => { if (!lifetime.signal.aborted) ctx.logger?.warn?.(`studio session roles: prune skipped: ${String(error)}`); });
      };
      const first = setTimeout(prune, 0);
      const timer = setInterval(prune, PRUNE_INTERVAL_MS);
      return async () => { clearTimeout(first); clearInterval(timer); lifetime.abort(); await running; };
    });
  }

  private controller() { return this.ctx.get('sessionController') as unknown as SessionControllerSlice; }

  private header = headerLookup(this.ctx);

  /** The preset the session runs: the live binding when an agent is up, else the durable header. */
  private async presetOf(sessionId: string, header: SessionLineage | undefined): Promise<string | undefined> {
    const agent = this.ctx.get('agents')?.get(sessionId as never) as unknown as { ctx: Context } | undefined;
    return (agent ? this.ctx.get('agentPresets')?.composedPreset(agent.ctx) : undefined) ?? header?.agentPreset;
  }

  /** Roles the root's preset declares, or undefined when that preset has no Studio role tool. */
  private async presetRoles(presetId: string | undefined): Promise<ExecutableRole[] | undefined> {
    if (!presetId) return undefined;
    let rows: CompositionRow[];
    try { rows = parseComposition((await this.ctx.agentPresets.readDocument(presetId)).content); } catch { return undefined; }
    const row = rolesRow(rows);
    if (!row) return undefined;
    return executableRoles(parseRoles((row.config as { roles?: unknown } | undefined)?.roles ?? []));
  }

  private async resolve(sessionId: string) {
    const header = await this.header(sessionId);
    const rootSessionId = await resolveRootSession(sessionId, id => this.header(id), header);
    const presetId = await this.presetOf(rootSessionId, rootSessionId === sessionId ? header : await this.header(rootSessionId));
    return { rootSessionId, presetId, preset: await this.presetRoles(presetId) };
  }

  private async editable(sessionId: string) {
    const resolved = await this.resolve(sessionId);
    if (resolved.rootSessionId !== sessionId) throw new Error('[session-roles/read-only] A subagent session follows its root session; edit roles there.');
    if (!resolved.preset) throw new Error('[session-roles/unavailable] This session has no Studio role tool.');
    return resolved.preset;
  }

  private async validate(record: { roles: ExecutableRole[] }, roleId: string) {
    const role = record.roles.find(item => item.role === roleId);
    if (role) await validateRoleModel(this.ctx.get('llm'), role);
  }

  @Remote
  async view(sessionId: string): Promise<SessionRolesView> {
    const { rootSessionId, presetId, preset } = await this.resolve(sessionId);
    const record = await this.store.read(rootSessionId);
    return { available: !!preset, rootSessionId, readOnly: rootSessionId !== sessionId, ...(presetId ? { presetId } : {}),
      roles: mergeRoles(preset ?? [], record), presetRoleIds: (preset ?? []).map(role => role.role) };
  }

  /** Payload `{ role, model?, reasoning?, persona?, spawn? }`. The first edit copies the preset role. */
  @Remote
  async editRole(sessionId: string, payload: string): Promise<SessionRolesView> {
    const { role, ...patch } = json<{ role: string } & SessionRolePatch>(payload);
    const preset = await this.editable(sessionId);
    await this.store.update(sessionId, async record => {
      const next = editSessionRole(record, preset, role, patch);
      await this.validate(next, role);
      return next;
    });
    return this.view(sessionId);
  }

  /** Payload `{ name, role, model?, reasoning?, persona?, spawn? }`. */
  @Remote
  async addRole(sessionId: string, payload: string): Promise<SessionRolesView> {
    const input = json<TemporaryRoleInput>(payload);
    const preset = await this.editable(sessionId);
    await this.store.update(sessionId, async record => {
      const next = addSessionRole(record, preset, input);
      await this.validate(next, input.role);
      return next;
    });
    return this.view(sessionId);
  }

  /** Revert a copied role to the preset, or delete a temporary role. */
  @Remote
  async removeRole(sessionId: string, roleId: string): Promise<SessionRolesView> {
    const resolved = await this.resolve(sessionId);
    if (resolved.rootSessionId !== sessionId) throw new Error('[session-roles/read-only] A subagent session follows its root session; edit roles there.');
    await this.store.update(sessionId, record => removeSessionRole(record, roleId));
    return this.view(sessionId);
  }

  /** `sync` first and after each committed change of the root's roles; the tab refetches `view`. */
  @Remote({ mode: 'stream' })
  async *follow(sessionId: string, signal: AbortSignal): AsyncIterable<SessionRolesFrame> {
    const { rootSessionId } = await this.resolve(sessionId);
    let pending = 1;
    let wake: (() => void) | undefined;
    const stop = this.store.subscribe(rootSessionId, () => { pending++; wake?.(); });
    const onAbort = () => wake?.();
    signal.addEventListener('abort', onAbort);
    try {
      while (!signal.aborted) {
        if (pending) { pending = 0; yield { type: 'sync' }; continue; }
        await new Promise<void>(resolve => { wake = resolve; });
        wake = undefined;
      }
    } finally { stop(); signal.removeEventListener('abort', onAbort); }
  }
}
