import type { Context } from '@deepseek-ai/cordis';
import { createConfigProjector, isNativeConfigSchema, LOADER_EXPRESSION_SCHEMA } from '@deepseek-ai/dsh-app-boot';
import { composeProfileConfig, configDiff, secretKeys, type SecretAction } from '../profile-config.ts';
import { fieldRoles, isSecretField, maskConfig, redactSecrets, schemaProperties } from '../secret-fields.ts';
import type { InstalledPlugin } from '../installed-plugins.ts';
import { detectProviders, SERVICE_GROUPS, serviceOf, type ProviderKind } from '../service-groups.ts';

interface Entry { options: { id: string; name: string; config?: unknown } }
interface ConfigEditorApi {
  entries(): Entry[];
  configuration(): Array<{ entry: Entry; inherited: Record<string, unknown>; override: Record<string, unknown> }>;
  edit(entry: Entry, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): Promise<void>;
}
interface LoaderApi { import(name: string): Promise<unknown>; unwrapExports(value: unknown): Record<string, unknown> | undefined }


export interface ProfileConfigView {
  patchId: string; name: string;
  /** Why this row is listed: an installed profile plugin, or the service a listed plugin registers into. */
  role: 'plugin' | 'service';
  schema?: Record<string, unknown>; schemaError?: string;
  /** Effective non-secret values, the inherited layer, and the fields that differ from it. */
  effective: Record<string, unknown>; inherited: Record<string, unknown>; diff: Record<string, unknown>;
  secrets: Array<{ key: string; set: boolean }>;
  /** Grouped service this row belongs to (e.g. `web`), when known. */
  service?: string;
  /** Provider ids this row registers (provider rows), from the Studio table. */
  provides?: Array<{ id: string; kind: ProviderKind }>;
  /** Owner rows: selector fields and the active provider ids each can pick. */
  selectors?: Array<{ field: string; kind: ProviderKind }>;
  /** Whether the row is running; inactive rows are listed but not editable. */
  active: boolean;
  /** `credential-ref` fields: the key name used and whether the credential store has a value (never the value). */
  credentials?: Array<{ field: string; ref: string; configured: boolean; source?: string }>;
}

/** Schema roles plus name-rule secrets (Exa `apiKey` carries no role), so an unset secret is still listed. */
function secretRoles(schema: unknown): Record<string, string> {
  return { ...Object.fromEntries(schemaProperties(schema).filter(key => isSecretField(key)).map(key => [key, 'secret'])), ...fieldRoles(schema) };
}

/** Schema default of a top-level property (`anyOf` branches included). */
function propertyDefault(schema: unknown, field: string): unknown {
  const visit = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return undefined;
    const value = node as { properties?: Record<string, { default?: unknown }>; anyOf?: unknown[] };
    if (value.properties?.[field] && 'default' in value.properties[field]!) return value.properties[field]!.default;
    for (const branch of value.anyOf ?? []) { const found = visit(branch); if (found !== undefined) return found; }
    return undefined;
  };
  return visit(schema);
}

function editorOf(ctx: Context): ConfigEditorApi {
  const editor = ctx.get('configEditor' as never) as unknown as ConfigEditorApi | undefined;
  if (!editor) throw new Error('Profile settings need the DSH configuration editor, which this profile does not load');
  return editor;
}

export async function schemaOf(ctx: Context, name: string): Promise<{ schema?: Record<string, unknown>; schemaError?: string; inject: string[]; exports: Record<string, unknown> }> {
  try {
    const loader = ctx.get('loader' as never) as unknown as LoaderApi;
    const module = loader.unwrapExports(await loader.import(name)) ?? {};
    const raw = module.inject;
    const inject = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : raw && typeof raw === 'object' ? Object.keys(raw) : [];
    // Only plain string exports are kept: enough for `*_PROVIDER_ID` recognition (S11).
    const exports = Object.fromEntries(Object.entries(module).filter(([, value]) => typeof value === 'string'));
    if (!module.Config) return { inject, exports };
    if (!isNativeConfigSchema(module.Config)) return { schemaError: 'Unsupported Config schema', inject, exports };
    const result = (await createConfigProjector())(module.Config, 'config');
    return { schema: JSON.parse(JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...result.schema, $defs: { ...result.definitions, loaderExpression: LOADER_EXPRESSION_SCHEMA } })), inject, exports };
  } catch (error) { return { schemaError: String(error), inject: [], exports: {} }; }
}

interface PluginRow { moduleName: string; enabled: boolean; fiberPhase: string | null; patchId?: string }

/**
 * Editable profile rows: installed profile-scoped plugins, and every profile row in a workflow
 * category (S10), built-in ones included, so related settings show together. Rows that run inside
 * presets never reach `configEditor.entries()`, so they cannot appear here.
 */
