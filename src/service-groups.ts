/**
 * Workflow categories for profile (Host) settings (#38 S8, S10-S12). Profile settings list only rows
 * that run in the profile and matter for harness/loop workflows; rows that run inside presets (tools,
 * compaction) are edited in the preset's Config, and single-implementation infrastructure is left out.
 *
 * Provider names are recognized in this order (S11): the row's `providerName`/`serverName` config or
 * schema default; then string exports named `*_PROVIDER_ID`; then the Studio table below. The export
 * convention is followed by DSH's own web providers (0.2.1-rc.2) but is not a documented DSH contract.
 */
export type ProviderKind = 'search' | 'fetch' | 'subagent' | 'mcp';
type Localized = Readonly<Record<'ko' | 'en' | 'zh', string>>;

export interface ServiceGroup {
  /** Category key; also the Host service name when one service owns it. */
  service: string;
  title: Localized;
  /** Package of the profile row that owns a provider choice, when the category has one. */
  owner?: string;
  /** Owner config fields that select a provider, by kind. */
  selectors?: ReadonlyArray<{ field: string; kind: ProviderKind }>;
  /** Packages (exact names or `prefix*`) listed in this category. */
  members: readonly string[];
}

export const SERVICE_GROUPS: readonly ServiceGroup[] = Object.freeze([
  { service: 'web', title: { ko: '웹 검색·가져오기', en: 'Web search and fetch', zh: '网页搜索与获取' }, owner: '@deepseek-ai/dsh-web',
    selectors: [{ field: 'searchProvider', kind: 'search' }, { field: 'fetchProvider', kind: 'fetch' }],
    members: ['@deepseek-ai/dsh-web', '@deepseek-ai/dsh-web-search-*', '@deepseek-ai/dsh-web-fetch-*', '@deepseek-ai/dsh-web-deepseek-api', '@matamt-dbg/dsh-web-fetch-exa'] },
  { service: 'subagents', title: { ko: '위임 공급자', en: 'Delegation providers', zh: '委派提供方' },
    members: ['@deepseek-ai/dsh-subagent-*'] },
  { service: 'guard', title: { ko: '루프 가드', en: 'Loop guards', zh: '循环防护' },
    members: ['@deepseek-ai/dsh-repeat-tool-reminder', '@deepseek-ai/dsh-tool-call-timeout-policy', '@deepseek-ai/dsh-session-checkpoint-policy'] },
  { service: 'goals', title: { ko: '목표 자동 진행', en: 'Goal continuation', zh: '目标自动推进' },
    members: ['@deepseek-ai/dsh-goal', '@deepseek-ai/dsh-goal-round-driver'] },
  { service: 'context', title: { ko: '컨텍스트 관리(공용)', en: 'Context management (shared)', zh: '上下文管理（共享）' },
    members: ['@deepseek-ai/dsh-compaction-image-offload', '@deepseek-ai/dsh-spill-local'] },
  { service: 'mcp', title: { ko: 'MCP 서버', en: 'MCP servers', zh: 'MCP 服务器' },
    members: ['@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-mcp-resources'] },
  { service: 'llm', title: { ko: '모델 재시도·측정', en: 'Model retry and metering', zh: '模型重试与计量' },
    members: ['@deepseek-ai/dsh-llm-retry', '@deepseek-ai/dsh-token-meter'] },
]);

/** Fallback provider table (step ③): ids read from DSH 0.2.1-rc.2 provider packages, plus the Studio Exa contents provider (#39). */
export const KNOWN_PROVIDERS: Readonly<Record<string, ReadonlyArray<{ id: string; kind: ProviderKind }>>> = Object.freeze({
  '@deepseek-ai/dsh-web-search-exa': [{ id: 'exa', kind: 'search' }],
  '@deepseek-ai/dsh-web-search-deepseek': [{ id: 'deepseek-official', kind: 'search' }],
  '@deepseek-ai/dsh-web-search-perplexity': [{ id: 'perplexity', kind: 'search' }],
  '@deepseek-ai/dsh-web-deepseek-api': [{ id: 'deepseek-search-api', kind: 'search' }, { id: 'deepseek-fetch-api', kind: 'fetch' }],
  '@deepseek-ai/dsh-web-fetch-http': [{ id: 'http', kind: 'fetch' }],
  '@matamt-dbg/dsh-web-fetch-exa': [{ id: 'exa-contents', kind: 'fetch' }],
});

const matchMember = (pattern: string, name: string) => pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name;

export function groupOfService(service: string | undefined): ServiceGroup | undefined {
  return SERVICE_GROUPS.find(group => group.service === service);
}

/** Category of a package: a listed member, else the first category whose service it injects. */
export function serviceOf(name: string, inject: readonly string[] = []): string | undefined {
  const listed = SERVICE_GROUPS.find(group => group.members.some(pattern => matchMember(pattern, name)));
  if (listed) return listed.service;
  return inject.find(service => groupOfService(service));
}

export function groupTitle(service: string | undefined, locale: string): string | undefined {
  const group = groupOfService(service);
  if (!group) return undefined;
  return group.title[locale.startsWith('ko') ? 'ko' : locale.startsWith('zh') ? 'zh' : 'en'];
}

/** Provider kind implied by a service and a name (`web` needs SEARCH/FETCH in the name). */
function kindFor(service: string | undefined, hint: string): ProviderKind | undefined {
  if (service === 'subagents') return 'subagent';
  if (service === 'mcp') return 'mcp';
  if (/search/i.test(hint)) return 'search';
  if (/fetch/i.test(hint)) return 'fetch';
  return undefined;
}

/**
 * Provider ids a row registers (S11). `config` is the row's effective config, `defaults` its schema
 * defaults, `exports` the module's own exports.
 */
export function detectProviders(input: { name: string; service?: string; config?: Record<string, unknown>; defaults?: Record<string, unknown>; exports?: Record<string, unknown> }): Array<{ id: string; kind: ProviderKind; source: 'config' | 'export' | 'table' }> {
  for (const field of ['providerName', 'serverName']) {
    const value = input.config?.[field] ?? input.defaults?.[field];
    const kind = field === 'serverName' ? 'mcp' : kindFor(input.service, input.name);
    if (typeof value === 'string' && value && kind) return [{ id: value, kind, source: 'config' }];
  }
  const exported = Object.entries(input.exports ?? {})
    .filter(([key, value]) => /^[A-Z][A-Z0-9_]*_PROVIDER_ID$/.test(key) && typeof value === 'string' && value)
    .flatMap(([key, value]) => { const kind = kindFor(input.service, `${key} ${input.name}`); return kind ? [{ id: value as string, kind, source: 'export' as const }] : []; });
  if (exported.length) return exported;
  return (KNOWN_PROVIDERS[input.name] ?? []).map(provider => ({ ...provider, source: 'table' as const }));
}

/**
 * Options for one selector: ids of active providers of that kind, plus the current value when it is
 * not among them (kept visible rather than silently replaced).
 */
export function selectorOptions(kind: ProviderKind, active: ReadonlyArray<{ id: string; kind: ProviderKind }>, current: unknown): Array<{ id: string; known: boolean }> {
  const ids = [...new Set(active.filter(provider => provider.kind === kind).map(provider => provider.id))].sort();
  const options = ids.map(id => ({ id, known: true }));
  if (typeof current === 'string' && current && !ids.includes(current)) options.push({ id: current, known: false });
  return options;
}

/** Lower-case text match over every given field; an empty query matches everything. */
export function matchesQuery(query: string, ...fields: ReadonlyArray<string | undefined>): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every(word => text.includes(word));
}
