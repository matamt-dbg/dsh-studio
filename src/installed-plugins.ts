/**
 * Classify installed plugin entry points by where they can run (#38 D1a). Evidence only:
 * a row already in the Master is agent-scoped; a row the profile already runs is profile-scoped;
 * otherwise the Studio compatibility table decides; anything else is `unknown`. A successful probe
 * is never evidence (repeat-tool-reminder and llm-retry pass it yet are profile-scoped).
 */
export type PluginScope = 'agent' | 'profile' | 'unknown';
export type PluginEvidence = 'master' | 'profile-row' | 'compatibility' | 'none';
export type PluginState = 'in-master' | 'profile-active' | 'profile-inactive' | 'profile-failed' | 'profile-unaddressable' | 'installed';

export interface InstalledPlugin {
  /** Package the entry belongs to. */
  package: string;
  /** Module specifier (package or package subpath). */
  entry: string;
  version?: string;
  scope: PluginScope;
  evidence: PluginEvidence;
  state: PluginState;
  /** Profile patch id when the profile runs this entry. */
  patchId?: string;
  /**
   * Applied Studio presets whose snapshot still mounts this profile-scoped entry. Registering it in the
   * profile before they are reapplied or unapplied would register it twice, so registration waits (D7).
   */
  pendingPresets?: Array<{ id: string; name: string }>;
}

/** One live profile row as `pluginManager.listPlugins()` reports it. */
export interface ProfileRow {
  moduleName: string;
  enabled: boolean;
  fiberPhase: string | null;
  patchId?: string;
  readOnlyReason?: string;
}

/**
 * Verified entry points (S1 table and #32 S1). Patterns match the module specifier; first match wins.
 * Profile: providers and singletons registering into Host services. Agent: tools proven to mount per preset.
 */
export const COMPATIBILITY: ReadonlyArray<{ pattern: RegExp; scope: Exclude<PluginScope, 'unknown'> }> = Object.freeze([
  { pattern: /^@deepseek-ai\/dsh-web-search-[a-z0-9-]+$/, scope: 'profile' },
  { pattern: /^@deepseek-ai\/dsh-web-fetch-[a-z0-9-]+$/, scope: 'profile' },
  { pattern: /^@deepseek-ai\/dsh-session-title(-[a-z0-9-]+)?$/, scope: 'profile' },
  { pattern: /^@deepseek-ai\/dsh-token-meter$/, scope: 'profile' },
  { pattern: /^@deepseek-ai\/dsh-jobs(-[a-z0-9-]+)?$/, scope: 'profile' },
  { pattern: /^@deepseek-ai\/dsh-compaction-image-offload$/, scope: 'profile' },
  { pattern: /^@deepseek-ai\/dsh-bash-sandbox$/, scope: 'profile' },
  { pattern: /^@deepseek-ai\/dsh-repeat-tool-reminder$/, scope: 'profile' },
  { pattern: /^@deepseek-ai\/dsh-llm-retry$/, scope: 'profile' },
  { pattern: /^@deepseek-ai\/dsh-tool-subagent$/, scope: 'agent' },
] as const);

/** Package name of a module specifier (`@scope/pkg/sub` → `@scope/pkg`). */
export function packageOf(entry: string): string {
  const parts = entry.split('/');
  return entry.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

function profileState(rows: readonly ProfileRow[]): PluginState {
  if (rows.length !== 1 || rows.some(row => !row.patchId)) return 'profile-unaddressable';
  const row = rows[0]!;
  if (!row.enabled) return 'profile-inactive';
  return row.fiberPhase === 'active' ? 'profile-active' : 'profile-failed';
}

/**
 * Classify every entry the profile declares or runs.
 * @param installed - profile dependencies: package name → version.
 * @param pluginEntries - per installed package, the entry specifiers that export a plugin (empty to skip a library).
 * @param masterNames - module names DSH standard and the Studio layer compose (not user additions).
 * @param addedNames - module names the user added to the Master; their scope still comes from evidence,
 *   so a profile-scoped addition from an older build is reported for migration (D7).
 * @param profileRows - live profile rows (`pluginManager.listPlugins()`), Master rows excluded by the caller.
 */
export function classifyInstalled(input: {
  installed: Readonly<Record<string, string>>;
  pluginEntries: Readonly<Record<string, readonly string[]>>;
  masterNames: ReadonlySet<string>;
  addedNames?: ReadonlySet<string>;
  profileRows: readonly ProfileRow[];
}): InstalledPlugin[] {
  const byModule = new Map<string, ProfileRow[]>();
  for (const row of input.profileRows) byModule.set(row.moduleName, [...(byModule.get(row.moduleName) ?? []), row]);
  const entries = new Set<string>();
  for (const [name, list] of Object.entries(input.pluginEntries)) if (Object.hasOwn(input.installed, name)) for (const entry of list) entries.add(entry);
  const result: InstalledPlugin[] = [];
  for (const entry of [...entries].sort()) {
    const pkg = packageOf(entry);
    const version = input.installed[pkg];
    const base = { package: pkg, entry, ...(version ? { version } : {}) };
    const rows = byModule.get(entry) ?? [];
    if (input.masterNames.has(entry)) { result.push({ ...base, scope: 'agent', evidence: 'master', state: 'in-master' }); continue; }
    if (rows.length) {
      const patchId = rows.length === 1 ? rows[0]!.patchId : undefined;
      result.push({ ...base, scope: 'profile', evidence: 'profile-row', state: profileState(rows), ...(patchId ? { patchId } : {}) });
      continue;
    }
    const known = COMPATIBILITY.find(item => item.pattern.test(entry));
    const added = input.addedNames?.has(entry) === true;
    // A user addition that probed and mounted is evidence it runs per preset unless the table says otherwise.
    result.push({ ...base, scope: known?.scope ?? (added ? 'agent' : 'unknown'), evidence: known ? 'compatibility' : added ? 'master' : 'none', state: added ? 'in-master' : 'installed' });
  }
  return result;
}

/** Why an entry may not join the Studio Master, or undefined when it may. */
export function masterRefusal(plugin: Pick<InstalledPlugin, 'entry' | 'scope' | 'evidence'>): string | undefined {
  if (plugin.scope !== 'profile') return undefined;
  return plugin.evidence === 'profile-row'
    ? `${plugin.entry} already runs in the profile; a second copy in the Studio Master would register into the same Host service. Configure it under Profile settings instead.`
    : `${plugin.entry} registers into a Host service shared by every session; register it in the profile (cordis.patch.yml) and configure it under Profile settings instead.`;
}
