import { OPTIMIZED_PRESET_ID, optimizedTemplate } from '../optimized-preset.ts';
import { createScope } from '@deepseek-ai/dsh-scope';
import { installPolicy, type PresetPolicyConfig } from './preset-policy.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { dump } from 'js-yaml';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { parsePreviewRequest, type PreviewRequest } from '../prompt-composition.ts';
import { compositionPlan, parseComposition } from './composition-plan.ts';
import { executableRoles, parseRoles, roleToolFilter } from '../role-settings.ts';
import { delegationTools, migratePolicyConfig, renameLegacyRoleKey, ROLE_PLUGIN, ROLE_TOOL, withoutDelegationPlugins } from '../delegation.ts';
import type { CompositionRow } from '../prompt-composition.ts';
import { cleanRequest, cleanRoles, type CleanablePreset } from '../master-snapshot.ts';
import { applyConfigExclusions, LEGACY_DROPPED_PACKAGES } from '../config-overrides.ts';
import { masterComposition } from './master-composition.ts';
import { MASTER_PRESET_ID } from '../master-preset.ts';


export interface StudioPreset {
  id: string; name: string; description: string; request: PreviewRequest;
  conveniences: unknown; agents: unknown; updatedAt: string; appliedAt?: string;
  status: 'draft' | 'applied' | 'modified'; applyWarning?: string;
  /** Non-tool features the applied snapshot lacks although the preset does not exclude them. */
  missingFeatures?: string[];
  /** Optimized only: the user edited it, so it differs from the shipped defaults. */
  customized?: boolean;
  /** Optimized only: the shipped defaults changed since the user edited it; restore adopts them. */
  newDefaults?: boolean;
}
interface StoredPreset extends StudioPreset {
  applied?: { name: string; description: string; plugins: string };
  /** Optimized only: the template (request and agents) this row was last aligned to. */
  templateHash?: string;
}
type OptimizedTemplate = ReturnType<typeof optimizedTemplate>;
/** Key-order independent: saving normalizes the request, which must not count as an edit. */
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
const templateKey = (value: { request: unknown; agents: unknown }) => JSON.stringify(canonical({ request: value.request, agents: value.agents }));
const hashOf = (value: { request: unknown; agents: unknown }) => createHash('sha256').update(templateKey(value)).digest('hex');
/** Rows from before Optimized was editable carry no hash; they were locked, so they are unedited. */
const edited = (row: StoredPreset) => row.templateHash !== undefined && hashOf(row) !== row.templateHash;
/** Prefix of the warning a failed startup apply leaves; such a row is retried at the next start. */
const STARTUP_APPLY_FAILED = 'Apply failed:';
const owned = (id: string) => id === OPTIMIZED_PRESET_ID || /^studio-user-[a-f0-9-]{36}$/.test(id);
const retiredLegacyWarning = 'Work convenience settings are saved but not applied yet. Legacy role overrides are stored only; roles apply only their supported settings.';

import { validateRoleModel } from './role-validation.ts';
import { currentPluginName, LEGACY_PACKAGE_NAME, POLICY_PLUGIN } from '../package-name.ts';

/** Snapshots from older builds name the pre-publication package and the studio_role tool; rewrite both so restore registers current entries. */
function migrateLegacyNames(row: StoredPreset): void {
  const request = row.request;
  if (request.toolOverrides) { const next = renameLegacyRoleKey(request.toolOverrides); if (next) request.toolOverrides = next; }
  if (request.execution?.defaults) { const next = renameLegacyRoleKey(request.execution.defaults); if (next) request.execution.defaults = next; }
  if (!row.applied || (!row.applied.plugins.includes('studio_role') && !row.applied.plugins.includes(LEGACY_PACKAGE_NAME))) return;
  const visit = (entries: CompositionRow[]): CompositionRow[] => entries.map(entry => {
    const name = currentPluginName(entry.name);
    const config = entry.group && Array.isArray(entry.config) ? visit(entry.config as CompositionRow[])
      : name === POLICY_PLUGIN && entry.config && typeof entry.config === 'object' ? migratePolicyConfig(entry.config as Record<string, unknown>) : entry.config;
    return { ...entry, name, ...(config === undefined ? {} : { config }) };
  });
  row.applied = { ...row.applied, plugins: dump(visit(parseComposition(row.applied.plugins)), { schema: entryListSchema, noRefs: true }) };
}

