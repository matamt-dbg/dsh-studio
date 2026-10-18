import { OPTIMIZED_PRESET_ID } from '../optimized-preset.ts';
import type { Context } from '@deepseek-ai/cordis';
import { disabledHere } from './master-composition.ts';
import { MasterCatalog } from './master-catalog.ts';
export { disabledHere };
import { MasterExtensions, validateExtensions } from './master-extensions.ts';
import { dirname, join } from 'node:path';
import type { CompositionRow } from '../prompt-composition.ts';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

import { assemblePreview } from './prompt-preview.ts';
import type { PreviewRequest } from '../prompt-composition.ts';
import { PresetStore, studioStorePath } from './preset-store.ts';
import { MASTER_PRESET_ID, MASTER_PRESET_NAME } from '../master-preset.ts';
import { StudioUpdater } from './studio-update.ts';
import { PixieService } from './pixie-service.ts';
import { SessionRoleService } from './session-role-service.ts';
import { installRoleChildPolicies } from './role-child-policy.ts';
import { installSkill } from './skill-install.ts';
import { pixieHookSkill, pixieLoopSkill } from './pixie-hook-skill.ts';
import { CatalogBaseline } from './catalog-baseline.ts';


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
  private master: MasterCatalog;
  private updater = new StudioUpdater(this.ctx);
  constructor(ctx: Context) {
    super(ctx, 'studioCatalog');
    // Shell environment variables are not the Desktop Host's launch environment.
    const storePath = studioStorePath(process.env, ctx.get('profileContext'));
    installRoleChildPolicies(ctx, join(dirname(storePath), 'child-policies'));
    const extensions = new MasterExtensions(join(dirname(storePath), 'master-extensions.json'));
    const baseline = new CatalogBaseline(join(dirname(storePath), 'catalog-snapshot.json'));
    this.master = new MasterCatalog(ctx, extensions, baseline);
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
    this.master.start(this.store);
    ctx.effect(() => () => this.master.stop());
    ctx.effect(async () => {
      await this.store.initialize();
      return () => this.store.dispose();
    });
  }
  @Remote
  async listPresets() { const catalog = await this.master.ready(); return [{ id: MASTER_PRESET_ID, name: MASTER_PRESET_NAME, description: 'Studio Master · read-only', readOnly: true, status: 'applied' as const, agents: [], request: { preset: MASTER_PRESET_ID, providers: [], tools: catalog.tools.map(tool => tool.name), prompt: '', model: 'testLLM' } }, ...(await this.store.list()).sort((a, b) => Number(b.id === OPTIMIZED_PRESET_ID) - Number(a.id === OPTIMIZED_PRESET_ID))]; }
  @Remote
  async savePreset(payload: string) { return this.store.save(payload); }
  @Remote
  async applyPreset(id: string) { await this.master.ready(); return this.store.apply(id); }
  @Remote
  async unapplyPreset(id: string) { return this.store.unapply(id); }
  /** Replace Optimized with the shipped defaults and apply them. */
  @Remote
  async restoreOptimized() { await this.master.ready(); return this.store.restoreOptimized(); }
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
  async read() { return structuredClone(await this.master.ready()); }
  @Remote
  async readExtensions() { await this.master.ready(); return this.master.readExtensions(); }
  @Remote
  async saveExtensions(payload: string) { return this.master.replaceExtensions(validateExtensions(JSON.parse(payload))); }
  /**
   * Add one installed package to the Studio Master by name, without config (edit it as an override).
   * Activation is checked before the Master is replaced; a failure keeps the previous Master.
   */
  @Remote
  async addMasterPlugin(payload: string) {
    const name = payload.trim();
    const rows = await this.master.readExtensions();
    if (new Set([...this.master.masterNames(), ...flatNames(rows)]).has(name)) throw new Error(`Already in the Studio Master: ${name}`);
    return this.master.replaceExtensions(validateExtensions([...rows, masterAddition(name, rows)]));
  }
  @Remote
  async removeMasterPlugin(id: string) {
    const rows = await this.master.readExtensions();
    if (!rows.some(row => row.id === id)) throw new Error(`Not added by Studio: ${id}`);
    return this.master.replaceExtensions(rows.filter(row => row.id !== id));
  }
  @Remote
  async catalogChange() { return this.master.catalogChange(); }
  @Remote
  async confirmCatalogChange() { return this.master.confirmCatalogChange(); }
  @Remote
  async preview(request: PreviewRequest) { await this.master.ready(); return assemblePreview(this.ctx, request); }
}
