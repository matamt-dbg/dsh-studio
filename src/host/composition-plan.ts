import { applyConfigExclusions, applyConfigOverrides, configEntries } from '../config-overrides.ts';
import { MASTER_PRESET_ID } from '../master-preset.ts';
import { providerFields } from '../provider-fields.ts';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import type {} from '@deepseek-ai/dsh-tools';
import { load } from 'js-yaml';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { parsePreviewRequest, promptProviderModules, type CompositionRow, type PreviewRequest } from '../prompt-composition.ts';

export function parseComposition(content: string): CompositionRow[] {
  const rows = load(content, { schema: entryListSchema });
  if (!Array.isArray(rows)) throw new Error('Preset declaration must be a plugin list');
  return rows as CompositionRow[];
}
function findProviders(rows: CompositionRow[]): CompositionRow[] {
  return rows.flatMap(row => row.disabled === true ? [] : row.group && Array.isArray(row.config)
    ? findProviders(row.config) : (promptProviderModules as readonly string[]).includes(row.name) ? [row] : []);
}
function normalizeRetention(config: Record<string, unknown>, overrides?: Record<string, unknown>) {
  if (overrides?.retainTokens !== undefined && overrides.retainRatio !== undefined) {
    throw new Error('Compaction retainRatio and retainTokens are mutually exclusive');
  }
  if (overrides?.retainTokens !== undefined) delete config.retainRatio;
  if (overrides?.retainRatio !== undefined) delete config.retainTokens;
}
/** Server-owned declarations only; client input never supplies module names or executable YAML. */
export async function compositionPlan(ctx: Context, input: PreviewRequest) {
  const request = parsePreviewRequest(input);
  const base = request.preset;
  if (request.configOverrides && base !== MASTER_PRESET_ID) throw new Error('Config overrides require Studio Master');
  if (request.configExclusions && base !== MASTER_PRESET_ID) throw new Error('Config exclusions require Studio Master');
  // Base declaration, then field overrides, then whole-entry exclusions; everything else keeps DSH defaults.
  const declared = parseComposition((await ctx.agentPresets.readDocument(base)).content);
  const source = applyConfigExclusions(applyConfigOverrides(declared, request.configOverrides ?? {}), request.configExclusions ?? [], request.configOverrides ?? {});
  if (request.configOverrides && Object.keys(request.configOverrides).length) {
    for (const { id, row } of configEntries(source)) {
      if (row.name === '@deepseek-ai/dsh-compaction-basic') {
        normalizeRetention(row.config as Record<string, unknown>, request.configOverrides[id]);
      }
    }
  }
  const available = new Map(findProviders(source).map(row => [row.name, row]));
  const presets = await ctx.agentPresets.list();
  for (const preset of presets) {
    if (base === MASTER_PRESET_ID || !['minimal', 'standard', 'ptc', 'cordis'].includes(preset.id)) continue;
    try {
      for (const row of findProviders(parseComposition((await ctx.agentPresets.readDocument(preset.id)).content))) {
        if (!available.has(row.name)) available.set(row.name, row);
      }
    } catch { /* Unavailable declarations are not selectable. */ }
  }
  const configure = (row: CompositionRow, name: string): Record<string, unknown> => {
    const config = { ...(row.config as Record<string, unknown> ?? {}) };
    const overrides = request.providerConfigs?.[name];
    if (overrides) {
      // Public settings explicitly supported by this editor; no arbitrary plugin internals.
      for (const [key, value] of Object.entries(overrides)) {
        const field = providerFields[name]?.find(field => field.key === key);
        const valid = field && (field.type === 'string[]' ? Array.isArray(value) && value.every(item => typeof item === 'string') : typeof value === field.type);
        if (!valid || (field?.options && !field.options.includes(String(value))) || (typeof value === 'number' && (!Number.isFinite(value) || (field?.minimum !== undefined && value < field.minimum)))) throw new Error(`Unsupported provider setting: ${name}.${key}`);
        if (key === 'timeZone' && typeof value === 'string') new Intl.DateTimeFormat('en', { timeZone: value }).format();
        config[key] = value;
      }
    }
    if (name === '@deepseek-ai/dsh-persona') {
      config.complete = false;
      if (request.persona !== undefined) config.prefix = request.persona;
    }
    if (name === '@deepseek-ai/dsh-compaction-basic') {
      normalizeRetention(config, overrides);
    }
    return config;
  };
  // The base declaration is used whenever tools are composed. Its providers stay in place with
  // their default config unless selected for editing: leaving a provider unselected is not an
  // exclusion, so persona-only edits must not silently drop compaction or context providers.
  const usesSource = request.tools.length > 0 || base === MASTER_PRESET_ID;
  const inSource = new Set(usesSource ? findProviders(source).map(row => row.name) : []);
  const selected = [...new Set(request.providers)];
  if (request.configExclusions?.length) {
    const kept = new Set(findProviders(source).map(row => row.name));
    const excludedSelection = selected.filter(name => findProviders(declared).some(row => row.name === name) && !kept.has(name));
    if (excludedSelection.length) throw new Error(`Excluded Config entries are selected prompt providers: ${excludedSelection.join(', ')}`);
  }
  for (const name of selected) if (!available.has(name)) throw new Error(`Unavailable prompt provider: ${name}`);
  // Providers taken from another built-in declaration are hoisted; source providers are edited in place.
  const plugins = selected.filter(name => !inSource.has(name)).map((name, index) => {
    const row = available.get(name)!;
    return { ...row, id: `studio-provider-${index}`, config: configure(row, name) };
  });
  if (request.persona !== undefined && !request.providers.includes('@deepseek-ai/dsh-persona')) throw new Error('Select persona before editing its prefix');
  for (const name of Object.keys(request.providerConfigs ?? {})) if (!request.providers.includes(name)) throw new Error(`Unselected provider override: ${name}`);
  if (usesSource) {
    // Bind tool implementations and their dependency realms to the requested declaration,
    // even when a same-named global tool exists. Never substitute another preset.
    const lease = await ctx.agentPresets.acquireScope(base);
    try {
      const names = new Set(ctx.tools.schemas(lease.key).map(tool => tool.name));
      const missing = request.tools.filter(name => !names.has(name));
      if (missing.length) throw new Error(`Requested preset ${base} does not supply tools: ${missing.join(', ')}. Tools from other source scopes cannot be substituted safely.`);
    } finally { await lease[Symbol.asyncDispose](); }
    const visit = (rows: CompositionRow[]): CompositionRow[] => rows.map(row => row.disabled === true ? row
      : row.group && Array.isArray(row.config) ? { ...row, config: visit(row.config) }
        : selected.includes(row.name) && inSource.has(row.name) ? { ...row, config: configure(row, row.name) } : row);
    plugins.push(...visit(source) as typeof plugins);
  }
  // Preserve private service ownership for providers hoisted from another declaration.
  const compaction = plugins.filter(row => ['@deepseek-ai/dsh-compaction-basic', '@deepseek-ai/dsh-compaction-tool-result-pruner'].includes(row.name));
  const isolated: CompositionRow[] = plugins.filter(row => !compaction.includes(row));
  if (compaction.length) isolated.push({ id: 'studio-compaction', name: 'cordis:group', group: true, isolate: { compaction: true, toolResultPruner: true }, config: compaction });
  // Effective Master entries after overrides and exclusions, for per-turn previews.
  const entries = base === MASTER_PRESET_ID ? configEntries(source).map(({ id, row }) => ({ id, name: row.name, config: row.config })) : [];
  return { request, plugins: isolated, entries };
}
