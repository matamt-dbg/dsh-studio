import { BUILTIN_TOOL_PRESETS, OPTIMIZED_PRESET_ID } from '../optimized-preset.ts';
import type { Context } from '@deepseek-ai/cordis';
import { createConfigProjector, isNativeConfigSchema, LOADER_EXPRESSION_SCHEMA } from '@deepseek-ai/dsh-app-boot';
import type { PluginCatalogEntry } from '../plugin-catalog.ts';
import { configEntries } from '../config-overrides.ts';
import { masterComposition } from './master-composition.ts';
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


/** Catalog reads and temporary composition previews; no Agents or model calls. */
export default class StudioCatalog extends TypertRemoteService {
  static inject = ['agentPresets', 'systemPrompt', 'tools', 'loader'];
  private store: PresetStore;
  private snapshot: Promise<PresetCatalog>;
  private disposeMaster?: () => Promise<void>;
  private stopped = false;
  private extensions: MasterExtensions;
  private changes: Promise<unknown> = Promise.resolve();
  constructor(ctx: Context) {
    super(ctx, 'studioCatalog');
    // Shell environment variables are not the Desktop Host's launch environment.
    const storePath = studioStorePath(process.env, ctx.get('profileContext'));
    this.extensions = new MasterExtensions(join(dirname(storePath), 'master-extensions.json'));
    this.store = new PresetStore(ctx, storePath);
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
  async deletePreset(id: string) { return this.store.delete(id); }
  @Remote
  async read() { return structuredClone(await this.snapshot); }
  @Remote
  async readExtensions() { await this.snapshot; return this.extensions.read(); }
  @Remote
  async saveExtensions(payload: string) {
    const rows = validateExtensions(JSON.parse(payload));
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
    return [...masterComposition(), ...(rows.length ? [{ id: 'studio-added', name: 'cordis:group', group: true, config: rows }] : [])];
  }
  private async capture(extra?: CompositionRow[]) {
    const project = await createConfigProjector();
    await this.ctx.loader.await();
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
    await this.store.ensureOptimized(baseline.tools.map(t => t.name), composition);
    catalog.plugins = plugins;
    catalog.execution = executionCapabilities(catalog.tools);
    return catalog;
  }
  @Remote
  async preview(request: PreviewRequest) { await this.snapshot; return assemblePreview(this.ctx, request); }
}
