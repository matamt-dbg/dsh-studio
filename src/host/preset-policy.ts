import type { Context } from '@deepseek-ai/cordis';
import { applyExecutionDefaults, validateBatchLimit, validateExecutionDefault, validateExecutionDefaults, type ExecutionDefaults } from '../execution-defaults.ts';
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope';
import type { PromptSectionOrderName } from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import { sectionsOnlyFor } from '../tool-prompt-sections.ts';

export interface PresetPolicyConfig {
  tools: string[];
  toolOverrides: Record<string, { description?: string; parameters?: Record<string, string> }>;
  sections: Record<string, string>;
  prompt: string;
  execution?: ExecutionDefaults;
  /** Selected tools hidden from every subagent (fresh and fork) started under this preset. */
  childToolFilter?: { deny: string[] };
}

/** Explicit supported section placements; never infer a plugin from its section name. */
export const POLICY_SECTION_ORDERS: Readonly<Record<string, PromptSectionOrderName>> = Object.freeze({
  'tool:jobs': 'TOOL_JOBS', 'tool:bash': 'TOOL_BASH', 'tool:pwsh': 'TOOL_PWSH',
  'tool:read': 'TOOL_READ', 'tool:write': 'TOOL_WRITE', 'tool:edit': 'TOOL_EDIT',
  'tool:glob': 'TOOL_GLOB', 'tool:grep': 'TOOL_GREP',
  'tool:web_fetch': 'TOOL_WEB_FETCH', 'tool:web_search': 'TOOL_WEB_SEARCH', 'tool:goal': 'TOOL_GOAL',
  'tool:workflow': 'TOOL_WORKFLOW',
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
  if (config.childToolFilter !== undefined) {
    const deny = record(config.childToolFilter) ? config.childToolFilter.deny : undefined;
    if (!Array.isArray(deny) || deny.some(name => typeof name !== 'string' || !name)) throw new Error('Invalid subagent tool filter');
    for (const name of deny) if (!config.tools.includes(name)) throw new Error(`Subagent tool filter requires selected tool: ${name}`);
  }
}

/**
 * The policy a subagent receives: the preset policy without the tools DSH hid from this child.
 * `hidden` is the child's own toolFilter result (it varies per role), always a subset of the
 * preset's hideable set. Sections only those tools used are blanked for the child alone, so the
 * parent's prompt and its edited usage instructions are unchanged.
 */
export function childPolicy(config: PresetPolicyConfig, hidden: readonly string[]): PresetPolicyConfig {
  const deny = new Set(hidden);
  if (!deny.size) return config;
  const keep = <T>(entries: Record<string, T>) => Object.fromEntries(Object.entries(entries).filter(([name]) => !deny.has(name)));
  const { childToolFilter: _filter, execution, ...rest } = config;
  const tools = config.tools.filter(name => !deny.has(name));
  const blank = Object.fromEntries(sectionsOnlyFor([...deny], tools).filter(name => own(POLICY_SECTION_ORDERS, name)).map(name => [name, '']));
  return { ...rest, tools, toolOverrides: keep(config.toolOverrides), sections: { ...config.sections, ...blank },
    ...(execution ? { execution: (({ batch, ...value }) => ({ ...value, defaults: keep(execution.defaults), ...(batch && !deny.has(batch.tool) ? { batch } : {}) }))(execution) } : {}) };
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
  // run_code is transport, not an end-capability. Never pass it to restrict or
  // silently rewrite this scope's presentation (and certainly not the host's).
  if (config.tools.includes('run_code') || ctx.tools.get('run_code', scopeKey) !== undefined) {
    throw new Error('Studio policy does not support PTC presentation or the reserved run_code tool; configure this preset with native tool presentation');
  }
  const missing = config.tools.filter(name => ctx.tools.get(name, scopeKey) === undefined);
  if (missing.length) throw new Error(`Studio policy selected tools unavailable: ${missing.join(', ')}`);
  // Public restrict masks inherited definitions, not this scope's own tools.
  // Probe with an empty allow-list, then restore synchronously even on failure.
  // Reject own registrations, including same-name shadows: permitting them would
  // promise exposure enforcement that the supported public API cannot provide.
  const restoreProbe = ctx.tools.restrict({ allow: [] });
  try {
    const local = ctx.tools.schemas(scopeKey);
    if (local.length) throw new Error(`Studio policy does not support own-scope tools: ${local.map(tool => tool.name).join(', ')}; register providers in an ancestor preset scope. Public API cannot hide late own-scope schemas; dynamic own-scope providers are unsupported`);
  } finally { restoreProbe(); }
  const selected = new Set(config.tools);
  const definitions = config.tools.map(name => {
    const definition = ctx.tools.get(name, scopeKey)!;
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
    disposers.push(ctx.tools.restrict({ allow: [...selected] }));
    // Public API gap: a plugin can register an own-scope schema after installation;
    // restrict cannot hide it and tools/change is only a notification, not a veto.
    // Do not monkeypatch the registry or claim an exact late-schema boundary.
    // The monotonic guard still denies every unselected body, including run_code
    // if another plugin switches presentation later. Providers must remain stable.
    disposers.push(ctx.tools.guard(execution => selected.has(execution.name) ? undefined : 'Tool excluded by Studio preset policy'));
    for (const definition of definitions) disposers.push(ctx.tools.register(definition));
    for (const [name, text] of Object.entries(config.sections)) disposers.push(ctx.systemPrompt.section({ name, order: ctx.systemPrompt.getSectionOrder(POLICY_SECTION_ORDERS[name]!), text, interpolate: false }));
    disposers.push(ctx.systemPrompt.section({ name: 'studio:additional', order: Number.MAX_SAFE_INTEGER, text: config.prompt, interpolate: false }));
    return dispose;
  } catch (error) { dispose(); throw error; }
}

interface PolicyAgent { ctx: Context; id?: unknown }
interface AgentRegistry { list(): PolicyAgent[]; roots?(): PolicyAgent[] }

export const name = 'studio-preset-policy';
export const inject = ['tools', 'systemPrompt'];
export function apply(ctx: Context, config: PresetPolicyConfig): void {
  validatePolicy(config);
  const registry = ctx.get('agents' as never) as AgentRegistry | undefined;
  const hideable = config.childToolFilter?.deny ?? [];
  // subagent_role passes each role's toolFilter to DSH, which restricts the child natively and
  // persists it for resume. Those tools are invisible to the child, so the full policy would reject
  // them as unavailable. Install the child policy without exactly the hideable tools this child
  // cannot see. A tool that is missing but not hideable still fails closed as unavailable.
  const policyFor = (agent: PolicyAgent) => {
    if (!hideable.length) return config;
    // Hidden means masked on this Agent while the preset itself still provides it; a tool the
    // preset lost is not hidden and stays in the policy so the Agent fails closed.
    const provided = (name: string) => scopeOf(ctx) === undefined || ctx.tools.get(name, scopeOf(ctx)) !== undefined;
    const hidden = hideable.filter(name => agent.ctx.tools.get(name, agent) === undefined && provided(name));
    return hidden.length ? childPolicy(config, hidden) : config;
  };
  const installed = new Map<PolicyAgent, () => void>();
  const installing = new Set<PolicyAgent>();
  const install = (agent: PolicyAgent) => {
    if (installed.has(agent) || installing.has(agent)) return;
    // Reserve first: registering the patched definitions emits tools/change synchronously.
    installing.add(agent);
    try { installed.set(agent, installPolicy(agent.ctx, agent, policyFor(agent))); }
    finally { installing.delete(agent); }
  };
  const remove = (agent: PolicyAgent) => { installed.get(agent)?.(); installed.delete(agent); };
  ctx.on('agent/created', ({ agent }) => { install(agent as PolicyAgent); return undefined; });
  ctx.on('agent/disposed', ({ agent }) => { remove(agent as PolicyAgent); });

  // A session that picks this preset before its first turn is created under the default preset
  // and then reparented (agentPresets.select -> recompose). That emits tools/change, not
  // agent/created, so reconcile live Agents by ancestry: install for Agents now under this
  // preset's scope, release for Agents that moved away.
  const composition = scopeOf(ctx);
  const agents = registry;
  if (composition === undefined || agents === undefined) {
    ctx.effect(() => () => { for (const dispose of installed.values()) dispose(); installed.clear(); });
    return;
  }
  const belongs = (agent: PolicyAgent) => scopeChainOf(scopeOf(agent.ctx)).includes(composition);
  // Fail closed but keep retrying: an Agent that joined this preset but cannot take its policy
  // yet must not run the unrestricted inherited tool set, so every call is denied. The usual
  // cause is transient: the previous preset's own-scope tool (tool-subagent's `subagent`) is
  // removed asynchronously after the same tools/change, and that removal emits tools/change again.
  const blocked = new Map<PolicyAgent, { release: () => void; reason: string }>();
  const unblock = (agent: PolicyAgent) => { blocked.get(agent)?.release(); blocked.delete(agent); };
  const block = (agent: PolicyAgent, error: unknown) => {
    const reason = `Studio preset policy could not be installed: ${error instanceof Error ? error.message : String(error)}`;
    const current = blocked.get(agent);
    if (current?.reason === reason) return;
    current?.release();
    blocked.set(agent, { release: agent.ctx.tools.guard(() => reason), reason });
  };
  const reconcile = () => {
    const live = agents.list();
    for (const agent of live) {
      if (!belongs(agent)) { remove(agent); unblock(agent); continue; }
      if (installed.has(agent)) continue;
      try { install(agent); unblock(agent); } catch (error) { block(agent, error); }
    }
    for (const agent of [...blocked.keys()]) if (!live.includes(agent)) unblock(agent);
  };
  ctx.on('tools/change', reconcile);
  ctx.on('agent/disposed', ({ agent }) => { unblock(agent as PolicyAgent); });
  reconcile();
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose(); installed.clear();
    for (const agent of [...blocked.keys()]) unblock(agent);
  });
}
