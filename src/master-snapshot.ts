/**
 * Last good catalog snapshot and the cleanup a removal implies for saved presets.
 * Pure: the host owns persistence, the client renders the same {@link CatalogChange}.
 */
import type { CompositionRow } from './prompt-composition.ts';
import type { PluginCatalogEntry } from './plugin-catalog.ts';
import type { CatalogTool } from './preset-catalog.ts';
import { configEntries } from './config-overrides.ts';
import { ROLE_TOOL } from './delegation.ts';

/** Identity metadata only: never Config values, which may carry credentials. */
export interface CatalogSnapshot {
  version: 1;
  tools: Array<{ name: string; schema: string }>;
  configs: Array<{ id: string; name: string }>;
}
export interface CatalogChange {
  added: { tools: string[]; configs: string[] };
  removed: { tools: string[]; configs: string[] };
  /** Same name, different parameter schema: kept, but overrides are re-validated on the next apply. */
  changed: { tools: string[] };
  /** Saved preset data that confirming the removal deletes. */
  cleanup: PresetCleanup[];
}
export interface PresetCleanup { id: string; name: string; tools: string[]; configs: string[] }

/** Minimal saved-request slice the cleanup reads and rewrites. */
export interface CleanableRequest {
  tools: string[];
  toolOverrides?: Record<string, unknown>;
  execution?: { defaults: Record<string, unknown>; batch?: { tool: string } | undefined };
  subagentToolFilter?: { deny: string[] };
  configOverrides?: Record<string, unknown>;
  configExclusions?: string[];
}
export interface CleanablePreset { id: string; name: string; request: CleanableRequest; agents?: unknown }

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
/** Canonical JSON so key order never reads as a schema change. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/**
 * Build a snapshot only from a complete, successful collection. Returns undefined when any Config
 * entry failed to load: a partial view must never become the new baseline or drive deletions.
 */
export function catalogSnapshot(tools: readonly CatalogTool[], plugins: readonly PluginCatalogEntry[] | undefined, composition: CompositionRow[]): CatalogSnapshot | undefined {
  if (!plugins || plugins.some(entry => entry.error !== undefined)) return undefined;
  const ids = new Set(plugins.map(entry => entry.id));
  const configs = configEntries(composition).filter(entry => ids.has(entry.id)).map(entry => ({ id: entry.id, name: entry.row.name }));
  return { version: 1,
    tools: [...tools].map(tool => ({ name: tool.name, schema: canonical(tool.parameters ?? {}) })).sort((a, b) => a.name.localeCompare(b.name)),
    configs: configs.sort((a, b) => a.id.localeCompare(b.id)) };
}

/** Saved data that refers to removed names. Same name from a different package is treated as removed. */
export function presetCleanup(presets: readonly CleanablePreset[], removedTools: readonly string[], removedConfigs: readonly string[]): PresetCleanup[] {
  const tools = new Set(removedTools), configs = new Set(removedConfigs);
  return presets.flatMap(preset => {
    const request = preset.request;
    const touched = sorted([...request.tools, ...Object.keys(request.toolOverrides ?? {}), ...Object.keys(request.execution?.defaults ?? {}),
      ...(request.subagentToolFilter?.deny ?? []), ...roleDenies(preset.agents)].filter(name => tools.has(name) && name !== ROLE_TOOL));
    const touchedConfigs = sorted([...Object.keys(request.configOverrides ?? {}), ...(request.configExclusions ?? [])].filter(id => configs.has(id)));
    return touched.length || touchedConfigs.length ? [{ id: preset.id, name: preset.name, tools: touched, configs: touchedConfigs }] : [];
  });
}
function roleDenies(agents: unknown): string[] {
  return Array.isArray(agents) ? agents.flatMap(role => Array.isArray(role?.toolFilter?.deny) ? role.toolFilter.deny as string[] : []) : [];
}

/**
 * Compare a complete collection with the last confirmed baseline. Without a baseline there is
 * nothing to announce: the first good collection becomes the baseline.
 */
export function compareCatalog(previous: CatalogSnapshot | undefined, next: CatalogSnapshot, presets: readonly CleanablePreset[]): CatalogChange | undefined {
  if (!previous) return undefined;
  const before = new Map(previous.tools.map(tool => [tool.name, tool.schema]));
  const after = new Map(next.tools.map(tool => [tool.name, tool.schema]));
  const configKey = (entry: { id: string; name: string }) => `${entry.id}\n${entry.name}`;
  const beforeConfigs = new Set(previous.configs.map(configKey)), afterConfigs = new Set(next.configs.map(configKey));
  const change: CatalogChange = {
    added: { tools: sorted([...after.keys()].filter(name => !before.has(name))), configs: sorted(next.configs.filter(entry => !beforeConfigs.has(configKey(entry))).map(entry => entry.id)) },
    removed: { tools: sorted([...before.keys()].filter(name => !after.has(name))), configs: sorted(previous.configs.filter(entry => !afterConfigs.has(configKey(entry))).map(entry => entry.id)) },
    changed: { tools: sorted([...after.keys()].filter(name => before.has(name) && before.get(name) !== after.get(name))) },
    cleanup: [],
  };
  // A Config id that now points at another package is both removed and added; its old data is cleaned.
  if (![change.added, change.removed].some(side => side.tools.length || side.configs.length) && !change.changed.tools.length) return undefined;
  change.cleanup = presetCleanup(presets, change.removed.tools, change.removed.configs);
  return change;
}

/** Remove only the confirmed names; everything else, including unrelated overrides, is kept. */
export function cleanRequest<T extends CleanableRequest>(request: T, tools: readonly string[], configs: readonly string[]): T {
  const drop = new Set(tools), dropConfigs = new Set(configs);
  const keep = <V>(entries: Record<string, V> | undefined) => entries && Object.fromEntries(Object.entries(entries).filter(([name]) => !drop.has(name)));
  const next: T = { ...request, tools: request.tools.filter(name => !drop.has(name)) };
  if (request.toolOverrides) next.toolOverrides = keep(request.toolOverrides)!;
  if (request.execution) {
    const { batch, ...rest } = request.execution;
    next.execution = { ...rest, defaults: keep(request.execution.defaults)!, ...(batch && !drop.has(batch.tool) ? { batch } : {}) };
  }
  if (request.subagentToolFilter) {
    const deny = request.subagentToolFilter.deny.filter(name => !drop.has(name));
    if (deny.length) next.subagentToolFilter = { deny }; else delete next.subagentToolFilter;
  }
  if (request.configOverrides) next.configOverrides = Object.fromEntries(Object.entries(request.configOverrides).filter(([id]) => !dropConfigs.has(id)));
  if (request.configExclusions) {
    const left = request.configExclusions.filter(id => !dropConfigs.has(id));
    if (left.length) next.configExclusions = left; else delete next.configExclusions;
  }
  return next;
}
export function cleanRoles<T>(agents: T, tools: readonly string[]): T {
  if (!Array.isArray(agents)) return agents;
  const drop = new Set(tools);
  return agents.map(role => role?.toolFilter && Array.isArray(role.toolFilter.deny)
    ? { ...role, toolFilter: { ...role.toolFilter, deny: role.toolFilter.deny.filter((name: string) => !drop.has(name)) } } : role) as T;
}
