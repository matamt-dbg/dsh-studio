import { executableRoles, parseRoles, type StudioRole } from './role-settings.ts';

/** A role as it executes: the stored editor shape without legacy override data. */
export type ExecutableRole = Omit<StudioRole, 'overrides'>;
/**
 * Roles one root session owns. Each entry is a complete, independent role: a copy of a preset role
 * taken at its first edit, or a temporary role. Preset changes never reach it.
 */
export interface SessionRoles { version: 1; roles: ExecutableRole[] }
/** Where a merged role came from. A session copy of a preset role reports `session`. */
export type RoleSource = 'preset' | 'session';
export type MergedRole = ExecutableRole & { source: RoleSource };
/** The fields a session may change. Everything else is fixed at copy time. */
export type SessionRolePatch = Partial<Pick<StudioRole, 'model' | 'reasoning' | 'persona' | 'spawn'>>;
/** Input for a temporary role. Defaults to a new conversation and uses the preset tool filter. */
export type TemporaryRoleInput = Pick<StudioRole, 'name' | 'role'> & SessionRolePatch;

/** What the Subagents tab shows for one session. */
export interface SessionRolesView {
  /** False when the session's preset has no Studio role tool; saved roles are kept but unused. */
  available: boolean;
  /** The session whose roles apply. Differs from the asked session for a subagent child. */
  rootSessionId: string;
  /** A child follows its root and cannot edit. */
  readOnly: boolean;
  presetId?: string;
  roles: MergedRole[];
  /** Role ids the preset declares. A `session` role listed here is a copy that reverts to the preset when removed. */
  presetRoleIds: string[];
}

/** Implicit role used when no role is available: same model, reasoning and persona as the parent, new conversation. */
export const PARENT_ROLE = { name: 'Subagent', role: 'subagent', model: 'inherit', reasoning: 'inherit', spawn: 'fresh', persona: '' } as const satisfies ExecutableRole;

export const emptySessionRoles = (): SessionRoles => ({ version: 1, roles: [] });

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validated = (roles: unknown[]): ExecutableRole[] => executableRoles(parseRoles(roles));

export function parseSessionRoles(input: unknown): SessionRoles {
  if (!object(input) || input.version !== 1) throw new Error('Invalid session roles record');
  return { version: 1, roles: validated(input.roles as unknown[]) };
}

/** Preset order first, each replaced by its session copy; then roles only the session has. */
export function mergeRoles(preset: readonly ExecutableRole[], record: SessionRoles): MergedRole[] {
  const own = new Map(record.roles.map(role => [role.role, role]));
  const merged: MergedRole[] = preset.map(role => {
    const copy = own.get(role.role);
    return copy ? { ...copy, source: 'session' } : { ...role, source: 'preset' };
  });
  const presetIds = new Set(preset.map(role => role.role));
  for (const role of record.roles) if (!presetIds.has(role.role)) merged.push({ ...role, source: 'session' });
  return merged;
}

const pickPatch = (patch: SessionRolePatch): SessionRolePatch => {
  const picked: SessionRolePatch = {};
  for (const key of ['model', 'reasoning', 'persona'] as const) if (patch[key] !== undefined) picked[key] = patch[key];
  if (patch.spawn !== undefined) {
    if (patch.spawn !== 'fresh' && patch.spawn !== 'fork') throw new Error('Role spawn must be fresh or fork');
    picked.spawn = patch.spawn;
  }
  return picked;
};

/** Change a role for this session. The first edit copies the preset role whole. */
export function editSessionRole(record: SessionRoles, preset: readonly ExecutableRole[], roleId: string, patch: SessionRolePatch): SessionRoles {
  const index = record.roles.findIndex(role => role.role === roleId);
  const base = index >= 0 ? record.roles[index] : preset.find(role => role.role === roleId);
  if (!base) throw new Error(`Unknown role: ${roleId}`);
  const next = [...record.roles];
  const role = { ...base, ...pickPatch(patch) };
  if (index >= 0) next[index] = role; else next.push(role);
  return { version: 1, roles: validated(next) };
}

/** Add a role that exists only in this session. */
export function addSessionRole(record: SessionRoles, preset: readonly ExecutableRole[], input: TemporaryRoleInput): SessionRoles {
  const role = validated([{ model: 'inherit', reasoning: 'inherit', persona: '', spawn: 'fresh', ...pickPatch(input), name: input.name, role: input.role }])[0]!;
  if (preset.some(item => item.role === role.role) || record.roles.some(item => item.role === role.role)) throw new Error(`Role identifier already exists: ${role.role}`);
  return { version: 1, roles: validated([...record.roles, role]) };
}

/** Drop the session's role: a copy reverts to the current preset role, a temporary role disappears. */
export function removeSessionRole(record: SessionRoles, roleId: string): SessionRoles {
  if (!record.roles.some(role => role.role === roleId)) throw new Error(`${roleId} is not a session role`);
  return { version: 1, roles: record.roles.filter(role => role.role !== roleId) };
}

/** The role a call uses. With no roles at all, every call starts a child matching the parent. */
export function selectRole(merged: readonly MergedRole[], roleId: string | undefined): ExecutableRole | undefined {
  return merged.length ? merged.find(role => role.role === roleId) : PARENT_ROLE;
}