const packageNames = (rows: CompositionRow[]): string[] => rows.flatMap(row => row.disabled === true ? [] : row.group && Array.isArray(row.config) ? packageNames(row.config as CompositionRow[]) : [row.name]);
/**
 * Features an older build dropped from the applied snapshot (e.g. compaction when only persona was
 * selected). Legacy data has no exclusions, so absence is never read as the user's intent; it is
 * only reported, and restoring it waits for the user to reapply.
 */
export function missingFeatures(row: Pick<StoredPreset, 'request' | 'applied'>, master: CompositionRow[] = masterComposition()): string[] {
  if (!row.applied || row.request.preset !== MASTER_PRESET_ID) return [];
  try {
    const expected = packageNames(applyConfigExclusions(master, row.request.configExclusions ?? [], row.request.configOverrides ?? {}))
      .filter(name => LEGACY_DROPPED_PACKAGES.includes(name));
    const present = new Set(packageNames(parseComposition(row.applied.plugins)));
    return expected.filter(name => !present.has(name));
  } catch { return []; }
}

/** Profile-local Studio data, never a Loader patch or profile package mutation. */
export function studioStorePath(env: NodeJS.ProcessEnv = process.env, profile?: { readonly dir: string }): string {
  const directory = profile?.dir ?? env.DSH_PROFILE_DIR;
  if (!directory) throw new Error('Studio preset persistence requires a profile');
  return join(directory, 'studio-data', 'presets.json');
}

