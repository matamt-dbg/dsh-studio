import React from 'react';
import { CONFIG_REQUIRES } from './config-overrides.ts';
import { isDelegationPlugin } from './delegation.ts';
import { pluginPurpose, pluginTitle } from './plugin-labels.ts';
import { ItemPicker, type PickerItem } from './item-picker.tsx';
import type { PluginCatalogEntry } from './plugin-catalog.ts';
import { Badge, Button, DetailDialog, Notice, SectionHead } from './ui.tsx';

/** Host actions that change which plugins the Studio Master offers. Adding lives in the Plugins service (#38). */
export interface MasterPluginActions { remove(id: string): Promise<void> }

type Locale = 'ko' | 'en' | 'zh';
type Copy = Record<'title' | 'hint' | 'included' | 'excluded' | 'overridden' | 'defaults' | 'follows' | 'requires' | 'addedTag' | 'autoOff' | 'autoOn' | 'declared'
  | 'search' | 'searchHint' | 'filter' | 'all' | 'empty' | 'noResults' | 'clear' | 'settings' | 'done' | 'modified' | 'modifiedTag'
  | 'add' | 'addTitle' | 'addHint' | 'addedList' | 'remove' | 'fallback', string> & Record<string, string>;
const copy: Record<Locale, Copy> = {
  ko: { title: '포함할 플러그인', hint: '기준은 DSH standard 프리셋이고, Studio가 더한 플러그인과 직접 추가한 플러그인을 함께 보여 줍니다. 모두 기본으로 포함되며, 끄면 이 프리셋에서 빠집니다. 값만 바꾸려면 아래 Config에서 덮어쓰세요. 선택한 도구를 제공하는 플러그인을 끄면 반영할 때 막힙니다.',
    included: '포함', excluded: '제외', overridden: '덮어쓰기', defaults: '기본값', follows: '함께 제외', requires: '필요: ', addedTag: '추가함', fallback: '실행 중인 DSH의 standard 프리셋을 읽지 못해 Studio에 들어 있는 standard 사본을 기준으로 씁니다.', origin_standard: 'standard', origin_studio: 'Studio', origin_added: '추가함',
    autoOff: '자동 압축 꺼짐 (auto: false)', autoOn: '자동 압축 켜짐', declared: '선언 기준이며 실행 중 세션의 상태는 아닙니다.',
    search: '플러그인 검색', searchHint: '플러그인 이름이나 ID로 검색', filter: '보기', all: '전체', empty: '플러그인이 없습니다.', noResults: '검색 결과가 없습니다.', clear: '전체 보기', settings: '설정', done: '완료', modified: '변경됨', modifiedTag: '변경됨',
    add: 'Studio가 추가한 플러그인', addTitle: 'Studio가 추가한 플러그인', addHint: '새 플러그인은 Studio → 플러그인에서 설치한 플러그인을 포함해 추가합니다. 여기서는 이미 추가한 플러그인을 뜁니다.',
    addedList: 'Studio가 추가한 플러그인', remove: '제거' },
  en: { title: 'Included plugins', hint: 'The base is the DSH standard preset, shown with the plugins Studio adds and the ones you added. All are included by default; turning one off leaves it out of this preset. To change values only, override them in Config below. Applying is blocked if a selected tool loses its plugin.',
    included: 'Included', excluded: 'Excluded', overridden: 'Override', defaults: 'Defaults', follows: 'Excluded with dependency', requires: 'Requires: ', addedTag: 'Added', fallback: 'Could not read the running DSH standard preset, so the copy bundled with Studio is used as the base.', origin_standard: 'standard', origin_studio: 'Studio', origin_added: 'Added',
    autoOff: 'Automatic compaction off (auto: false)', autoOn: 'Automatic compaction on', declared: 'Shows the declaration, not the state of a running session.',
    search: 'Search plugins', searchHint: 'Search plugin names or IDs', filter: 'Show', all: 'All', empty: 'No plugins.', noResults: 'No matching results.', clear: 'Show all', settings: 'Settings', done: 'Done', modified: 'Modified', modifiedTag: 'Modified',
    add: 'Plugins added by Studio', addTitle: 'Plugins added by Studio', addHint: 'Add new plugins by including installed ones in Studio → Plugins. This lists the ones already added so you can remove them.',
    addedList: 'Plugins added by Studio', remove: 'Remove' },
  zh: { title: '包含的插件', hint: '基础为 DSH standard 预设，并显示 Studio 添加的插件和您添加的插件。默认全部包含，关闭后将从此预设中移除；如只需修改值，请在下方 Config 中覆盖。若已选工具失去其插件，将无法应用',
    included: '包含', excluded: '排除', overridden: '覆盖', defaults: '默认值', follows: '随依赖排除', requires: '需要：', addedTag: '已添加', fallback: '无法读取正在运行的 DSH standard 预设，因此使用 Studio 内置的 standard 副本作为基础', origin_standard: 'standard', origin_studio: 'Studio', origin_added: '已添加',
    autoOff: '自动压缩已关闭 (auto: false)', autoOn: '自动压缩已开启', declared: '显示的是声明，而非运行中会话的状态',
    search: '搜索插件', searchHint: '按插件名称或 ID 搜索', filter: '显示', all: '全部', empty: '没有插件', noResults: '没有匹配结果', clear: '显示全部', settings: '设置', done: '完成', modified: '已修改', modifiedTag: '已修改',
    add: 'Studio 添加的插件', addTitle: 'Studio 添加的插件', addHint: '新插件请在 Studio → 插件中加入已安装的插件。此处列出已添加的插件以便移除',
    addedList: 'Studio 添加的插件', remove: '移除' },
};
export const localeOf = (locale: string): Locale => locale.startsWith('ko') ? 'ko' : locale.startsWith('zh') ? 'zh' : 'en';
export const featureLabel = (name: string, locale: string) => pluginTitle(name, locale);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** One row's three-way state: excluded wins; otherwise an override key, otherwise DSH defaults. */
export function featureState(id: string, overrides: Record<string, unknown>, excluded: readonly string[]): 'defaults' | 'overridden' | 'excluded' {
  return excluded.includes(id) ? 'excluded' : Object.hasOwn(overrides, id) ? 'overridden' : 'defaults';
}

