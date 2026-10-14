import type { Context } from '@deepseek-ai/cordis';
import { applyExecutionDefaults, validateBatchLimit, validateExecutionDefault, validateExecutionDefaults, type ExecutionDefaults } from '../execution-defaults.ts';
import { scopeOf } from '@deepseek-ai/dsh-scope';
import type { PromptSectionOrderName } from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';

export interface PresetPolicyConfig {
  tools: string[];
  toolOverrides: Record<string, { description?: string; parameters?: Record<string, string> }>;
  sections: Record<string, string>;
  prompt: string;
  execution?: ExecutionDefaults;
}

/** Explicit supported section placements; never infer a plugin from its section name. */
export const POLICY_SECTION_ORDERS: Readonly<Record<string, PromptSectionOrderName>> = Object.freeze({
  'tool:jobs': 'TOOL_JOBS', 'tool:bash': 'TOOL_BASH', 'tool:pwsh': 'TOOL_PWSH',
  'tool:read': 'TOOL_READ', 'tool:write': 'TOOL_WRITE', 'tool:edit': 'TOOL_EDIT',
  'tool:glob': 'TOOL_GLOB', 'tool:grep': 'TOOL_GREP',
  'tool:web_fetch': 'TOOL_WEB_FETCH', 'tool:web_search': 'TOOL_WEB_SEARCH', 'tool:goal': 'TOOL_GOAL',
});
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function validatePolicy(config: PresetPolicyConfig): void {
  if (!record(config) || !Array.isArray(config.tools) || config.tools.some(name => typeof name !== 'string' || !name)
    || new Set(config.tools).size !== config.tools.length || !record(config.toolOverrides) || !record(config.sections) || typeof config.prompt !== 'string') throw new Error('Invalid Studio policy');
  if (config.execution !== undefined) {
    validateExecutionDefaults(config.execution);
    for (const name of Object.keys(config.execution.defaults)) if (!config.tools.includes(name)) throw new Error(`Execution default requires selected tool: ${name}`);
    if (config.execution.batch && !config.tools.includes(config.execution.batch.tool)) throw new Error('Batch limit requires selected tool');
  }
  for (const [name, override] of Object.entries(config.toolOverrides)) {
    if (!config.tools.includes(name)) throw new Error(`Override requires selected tool: ${name}`);
    if (!record(override) || Object.keys(override).some(key => !['description', 'parameters'].includes(key)) || (override.description !== undefined && typeof override.description !== 'string')
      || (override.parameters !== undefined && (!record(override.parameters) || Object.values(override.parameters).some(value => typeof value !== 'string')))) throw new Error(`Invalid override: ${name}`);
  }
  for (const [name, text] of Object.entries(config.sections)) {
    if (!own(POLICY_SECTION_ORDERS, name) || typeof text !== 'string') throw new Error(`Unsupported policy section: ${name}`);
  }
}

/** Parameter paths follow properties recursively, e.g. "options.timeout" (not JSON pointers). */
function patchParameter(parameters: Record<string, unknown>, path: string, description: string): void {
  const segments = path.split('.');
  let node: Record<string, unknown> = parameters;
  for (const segment of segments) {
    if (!segment || ['__proto__', 'prototype', 'constructor'].includes(segment) || !record(node.properties) || !own(node.properties, segment) || !record(node.properties[segment])) throw new Error(`Unknown parameter path: ${path}`);
    node = node.properties[segment];
  }
  node.description = description;
}

/** Install into an already scoped agent/preview context. Disposer is idempotent and rolls back failures. */
export function installPolicy(ctx: Context, scopeKey: object, config: PresetPolicyConfig): () => void {
  validatePolicy(config);
  if (scopeOf(ctx) !== scopeKey) throw new Error('Studio policy requires its owning scoped context');
  const selected = new Set(config.tools);
  const definitions = config.tools.map(name => {
    const definition = ctx.tools.get(name, scopeKey);
    if (!definition) throw new Error(`Unavailable selected tool: ${name}`);
    const override = config.toolOverrides[name];
    const defaults = config.execution?.defaults[name];
    const batch = config.execution?.batch?.tool === name ? config.execution.batch : undefined;
    if (!override && !defaults && !batch) return undefined;
    const parameters = structuredClone(definition.parameters);
    for (const [path, description] of Object.entries(override?.parameters ?? {})) patchParameter(parameters, path, description);
    for (const [field, value] of Object.entries(defaults ?? {})) {
      validateExecutionDefault(parameters, field, value);
      ((parameters.properties as Record<string, Record<string, unknown>>)[field]!).default = value;
    }
    if (batch) {
      validateBatchLimit(parameters, batch);
      ((parameters.properties as Record<string, Record<string, unknown>>)[batch.parameter]!).maxItems = batch.maxItems;
    }
    const stableDefaults = { ...defaults };
    const stableBatch = batch && { ...batch };
    return { ...definition, parameters, ...(override?.description === undefined ? {} : { description: override.description }),
      ...(defaults || batch ? { execute(args: unknown, exec: Parameters<typeof definition.execute>[1]) {
        const effective = applyExecutionDefaults(args, stableDefaults);
        if (stableBatch && record(effective) && Array.isArray(effective[stableBatch.parameter]) && (effective[stableBatch.parameter] as unknown[]).length > stableBatch.maxItems) throw new Error(`Studio batch limit exceeded: ${stableBatch.maxItems}`);
        // Stay inside the registry's existing execution pipeline; never recursively dispatch.
        return definition.execute.call(definition, effective, exec);
      } } : {}),
    };
  }).filter(definition => definition !== undefined);
  const disposers: Array<() => void> = [];
  const dispose = () => { for (const release of disposers.splice(0).reverse()) release(); };
  try {
    disposers.push(ctx.tools.restrict({ allow: config.tools }));
    // Restrictions mask ancestors, but leave this layer's own definitions visible.
    const excess = ctx.tools.schemas(scopeKey).filter(tool => !selected.has(tool.name));
    if (excess.length) throw new Error(`Unselected scoped tools must be removed from preset plugins: ${excess.map(tool => tool.name).join(', ')}`);
    disposers.push(ctx.tools.guard(execution => selected.has(execution.name) ? undefined : 'Tool excluded by Studio preset policy'));
    for (const definition of definitions) disposers.push(ctx.tools.register(definition));
    for (const [name, text] of Object.entries(config.sections)) disposers.push(ctx.systemPrompt.section({ name, order: ctx.systemPrompt.getSectionOrder(POLICY_SECTION_ORDERS[name]!), text, interpolate: false }));
    disposers.push(ctx.systemPrompt.section({ name: 'studio:additional', order: Number.MAX_SAFE_INTEGER, text: config.prompt, interpolate: false }));
    return dispose;
  } catch (error) { dispose(); throw error; }
}

export const name = 'studio-preset-policy';
export const inject = ['tools', 'systemPrompt'];
export function apply(ctx: Context, config: PresetPolicyConfig): void {
  validatePolicy(config);
  const installed = new Map<object, () => void>();
  ctx.on('agent/created', ({ agent }) => {
    if (!installed.has(agent)) installed.set(agent, installPolicy(agent.ctx, agent, config));
    return undefined;
  });
  ctx.on('agent/disposed', ({ agent }) => { installed.get(agent)?.(); installed.delete(agent); });
  ctx.effect(() => () => { for (const dispose of installed.values()) dispose(); installed.clear(); });
}
