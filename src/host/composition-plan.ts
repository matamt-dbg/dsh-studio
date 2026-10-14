import { applyConfigOverrides, configEntries } from '../config-overrides.ts';
import { MASTER_PRESET_ID } from '../master-preset.ts';
import { providerFields } from '../provider-fields.ts';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import type {} from '@deepseek-ai/dsh-tools';
import { load } from 'js-yaml';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { parsePreviewRequest, promptProviderModules, selectPromptProviders, type CompositionRow, type PreviewRequest } from '../prompt-composition.ts';

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
  const source = applyConfigOverrides(parseComposition((await ctx.agentPresets.readDocument(base)).content), request.configOverrides ?? {});
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
  const plugins = [...new Set(request.providers)].map((name, index) => {
    const row = available.get(name);
    if (!row) throw new Error(`Unavailable prompt provider: ${name}`);
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
    return { ...row, id: `studio-provider-${index}`, config };
  });
  if (request.persona !== undefined && !request.providers.includes('@deepseek-ai/dsh-persona')) throw new Error('Select persona before editing its prefix');
  for (const name of Object.keys(request.providerConfigs ?? {})) if (!request.providers.includes(name)) throw new Error(`Unselected provider override: ${name}`);
  if (request.tools.length || base === MASTER_PRESET_ID) {
    // Bind tool implementations and their dependency realms to the requested declaration,
    // even when a same-named global tool exists. Never substitute another preset.
    const lease = await ctx.agentPresets.acquireScope(base);
    try {
      const names = new Set(ctx.tools.schemas(lease.key).map(tool => tool.name));
      const missing = request.tools.filter(name => !names.has(name));
      if (missing.length) throw new Error(`Requested preset ${base} does not supply tools: ${missing.join(', ')}. Tools from other source scopes cannot be substituted safely.`);
    } finally { await lease[Symbol.asyncDispose](); }
    plugins.push(...selectPromptProviders(source, []) as typeof plugins);
  }
  // Preserve private service ownership when hoisting selected providers out of preset groups.
  const compaction = plugins.filter(row => ['@deepseek-ai/dsh-compaction-basic', '@deepseek-ai/dsh-compaction-tool-result-pruner'].includes(row.name));
  const isolated: CompositionRow[] = plugins.filter(row => !compaction.includes(row));
  if (compaction.length) isolated.push({ id: 'studio-compaction', name: 'cordis:group', group: true, isolate: { compaction: true, toolResultPruner: true }, config: compaction });
  return { request, plugins: isolated };
}