/**
 * Include/exclude every Master plugin, in the same searchable list as the Config editor.
 * Turning one off records an exclusion and drops its Config override; turning it back on returns
 * it to DSH defaults. Dependants follow their requirement and cannot be turned on alone.
 */
export function FeatureInclusion({ entries, overrides, excluded, onChange, locale, origins, added, actions, base }: {
  entries: readonly PluginCatalogEntry[]; overrides: Record<string, Record<string, unknown>>; excluded: readonly string[];
  onChange(next: { overrides: Record<string, Record<string, unknown>>; excluded: string[] }): void; locale: string;
  base?: { preset: string; source: 'dsh' | 'fallback' } | undefined; origins?: Readonly<Record<string, 'standard' | 'studio' | 'added'>> | undefined; added?: ReadonlyArray<{ id: string; name: string }> | undefined; actions?: MasterPluginActions | undefined;
}): React.ReactElement {
  const t = copy[localeOf(locale)];
  // Delegation plugins are replaced by the role tool on apply, so the Subagent tab owns them.
  const rows = entries.filter(entry => !isDelegationPlugin(entry.name));
  const idOf = (name: string) => rows.find(entry => entry.name === name)?.id;
  const followed = (entry: PluginCatalogEntry) => { const needs = CONFIG_REQUIRES[entry.name]; const id = needs && idOf(needs); return !!id && excluded.includes(id) && !excluded.includes(entry.id); };
  const addedIds = new Set((added ?? []).map(row => row.id));
  const compaction = rows.find(entry => entry.name === '@deepseek-ai/dsh-compaction-basic');
  const auto = compaction && (overrides[compaction.id]?.auto ?? (compaction.config as Record<string, unknown> | undefined)?.auto);
  const items: PickerItem[] = rows.map(entry => {
    const label = featureLabel(entry.name, locale);
    const description = entry.name === '@deepseek-ai/dsh-compaction-basic' ? `${pluginPurpose(entry.name, locale)} · ${auto === false ? t.autoOff : t.autoOn}` : pluginPurpose(entry.name, locale);
    return { name: entry.id, title: label, subtitle: label === entry.name ? entry.id : `${entry.id} · ${entry.name}`, description, searchText: entry.name,
      ...(followed(entry) ? { disabledReason: `${t.follows} · ${t.requires}${featureLabel(CONFIG_REQUIRES[entry.name]!, locale)}` } : {}) };
  });
  const selected = rows.filter(entry => !excluded.includes(entry.id) && !followed(entry)).map(entry => entry.id);
  const change = (names: string[]) => {
    const nextExcluded = rows.filter(entry => !names.includes(entry.id) && !followed(entry)).map(entry => entry.id);
    const nextOverrides = Object.fromEntries(Object.entries(overrides).filter(([id]) => !nextExcluded.includes(id)));
    onChange({ overrides: nextOverrides, excluded: nextExcluded });
  };
  const badge = (id: string) => {
    const entry = rows.find(row => row.id === id)!;
    const state = followed(entry) ? 'excluded' : featureState(id, overrides, excluded);
    const origin = origins?.[id] ?? (addedIds.has(id) ? 'added' : undefined);
    return <>{origin && <Badge tone={origin === 'standard' ? 'neutral' : origin === 'studio' ? 'info' : 'outline'}>{t[`origin_${origin}`]}</Badge>}<Badge tone={state === 'excluded' ? 'neutral' : state === 'overridden' ? 'info' : 'outline'}>{t[state]}</Badge></>;
  };
  const [adding, setAdding] = React.useState(false);
  return <section className="studio-stack">
    <SectionHead title={t.title} description={t.hint} actions={actions && (added ?? []).length ? <Button small onClick={() => setAdding(true)}>{t.add}</Button> : undefined} />
    {base?.source === 'fallback' && <Notice tone="info">{t.fallback}</Notice>}
    <ItemPicker label={t.title} items={items} selected={selected} onChange={change} filters={['all', 'selected']} badge={badge}
      labels={{ search: t.search, searchHint: t.searchHint, filter: t.filter, all: t.all, selected: t.included, modified: t.modified, settings: t.settings, done: t.done, empty: t.empty, noResults: t.noResults, modifiedTag: t.modifiedTag, clear: t.clear }} />
    <p className="studio-muted studio-hint">{t.declared}</p>
    {actions && <AddPluginDialog open={adding} onClose={() => setAdding(false)} locale={locale} added={added ?? []} actions={actions} />}
  </section>;
}

/** Plugins the user already added; new ones are included from the Plugins service. */
function AddPluginDialog({ open, onClose, locale, added, actions }: { open: boolean; onClose(): void; locale: string; added: ReadonlyArray<{ id: string; name: string }>; actions: MasterPluginActions }) {
  const t = copy[localeOf(locale)];
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const run = async (key: string, perform: () => Promise<void>) => {
    setBusy(key); setError('');
    try { await perform(); } catch (value) { setError(message(value)); } finally { setBusy(''); }
  };
  return <DetailDialog open={open} onClose={onClose} title={t.addTitle} closeLabel={t.done}>
    <p className="studio-muted">{t.addHint}</p>
    {error && <Notice>{error}</Notice>}
    {added.length > 0 && <>
      <ul className="studio-change-list">{added.map(row => <li key={row.id} className="studio-inline-actions">
        <span className="studio-mono">{row.name}</span><span className="studio-card-meta">{row.id}</span>
        <Button small disabled={!!busy} onClick={() => void run(row.id, () => actions.remove(row.id.replace(/^studio-added\//, '')))}>{t.remove}</Button>
      </li>)}</ul></>}
  </DetailDialog>;
}
