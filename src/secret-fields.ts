/**
 * Secret Config fields (#38 D6). A projected schema marks them with `x-cordis.role: secret`; a field
 * without a role is secret when its name says so (Exa `apiKey`). `credential-ref` fields hold a key
 * name, not a value, and are never masked. Roles and the name rule apply at every depth: a nested
 * `auth.apiKey` is masked like a top-level one.
 */
export const SECRET_MASK = Object.freeze({ secret: true, set: true } as const);
export type MaskedSecret = typeof SECRET_MASK | { secret: true; set: false };

/** Words of a camelCase / snake / kebab name: `githubToken` → `github token`. */
const words = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_-]+/).filter(Boolean);
const SECRET_WORDS = new Set(['token', 'secret', 'password', 'passwd', 'apikey']);
type Schema = Record<string, unknown>;
const obj = (v: unknown): v is Schema => !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether a value is a presence marker produced by {@link maskConfig}. */
export function isMask(value: unknown): value is MaskedSecret {
  return obj(value) && value.secret === true && typeof value.set === 'boolean' && Object.keys(value).length === 2;
}

/** Field roles from a projected Config schema, by property name at any depth (`anyOf`, `items`, `$defs` included). */
export function fieldRoles(schema: unknown): Record<string, string> {
  const roles: Record<string, string> = {};
  const seen = new Set<unknown>();
  const visit = (node: unknown, depth: number) => {
    if (!obj(node) || seen.has(node) || depth > 32) return;
    seen.add(node);
    if (obj(node.properties)) for (const [key, field] of Object.entries(node.properties)) {
      const role = obj(field) && obj(field['x-cordis']) ? field['x-cordis'].role : undefined;
      if (typeof role === 'string' && roles[key] === undefined) roles[key] = role;
      visit(field, depth + 1);
    }
    for (const key of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(node[key])) (node[key] as unknown[]).forEach(child => visit(child, depth + 1));
    for (const key of ['items', 'additionalProperties']) visit(node[key], depth + 1);
    if (obj(node.$defs)) Object.values(node.$defs).forEach(child => visit(child, depth + 1));
  };
  visit(schema, 0);
  return roles;
}

/** Top-level property names of a projected Config schema. */
export function schemaProperties(schema: unknown): string[] {
  const keys = new Set<string>();
  const visit = (node: unknown) => {
    if (!obj(node)) return;
    if (obj(node.properties)) for (const key of Object.keys(node.properties)) keys.add(key);
    if (Array.isArray(node.anyOf)) node.anyOf.forEach(visit);
  };
  visit(schema);
  return [...keys];
}

export function isSecretField(key: string, roles: Readonly<Record<string, string>> = {}): boolean {
  const role = roles[key];
  if (role !== undefined) return role === 'secret';
  const list = words(key);
  const last = list.at(-1) ?? '';
  return SECRET_WORDS.has(last) || (last === 'key' && list.at(-2) === 'api');
}

const marker = (value: unknown): MaskedSecret => value === undefined || value === null || value === '' ? { secret: true, set: false } : SECRET_MASK;

/** Deep copy with every secret value (any depth, arrays included) replaced by a presence marker. */
export function maskValue(value: unknown, roles: Readonly<Record<string, string>> = {}, depth = 0): unknown {
  if (depth > 32) return null;
  if (Array.isArray(value)) return value.map(item => maskValue(item, roles, depth + 1));
  if (!obj(value)) return structuredClone(value);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, isSecretField(key, roles) ? marker(child) : maskValue(child, roles, depth + 1)]));
}

/** Copy of a config with secret values at any depth replaced by presence markers. */
export function maskConfig(config: unknown, roles: Readonly<Record<string, string>> = {}): Record<string, unknown> {
  return obj(config) ? maskValue(config, roles) as Record<string, unknown> : {};
}

/**
 * Put back secrets a client saw only as markers: each marker in `next` takes the value at the same
 * path in `current`, or is dropped when `current` has none. A client can therefore never write a
 * marker object into a config, and never needs the secret to keep it.
 */
export function restoreMasked(next: unknown, current: unknown, depth = 0): unknown {
  if (depth > 32) return next;
  if (Array.isArray(next)) return next.map((item, index) => restoreMasked(item, Array.isArray(current) ? current[index] : undefined, depth + 1));
  if (!obj(next)) return next;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    const prior = obj(current) ? current[key] : undefined;
    if (isMask(value)) { if (prior !== undefined) result[key] = structuredClone(prior); continue; }
    result[key] = restoreMasked(value, prior, depth + 1);
  }
  return result;
}

/** Whether a row offers anything to edit: a secret control or a non-secret schema property. */
export function hasEditableFields(schema: unknown, secretCount: number): boolean {
  if (secretCount > 0) return true;
  return schemaProperties(withoutSecrets(schema)).length > 0;
}

/** Copy of a projected schema without top-level secret properties; those get their own keep/replace/delete control. */
export function withoutSecrets<T>(schema: T, roles: Readonly<Record<string, string>> = fieldRoles(schema)): T {
  const visit = (node: unknown): unknown => {
    if (!obj(node)) return node;
    const next: Schema = { ...node };
    if (obj(node.properties)) next.properties = Object.fromEntries(Object.entries(node.properties).filter(([key]) => !isSecretField(key, roles)));
    if (Array.isArray(node.anyOf)) next.anyOf = node.anyOf.map(visit);
    return next;
  };
  return visit(schema) as T;
}

/** Every non-empty secret string value in `value`, at any depth. */
export function secretValues(value: unknown, roles: Readonly<Record<string, string>> = {}, depth = 0): string[] {
  if (depth > 32) return [];
  if (Array.isArray(value)) return value.flatMap(item => secretValues(item, roles, depth + 1));
  if (!obj(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => isSecretField(key, roles)
    ? (typeof child === 'string' && child ? [child] : typeof child === 'number' ? [String(child)] : secretValues(child, roles, depth + 1))
    : secretValues(child, roles, depth + 1));
}

export const WITHHELD = 'details were withheld because they may contain a secret value';

/**
 * Text safe to return to a client: every secret found in `sources` is replaced with `<secret>`. A
 * secret shorter than 4 characters cannot be replaced without mangling the text, so a text that
 * contains one is withheld entirely.
 */
export function redactSecrets(text: string, ...sources: Array<{ value: unknown; roles?: Readonly<Record<string, string>> }>): string {
  const all = [...new Set(sources.flatMap(source => secretValues(source.value, source.roles ?? {})))].sort((a, b) => b.length - a.length);
  if (all.some(secret => secret.length < 4 && text.includes(secret))) return WITHHELD;
  let result = text;
  for (const secret of all) result = result.split(secret).join('<secret>');
  return result;
}