export async function readProfileConfigs(ctx: Context, installed: readonly InstalledPlugin[]): Promise<ProfileConfigView[]> {
  const editor = editorOf(ctx);
  const rows = new Map(editor.configuration().map(row => [row.entry.options.id, row]));
  const manager = ctx.get('pluginManager' as never) as unknown as { listPlugins(): Promise<PluginRow[]> } | undefined;
  const live = new Map((await manager?.listPlugins() ?? []).filter(row => row.patchId).map(row => [row.patchId!, row]));
  const isActive = (patchId: string) => { const row = live.get(patchId); return row ? row.enabled && row.fiberPhase === 'active' : true; };
  const wanted = new Map<string, 'plugin' | 'service'>();
  for (const plugin of installed) if (plugin.scope === 'profile' && plugin.state === 'profile-active' && plugin.patchId && rows.has(plugin.patchId)) wanted.set(plugin.patchId, 'plugin');
  for (const [patchId, row] of rows) {
    const name = row.entry.options.name;
    if (SERVICE_GROUPS.some(group => group.owner === name)) wanted.set(patchId, 'service');
    else if (serviceOf(name) && !wanted.has(patchId)) wanted.set(patchId, 'plugin');
  }
  const views: ProfileConfigView[] = [];
  for (const [patchId, role] of wanted) {
    const row = rows.get(patchId)!;
    const { schema, schemaError, inject, exports } = await schemaOf(ctx, row.entry.options.name);
    const service = serviceOf(row.entry.options.name, inject);
    const refs = Object.entries(fieldRoles(schema)).filter(([, role]) => role === 'credential-ref').map(([field]) => field);
    const credentials: NonNullable<ProfileConfigView['credentials']> = [];
    const store = ctx.get('credentials' as never) as unknown as { describe(ref: string): Promise<{ configured: boolean; source?: string }> } | undefined;
    for (const field of refs) {
      const ref = (row.entry.options.config as Record<string, unknown> | undefined)?.[field] ?? propertyDefault(schema, field);
      if (typeof ref !== 'string' || !ref) continue;
      try { const info = store ? await store.describe(ref) : { configured: false }; credentials.push({ field, ref, configured: info.configured, ...(info.source ? { source: info.source } : {}) }); }
      catch { credentials.push({ field, ref, configured: false }); }
    }
    const group = SERVICE_GROUPS.find(item => item.owner === row.entry.options.name);
    const defaults = Object.fromEntries(['providerName', 'serverName'].map(field => [field, propertyDefault(schema, field)]).filter(([, value]) => value !== undefined));
    const provides = detectProviders({ name: row.entry.options.name, ...(service ? { service } : {}), config: (row.entry.options.config ?? {}) as Record<string, unknown>, defaults, exports }).map(({ id, kind }) => ({ id, kind }));
    const roles = secretRoles(schema);
    const effective = (row.entry.options.config ?? {}) as Record<string, unknown>;
    const masked = maskConfig(effective, roles);
    views.push({ patchId, name: row.entry.options.name, role, ...(schema ? { schema } : {}), ...(schemaError ? { schemaError } : {}),
      effective: Object.fromEntries(Object.entries(masked).filter(([key]) => !secretKeys(roles, effective).includes(key))),
      inherited: Object.fromEntries(Object.entries(maskConfig(row.inherited, roles)).filter(([key]) => !secretKeys(roles, row.inherited).includes(key))),
      diff: configDiff(row.inherited, effective, roles),
      secrets: secretKeys(roles, effective, row.inherited).map(key => ({ key, set: typeof effective[key] === 'string' ? effective[key] !== '' : effective[key] !== undefined && effective[key] !== null })),
      ...(service ? { service } : {}), ...(provides.length ? { provides } : {}),
      ...(group?.selectors ? { selectors: [...group.selectors] } : {}), active: isActive(patchId), ...(credentials.length ? { credentials } : {}) });
  }
  // Owner first within a service, then providers; ungrouped rows last.
  const order = (service?: string) => { const index = SERVICE_GROUPS.findIndex(group => group.service === service); return index < 0 ? SERVICE_GROUPS.length : index; };
  return views.sort((a, b) => order(a.service) - order(b.service) || Number(a.role !== 'service') - Number(b.role !== 'service') || a.patchId.localeCompare(b.patchId));
}

/** Save one profile row through `configEditor.edit()`; only listed rows may be written. */
export async function saveProfileConfig(ctx: Context, installed: readonly InstalledPlugin[], payload: { patchId: string; diff: Record<string, unknown>; secrets?: Record<string, SecretAction> }): Promise<void> {
  const view = (await readProfileConfigs(ctx, installed)).find(item => item.patchId === payload.patchId);
  if (!view) throw new Error(`Not an editable profile setting: ${payload.patchId}`);
  if (!view.active) throw new Error(`${payload.patchId} is not running in this profile, so its settings cannot be saved here`);
  const editor = editorOf(ctx);
  const entry = editor.entries().find(item => item.options.id === payload.patchId);
  if (!entry) throw new Error(`Profile entry is no longer available: ${payload.patchId}`);
  const roles = secretRoles((await schemaOf(ctx, entry.options.name)).schema);
  // Every secret this save touches: the entry's current and inherited values, and replacements.
  const seen: Array<{ value: unknown; roles: Record<string, string> }> = [{ value: entry.options.config, roles }];
  try {
    await editor.edit(entry, (current, inherited) => {
      seen.push({ value: current, roles }, { value: inherited, roles });
      return composeProfileConfig({ inherited, current, diff: payload.diff, secrets: payload.secrets ?? {}, roles });
    });
  } catch (error) {
    const replaced = Object.fromEntries(Object.entries(payload.secrets ?? {}).flatMap(([key, action]) => action.action === 'replace' ? [[key, action.value]] : []));
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error), ...seen, { value: replaced, roles: Object.fromEntries(Object.keys(replaced).map(key => [key, 'secret'])) }));
  }
}
