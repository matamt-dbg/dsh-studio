import type { CompositionRow } from '../prompt-composition.ts';
import { BATCH_PLUGIN, JUDGE_PLUGIN, ROLE_PLUGIN } from '../package-name.ts';
const plugin = (id: string, config?: Record<string, unknown>, suffix = id): CompositionRow => ({ id, name: `@deepseek-ai/dsh-${suffix}`, ...(config ? { config } : {}) });

/** DSH preset the Studio Master follows. */
export const MASTER_BASE_PRESET = 'standard';
/** Group id holding plugins the user added to the Master (Config ids `studio-added/…`). */
export const USER_LAYER_ID = 'studio-added';
export type PluginOrigin = 'standard' | 'studio' | 'added';

/**
 * Plugins Studio adds on top of DSH standard, at top level with the ids earlier builds used so saved
 * Config overrides stay addressable. The role plugin is not here: it joins standard's delegation group.
 */
export function studioLayer(): CompositionRow[] {
  return [plugin('spill-policy'), { id: 'studio-batch', name: BATCH_PLUGIN }, { id: 'studio-judge', name: JUDGE_PLUGIN },
    plugin('tool-cordis'), plugin('tool-plugin-manager', undefined, 'plugin-manager/tools')];
}
const roleRow = (): CompositionRow => ({ id: 'studio-master-roles', name: ROLE_PLUGIN, config: { roles: [] } });

/**
 * Whether a declared row is off on this Host. Literal flags are read as-is; of `!!js` gates only the
 * `process.platform === / !== '<os>'` form DSH presets use is evaluated. Anything else counts as off,
 * so Studio never activates a row whose enablement it cannot decide.
 */
export function disabledHere(row: CompositionRow, platform: string = process.platform): boolean {
  const value = row.disabled;
  if (value === undefined || value === false) return false;
  const expression = value && typeof value === 'object' ? (value as { __jsExpr?: unknown }).__jsExpr : undefined;
  const match = typeof expression === 'string' ? /^process\.platform\s*(===|!==)\s*'([a-z0-9]+)'$/.exec(expression.trim()) : null;
  if (!match) return true;
  return match[1] === '===' ? platform === match[2] : platform !== match[2];
}
/** Drop rows that are off on this Host (and empty groups), so the Master carries no gate expressions. */
export function enabledRows(rows: CompositionRow[]): CompositionRow[] {
  return rows.flatMap(row => {
    if (disabledHere(row)) return [];
    const { disabled: _disabled, ...rest } = row;
    if (!row.group || !Array.isArray(row.config)) return [rest as CompositionRow];
    const config = enabledRows(row.config as CompositionRow[]);
    return config.length ? [{ ...rest, config } as CompositionRow] : [];
  });
}
const names = (rows: CompositionRow[]): string[] => rows.flatMap(row => row.group && Array.isArray(row.config) ? names(row.config as CompositionRow[]) : [row.name]);

/**
 * Studio Master = DSH standard as the running DSH declares it (or the bundled copy below when it
 * cannot be read) + the Studio layer + the user's additions. Standard rows keep their ids and
 * groups, so Config overrides and isolation follow DSH. A Studio row whose package standard already
 * provides is left out rather than loaded twice.
 */
export function masterComposition(standard: CompositionRow[] = standardFallback(), added: CompositionRow[] = []): CompositionRow[] {
  const base = enabledRows(structuredClone(standard));
  const present = new Set(names(base));
  let joined = false;
  const withRoles = base.map(row => {
    if (row.id !== 'delegation' || !row.group || !Array.isArray(row.config)) return row;
    joined = true;
    return { ...row, config: [...row.config as CompositionRow[], roleRow()] };
  });
  return [
    ...withRoles,
    ...studioLayer().filter(row => !present.has(row.name)),
    ...(joined ? [] : [roleRow()]),
    ...(added.length ? [{ id: USER_LAYER_ID, name: 'cordis:group', group: true, config: added }] : []),
  ];
}

/** Origin of each Config entry id in a {@link masterComposition} result. */
export function pluginOrigins(standard: CompositionRow[], composition: CompositionRow[]): Map<string, PluginOrigin> {
  const fromStandard = new Set<string>();
  const visit = (rows: CompositionRow[], parent = '') => {
    for (const row of rows) {
      const id = parent ? `${parent}/${row.id}` : String(row.id);
      if (row.group && Array.isArray(row.config)) visit(row.config as CompositionRow[], id); else fromStandard.add(id);
    }
  };
  visit(enabledRows(structuredClone(standard)));
  const origins = new Map<string, PluginOrigin>();
  const walk = (rows: CompositionRow[], parent = '') => {
    for (const row of rows) {
      const id = parent ? `${parent}/${row.id}` : String(row.id);
      if (row.group && Array.isArray(row.config)) walk(row.config as CompositionRow[], id);
      else origins.set(id, id.startsWith(`${USER_LAYER_ID}/`) ? 'added' : fromStandard.has(id) ? 'standard' : 'studio');
    }
  };
  walk(composition);
  return origins;
}

/** Bundled copy of DSH 0.2.x standard, used only when the running standard cannot be read. */
export function standardFallback(): CompositionRow[] {
  return [
    plugin('persona', { prefix: 'You are a coding agent powered by the {{model}} model.' }),
    plugin('agent-instructions', { maxBytes: 65536 }), plugin('time-context'),
    plugin(process.platform === 'win32' ? 'tool-pwsh' : 'tool-bash'),
    plugin('tool-fs'), plugin('tool-fs-search', { sampleOverCapGlobResults: false }),
    plugin('tool-jobs'), plugin('skill-filesystem'), plugin('tool-skill'),
    plugin('command-goal'), plugin('tool-goal'),
    { id: 'planning', name: 'cordis:group', group: true, isolate: { planMode: true }, config: [plugin('plan-mode')] },
    { id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true, toolResultPruner: true }, config: [plugin('compaction-basic'), plugin('command-compact'), plugin('tool-result-pruner', { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }, 'compaction-tool-result-pruner')] },
    { id: 'delegation', name: 'cordis:group', group: true, isolate: { workflowEngine: true }, config: [
      plugin('tool-subagent-control'), plugin('tool-subagent-list-agents', undefined, 'tool-subagent-control/list-agents'),
      plugin('tool-subagent', { provider: 'spawn', toolName: 'subagent', modelSelectionSettings: true }),
      plugin('tool-subagent-fork', { provider: 'fork', toolName: 'subagent_fork' }, 'tool-subagent'),
      plugin('workflow-ptc', { provider: 'spawn' }), plugin('tool-workflow'),
    ] },
    plugin('tool-ask-user'), plugin('tool-todo', { allowParallelInProgress: true }),
    plugin('tool-web', { fetch: true, searchTimeoutMs: 60000 }), { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
  ];
}