/** Serializes mutations; retains last applied composition separately from unsaved-to-DSH drafts. */
export class PresetStore {
  private rows: StoredPreset[] = [];
  /** Current Studio Master; missing-feature checks compare against it, never against a guess. */
  private master: CompositionRow[] | undefined;
  setMaster(rows: CompositionRow[]) { this.master = structuredClone(rows); }
  private disposers = new Map<string, () => Promise<void>>();
  private ready?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private ctx: Context, private file: string) {}
  initialize(): Promise<void> {
    return this.ready ??= (async () => {
      try {
        const value = JSON.parse(await readFile(this.file, 'utf8'));
        if (value.version !== 1 || !Array.isArray(value.presets)) throw new Error('Unsupported Studio preset store');
        this.rows = value.presets;
        for (const row of this.rows) {
          if (!owned(row.id)) throw new Error('Invalid Studio preset ownership');
          parsePreviewRequest(row.request);
          migrateLegacyNames(row);
          if (row.applyWarning === retiredLegacyWarning) delete row.applyWarning;
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      for (const row of this.rows) if (row.applied) {
        try { const warnings = await this.mount(row.id, row.applied); if (warnings.length) row.applyWarning = [...new Set([row.applyWarning, ...warnings].filter(Boolean))].join('\n'); }
        catch (error) { row.applyWarning = `Restore failed: ${String(error)}`; row.status = 'modified'; }
      }
    })();
  }
  /**
   * @param strict - fail when a selected tool is missing. Apply is strict: the Master supplied every
   *   selected tool, so a gap means this preset's own exclusions removed its provider. Restore at
   *   startup is lenient and reports the gap instead.
   */
  private async mount(id: string, definition: NonNullable<StoredPreset['applied']>, strict = false) {
    const plugins = parseComposition(definition.plugins);
    const dispose = await this.ctx.agentPresets.register({ id, name: definition.name, description: definition.description, plugins: plugins as never });
    try {
      const preset = await this.ctx.agentPresets.resolve(id);
      if (preset.broken) throw new Error(preset.broken);
      // Loader activation does not create an Agent: validate its policy in a disposable
      // child as well, so missing tools and invalid overrides cannot appear applied.
      const policies = (rows: CompositionRow[]): PresetPolicyConfig[] => rows.flatMap(row => row.disabled === true ? []
        : row.group && Array.isArray(row.config) ? policies(row.config as CompositionRow[])
          : row.name === POLICY_PLUGIN ? [row.config as unknown as PresetPolicyConfig] : []);
      const configs = policies(plugins);
      const warnings: string[] = [];
      if (configs.length) {
        const lease = await this.ctx.agentPresets.acquireScope(id);
        try {
          const key = {};
          const child = createScope(this.ctx, key, { parent: lease.key });
          const releases: Array<() => void> = [];
          try {
            if (strict) {
              const missing = [...new Set(configs.flatMap(config => config.tools.filter(name => child.ctx.tools.get(name, key) === undefined)))];
              if (missing.length) throw new Error(`Selected tools are not provided by this composition: ${missing.join(', ')}. Include the plugin that provides them again, or deselect these tools.`);
            }
            for (const config of configs) releases.push(installPolicy(child.ctx, key, config, message => warnings.push(message)));
          }
          finally {
            try { for (const release of releases.reverse()) release(); }
            finally { await child.dispose(); }
          }
        } finally { await lease[Symbol.asyncDispose](); }
      }
      this.disposers.set(id, dispose);
      return warnings;
    } catch (error) { await dispose(); throw error; }
  }
  private async persist(rows: StoredPreset[]) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, presets: rows }, null, 2), { mode: 0o600 });
    // Both paths are fixed siblings of the explicit profile-local store path.
    await rename(temp, this.file);
    this.rows = rows;
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => { await this.initialize(); return action(); });
    this.tail = result.catch(() => {});
    return result;
  }
  /** Tools the Master offered at the last alignment; restore builds the template from them. */
  private templateTools: string[] | undefined;
  /** Hash of the template built from {@link templateTools}; edited rows compare against it. */
  private templateHash: string | undefined;
  private public(row: StoredPreset): StudioPreset & { template?: boolean; nonDeletable?: boolean } {
    const { applied, templateHash: _hash, ...value } = row;
    const missing = this.master ? missingFeatures(row, this.master) : [];
    const optimized = row.id === OPTIMIZED_PRESET_ID;
    const customized = optimized && edited(row);
    const newDefaults = customized && this.templateHash !== undefined && this.templateHash !== row.templateHash;
    return structuredClone({ ...value, ...(missing.length ? { missingFeatures: missing } : {}),
      ...(optimized ? { template: true, nonDeletable: true, ...(customized ? { customized: true } : {}), ...(newDefaults ? { newDefaults: true } : {}) } : {}) });
  }
  /** The template row content: shipped request and roles, plus the hash that marks them unedited. */
  private fromTemplate(row: StoredPreset, template: OptimizedTemplate): StoredPreset {
    const next: StoredPreset = { ...row, name: template.name, description: template.description, request: structuredClone(template.request),
      agents: structuredClone(template.agents), templateHash: hashOf(template), updatedAt: new Date().toISOString() };
    if (template.applyWarning) next.applyWarning = template.applyWarning; else delete next.applyWarning;
    return next;
  }
  /**
   * Seed Optimized on first run and follow the shipped template while the user has not edited it.
   * An edited Optimized is the user's: it stays as saved and reports newer defaults instead, which
   * {@link restoreOptimized} adopts. Without the alignment a profile plugin that registers a new
   * tool would enlarge the preset forever after its first seed. Applying uses the same composition
   * as user presets, so sections, roles and the child Tool Filter take effect.
   */
  ensureOptimized(tools: string[]) { return this.serial(async () => {
    const template = optimizedTemplate(tools);
    this.templateTools = [...tools]; this.templateHash = hashOf(template);
    const existing = this.rows.find(row => row.id === OPTIMIZED_PRESET_ID);
    if (!existing) {
      const now = new Date().toISOString();
      const row = this.fromTemplate({ id: template.id, name: template.name, description: template.description, request: template.request, conveniences: {}, agents: [], updatedAt: now, status: 'draft' }, template);
      await this.persist([...this.rows, row]);
      return this.applyOrReport(row, template.applyWarning);
    }
    if (edited(existing)) return this.public(existing);
    const aligned = templateKey(existing) === templateKey(template) && existing.templateHash === this.templateHash;
    const row = aligned ? existing : this.fromTemplate(existing, template);
    // A user's unapply is kept; an Optimized whose own startup apply failed is retried instead.
    const failedStartup = !existing.applied && existing.applyWarning?.includes(STARTUP_APPLY_FAILED) === true;
    if (!row.applied && !failedStartup) { if (!aligned) await this.persist(this.rows.map(item => item.id === row.id ? row : item)); return this.public(row); }
    // An unchanged template re-aligns only an applied snapshot composed by an older build (e.g. one
    // that dropped compaction); a base that cannot compose then keeps the last snapshot, as before.
    if (aligned && row.applied) {
      let current: string | undefined;
      try { current = (await this.compose(row)).plugins; } catch { current = undefined; }
      if (current === undefined || current === existing.applied!.plugins) return this.public(existing);
    }
    // A new template is applied; if that fails the previous snapshot stays mounted and the row is
    // stored as needing reapply with the cause, never as applied with values it is not running.
    return this.applyOrReport(row, template.applyWarning);
  }); }
  /**
   * Startup alignment must not take the Studio catalog down with it: a template that cannot apply
   * leaves the previous snapshot mounted (or Optimized unapplied) and reports why.
   */
  private async applyOrReport(row: StoredPreset, notice?: string) {
    try { return await this.applyRow(row, notice); }
    catch (error) {
      const current = this.rows.find(item => item.id === row.id) ?? row;
      const failed: StoredPreset = { ...row, ...(current.applied ? { applied: current.applied, status: 'modified' as const } : { status: 'draft' as const }),
        applyWarning: [notice, `${STARTUP_APPLY_FAILED} ${String(error)}`].filter(Boolean).join('\n') };
      if (!current.applied) { delete failed.applied; delete failed.appliedAt; }
      await this.persist(this.rows.map(item => item.id === row.id ? failed : item));
      return this.public(failed);
    }
  }
  /** Replace Optimized with the shipped defaults and apply them. */
  restoreOptimized() { return this.serial(async () => {
    if (!this.templateTools) throw new Error('Studio catalog is not ready; retry after it loads');
    const template = optimizedTemplate(this.templateTools);
    const row = this.fromTemplate(this.find(OPTIMIZED_PRESET_ID), template);
    return this.applyRow(row, template.applyWarning);
  }); }
  list() { return this.serial(async () => this.rows.map(row => this.public(row))); }
  /** Each preset's raw Config overrides and the module names its applied snapshot mounts (#38 D7). */
  migrationSources() { return this.serial(async () => this.rows.map(row => structuredClone({ id: row.id, name: row.name,
    overrides: (row.request.configOverrides ?? {}) as Record<string, Record<string, unknown>>,
    appliedNames: row.applied ? packageNames(parseComposition(row.applied.plugins)) : [] }))); }
  /** Presets the catalog cleanup may rewrite; an unedited Optimized follows its template instead. */
  cleanable() { return this.serial(async (): Promise<CleanablePreset[]> => this.rows.filter(row => row.id !== OPTIMIZED_PRESET_ID || edited(row)).map(row => structuredClone({ id: row.id, name: row.name, request: row.request, agents: row.agents }))); }
  /**
   * Delete confirmed removed names from saved drafts in one write. Applied snapshots stay as they
   * are (sessions that use them are not reconfigured); a changed preset is marked for reapply.
   */
  cleanup(tools: readonly string[], configs: readonly string[]) { return this.serial(async () => {
    const now = new Date().toISOString();
    const rows = this.rows.map(row => {
      if (row.id === OPTIMIZED_PRESET_ID && !edited(row)) return row;
      const request = cleanRequest(row.request, tools, configs);
      const agents = cleanRoles(row.agents, tools);
      if (JSON.stringify(request) === JSON.stringify(row.request) && JSON.stringify(agents) === JSON.stringify(row.agents)) return row;
      return { ...row, request, agents, updatedAt: now, status: row.applied ? 'modified' as const : row.status };
    });
    const changed = rows.filter((row, index) => row !== this.rows[index]).length;
    if (changed) await this.persist(rows);
    return changed;
  }); }
  save(payload: string) { return this.serial(async () => {
    const value = JSON.parse(payload);
    if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || typeof value.description !== 'string') throw new Error('Invalid preset name or description');
    const old = value.id ? this.find(value.id) : undefined;
    const row: StoredPreset = { ...old, id: old?.id ?? `studio-user-${randomUUID()}`, name: value.name.trim(), description: value.description,
      request: parsePreviewRequest(value.request), conveniences: value.conveniences ?? {}, agents: parseRoles(value.agents ?? old?.agents ?? []).map(role => {
        const prior = Array.isArray(old?.agents) ? old.agents.find(item => item.role === role.role || item.name === role.name) : undefined;
        return prior && 'overrides' in prior && !('overrides' in role) ? { ...role, overrides: prior.overrides } : role;
      }), updatedAt: new Date().toISOString(), status: old?.applied ? 'modified' : 'draft' };
    await this.persist([...this.rows.filter(item => item.id !== row.id), row]);
    return this.public(row);
  }); }
  private find(id: string) {
    if (!owned(id)) throw new Error('Only Studio-owned presets may be managed');
    const row = this.rows.find(row => row.id === id);
    if (!row) throw new Error('Studio preset not found');
    return row;
  }
  apply(id: string) { return this.serial(async () => {
    const row = this.find(id);
    // An unedited Optimized keeps reporting the optional tools its template could not select.
    const notice = row.id === OPTIMIZED_PRESET_ID && !edited(row) && this.templateTools ? optimizedTemplate(this.templateTools).applyWarning : undefined;
    return this.applyRow(row, notice);
  }); }
  /** The applied snapshot for a preset: its request and roles over the current Master. */
  private async compose(old: StoredPreset) {
    const roles = executableRoles(parseRoles(old.agents));
    const tools = delegationTools(old.request.tools, roles.length > 0);
    // The role plugin supplies subagent_role itself, so the base composition never needs to provide delegation tools.
    const { request, plugins } = await compositionPlan(this.ctx, { ...old.request, tools: tools.filter(name => name !== ROLE_TOOL) });
    for (const role of roles) await validateRoleModel(this.ctx.get('llm'), role);
    const delegates = tools.includes(ROLE_TOOL);
    const keep = <T>(entries: Record<string, T>) => Object.fromEntries(Object.entries(entries).filter(([name]) => tools.includes(name)));
    // Generic subagent tools never ship with a Studio preset; the role tool replaces them, even with no saved roles.
    // Tools hidden from every subagent. They must be tools the preset selects: DSH rejects a child
    // filter naming a tool the child could not inherit, so check here instead of at the first call.
    const presetHidden = old.request.subagentToolFilter?.deny ?? [];
    const lists = [presetHidden, ...roles.map(role => roleToolFilter(role, presetHidden))];
    const unknownHidden = [...new Set(lists.flat().filter(name => !tools.includes(name) || name === ROLE_TOOL))];
    if (delegates && unknownHidden.length) throw new Error(`Subagent Tool Filter may only list tools selected in this preset: ${unknownHidden.join(', ')}`);
    // The policy may hide any tool some role (or the default) filters; each child hides only its own list.
    const hideable = delegates ? [...new Set(lists.flat())] : [];
    const childToolFilter = hideable.length ? { deny: hideable } : undefined;
    const rolePlugins: CompositionRow[] = delegates ? [{ id: 'studio-roles', name: ROLE_PLUGIN, config: { roles, ...(presetHidden.length ? { toolFilter: { deny: [...presetHidden] } } : {}) } }] : [];
    const execution = request.execution && { ...request.execution, defaults: keep(request.execution.defaults),
      ...(request.execution.batch && !tools.includes(request.execution.batch.tool) ? { batch: undefined } : {}) };
    return { name: old.name, description: old.description, plugins: dump([...withoutDelegationPlugins(plugins), ...rolePlugins, { id: 'studio-policy', name: POLICY_PLUGIN, config: { tools: [...new Set(tools)], toolOverrides: keep(request.toolOverrides ?? {}), sections: request.sections ?? {}, prompt: request.prompt, ...(execution ? { execution } : {}), ...(childToolFilter ? { childToolFilter } : {}) } }], { schema: entryListSchema, noRefs: true }) };
  }
  /**
   * Compose, mount strictly and persist `old` as applied; on failure the previous snapshot is
   * mounted again. `notice` (the Optimized template warning) is kept beside the mount warnings.
   */
  private async applyRow(old: StoredPreset, notice?: string) {
    const id = old.id;
    const applied = await this.compose(old);
    const previous = this.rows.find(item => item.id === id)?.applied;
    await this.disposers.get(id)?.(); this.disposers.delete(id);
    try {
      const warnings = await this.mount(id, applied, true);
      const row: StoredPreset = { ...old, applied, appliedAt: new Date().toISOString(), status: 'applied' };
      // Missing selected tools no longer block: the preset applies without them and says so.
      const messages = [...new Set([notice, ...warnings].filter((text): text is string => !!text))];
      if (messages.length) row.applyWarning = messages.join('\n'); else delete row.applyWarning;
      await this.persist(this.rows.map(item => item.id === id ? row : item));
      return this.public(row);
    } catch (error) {
      await this.disposers.get(id)?.(); this.disposers.delete(id);
      if (previous) await this.mount(id, previous);
      throw error;
    }
  }
  unapply(id: string) { return this.serial(async () => {
    const old = this.find(id);
    await this.disposers.get(id)?.(); this.disposers.delete(id);
    const { applied, appliedAt, applyWarning, ...draft } = old;
    const row: StoredPreset = { ...draft, status: 'draft' };
    try { await this.persist(this.rows.map(item => item.id === id ? row : item)); }
    catch (error) { if (applied) await this.mount(id, applied); throw error; }
    return this.public(row);
  }); }
  delete(id: string) { return this.serial(async () => {
    if (id === OPTIMIZED_PRESET_ID) throw new Error('Optimized is a non-deletable built-in preset');
    const old = this.find(id);
    await this.disposers.get(id)?.(); this.disposers.delete(id);
    try { await this.persist(this.rows.filter(row => row.id !== id)); }
    catch (error) { if (old.applied) await this.mount(id, old.applied); throw error; }
    return { id };
  }); }
  async dispose() { await this.tail; for (const dispose of this.disposers.values()) await dispose(); this.disposers.clear(); }
}
