import type { Context } from '@deepseek-ai/cordis';
import { applyExecutionDefaults, validateBatchLimit, validateExecutionDefault, validateExecutionDefaults, type ExecutionDefaults } from '../execution-defaults.ts';
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope';
import type { PromptSectionOrderName } from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import { sectionsOnlyFor } from '../tool-prompt-sections.ts';
import { roleChildPolicy } from './role-child-policy-contract.ts';

export interface PresetPolicyConfig {
  tools: string[];
  toolOverrides: Record<string, { description?: string; parameters?: Record<string, string> }>;
  sections: Record<string, string>;
  prompt: string;
  execution?: ExecutionDefaults;
  /** Union of the selected tools that any role may hide; each child uses its own fixed list. */
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

/**
 * Install into an already scoped agent/preview context. Disposer is idempotent and rolls back failures.
 *
 * The selection is the preset's starting tool set, not an allowlist: unselected tools the Agent
 * inherits at install time are masked with `restrict({ deny })`, while tools registered later
 * under new names, and this scope's own registrations, follow DSH's normal tool flow. Selected
 * tools that are absent, or own-scope tools that cannot be shadowed, are reported through `warn`
 * and skipped instead of blocking the Agent.
 */
export function installPolicy(ctx: Context, scopeKey: object, config: PresetPolicyConfig, warn: (message: string) => void = () => {}): () => void {
  validatePolicy(config);
  if (scopeOf(ctx) !== scopeKey) throw new Error('Studio policy requires its owning scoped context');
  // run_code is transport, not an end-capability. Never pass it to restrict or
  // silently rewrite this scope's presentation (and certainly not the host's).
  if (config.tools.includes('run_code') || ctx.tools.get('run_code', scopeKey) !== undefined) {
    throw new Error('Studio policy does not support PTC presentation or the reserved run_code tool; configure this preset with native tool presentation');
  }
  const missing = config.tools.filter(name => ctx.tools.get(name, scopeKey) === undefined);
  if (missing.length) warn(`Studio policy selected tools unavailable: ${missing.join(', ')}`);
  // Public restrict masks inherited definitions, not this scope's own tools. Probe with an
  // empty allow-list to tell the two apart, then restore synchronously even on failure.
  const restoreProbe = ctx.tools.restrict({ allow: [] });
  let local: Set<string>;
  try { local = new Set(ctx.tools.schemas(scopeKey).map(tool => tool.name)); }
  finally { restoreProbe(); }
  const selected = new Set(config.tools);
  const deny = ctx.tools.schemas(scopeKey).map(tool => tool.name).filter(name => !selected.has(name) && !local.has(name));
  // An own-scope tool cannot be shadowed in its own layer; leave it unpatched rather than fail.
  const unpatchable = config.tools.filter(name => local.has(name) && (config.toolOverrides[name] || config.execution?.defaults[name] || config.execution?.batch?.tool === name));
  if (unpatchable.length) warn(`Studio policy cannot apply overrides to agent-scope tools: ${unpatchable.join(', ')}`);
  const definitions = config.tools.filter(name => !local.has(name) && !missing.includes(name)).map(name => {
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
    // A snapshot of names, not a guard: later registrations and removals stay DSH's to decide.
    if (deny.length) disposers.push(ctx.tools.restrict({ deny }));
    for (const definition of definitions) disposers.push(ctx.tools.register(definition));
    for (const [name, text] of Object.entries(config.sections)) disposers.push(ctx.systemPrompt.section({ name, order: ctx.systemPrompt.getSectionOrder(POLICY_SECTION_ORDERS[name]!), text, interpolate: false }));
    disposers.push(ctx.systemPrompt.section({ name: 'studio:additional', order: Number.MAX_SAFE_INTEGER, text: config.prompt, interpolate: false }));
    return dispose;
  } catch (error) { dispose(); throw error; }
}

interface PolicyAgent { ctx: Context; id?: unknown }
interface AgentRegistry { list(): PolicyAgent[]; roots?(): PolicyAgent[] }
interface PolicyOwner { owner: object; release: () => void }
interface SharedPolicyState {
  /** The Studio preset whose policy each Agent carries. */
  owners: WeakMap<object, PolicyOwner>;
  /** Agents whose policy is being disposed; their tool view is mid-change. */
  releasing: WeakSet<object>;
  /** Every mounted preset's reconcile, rerun once a release has finished. */
  reconcilers: Set<() => void>;
}

/**
 * Coordination across every mounted Studio preset. installPolicy masks a snapshot of the tools
 * the Agent sees, so it must never run while another Studio preset's policy still masks and
 * re-registers tools on that Agent. Switching Studio A -> B (agentPresets.select -> recompose)
 * emits one tools/change that both presets handle in mount order, and releasing A emits more
 * tools/change synchronously while A is half disposed. Without this, B's snapshot could miss what
 * A hid, and A's release then exposed those tools again. Shared through a global symbol so preset
 * instances that load separate copies of this module (HMR reloads) still agree.
 */
const SHARED = Symbol.for('@matamt-dbg/dsh-studio/preset-policy-state');
const shared = ((globalThis as Record<symbol, unknown>)[SHARED] ??= { owners: new WeakMap(), releasing: new WeakSet(), reconcilers: new Set() }) as SharedPolicyState;
const { owners, releasing } = shared;

export const name = 'studio-preset-policy';
export const inject = ['tools', 'systemPrompt'];
export function apply(ctx: Context, config: PresetPolicyConfig): void {
  validatePolicy(config);
  const registry = ctx.get('agents' as never) as AgentRegistry | undefined;
  const hideable = config.childToolFilter?.deny ?? [];
  // Legacy DSH persists native toolFilter; rc.1 uses Studio's immutable child snapshot instead.
  // Those tools are invisible to the child, so the full policy would report
  // them as unavailable. Install the child policy without exactly the hideable tools this child
  // cannot see. A tool that is missing but not hideable is reported as unavailable and skipped.
  const policyFor = (agent: PolicyAgent) => {
    const fixed = roleChildPolicy(ctx, agent);
    if (fixed) return childPolicy(config, fixed.deny);
    if (!hideable.length) return config;
    // Hidden means masked on this Agent while the preset itself still provides it; a tool the
    // preset lost is not hidden and stays in the policy so its absence is reported.
    const provided = (name: string) => scopeOf(ctx) === undefined || ctx.tools.get(name, scopeOf(ctx)) !== undefined;
    const hidden = hideable.filter(name => agent.ctx.tools.get(name, agent) === undefined && provided(name));
    return hidden.length ? childPolicy(config, hidden) : config;
  };
  const warn = (message: string) => { ctx.logger?.warn?.(message); };
  const installed = new Map<PolicyAgent, () => void>();
  const installing = new Set<PolicyAgent>();
  /** Identifies this preset instance in {@link owners}. */
  const owner = {};
  const remove = (agent: PolicyAgent) => {
    const dispose = installed.get(agent);
    if (!dispose) return;
    // Forget first: disposing emits tools/change, which re-enters reconcile synchronously.
    installed.delete(agent);
    if (owners.get(agent)?.owner === owner) owners.delete(agent);
    releasing.add(agent);
    try { dispose(); } finally { releasing.delete(agent); }
    // Installs skipped during the release see the settled tool set now.
    for (const reconcile of [...shared.reconcilers]) reconcile();
  };
  const install = (agent: PolicyAgent) => {
    if (installed.has(agent) || installing.has(agent) || releasing.has(agent)) return;
    // Reserve first: releasing the previous policy and registering the patched definitions
    // both emit tools/change synchronously.
    installing.add(agent);
    try {
      // Another Studio preset's policy leaves first, so this snapshot sees the unmasked tools.
      const previous = owners.get(agent);
      if (previous && previous.owner !== owner) { owners.delete(agent); previous.release(); }
      installed.set(agent, installPolicy(agent.ctx, agent, policyFor(agent), warn));
      owners.set(agent, { owner, release: () => remove(agent) });
    }
    finally { installing.delete(agent); }
  };
  ctx.on('agent/created', ({ agent }) => { install(agent as PolicyAgent); return undefined; });
  ctx.on('agent/disposed', ({ agent }) => { remove(agent as PolicyAgent); });

  // A session that picks this preset before its first turn is created under the default preset
  // and then reparented (agentPresets.select -> recompose). That emits tools/change, not
  // agent/created, so reconcile live Agents by ancestry: install for Agents now under this
  // preset's scope, release for Agents that moved away.
  const composition = scopeOf(ctx);
  const agents = registry;
  if (composition === undefined || agents === undefined) {
    ctx.effect(() => () => { for (const agent of [...installed.keys()]) remove(agent); });
    return;
  }
  const belongs = (agent: PolicyAgent) => scopeChainOf(scopeOf(agent.ctx)).includes(composition);
  // Fail closed but keep retrying: an Agent that joined this preset but cannot take its policy
  // must not run with half-applied overrides, so every call is denied with the reason. Only
  // invalid policy data reaches this (unknown parameter paths, PTC presentation, conflicting
  // prompt sections); tool availability and agent-scope registrations never block.
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
  shared.reconcilers.add(reconcile);
  reconcile();
  ctx.effect(() => () => {
    shared.reconcilers.delete(reconcile);
    for (const agent of [...installed.keys()]) remove(agent);
    for (const agent of [...blocked.keys()]) unblock(agent);
  });
}
