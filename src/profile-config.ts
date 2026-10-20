/**
 * Profile-scoped plugin settings (#38 S5/S6). DSH `configEditor.edit()` writes one complete config
 * per profile row, and a config equal to the inherited one removes the override. The page edits only
 * the fields that differ from the inherited layer; secret fields travel separately as keep / replace /
 * delete so a masked value never round-trips.
 */
import { mergeConfig } from './config-overrides.ts';
import { isSecretField, maskValue, restoreMasked } from './secret-fields.ts';

type Config = Record<string, unknown>;
const obj = (v: unknown): v is Config => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type SecretAction = { action: 'keep' } | { action: 'delete' } | { action: 'replace'; value: string };

/**
 * Top-level fields of `effective` that differ from `inherited`, top-level secrets excluded and nested
 * secrets replaced by presence markers. A save restores those markers from the current config.
 */
export function configDiff(inherited: unknown, effective: unknown, roles: Readonly<Record<string, string>> = {}): Config {
  const base = obj(inherited) ? inherited : {};
  const next = obj(effective) ? effective : {};
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => !isSecretField(key, roles) && !same(base[key], value)).map(([key, value]) => [key, maskValue(value, roles)]));
}

/** Secret field names present in either layer or declared by the schema roles. */
export function secretKeys(roles: Readonly<Record<string, string>>, ...layers: unknown[]): string[] {
  const keys = new Set(Object.entries(roles).filter(([, role]) => role === 'secret').map(([key]) => key));
  for (const layer of layers) if (obj(layer)) for (const key of Object.keys(layer)) if (isSecretField(key, roles)) keys.add(key);
  return [...keys].sort();
}

/**
 * The complete config to hand to `configEditor.edit()`.
 * @param current - the entry's effective raw config (source of kept secrets).
 * @param diff - non-secret fields that should differ from `inherited`; other non-secret fields follow it.
 */
export function composeProfileConfig(input: { inherited: unknown; current: unknown; diff: Config; secrets: Readonly<Record<string, SecretAction>>; roles?: Readonly<Record<string, string>> }): Config {
  const roles = input.roles ?? {};
  const inherited = obj(input.inherited) ? input.inherited : {};
  const current = obj(input.current) ? input.current : {};
  for (const key of Object.keys(input.diff)) if (isSecretField(key, roles)) throw new Error(`Secret field ${key} must be sent as a secret action`);
  const plain = Object.fromEntries(Object.entries(inherited).filter(([key]) => !isSecretField(key, roles)));
  const next = mergeConfig(plain, input.diff);
  // Shallow replace, not merge: a diff value is the whole field. Nested secret markers take the current value.
  for (const [key, value] of Object.entries(input.diff)) next[key] = restoreMasked(value, current[key] ?? inherited[key]);
  for (const key of secretKeys(roles, inherited, current, input.secrets)) {
    const action = input.secrets[key] ?? { action: 'keep' };
    if (action.action === 'replace') {
      if (typeof action.value !== 'string' || !action.value) throw new Error(`Enter a value for ${key}`);
      next[key] = action.value;
    } else if (action.action === 'keep' && Object.hasOwn(current, key)) next[key] = structuredClone(current[key]);
  }
  return next;
}

/** `cordis.patch.yml` insert for a profile-scoped package; secrets become placeholders. */
export function profileSnippet(entry: string, id: string, keys: readonly string[] = []): string {
  const lines = ['- insert:', `    - id: ${id}`, `      name: '${entry.replace(/'/g, "''")}'`];
  if (keys.length) lines.push('      config:', ...keys.map(key => `        ${key}: <${key}>`));
  return `${lines.join('\n')}\n`;
}

/** Default patch id for a package entry: last path segment without the `dsh-` prefix. */
export function snippetId(entry: string): string {
  const last = entry.split('/').pop() ?? 'plugin';
  return last.replace(/^dsh-/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin';
}
