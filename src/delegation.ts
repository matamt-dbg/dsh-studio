/** Studio presets delegate through one role-based tool instead of the generic subagent tools. */
export const ROLE_TOOL = 'subagent_role';
/** Earlier name of {@link ROLE_TOOL}; saved presets and applied snapshots are migrated on read. */
export const LEGACY_ROLE_TOOL = 'studio_role';
export const GENERIC_DELEGATION_TOOLS: readonly string[] = ['subagent', 'subagent_fork', 'list_subagent_models'];
import { ROLE_PLUGIN } from './package-name.ts';
export { ROLE_PLUGIN };
const SUBAGENT_PLUGIN = '@deepseek-ai/dsh-tool-subagent';

/** Tools no longer offered by the Studio Master; saved presets drop them instead of failing to apply. */
export const WITHDRAWN_TOOLS: readonly string[] = ['task_run'];

/** Normalize a saved tool list: withdrawn tools drop out, and any delegation request (legacy generic tools, the role tool, or saved roles) becomes the role tool alone. */
export function delegationTools(tools: readonly string[], hasRoles = false): string[] {
  const delegates = hasRoles || tools.some(name => name === ROLE_TOOL || name === LEGACY_ROLE_TOOL || GENERIC_DELEGATION_TOOLS.includes(name));
  const rest = tools.filter(name => name !== ROLE_TOOL && name !== LEGACY_ROLE_TOOL && !GENERIC_DELEGATION_TOOLS.includes(name) && !WITHDRAWN_TOOLS.includes(name));
  return delegates ? [...rest, ROLE_TOOL] : rest;
}

type Row = { name: string; group?: boolean; config?: unknown };
/** Drop generic subagent tool plugins and any baseline role tool so the preset's own role plugin is the only provider. */
export function withoutDelegationPlugins<T extends Row>(rows: T[]): T[] {
  return rows.filter(row => row.name !== SUBAGENT_PLUGIN && row.name !== ROLE_PLUGIN)
    .map(row => row.group && Array.isArray(row.config) ? { ...row, config: withoutDelegationPlugins(row.config as T[]) } : row);
}

/** Move a per-tool record entry from the legacy role tool name to the current one, keeping an existing current entry. */
export function renameLegacyRoleKey<T>(entries: Record<string, T> | undefined): Record<string, T> | undefined {
  if (!entries || !Object.hasOwn(entries, LEGACY_ROLE_TOOL)) return entries;
  const { [LEGACY_ROLE_TOOL]: legacy, ...rest } = entries;
  return Object.hasOwn(rest, ROLE_TOOL) ? rest : { ...rest, [ROLE_TOOL]: legacy as T };
}

/** Rename the legacy role tool inside one Studio policy config (tools, description overrides, execution defaults). */
export function migratePolicyConfig(config: Record<string, unknown>): Record<string, unknown> {
  const tools = Array.isArray(config.tools) ? config.tools as string[] : [];
  if (!tools.includes(LEGACY_ROLE_TOOL)) return config;
  const execution = config.execution as { defaults?: Record<string, unknown> } | undefined;
  return { ...config, tools: [...new Set(tools.map(name => name === LEGACY_ROLE_TOOL ? ROLE_TOOL : name))],
    ...(config.toolOverrides ? { toolOverrides: renameLegacyRoleKey(config.toolOverrides as Record<string, unknown>) } : {}),
    ...(execution?.defaults ? { execution: { ...execution, defaults: renameLegacyRoleKey(execution.defaults) } } : {}) };
}
