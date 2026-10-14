/** Studio self-update through the profile's plugin manager. Reads the registry; installs only on request. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { evaluatePluginCompatibility, getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';
import { PACKAGE_NAME, STUDIO_VERSION } from '../package-name.ts';
import { isNewer, packumentUrl, pickUpdate, type RegistryDocument, type UpdateResult, type UpdateStatus } from '../update-check.ts';

/** The plugin-manager Service methods Studio calls; present in DSH 0.2.0-rc.2 and 0.2.1-alpha.2. */
interface PluginManagerApi {
  registries(): Promise<{ registry: string | null; resolved: string | null }>;
  installBundle(spec: string, options?: { enabled?: boolean }): Promise<{
    application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled';
    version?: string;
    error?: { code: string; diagnostic?: string };
    packageResult?: { output?: string };
  }>;
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const CACHE_MS = 10 * 60_000;

/** Registry lookup and installation for the running Studio package. */
export class StudioUpdater {
  private cached: { at: number; status: Promise<UpdateStatus> } | undefined;
  private installing: Promise<UpdateResult> | undefined;
  constructor(private ctx: Context, private fetcher: typeof fetch = globalThis.fetch) {}

  private manager() { return this.ctx.get('pluginManager' as never) as unknown as PluginManagerApi | undefined; }

  /** Read the current status, reusing a recent registry answer unless `force`. */
  status(force = false): Promise<UpdateStatus> {
    if (!force && this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.status;
    const status = this.check();
    this.cached = { at: Date.now(), status };
    // A failed lookup is reported inside the status; never cache a rejected promise.
    void status.catch(() => { if (this.cached?.status === status) this.cached = undefined; });
    return status;
  }

  private async check(): Promise<UpdateStatus> {
    const result: UpdateStatus = { current: STUDIO_VERSION };
    let runtimeVersion: string | undefined;
    try { runtimeVersion = getDshRuntimeVersion(); result.runtimeVersion = runtimeVersion; } catch { /* reported as unknown */ }
    const { source, installed } = await this.profilePackage();
    if (source) result.source = source;
    // DSH can swap the Client bundle right after an install while this Host code runs until restart.
    if (installed && installed !== STUDIO_VERSION) result.installed = installed;
    const baseline = installed && isNewer(installed, STUDIO_VERSION) ? installed : STUDIO_VERSION;
    const manager = this.manager();
    if (!manager) result.blocked = 'no-plugin-manager';
    else if (!source) result.blocked = 'not-profile-dependency';
    try {
      const registries = manager ? await manager.registries().catch(() => undefined) : undefined;
      const registry = registries?.registry ?? registries?.resolved ?? DEFAULT_REGISTRY;
      const response = await this.fetcher(packumentUrl(registry, PACKAGE_NAME), {
        headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Registry answered ${response.status}`);
      const document = await response.json() as RegistryDocument;
      Object.assign(result, pickUpdate(document, baseline, manifest => {
        try { return evaluatePluginCompatibility({ name: PACKAGE_NAME, version: '0.0.0', ...manifest }, {}, runtimeVersion) === undefined; }
        catch { return false; }
      }));
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    return result;
  }

  /** How the profile declares Studio and which version its files hold now. */
  private async profilePackage(): Promise<{ source?: string; installed?: string }> {
    const dir = (this.ctx.get('profileContext' as never) as unknown as { dir?: string } | undefined)?.dir ?? process.env.DSH_PROFILE_DIR;
    if (!dir) return {};
    const json = async (path: string) => { try { return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>; } catch { return undefined; } };
    const manifest = await json(join(dir, 'package.json')) as { dependencies?: Record<string, string> } | undefined;
    const source = manifest?.dependencies?.[PACKAGE_NAME];
    const installed = (await json(join(dir, 'node_modules', ...PACKAGE_NAME.split('/'), 'package.json')))?.version;
    return { ...(source ? { source } : {}), ...(typeof installed === 'string' ? { installed } : {}) };
  }

  /**
   * Install one exact version offered by {@link status}. The running Studio keeps its code until DSH restarts.
   * @param version Exact version; must equal the current offer so arbitrary specs never reach pnpm.
   */
  update(version: string): Promise<UpdateResult> {
    if (this.installing) return this.installing;
    const run = (async (): Promise<UpdateResult> => {
      const status = await this.status();
      if (status.available !== version) throw new Error(`Version ${version} is not the offered update`);
      if (status.blocked) throw new Error(`Studio cannot update this install (${status.blocked})`);
      const manager = this.manager()!;
      const result = await manager.installBundle(`${PACKAGE_NAME}@${version}`, { enabled: true });
      const installed = result.version ?? version;
      if (result.application === 'failed' || result.application === 'cancelled') {
        const detail = result.error?.diagnostic ?? result.error?.code ?? result.packageResult?.output?.trim().split('\n').slice(-3).join('\n');
        return { status: result.application, version: installed, ...(detail ? { message: detail } : {}) };
      }
      this.cached = undefined;
      // A dependency the profile already declared is never hot-reloaded: its new files load on restart.
      return { status: result.application === 'applied' ? 'applied' : 'restart-required', version: installed };
    })();
    this.installing = run;
    return run.finally(() => { this.installing = undefined; });
  }
}
