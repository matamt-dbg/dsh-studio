import type { Context } from '@deepseek-ai/cordis';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { classifyInstalled, type InstalledPlugin, type ProfileRow } from '../installed-plugins.ts';
import { PACKAGE_NAME } from '../package-name.ts';

interface PluginManagerApi { listPlugins(): Promise<ProfileRow[]> }
interface LoaderApi { import(name: string): Promise<unknown>; unwrapExports(value: unknown): Record<string, unknown> | undefined }

/** A module exports a Cordis plugin when it has `apply` or is a class / default class. */
export function exportsPlugin(module: Record<string, unknown> | undefined): boolean {
  if (!module) return false;
  return typeof module.apply === 'function' || typeof module.default === 'function' || typeof module === 'function';
}

/** Entry specifiers a package declares through `exports`: the root plus explicit non-file subpaths. */
export function declaredEntries(name: string, manifest: { exports?: unknown }): string[] {
  const exports = manifest.exports;
  if (!exports || typeof exports !== 'object' || Array.isArray(exports)) return [name];
  const keys = Object.keys(exports);
  if (!keys.some(key => key.startsWith('.'))) return [name];
  return keys.filter(key => key === '.' || (/^\.\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(key)))
    .map(key => key === '.' ? name : `${name}/${key.slice(2)}`);
}

/**
 * Read the profile's installed plugins and classify them. Imports run module top-level code but
 * never a plugin's `apply`; only dependencies the profile manifest declares are imported.
 */
export async function readInstalledPlugins(ctx: Context, masterNames: ReadonlySet<string>, addedNames: ReadonlySet<string> = new Set()): Promise<{ plugins: InstalledPlugin[]; errors: Record<string, string> }> {
  const profile = ctx.get('profileContext' as never) as unknown as { dir: string } | undefined;
  if (!profile) throw new Error('Installed plugin detection requires a profile');
  const manifest = JSON.parse(await readFile(join(profile.dir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
  const installed: Record<string, string> = {};
  const pluginEntries: Record<string, string[]> = {};
  const errors: Record<string, string> = {};
  const require = createRequire(join(profile.dir, 'package.json'));
  const loader = ctx.get('loader' as never) as unknown as LoaderApi;
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (name === PACKAGE_NAME) continue;
    try {
      const pkg = JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8')) as { version?: string; exports?: unknown };
      installed[name] = pkg.version ?? '';
      const entries: string[] = [];
      for (const entry of declaredEntries(name, pkg)) {
        try { if (exportsPlugin(loader.unwrapExports(await loader.import(entry)))) entries.push(entry); }
        catch (error) { if (entry === name) errors[entry] = String(error); }
      }
      pluginEntries[name] = entries;
    } catch (error) { errors[name] = String(error); }
  }
  const manager = ctx.get('pluginManager' as never) as unknown as PluginManagerApi | undefined;
  const profileRows = manager ? (await manager.listPlugins()).filter(row => !row.moduleName.startsWith('cordis:')) : [];
  return { plugins: classifyInstalled({ installed, pluginEntries, masterNames, addedNames, profileRows }), errors };
}
