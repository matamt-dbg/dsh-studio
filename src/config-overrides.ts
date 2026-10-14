import type { CompositionRow } from './prompt-composition.ts';
export type ConfigOverrides = Record<string, Record<string, unknown>>;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export function validateConfigOverrides(value: unknown): asserts value is ConfigOverrides {
  if (!object(value)) throw new Error('Config overrides must be an object');
  const visit = (v: unknown, depth = 0) => {
    if (depth > 32) throw new Error('Config nesting exceeds 32');
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Invalid Config number');
    if (v !== null && !['object', 'string', 'number', 'boolean'].includes(typeof v)) throw new Error('Config must be JSON');
    if (Array.isArray(v)) v.forEach(child => visit(child, depth + 1));
    else if (object(v)) for (const [key, child] of Object.entries(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe Config key');
      visit(child, depth + 1);
    }
  };
  for (const patch of Object.values(value)) { if (!object(patch)) throw new Error('Plugin override must be an object'); visit(patch); }
}
/** Nested objects merge; arrays/null/scalars replace. Inputs are never mutated. */
export function mergeConfig(base: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...(object(base) ? base : {}) };
  for (const [key, value] of Object.entries(patch)) next[key] = object(value) ? mergeConfig(next[key], value) : structuredClone(value);
  return next;
}
export function configEntries(rows: CompositionRow[], parent = ''): Array<{ id: string; row: CompositionRow }> {
  return rows.flatMap(row => {
    if (!row.id) throw new Error('Master entries require stable ids');
    const id = parent ? `${parent}/${row.id}` : row.id;
    return row.group && Array.isArray(row.config) ? configEntries(row.config, id) : [{ id, row }];
  });
}
export function applyConfigOverrides(rows: CompositionRow[], overrides: ConfigOverrides): CompositionRow[] {
  validateConfigOverrides(overrides);
  if (!Object.keys(overrides).length) return structuredClone(rows);
  const entries = new Map(configEntries(rows).map(entry => [entry.id, entry.row]));
  for (const id of Object.keys(overrides)) if (!entries.has(id)) throw new Error(`Unknown master Config entry: ${id}`);
  const visit = (items: CompositionRow[], parent = ''): CompositionRow[] => items.map(row => {
    const id = parent ? `${parent}/${row.id}` : row.id!;
    return { ...row, ...(row.group && Array.isArray(row.config) ? { config: visit(row.config, id) } : overrides[id] ? { config: mergeConfig(row.config, overrides[id]) } : {}) };
  });
  return visit(rows);
}
