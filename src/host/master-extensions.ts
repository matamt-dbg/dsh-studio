import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CompositionRow } from '../prompt-composition.ts';

const poison = new Set(['__proto__', 'prototype', 'constructor']);
const rowKeys = new Set(['id', 'name', 'group', 'config', 'disabled', 'isolate']);
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Inspect descriptors before reading values: JSON data never contains getters or symbols. */
function keys(value: object): string[] {
  const result: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || poison.has(key)) throw new Error('Unsafe extension key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor) || (!descriptor.enumerable && !(Array.isArray(value) && key === 'length'))) {
      throw new Error('Extensions must contain JSON data only');
    }
    result.push(key);
  }
  return result;
}

function array(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an extension array');
  const own = keys(value);
  if (own.length !== value.length + 1 || own.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) {
    throw new Error('Extensions must contain dense JSON arrays');
  }
}

function json(value: unknown, depth = 0, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === null || (!Array.isArray(value) && !record(value))) {
    throw new Error('Extensions must contain JSON data only');
  }
  if (depth >= 8 || ancestors.has(value)) throw new Error('Extension config exceeds depth 8 or is cyclic');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      array(value);
      return value.map(item => json(item, depth + 1, ancestors));
    }
    return Object.fromEntries(keys(value).map(key => [key, json((value as Record<string, unknown>)[key], depth + 1, ancestors)]));
  } finally { ancestors.delete(value); }
}

/** A deliberately literal subset of Loader rows; never evaluates expression strings. */
export function validateExtensions(value: unknown): CompositionRow[] {
  let count = 0;
  function visit(input: unknown, depth: number): CompositionRow[] {
    array(input);
    if (depth > 8) throw new Error('Extensions exceed depth 8');
    const ids = new Set<string>();
    return input.map(value => {
      if (++count > 64) throw new Error('Extensions exceed 64 entries');
      if (!record(value)) throw new Error('Invalid extension row');
      const own = keys(value);
      if (own.some(key => !rowKeys.has(key))) throw new Error('Unsupported extension row key');
      if (typeof value.id !== 'string' || !idPattern.test(value.id)) throw new Error('Invalid extension id');
      if (ids.has(value.id)) throw new Error('Duplicate sibling extension id');
      ids.add(value.id);
      if (typeof value.name !== 'string' || (value.name !== 'cordis:group' && !packagePattern.test(value.name))) {
        throw new Error('Invalid extension package name');
      }
      if (own.includes('group') && typeof value.group !== 'boolean') throw new Error('Invalid extension group');
      if ((value.name === 'cordis:group') !== (value.group === true)) throw new Error('cordis:group requires group: true');
      if (own.includes('disabled') && typeof value.disabled !== 'boolean') throw new Error('Invalid extension disabled flag');
      if (own.includes('isolate')) {
        const isolate = value.isolate;
        if (!record(isolate) || keys(isolate).some(key => typeof isolate[key] !== 'boolean')) {
          throw new Error('Extension isolate must map service names to booleans');
        }
      }
      const row: CompositionRow = { id: value.id, name: value.name };
      if (own.includes('group')) row.group = value.group as boolean;
      if (own.includes('disabled')) row.disabled = value.disabled;
      if (own.includes('isolate')) row.isolate = json(value.isolate);
      if (value.group === true) row.config = visit(value.config, depth + 1);
      else if (own.includes('config')) row.config = json(value.config);
      return row;
    });
  }
  return visit(value, 1);
}

/** Profile-local extra compositions. Invalid data never replaces the previous file. */
export class MasterExtensions {
  private readonly file: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(file: string) { this.file = resolve(file); }

  async read(): Promise<CompositionRow[]> {
    await this.tail;
    let content: string;
    try { content = await readFile(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const value: unknown = JSON.parse(content);
    if (!record(value) || keys(value).some(key => !['version', 'extensions'].includes(key)) || value.version !== 1) {
      throw new Error('Unsupported Studio master extensions store');
    }
    return validateExtensions(value.extensions);
  }

  async save(rows: CompositionRow[]): Promise<void> {
    // Validate and snapshot before any I/O or waiting on an earlier save.
    const content = JSON.stringify({ version: 1, extensions: validateExtensions(rows) }, null, 2);
    const operation = this.tail.then(async () => {
      const directory = dirname(this.file);
      const temp = resolve(`${this.file}.${randomUUID()}.tmp`);
      // Both mutation targets are checked absolute siblings of the explicit store path.
      const verify = () => {
        if (resolve(this.file) !== this.file || dirname(temp) !== directory || temp === this.file) {
          throw new Error('Invalid master extensions persistence paths');
        }
      };
      verify();
      await mkdir(directory, { recursive: true, mode: 0o700 });
      let created = false;
      try {
        await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
        created = true;
        verify();
        await rename(temp, this.file);
      } finally {
        if (created) {
          verify();
          await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
