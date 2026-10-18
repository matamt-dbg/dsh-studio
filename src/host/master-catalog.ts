import type { Context } from '@deepseek-ai/cordis';
import { BUILTIN_TOOL_PRESETS } from '../optimized-preset.ts';
import { createConfigProjector, isNativeConfigSchema, LOADER_EXPRESSION_SCHEMA } from '@deepseek-ai/dsh-app-boot';
import type { PluginCatalogEntry } from '../plugin-catalog.ts';
import { configEntries } from '../config-overrides.ts';
import { MASTER_BASE_PRESET, masterComposition, pluginOrigins, standardFallback } from './master-composition.ts';
import { MasterExtensions } from './master-extensions.ts';
import { CatalogBaseline } from './catalog-baseline.ts';
import { randomUUID } from 'node:crypto';
import type { CompositionRow } from '../prompt-composition.ts';
import { readPresetCatalog, type PresetCatalog, type CatalogServices } from '../preset-catalog.ts';
import { parseComposition, promptProviders } from './prompt-preview.ts';
import { executionCapabilities } from '../execution-capabilities.ts';
import type { PresetStore } from './preset-store.ts';
import { MASTER_PRESET_ID, MASTER_PRESET_NAME } from '../master-preset.ts';
import { catalogSnapshot, compareCatalog, type CatalogChange, type CatalogSnapshot } from '../master-snapshot.ts';

const flatRows = (rows: CompositionRow[]): CompositionRow[] => rows.flatMap(row => row.disabled === true ? [] : row.group && Array.isArray(row.config) ? flatRows(row.config as CompositionRow[]) : [row]);
const flatNames = (rows: CompositionRow[]) => flatRows(rows).map(row => row.name);

/** Own the current Master registration, catalog snapshot and serialized replacement/rollback. */
export class MasterCatalog {
  private store!: PresetStore;
  private snapshot!: Promise<PresetCatalog>;
  private disposeMaster?: () => Promise<void>;
  private stopped = false;
  private changes: Promise<unknown> = Promise.resolve();
  private standard: CompositionRow[] = standardFallback();
  private standardSource: 'dsh' | 'fallback' = 'fallback';
  private pending: { snapshot: CatalogSnapshot; change?: CatalogChange; error?: string } | undefined;
  constructor(private ctx: Context, private extensions: MasterExtensions, private baseline: CatalogBaseline) {}

  /** Called at the shell's original initialization point, not during construction. */
  start(store: PresetStore) {
    this.store = store;
    this.snapshot = new Promise<void>(resolve => { setImmediate(resolve); }).then(() => this.capture());
    void this.snapshot.catch(() => undefined);
  }
  ready() { return this.snapshot; }
  readExtensions() { return this.extensions.read(); }
  async stop() { this.stopped = true; await this.snapshot.catch(() => {}); await this.disposeMaster?.(); }
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
  masterNames() { return new Set(flatNames(masterComposition(this.standard))); }
  async replaceExtensions(rows: CompositionRow[]) {
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
    await this.store.ensureOptimized(baseline.tools.map(t => t.name));
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
  async catalogChange() { await this.snapshot; return this.pending ? structuredClone(this.pending.change ?? { error: this.pending.error }) : null; }
  /** Apply the shown cleanup and adopt the collection as the new baseline. Idempotent. */
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
}
