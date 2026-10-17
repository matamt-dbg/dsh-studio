import { BUILTIN_TOOL_PRESETS, OPTIMIZED_PRESET_ID } from '../optimized-preset.ts';
import type { Context } from '@deepseek-ai/cordis';
import { createConfigProjector, isNativeConfigSchema, LOADER_EXPRESSION_SCHEMA } from '@deepseek-ai/dsh-app-boot';
import type { PluginCatalogEntry } from '../plugin-catalog.ts';
import { configEntries } from '../config-overrides.ts';
import { disabledHere, MASTER_BASE_PRESET, masterComposition, pluginOrigins, standardFallback } from './master-composition.ts';
export { disabledHere };
import { MasterExtensions, validateExtensions } from './master-extensions.ts';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CompositionRow } from '../prompt-composition.ts';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { readPresetCatalog, type PresetCatalog, type CatalogServices } from '../preset-catalog.ts';

import { assemblePreview, parseComposition, promptProviders } from './prompt-preview.ts';
import type { PreviewRequest } from '../prompt-composition.ts';
import { executionCapabilities } from '../execution-capabilities.ts';
import { PresetStore, studioStorePath } from './preset-store.ts';
import { MASTER_PRESET_ID, MASTER_PRESET_NAME } from '../master-preset.ts';
import { StudioUpdater } from './studio-update.ts';
import { PixieService } from './pixie-service.ts';
import { SessionRoleService } from './session-role-service.ts';
import { installSkill } from './skill-install.ts';
import { pixieHookSkill, pixieLoopSkill } from './pixie-hook-skill.ts';
import { CatalogBaseline } from './catalog-baseline.ts';
import { catalogSnapshot, compareCatalog, type CatalogChange, type CatalogSnapshot } from '../master-snapshot.ts';


const flatRows = (rows: CompositionRow[]): CompositionRow[] => rows.flatMap(row => row.disabled === true ? [] : row.group && Array.isArray(row.config) ? flatRows(row.config as CompositionRow[]) : [row]);
const flatNames = (rows: CompositionRow[]) => flatRows(rows).map(row => row.name);

/** The row that adding package `name` puts into the Studio Master, with an id unique among `existing`. */
export function masterAddition(name: string, existing: readonly CompositionRow[]): CompositionRow {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(name)) throw new Error(`Invalid package name: ${name}`);
  const taken = new Set(existing.map(row => row.id));
  const base = (name.split('/').pop() ?? 'plugin').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 56) || 'plugin';
  let id = base; for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return { id, name };
}

