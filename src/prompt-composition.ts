import { validateConfigOverrides, type ConfigOverrides } from './config-overrides.ts';
import { providerFields, type ProviderField } from './provider-fields.ts';
import { validateExecutionDefaults, type ExecutionDefaults } from './execution-defaults.ts';
export const promptProviderModules = [
  '@deepseek-ai/dsh-persona',
  '@deepseek-ai/dsh-agent-instructions',
  '@deepseek-ai/dsh-time-context',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
  '@deepseek-ai/dsh-agent-tool-presentation',
] as const;
export interface PromptProvider { name: string; description: string; fields?: ProviderField[] }
export interface ToolOverride { description?: string; parameters?: Record<string, string> }
export interface PreviewRequest { configOverrides?: ConfigOverrides; preset: string; providers: string[]; tools: string[]; prompt: string; model: string; persona?: string; toolOverrides?: Record<string, ToolOverride>; sections?: Record<string, string>; providerConfigs?: Record<string, Record<string, unknown>>; execution?: ExecutionDefaults; subagentToolFilter?: { deny: string[] };
  /** Master Config entry ids left out of this preset entirely. Absent ids keep DSH defaults (or their override). */
  configExclusions?: string[] }
export interface PresetBundle { files: Record<string, string> }
export type ExportAction = (request: PreviewRequest) => Promise<PresetBundle>;
/** Runtime schema used by the public Remote input codec. */
export function parsePreviewRequest(value: unknown): PreviewRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preview request');
  const row = value as Record<string, unknown>;
  const strings = (input: unknown): input is string[] => Array.isArray(input) && input.every(item => typeof item === 'string');
  if (typeof row.preset !== 'string' || !strings(row.providers) || !strings(row.tools) || typeof row.prompt !== 'string' || typeof row.model !== 'string') throw new Error('Invalid preview request');
  const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (row.persona !== undefined && typeof row.persona !== 'string') throw new Error('Invalid persona');
  if (row.sections !== undefined && (!record(row.sections) || Object.values(row.sections).some(v => typeof v !== 'string'))) throw new Error('Invalid section overrides');
  if (row.toolOverrides !== undefined && (!record(row.toolOverrides) || Object.values(row.toolOverrides).some(v => !record(v) || Object.keys(v).some(k => !['description', 'parameters'].includes(k)) || (v.description !== undefined && typeof v.description !== 'string') || (v.parameters !== undefined && (!record(v.parameters) || Object.values(v.parameters).some(p => typeof p !== 'string')))))) throw new Error('Invalid tool overrides');
  if (row.providerConfigs !== undefined && (!record(row.providerConfigs) || Object.values(row.providerConfigs).some(v => !record(v)))) throw new Error('Invalid provider configs');
  if (row.configOverrides !== undefined) validateConfigOverrides(row.configOverrides);
  if (row.execution !== undefined) validateExecutionDefaults(row.execution);
  if (row.configExclusions !== undefined && (!strings(row.configExclusions) || row.configExclusions.some(id => !id))) throw new Error('Invalid Config exclusions');
  const filter = row.subagentToolFilter as { deny?: unknown } | undefined;
  if (filter !== undefined && (!record(filter) || !strings(filter.deny) || filter.deny.some(name => !name))) throw new Error('Invalid subagent tool filter');
  return { ...(row.configOverrides !== undefined ? { configOverrides: row.configOverrides as ConfigOverrides } : {}), ...(row.execution !== undefined ? { execution: row.execution } : {}), preset: row.preset, providers: [...row.providers], tools: [...row.tools], prompt: row.prompt, model: row.model,
    ...(row.persona !== undefined ? { persona: row.persona as string } : {}),
    ...(row.sections !== undefined ? { sections: row.sections as Record<string,string> } : {}),
    ...(row.toolOverrides !== undefined ? { toolOverrides: row.toolOverrides as Record<string,ToolOverride> } : {}),
    ...(row.providerConfigs !== undefined ? { providerConfigs: row.providerConfigs as Record<string,Record<string,unknown>> } : {}),
    ...(filter !== undefined && (filter.deny as string[]).length ? { subagentToolFilter: { deny: [...new Set(filter.deny as string[])] } } : {}),
    ...(Array.isArray(row.configExclusions) && row.configExclusions.length ? { configExclusions: [...new Set(row.configExclusions as string[])] } : {}),
  };
}
/**
 * One per-turn message a composed plugin adds in a real session (not part of the system prompt).
 * `text` is an example rendered now in the Studio Host's working directory; `entry` is the Master
 * Config id whose fields produce it, so the preview can edit the same override.
 */
export interface TurnInjection { entry: string; name: string; text?: string; note?: string }
export interface PreviewResult { prompt: string; sections: { name: string; text: string }[]; context: string; tools: { name: string; description: string; parameters: Record<string, unknown> }[]; injections?: TurnInjection[];
  /** Runtime context sections sent after the system prompt on every request, by contributor. */
  contexts?: { name: string; text: string }[] }
export type PreviewAction = (request: PreviewRequest) => Promise<PreviewResult>;
export interface CompositionRow { id?: string; name: string; group?: boolean; config?: unknown; disabled?: unknown; [key: string]: unknown }
/** Curated semantic classification; do not guess prompt providers from package substrings. */
export function promptProviders(rows: CompositionRow[]): PromptProvider[] {
  const found: PromptProvider[] = [];
  for (const row of rows) {
    if (row.disabled === true) continue;
    if (row.group && Array.isArray(row.config)) found.push(...promptProviders(row.config));
    else if ((promptProviderModules as readonly string[]).includes(row.name)) {
      const config = (row.config ?? {}) as Record<string, unknown>;
      found.push({ name: row.name, description: row.name.replace('@deepseek-ai/dsh-', ''), fields: (providerFields[row.name] ?? []).map(field => ({ ...field, ...(Object.hasOwn(config, field.key) ? { value: config[field.key] } : {}) })) });
    }
  }
  return [...new Map(found.map(item => [item.name, item])).values()];
}
