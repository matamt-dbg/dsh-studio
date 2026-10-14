export interface PluginCatalogEntry {
  id: string;
  name: string;
  config?: unknown;
  schema?: Record<string, unknown>;
  error?: string;
}
export interface PluginCatalogLoader {
  await(): Promise<void>;
  entries(): Iterable<{ id: string; options: { name: string; config?: unknown }; parent: { tree: { import(name: string): unknown } } }>;
  unwrapExports(value: unknown): { Config?: unknown } | undefined;
}
/** Runs outside the caller's activation chain. Settlement is not activation success. */
export async function readPluginCatalog(loader: PluginCatalogLoader, project: (schema: unknown) => Promise<Record<string, unknown>>): Promise<PluginCatalogEntry[]> {
  await loader.await();
  const rows: PluginCatalogEntry[] = [];
  for (const entry of loader.entries()) {
    if (entry.options.name.startsWith('cordis:')) continue;
    const row: PluginCatalogEntry = { id: entry.id, name: entry.options.name };
    try {
      const plugin = loader.unwrapExports(await entry.parent.tree.import(entry.options.name));
      if (plugin?.Config !== undefined) row.schema = await project(plugin.Config);
    } catch (error) { row.error = String(error); }
    rows.push(row);
  }
  return rows;
}
