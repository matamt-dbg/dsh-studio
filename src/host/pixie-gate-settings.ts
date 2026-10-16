import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

/** Gate-wide settings, kept apart from Pixie settings so the two pages never overwrite each other. */
export interface GateSettings { scriptDirectory?: string }

/** `~` expands to the home directory; anything else must already be absolute. Empty means the default folder. */
export function parseGateSettings(value: unknown): GateSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Gate settings must be an object');
  const raw = (value as { scriptDirectory?: unknown }).scriptDirectory;
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'string') throw new Error('Gate script folder must be a string');
  const text = raw.trim();
  if (!text) return {};
  const expanded = text === '~' ? homedir() : text.startsWith('~/') ? resolve(homedir(), text.slice(2)) : text;
  if (!isAbsolute(expanded)) throw new Error('Gate script folder must be an absolute path');
  return { scriptDirectory: resolve(expanded) };
}

export class PixieGateSettings {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async read(): Promise<GateSettings> {
    try { return parseGateSettings(JSON.parse(await readFile(this.file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  }
  save(value: unknown): Promise<GateSettings> {
    const run = this.tail.catch(() => {}).then(async () => {
      const settings = parseGateSettings(value);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(settings, null, 2));
      await rename(temporary, this.file);
      return settings;
    });
    this.tail = run;
    return run;
  }
}
