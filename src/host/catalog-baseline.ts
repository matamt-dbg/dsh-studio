import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CatalogSnapshot } from '../master-snapshot.ts';

const valid = (value: unknown): value is CatalogSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.version === 1 && Array.isArray(row.tools) && Array.isArray(row.configs)
    && row.tools.every(tool => tool && typeof tool.name === 'string' && typeof tool.schema === 'string')
    && row.configs.every(entry => entry && typeof entry.id === 'string' && typeof entry.name === 'string');
};

/** Profile-local last confirmed catalog. Unreadable data is reported, never silently replaced. */
export class CatalogBaseline {
  private readonly file: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(file: string) { this.file = resolve(file); }
  async read(): Promise<CatalogSnapshot | undefined> {
    await this.tail;
    let content: string;
    try { content = await readFile(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    const value: unknown = JSON.parse(content);
    if (!valid(value)) throw new Error('Unsupported Studio catalog snapshot');
    return value;
  }
  save(snapshot: CatalogSnapshot): Promise<void> {
    const content = JSON.stringify(snapshot, null, 2);
    const operation = this.tail.then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      // Temp file is a fixed-pattern sibling of the explicit profile-local path.
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try { await writeFile(temp, content, { mode: 0o600, flag: 'wx' }); await rename(temp, this.file); }
      finally { await unlink(temp).catch(() => {}); }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
