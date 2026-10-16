import { RoleEditor } from './role-editor.tsx';
// Studio preset creation and saved-preset management.
import React from 'react';
import { ConfigEditor } from './config-editor.tsx';
import { FeatureInclusion } from './feature-inclusion.tsx';
import type { ConfigOverrides } from './config-overrides.ts';
import { PresetList, type PresetActions } from './preset-manager.tsx';
import type { PreviewRequest } from './prompt-composition.ts';
import { GENERIC_DELEGATION_TOOLS, ROLE_TOOL } from './delegation.ts';
/** The Subagent tab owns the child filter; drop the copy the tools tab carried over from the saved request. */
const withoutSubagentFilter = (request: PreviewRequest): PreviewRequest => { const { subagentToolFilter: _filter, ...rest } = request; return rest; };
import { PromptToolsPrototype, defaultProvidedTools } from './prompt-tools-prototype.tsx';
import { DetailLayout } from './detail-layout.tsx';
import { Button, Notice, PageHead, SectionHead } from './ui.tsx';

type Settings = { prompt: string; tools: string; spill: string; wait: string };
type Agent = import('./role-settings.ts').StudioRole;
const initial: Settings = { prompt: 'Report evidence, uncertainty and remaining work.', tools: 'read / grep / glob', spill: '2048', wait: '60000' };
const seeds: Agent[] = [
  { name: 'Researcher', role: 'research', model: 'inherit', reasoning: 'inherit', spawn: 'fresh', persona: 'Investigate primary sources and cite the evidence.' },
  { name: 'Reviewer', role: 'review', model: 'inherit', reasoning: 'inherit', spawn: 'fork', persona: 'Review correctness and identify concrete risks.' },
];
export function OptimizationPrototype({ locale, catalog, catalogError, onPreview, presetActions, extensionActions, navFooter, catalogChanges }: { catalogChanges?: import('./master-change-notice.tsx').CatalogChangeActions | undefined; navFooter?: React.ReactNode; extensionActions?: import('./feature-inclusion.tsx').MasterPluginActions | undefined; presetActions?: PresetActions | undefined; onPreview?: import('./prompt-composition.ts').PreviewAction | undefined; locale: string; catalog?: import('./preset-catalog.ts').PresetCatalog | undefined; catalogError?: string | undefined }) {
  const t = (ko: string, en: string, zh: string) => locale.startsWith('ko') ? ko : locale.startsWith('zh') ? zh : en;
  const [page, setPage] = React.useState('list');
  const [common, setCommon] = React.useState<Settings>({ ...initial });
  const [agents, setAgents] = React.useState<Agent[]>(() => seeds.map(a => ({ ...a })));
  const [editing, setEditing] = React.useState<import('./preset-manager.tsx').SavedPreset>();
  const [provided, setProvided] = React.useState<string[]>(defaultProvidedTools);
  const [tab, setTab] = React.useState('tools');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [draftKey, setDraftKey] = React.useState(0);
  const [revision, setRevision] = React.useState(0);
  const defaults = React.useMemo(() => Object.fromEntries((catalog?.plugins ?? []).filter(p => p.schema && ['tool-bash', 'tool-pwsh', 'tool-fs', 'spill-policy'].includes(p.id)).map(p => [p.id, {}])), [catalog]);
  const [configDraft, setConfigDraft] = React.useState<ConfigOverrides>();
  const configOverrides = configDraft ?? defaults;
  const [configExclusions, setConfigExclusions] = React.useState<string[]>([]);
  const [request, setRequest] = React.useState<PreviewRequest>();
  const [hiddenFromSubagents, setHiddenFromSubagents] = React.useState<string[]>([]);
  // A tool dropped on the Prompts & tools tab leaves the Tool Filter too; it could only fail on apply.
  const selectable = (names: string[]) => names.filter(name => provided.includes(name) && name !== ROLE_TOOL);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const save = async () => {
    if (saving || !presetActions || !request || !name.trim()) return;
    setSaving(true); setSaveError('');
    try { await presetActions.save(JSON.stringify({ ...(editing?.id ? { id: editing.id } : {}), name: name.trim(), description, request: { ...withoutSubagentFilter(request), configOverrides, ...(configExclusions.length ? { configExclusions } : {}), ...(selectable(hiddenFromSubagents).length ? { subagentToolFilter: { deny: selectable(hiddenFromSubagents) } } : {}) }, conveniences: { spill: common.spill }, agents: agents.map(role => role.toolFilter ? { ...role, toolFilter: { ...role.toolFilter, deny: selectable(role.toolFilter.deny) } } : role) })); setRevision(n => n + 1); setPage('list'); setName(''); setDescription(''); setConfigDraft(undefined); setConfigExclusions([]); setCommon({ ...initial }); setProvided([]); setAgents(seeds.map(a => ({ ...a }))); setHiddenFromSubagents([]); setEditing(undefined); setTab('tools'); setDraftKey(n => n + 1); }
    catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); } finally { setSaving(false); }
  };
  const editPreset = (item: import('./preset-manager.tsx').SavedPreset, copy = false) => {
    setEditing(copy ? { ...item, id: '' } : item); setName(copy ? `${item.name} Copy` : item.name); setDescription(item.description);
    setCommon({ ...initial, prompt: item.request.prompt, spill: item.conveniences?.spill ?? initial.spill });
    setProvided([...item.request.tools]); setConfigDraft(item.request.configOverrides ?? {}); setConfigExclusions([...(item.request.configExclusions ?? [])]);
    setAgents(item.agents.map(role => ({ ...role }))); setRequest(item.request); setHiddenFromSubagents([...(item.request.subagentToolFilter?.deny ?? [])]);
    setDraftKey(n => n + 1); setPage('create');
  };
  // A role without its own persona keeps the preset persona: the edited prefix, else the Studio Master default.
  const persona = '@deepseek-ai/dsh-persona';
  const presetPersona = request?.providerConfigs?.[persona]?.prefix;
  const masterPersona = catalog?.presets?.find(p => p.id === (request?.preset ?? 'studio-master'))?.promptProviders?.find(p => p.name === persona)?.fields?.find(f => f.key === "prefix")?.value;
  const defaultPersona = typeof presetPersona === 'string' ? presetPersona : typeof masterPersona === 'string' ? masterPersona : '';
  // Only tools this preset selects can be hidden from subagents; subagent_role itself is the delegation tool.
  const toolChoices = (catalog?.tools ?? []).filter(tool => provided.includes(tool.name) && tool.name !== ROLE_TOOL).map(tool => ({ name: tool.name, description: tool.description }));
  const delegates = provided.some(name => name === ROLE_TOOL || GENERIC_DELEGATION_TOOLS.includes(name));
  const agentPage = <RoleEditor key={draftKey} locale={locale} roles={agents} onChange={setAgents} loadModels={presetActions?.models} defaultPersona={defaultPersona} tools={toolChoices} hiddenTools={hiddenFromSubagents} onHiddenToolsChange={setHiddenFromSubagents} delegates={delegates} />;
  const tabs = [
    { id: 'tools', label: t('프롬프트·도구', 'Prompts & tools', '提示词与工具'), content: <PromptToolsPrototype key={draftKey} initialRequest={editing?.request} locale={locale} catalog={catalog} catalogError={catalogError} onPreview={onPreview ? request => onPreview({ ...request, configOverrides, ...(configExclusions.length ? { configExclusions } : {}) }) : undefined} configOverrides={configOverrides} onConfigOverridesChange={setConfigDraft} previewKey={JSON.stringify([configOverrides, configExclusions])} onRequestChange={setRequest} prompt={common.prompt} onPromptChange={value => setCommon(c => ({ ...c, prompt: value }))} provided={provided} onProvidedChange={setProvided} /> },
    { id: 'convenience', label: t('실행 설정', 'Execution settings', '执行设置'), content: <><SectionHead title={t('실행 설정', 'Execution settings', '执行设置')} description={t('Studio 기준 구성의 실행 설정은 모두 DSH 기본값으로 포함됩니다. 켠 Config에서 바꾼 값만 덮어쓰고, 끄면 기본값으로 돌아갑니다.', 'Every execution setting in the Studio base composition is included with DSH defaults. Only the values you change in an enabled Config are overridden; turning it off returns to the defaults.', 'Studio 基础组成中的执行设置均以 DSH 默认值包含。只覆盖已启用 Config 中修改的值；关闭即恢复默认值')} /><FeatureInclusion locale={locale} entries={catalog?.plugins ?? []} overrides={configOverrides} excluded={configExclusions} origins={catalog?.origins} base={catalog?.base} added={catalog?.added} actions={extensionActions} onChange={next => { setConfigDraft(next.overrides); setConfigExclusions(next.excluded); }} /><ConfigEditor locale={locale} entries={(catalog?.plugins ?? []).filter(entry => !configExclusions.includes(entry.id))} value={configOverrides} onChange={setConfigDraft} /></> },
    { id: 'agents', label: t('서브에이전트', 'Subagent settings', '子代理设置'), content: agentPage },
  ];
  const tabId = React.useId();
  return <DetailLayout footer={navFooter} navigation={t('Studio 메뉴', 'Studio menu', '预设导航')} selected={page} onSelect={next => { if (next === 'create' && editing) { setEditing(undefined); setName(''); setDescription(''); setCommon({ ...initial }); setProvided([]); setConfigDraft(undefined); setConfigExclusions([]); setAgents(seeds.map(role => ({ ...role }))); setDraftKey(n => n + 1); } setPage(next); }} pages={[
    { id: 'list', group: t('프리셋', 'Presets', '预设'), label: t('프리셋 목록', 'Preset list', '预设列表'), content: <PresetList locale={locale} api={presetActions} changes={catalogChanges} revision={revision} onEdit={item => editPreset(item)} onCopy={item => editPreset(item, true)} /> },
    { id: 'create', group: t('프리셋', 'Presets', '预设'), label: editing ? t('프리셋 편집', 'Edit preset', '编辑预设') : t('프리셋 만들기', 'Create preset', '创建预设'), content: <div className="studio-page-stack"><PageHead title={editing ? t('프리셋 편집', 'Edit preset', '编辑预设') : t('프리셋 만들기', 'Create preset', '创建预设')} description={editing ? t('저장한 뒤 새 세션에 적용하려면 프리셋 목록에서 DSH에 반영하세요. 이미 실행 중인 세션은 바뀌지 않습니다.', 'After saving, apply to DSH from the preset list to use these settings in new sessions. Changes do not affect sessions that are already running.', '保存后，请在预设列表中应用到 DSH，以便在新会话中使用这些设置。更改不会影响正在运行的会话。') : t('프롬프트, 도구, 실행 설정, 서브에이전트를 구성해 새 프리셋으로 저장합니다.', 'Configure prompts, tools, execution settings and subagents, then save a new preset.', '配置工具、执行设置和子代理角色，并保存为新预设')} actions={<Button primary disabled={saving || !presetActions || !request || !name.trim()} onClick={() => void save()}>{saving ? t('저장 중…', 'Saving…', '保存中…') : t('프리셋 저장', 'Save preset', '保存预设')}</Button>} />
      {saveError && <Notice>{t(`프리셋을 저장하지 못했습니다. 편집한 내용은 화면에 그대로 있습니다. (${saveError})`, `Could not save the preset. Your edits remain on this screen. (${saveError})`, `无法保存预设，编辑内容仍保留在此页面（${saveError}）`)}</Notice>}
      <div className="studio-identity">
        <label className="studio-field studio-identity-name"><span>{t('프리셋 이름', 'Preset name', '预设名称')}</span><input value={name} maxLength={120} placeholder={t('예: 리서치용 에이전트', 'e.g. Research agent', '例如：研究代理')} onChange={e => setName(e.target.value)} /></label>
        <label className="studio-field"><span>{t('설명', 'Description', '描述')}</span><input value={description} placeholder={t('어떤 작업에 쓰는 프리셋인지 한 줄로 적어 주세요 (선택)', 'One line on what this preset is for (optional)', '一句话说明此预设的用途（可选）')} onChange={e => setDescription(e.target.value)} /></label>
      </div>
      <div className="studio-tabs studio-editor-tabs" role="tablist" aria-label={t('프리셋 구성', 'Preset configuration', '预设配置')}>{tabs.map((item, index) => <button type="button" role="tab" className="studio-tab" id={`${tabId}-${item.id}-tab`} aria-controls={`${tabId}-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} key={item.id} onClick={() => setTab(item.id)} onKeyDown={e => { const next = e.key === 'ArrowRight' ? (index + 1) % tabs.length : e.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1; if (next < 0) return; e.preventDefault(); setTab(tabs[next]!.id); document.getElementById(`${tabId}-${tabs[next]!.id}-tab`)?.focus(); }}>{item.label}</button>)}</div>
      {tabs.map(item => <section role="tabpanel" className="studio-tab-body" id={`${tabId}-${item.id}`} aria-labelledby={`${tabId}-${item.id}-tab`} key={item.id} hidden={tab !== item.id}>{item.content}</section>)}
    </div> },
  ]} />;
}
