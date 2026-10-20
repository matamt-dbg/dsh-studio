/**
 * Register an installed profile-scoped plugin in the profile patch from Studio (#38 D4 revised).
 * The insert is appended as text so existing comments and `!!js` expressions stay untouched, the file
 * is replaced atomically (0600), and DSH applies it through the public `hmr.reconcileProfile()`
 * inside `hmr.runExclusive()` - the same path HMR uses for a hand edit. If the new row fails to
 * activate, the previous file is restored and reconciled again.
 */
import type { Context } from '@deepseek-ai/cordis';
import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dump, load } from 'js-yaml';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { snippetId } from '../profile-config.ts';
import type { InstalledPlugin } from '../installed-plugins.ts';
import { redactSecrets } from '../secret-fields.ts';

interface HmrApi {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  reconcileProfile(requiredIds?: readonly string[]): Promise<{ warnings: string[]; pending: unknown[]; restartReason?: string }>;
}
interface ProfileRowsApi { listPlugins(): Promise<Array<{ patchId?: string }>> }

/** Patch file text with one insert appended; an empty flow list (`[]`) becomes a block list. */
export function appendInsert(text: string, row: { id: string; name: string; config?: Record<string, unknown> }): string {
  const block = dump([{ insert: [{ id: row.id, name: row.name, ...(row.config && Object.keys(row.config).length ? { config: row.config } : {}) }] }], { schema: entryListSchema, noRefs: true, lineWidth: -1 });
  const lines = text.split('\n');
  const flowEmpty = lines.findIndex(line => line.trim() === '[]');
  const body = flowEmpty >= 0 && lines.every((line, index) => index === flowEmpty || line.trim() === '' || line.trim().startsWith('#'))
    ? lines.filter((_, index) => index !== flowEmpty).join('\n') : text;
  const next = `${body.replace(/\s*$/, '')}\n${block}`;
  const parsed = load(next, { schema: entryListSchema });
  if (!Array.isArray(parsed)) throw new Error('Profile patch must be a YAML list');
  return next.startsWith('\n') ? next.slice(1) : next;
}

/** A row id not used by any profile patch row: `web-search-exa`, then `web-search-exa-2`, ... */
export function uniqueRowId(entry: string, taken: ReadonlySet<string>): string {
  const base = snippetId(entry);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

async function writeAtomic(file: string, content: string) {
  const temp = join(dirname(file), `.${randomUUID()}.studio.tmp`);
  try { await writeFile(temp, content, { mode: 0o600, flag: 'wx' }); await rename(temp, file); }
  catch (error) { await unlink(temp).catch(() => undefined); throw error; }
}

export async function registerProfilePlugin(ctx: Context, installed: readonly InstalledPlugin[], payload: { entry: string; config?: Record<string, unknown> }) {
  const plugin = installed.find(item => item.entry === payload.entry);
  if (!plugin) throw new Error(`Not an installed plugin entry: ${payload.entry}`);
  if (plugin.scope !== 'profile' || plugin.state !== 'installed') throw new Error(`${payload.entry} is not a profile-wide plugin waiting for registration`);
  if (plugin.pendingPresets?.length) throw new Error(`Reapply or unapply these presets first, because they still run ${payload.entry}: ${plugin.pendingPresets.map(preset => preset.name).join(', ')}`);
  const profile = ctx.get('profileContext' as never) as unknown as { patchPath: string } | undefined;
  const hmr = ctx.get('hmr' as never) as unknown as HmrApi | undefined;
  if (!profile) throw new Error('Registration needs a profile');
  if (!hmr) throw new Error('This DSH runs without hot reload; add the shown lines to the profile patch file and restart');
  const manager = ctx.get('pluginManager' as never) as unknown as ProfileRowsApi | undefined;
  // Errors may quote any config in the profile; redact every secret the patch file or request holds.
  let existing: unknown = [];
  const safe = (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    return redactSecrets(text, { value: existing }, { value: payload.config ?? {} });
  };
  return hmr.runExclusive(async () => {
    let before: string;
    try { before = await readFile(profile.patchPath, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; before = '[]\n'; }
    // A parse error can quote the file; report only that it could not be read.
    try { existing = load(before, { schema: entryListSchema }); }
    catch { throw new Error('The profile patch file could not be parsed; fix it in a text editor and try again'); }
    const ids = new Set<string>();
    const collect = (rows: unknown) => { if (Array.isArray(rows)) for (const row of rows) if (row && typeof row === 'object') {
      const value = row as { id?: unknown; insert?: unknown }; if (typeof value.id === 'string') ids.add(value.id); collect(value.insert);
    } };
    collect(existing);
    for (const row of await manager?.listPlugins() ?? []) if (row.patchId) ids.add(row.patchId);
    const id = uniqueRowId(payload.entry, ids);
    await writeAtomic(profile.patchPath, appendInsert(before, { id, name: payload.entry, ...(payload.config ? { config: payload.config } : {}) }));
    try {
      const result = await hmr.reconcileProfile([id]);
      // Warnings describe other inactive rows and may quote their configs: return only how many.
      return { id, warnings: result.warnings.length, ...(result.restartReason ? { restartReason: result.restartReason } : {}) };
    } catch (error) {
      await writeAtomic(profile.patchPath, before);
      try { await hmr.reconcileProfile(); }
      catch (restore) {
        throw new Error(`Registration failed: ${safe(error)}. The profile patch file was restored, but reloading it also failed (${safe(restore)}); restart DSH to return to the previous state.`);
      }
      throw new Error(`Registration failed: ${safe(error)}. The profile patch file was restored.`);
    }
  });
}