/** Catalog reads and temporary composition previews; no Agents or model calls. */
export default class StudioCatalog extends TypertRemoteService {
  static inject = ['agentPresets', 'systemPrompt', 'tools', 'loader'];
  private store: PresetStore;
  private snapshot: Promise<PresetCatalog>;
  private disposeMaster?: () => Promise<void>;
  private stopped = false;
  private extensions: MasterExtensions;
  private changes: Promise<unknown> = Promise.resolve();
  private updater = new StudioUpdater(this.ctx);
  /** DSH standard as last read; the bundled copy until the first successful read. */
  private standard: CompositionRow[] = standardFallback();
  private standardSource: 'dsh' | 'fallback' = 'fallback';
  private baseline: CatalogBaseline;
  /** The newest complete collection and what it changes against the confirmed baseline. */
  private pending: { snapshot: CatalogSnapshot; change?: CatalogChange; error?: string } | undefined;
  constructor(ctx: Context) {
    super(ctx, 'studioCatalog');
    // Shell environment variables are not the Desktop Host's launch environment.
    const storePath = studioStorePath(process.env, ctx.get('profileContext'));
    this.extensions = new MasterExtensions(join(dirname(storePath), 'master-extensions.json'));
    this.baseline = new CatalogBaseline(join(dirname(storePath), 'catalog-snapshot.json'));
    this.store = new PresetStore(ctx, storePath);
    // Pixie is optional: it starts only where llm, sessionController, and commands exist.
    ctx.plugin(PixieService, dirname(storePath));
    // Session roles start where sessionController exists; the role tool reads the same files.
    ctx.plugin(SessionRoleService, dirname(storePath));
    // Agents read user skills from <DSH home>/skills; a user-edited copy is never overwritten. Failure only warns.
    const home = (ctx.get('profileContext') as { home?: string } | undefined)?.home;
    if (home) for (const bundled of [pixieHookSkill, pixieLoopSkill]) void Promise.resolve().then(() => { const skill = bundled(); return installSkill(join(home, 'skills'), skill).then(results => {
      const kept = Object.entries(results).filter(([, result]) => result === 'kept-user-edit').map(([file]) => file);
      if (kept.length) ctx.logger?.info?.(`studio: kept user-edited ${skill.name}/${kept.join(', ')}`);
    }); }).catch(error => ctx.logger?.warn?.(`studio: skill install skipped: ${String(error)}`));
    // Do not return this task from a Cordis activation effect: Loader awaits us.
    this.snapshot = new Promise<void>(resolve => { setImmediate(resolve); }).then(() => this.capture());
    // Keep failure observable to RPC callers without an unhandled rejection.
    void this.snapshot.catch(() => undefined);
    ctx.effect(() => async () => { this.stopped = true; await this.snapshot.catch(() => {}); await this.disposeMaster?.(); });
    ctx.effect(async () => {
      await this.store.initialize();
      return () => this.store.dispose();
    });
  }
  @Remote
  async listPresets() { const catalog = await this.snapshot; return [{ id: MASTER_PRESET_ID, name: MASTER_PRESET_NAME, description: 'Studio Master · read-only', readOnly: true, status: 'applied' as const, agents: [], request: { preset: MASTER_PRESET_ID, providers: [], tools: catalog.tools.map(tool => tool.name), prompt: '', model: 'testLLM' } }, ...(await this.store.list()).sort((a, b) => Number(b.id === OPTIMIZED_PRESET_ID) - Number(a.id === OPTIMIZED_PRESET_ID))]; }
  @Remote
  async savePreset(payload: string) { return this.store.save(payload); }
  @Remote
  async applyPreset(id: string) { await this.snapshot; return this.store.apply(id); }
  @Remote
  async unapplyPreset(id: string) { return this.store.unapply(id); }
  @Remote
  async roleModels() {
    const service = this.ctx.get('sessionController');
    if (!service) throw new Error('Model catalog API unavailable');
    return service.modelCatalog();
  }
  @Remote
  async updateStatus(force: string) { return this.updater.status(force === 'force'); }
  @Remote
  async updateStudio(version: string) { return this.updater.update(version); }
  @Remote
  async deletePreset(id: string) { return this.store.delete(id); }
  @Remote
  async read() { return structuredClone(await this.snapshot); }
  @Remote
  async readExtensions() { await this.snapshot; return this.extensions.read(); }
  @Remote
  async saveExtensions(payload: string) { return this.replaceExtensions(validateExtensions(JSON.parse(payload))); }
  /**
   * Add one installed package to the Studio Master by name, without config (edit it as an override).
   * Activation is checked before the Master is replaced; a failure keeps the previous Master.
   */
  @Remote
  async addMasterPlugin(payload: string) {
    const name = payload.trim();
    const rows = await this.extensions.read();
    if (new Set([...this.masterNames(), ...flatNames(rows)]).has(name)) throw new Error(`Already in the Studio Master: ${name}`);
    return this.replaceExtensions(validateExtensions([...rows, masterAddition(name, rows)]));
  }
  @Remote
  async removeMasterPlugin(id: string) {
    const rows = await this.extensions.read();
    if (!rows.some(row => row.id === id)) throw new Error(`Not added by Studio: ${id}`);
    return this.replaceExtensions(rows.filter(row => row.id !== id));
  }
  /**
   * Follow the running DSH standard. Its rows become the Master base as declared; a missing or
   * unreadable standard keeps the bundled copy and is reported as such, never a partial read.
   */
  private async readStandard() {
    try {
      const rows = parseComposition((await this.ctx.agentPresets.readDocument(MASTER_BASE_PRESET)).content);
      if (!rows.length || rows.some(row => typeof row.id !== 'string' || !row.id)) throw new Error('Standard rows need ids');
      this.standard = rows; this.standardSource = 'dsh';
    } catch { this.standard = standardFallback(); this.standardSource = 'fallback'; }
  }
  private masterNames() { return new Set(flatNames(masterComposition(this.standard))); }
  private async replaceExtensions(rows: CompositionRow[]) {
    const operation = this.changes.catch(() => {}).then(async () => {
      await this.snapshot;
      const previous = await this.extensions.read();
      // Probe activation before retiring the working master. Module loading executes code.
      const probe = `studio-probe-${randomUUID()}`;
      const dispose = await this.ctx.agentPresets.register({ id: probe, plugins: this.composition(rows) as never });
      try {
        const resolved = await this.ctx.agentPresets.resolve(probe);
        if (resolved.broken) throw new Error(resolved.broken);
      } finally { await dispose(); }
      const update = (async () => {
        await this.disposeMaster?.();
        try {
          const catalog = await this.capture(rows);
          await this.extensions.save(rows);
          return catalog;
        } catch (error) {
          await this.disposeMaster?.();
          const restored = await this.capture(previous);
          this.snapshot = Promise.resolve(restored);
          throw error;
        }
      })();
      this.snapshot = update;
      try { return await update; } catch (error) { throw error; }
    });
    this.changes = operation;
    return operation;
  }
  private composition(rows: CompositionRow[]) {
    return masterComposition(this.standard, rows);
  }
  private async capture(extra?: CompositionRow[]) {
    const project = await createConfigProjector();
    await this.ctx.loader.await();
    await this.readStandard();
    const composition = this.composition(extra ?? await this.extensions.read());
    const plugins: PluginCatalogEntry[] = [];
    for (const { id, row } of configEntries(composition)) {
      // User extension configs may contain credentials; do not echo them in the catalog.
      const item: PluginCatalogEntry = { id, name: row.name, ...(id.startsWith('studio-added/') ? {} : { config: structuredClone(row.config ?? {}) }) };
      try {
        const module = this.ctx.loader.unwrapExports(await this.ctx.loader.import(row.name));
        if (module?.Config) {
          if (!isNativeConfigSchema(module.Config)) throw new Error('Unsupported Config schema');
          const result = project(module.Config, 'config');
          item.schema = JSON.parse(JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...result.schema, $defs: { ...result.definitions, loaderExpression: LOADER_EXPRESSION_SCHEMA } }));
        }
      } catch (error) { item.error = String(error); }
      plugins.push(item);
    }
    if (this.stopped) throw new Error('Studio stopped during catalog initialization');
    // Explicit compatible baseline, not an indiscriminate union of installed plugins.
    this.disposeMaster = await this.ctx.agentPresets.register({ id: MASTER_PRESET_ID, name: MASTER_PRESET_NAME, description: 'Studio-managed read-only explicit composition', plugins: composition as never });
    const master = await this.ctx.agentPresets.resolve(MASTER_PRESET_ID);
    if (master.broken) throw new Error(`Studio Master: ${master.broken}`);
    const registry = this.ctx.get('agentPresets') as unknown as CatalogServices['agentPresets'];
    const catalog = await readPresetCatalog({
      agentPresets: { list: async () => [{ id: MASTER_PRESET_ID, name: MASTER_PRESET_NAME }, ...(await registry.list()).filter(p => BUILTIN_TOOL_PRESETS.includes(p.id as typeof BUILTIN_TOOL_PRESETS[number]))], readDocument: id => registry.readDocument(id), acquireScope: id => registry.acquireScope(id) },
      systemPrompt: this.ctx.get('systemPrompt') as unknown as CatalogServices['systemPrompt'],
      tools: this.ctx.get('tools') as unknown as CatalogServices['tools'],
    });
    if (catalog.presets[0]?.error) throw new Error(catalog.presets[0].error);
    for (const preset of catalog.presets) {
      if (preset.declaration) preset.promptProviders = promptProviders(parseComposition(preset.declaration));
    }
    const baseline = catalog.presets.find(p => p.id === MASTER_PRESET_ID)!;
    this.store.setMaster(composition);
    await this.store.ensureOptimized(baseline.tools.map(t => t.name), composition);
    catalog.plugins = plugins;
    catalog.execution = executionCapabilities(catalog.tools);
    catalog.origins = Object.fromEntries(pluginOrigins(this.standard, composition));
    catalog.base = { preset: MASTER_BASE_PRESET, source: this.standardSource };
    catalog.added = (extra ?? await this.extensions.read()).map(row => ({ id: `studio-added/${row.id}`, name: row.name }));
    await this.observe(catalog.tools, plugins, composition);
    return catalog;
  }
  /**
   * Compare a complete collection with the confirmed baseline. The first good collection becomes
   * the baseline; later differences wait for the user, so a partial or failed collection never
   * deletes preset data or replaces the baseline.
   */
  private async observe(tools: PresetCatalog['tools'], plugins: PluginCatalogEntry[], composition: CompositionRow[]) {
    const snapshot = catalogSnapshot(tools, plugins, composition);
    if (!snapshot) { this.pending = undefined; return; }
    try {
      const previous = await this.baseline.read();
      if (!previous) { await this.baseline.save(snapshot); this.pending = undefined; return; }
      const change = compareCatalog(previous, snapshot, await this.store.cleanable());
      this.pending = change ? { snapshot, change } : undefined;
      if (!change && JSON.stringify(previous) !== JSON.stringify(snapshot)) await this.baseline.save(snapshot);
    } catch (error) { this.pending = { snapshot, error: String(error) }; }
  }
  @Remote
  async catalogChange() { await this.snapshot; return this.pending ? structuredClone(this.pending.change ?? { error: this.pending.error }) : null; }
  /** Apply the shown cleanup and adopt the collection as the new baseline. Idempotent. */
  @Remote
  async confirmCatalogChange() {
    await this.snapshot;
    const pending = this.pending;
    if (!pending?.change) return { cleaned: 0 };
    // Recompute against current saved presets: edits made since the notice are cleaned too.
    const cleaned = await this.store.cleanup(pending.change.removed.tools, pending.change.removed.configs);
    await this.baseline.save(pending.snapshot);
    if (this.pending === pending) this.pending = undefined;
    return { cleaned };
  }
  @Remote
  async preview(request: PreviewRequest) { await this.snapshot; return assemblePreview(this.ctx, request); }
}
