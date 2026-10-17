import React from 'react';
import { Badge, Button, DetailDialog, Note, SectionHead } from './ui.tsx';
import { ItemPicker } from './item-picker.tsx';
import type { StudioRole } from './role-settings.ts';
export interface RoleModelCatalog {
  groups: { id: string; name: string; models: { id: string; name: string; reasoning?: { efforts: { id: string; name: string }[] } }[] }[];
  failures: { name: string; message: string }[];
}
export function RoleEditor({ locale, roles, onChange, loadModels, defaultPersona = '', tools, hiddenTools = [], onHiddenToolsChange, delegates = true }: { delegates?: boolean; locale: string; roles: StudioRole[]; onChange: (roles: StudioRole[]) => void; loadModels?: (() => Promise<RoleModelCatalog>) | undefined; defaultPersona?: string; tools?: { name: string; description: string }[] | undefined; hiddenTools?: string[]; onHiddenToolsChange?: ((names: string[]) => void) | undefined }) {
  const t = (ko: string, en: string, zh: string) => locale.startsWith('ko') ? ko : locale.startsWith('zh') ? zh : en;
  const [selected, setSelected] = React.useState<number>();
  const [catalog, setCatalog] = React.useState<RoleModelCatalog>();
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const refresh = React.useCallback(async () => {
    if (!loadModels) return;
    setLoading(true); setError('');
    try { setCatalog(await loadModels()); } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [loadModels]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const models = (catalog?.groups ?? []).flatMap(group => group.models.map(model => ({ ...model, value: `${group.id}/${model.id}`, label: `${group.name} · ${model.name}` })));
  const role = selected === undefined ? undefined : roles[selected];
  const model = models.find(model => model.value === role?.model);
  const update = (patch: { [K in keyof StudioRole]?: StudioRole[K] | undefined }) => onChange(roles.map((role, index) => {
    if (index !== selected) return role;
    const next = { ...role, ...patch } as StudioRole;
    if (next.toolFilter === undefined) delete next.toolFilter;
    return next;
  }));
  const field = (label: string, content: React.ReactNode) => <label className="studio-field"><span>{label}</span>{content}</label>;
  const close = () => setSelected(undefined);
  const defaultCount = hiddenTools.filter(name => tools?.some(tool => tool.name === name)).length;
  const filterTitle = t('서브에이전트 Tool Filter', 'Subagent Tool Filter', '子代理 Tool Filter');
  const roleFilterLabel = t('이 역할의 Tool Filter', 'Tool Filter for this role', '此角色的 Tool Filter');
  const filterSummary = (item: StudioRole) => {
    const own = item.toolFilter?.deny.filter(name => tools?.some(tool => tool.name === name) && !(item.toolFilter?.mode === 'extend' && hiddenTools.includes(name))).length ?? 0;
    return !item.toolFilter ? t('기본값', 'default', '默认') : item.toolFilter.mode === 'extend' ? t(`기본값 + ${own}`, `default + ${own}`, `默认 + ${own}`) : t(`따로 ${own}`, `own ${own}`, `单独 ${own}`);
  };
  return <>
    <SectionHead title={<h3 className="studio-panel-title">{t('서브에이전트', 'Subagents', '子代理')}<span className="studio-count">{roles.length}</span></h3>} description={t('바꾼 내용은 프리셋을 저장하고 DSH에 다시 반영해야 적용됩니다.', 'Save the preset and reapply it to DSH after changes.', '修改后需保存预设并重新应用到 DSH。')} actions={<><Button small disabled={loading || !loadModels} onClick={() => void refresh()}>{loading ? t('모델 불러오는 중…', 'Loading models…', '正在加载模型…') : t('모델 목록 새로고침', 'Refresh models', '刷新模型列表')}</Button><Button small onClick={() => { setSelected(roles.length); onChange([...roles, { name: '', role: '', model: 'inherit', reasoning: 'inherit', spawn: 'fresh', persona: '' }]); }}>{t('역할 추가', 'Add role', '添加角色')}</Button></>} />
    {error && <Note>{error}</Note>}{catalog?.failures.map(failure => <Note key={failure.name}>{failure.name}: {failure.message}</Note>)}
    <Note>{t('DSH standard의 서브에이전트 도구(subagent, subagent_fork, list_subagent_models)를 Studio의 subagent_role 하나로 대체합니다. standard 쪽 도구는 반영할 때 자동으로 빠지므로 포함할 플러그인 목록에도 나오지 않습니다. subagent_role의 설명과 인자는 프롬프트·도구 탭의 도구 목록에서 보고 고칠 수 있습니다.',
      'Studio replaces the DSH standard subagent tools (subagent, subagent_fork, list_subagent_models) with a single subagent_role tool. The standard tools are removed on apply, so they are not listed among the included plugins; review or edit subagent_role in the tool list on the Prompts & tools tab.',
      'Studio 用一个 subagent_role 工具替代 DSH standard 的子代理工具（subagent、subagent_fork、list_subagent_models）。standard 的工具会在应用时自动移除，因此不会出现在包含的插件列表中；可在“提示词与工具”页的工具列表中查看或编辑 subagent_role。')}</Note>
    {!roles.length && <p className="studio-muted" role="status">{t('정의된 역할이 없습니다. 이 상태에서는 subagent_role이 부모와 같은 모델·추론·지침으로 새 서브에이전트를 시작합니다.', 'No roles defined. subagent_role then starts a new subagent with the same model, reasoning and instructions as the parent.', '尚未定义角色。此时 subagent_role 会以与父代理相同的模型、推理和指令启动新的子代理。')}</p>}
    <div className="studio-tool-cards studio-card-pair">{roles.map((item, index) => <article className="studio-role-card" key={index}>
      <div className="studio-card-head"><h3>{item.name || t('이름 없음', 'Untitled', '未命名')}</h3><Badge tone="outline">{item.spawn === 'fork' ? t('부모 대화 이어받기', 'Continue parent', '继承父对话') : t('새 대화', 'New conversation', '新对话')}</Badge></div>
      {item.role && <p className="studio-card-text studio-mono">{item.role}</p>}
      <p className="studio-card-meta">{item.model === 'inherit' ? t('부모 모델 사용', 'Inherit parent model', '继承父级模型') : models.find(model => model.value === item.model)?.label ?? item.model} · {t('추론', 'Reasoning', '推理')} {item.reasoning === 'inherit' ? t('기본값', 'default', '默认') : item.reasoning}{tools && delegates && <> · Tool Filter: {filterSummary(item)}</>}</p>
      <div className="studio-card-footer"><Button small aria-haspopup="dialog" onClick={() => setSelected(index)}>{t('편집', 'Edit', '编辑')}</Button></div>
    </article>)}</div>
    {tools && onHiddenToolsChange && <section className="studio-form-section">
      <SectionHead title={filterTitle} description={t('Tool Filter에 등록한 도구는 이 프리셋의 모든 서브에이전트에서 빠집니다. 서브에이전트에게 필요 없는 도구를 빼면 시스템 프롬프트와 컨텍스트가 가벼워집니다. 역할 편집에서 역할마다 따로 정할 수도 있습니다.', 'Tools in the Tool Filter are removed from every subagent of this preset. Remove tools a subagent does not need from its system prompt to keep its context light. Each role can also set its own list in the role editor.', '加入 Tool Filter 的工具会从此预设的所有子代理中移除。从子代理的系统提示中移除其不需要的工具，让上下文保持精简。也可以在角色编辑中为每个角色单独设置。')} />
      {!delegates ? <Note>{t('프롬프트·도구 탭에서 subagent_role을 선택하면 쓸 수 있습니다.', 'Select subagent_role on the Prompts & tools tab to use the Tool Filter.', '在“提示词与工具”页选择 subagent_role 后即可使用。')}</Note>
        : <ToolFilterPicker label={filterTitle} tools={tools} selected={hiddenTools} onChange={onHiddenToolsChange} t={t} />}
    </section>}
    <DetailDialog open={role !== undefined} title={role?.name || t('새 역할', 'New role', '新角色')} subtitle={t('역할 편집', 'Edit role', '编辑角色')} onClose={close}
      footer={<><Button small onClick={() => { onChange(roles.filter((_, index) => index !== selected)); close(); }}>{t('역할 삭제', 'Remove role', '移除角色')}</Button><Button small primary onClick={close}>{t('완료', 'Done', '完成')}</Button></>}>
      {role && <><div className="studio-field-grid">
        {field(t('이름', 'Name', '名称'), <input value={role.name} onChange={e => update({ name: e.target.value })} />)}
        {field(t('역할 ID', 'Role ID', '角色 ID'), <input className="studio-mono" value={role.role} onChange={e => update({ role: e.target.value })} />)}
      </div>
      <div className="studio-field-grid">
        {field(t('모델', 'Model', '模型'), <select value={role.model} onChange={e => update({ model: e.target.value, reasoning: 'inherit' })}><option value="inherit">{t('부모 모델 사용', 'Inherit parent model', '继承父级模型')}</option>{role.model !== 'inherit' && !model && <option value={role.model} disabled>{role.model} · {t('목록에 없음 · 반영할 때 확인', 'Not in list · checked on apply', '目录中未确认 · 应用时验证')}</option>}{models.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}</select>)}
        {field(t('추론 수준', 'Reasoning', '推理级别'), <select value={role.reasoning} disabled={!model} onChange={e => update({ reasoning: e.target.value })}><option value="inherit">{role.model === 'inherit' ? t('부모 설정 사용', 'Inherit parent setting', '继承父级设置') : t('모델 기본값', 'Model default', '模型默认值')}</option>{role.reasoning !== 'inherit' && !model?.reasoning?.efforts.some(e => e.id === role.reasoning) && <option value={role.reasoning} disabled>{role.reasoning} · {t('지원 여부 확인 필요', 'Support unconfirmed', '需确认支持')}</option>}{model?.reasoning?.efforts.map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select>)}
        {field(t('시작 방식', 'Spawn mode', '生成方式'), <select value={role.spawn} onChange={e => update({ spawn: e.target.value as StudioRole['spawn'] })}><option value="fresh">{t('새 대화 (Fresh)', 'New conversation (Fresh)', '新对话（Fresh）')}</option><option value="fork">{t('부모 대화 이어받기 (Fork)', 'Continue parent (Fork)', '继承父对话（Fork）')}</option></select>)}
      </div>
      {tools && delegates && <div className="studio-field">
        <span>{filterTitle}</span>
        <select aria-label={roleFilterLabel} value={role.toolFilter?.mode ?? 'default'} onChange={e => {
          const mode = e.target.value;
          // Each mode starts from what it means: extend adds to the locked default, replace starts empty.
          update({ toolFilter: mode === 'extend' || mode === 'replace' ? { mode, deny: [] } : undefined });
        }}>
          <option value="default">{t(`프리셋 기본값 사용 (${defaultCount}개)`, `Use preset default (${defaultCount})`, `使用预设默认值（${defaultCount} 个）`)}</option>
          <option value="extend">{t('기본값에 추가', 'Add to preset default', '在默认值基础上添加')}</option>
          <option value="replace">{t('이 역할만 따로 (기본값 무시)', 'This role only (ignore default)', '仅此角色（忽略默认值）')}</option>
        </select>
        {role.toolFilter?.mode === 'extend' && <p className="studio-muted studio-hint">{t('프리셋 기본값의 도구는 잠긴 채로 함께 빠집니다. 이 역할에서 추가로 뺄 도구를 고르세요. 기본값을 바꾸면 이 역할에도 반영됩니다.', 'Preset default tools are locked and stay filtered. Choose the tools this role filters in addition. Changes to the default apply to this role too.', '预设默认值中的工具已锁定并一并排除。请选择此角色额外排除的工具。默认值的更改也会应用到此角色。')}</p>}
        {role.toolFilter?.mode === 'replace' && <p className="studio-muted studio-hint">{t('프리셋 기본값이 이 역할에는 적용되지 않습니다. 이 역할에서 뺄 도구만 고르세요.', 'The preset default does not apply to this role. Choose only the tools this role filters.', '预设默认值不适用于此角色。请仅选择此角色排除的工具。')}</p>}
        {role.toolFilter && <ToolFilterPicker label={roleFilterLabel} tools={tools} selected={role.toolFilter.deny}
          locked={role.toolFilter.mode === 'extend' ? hiddenTools : []} lockedReason={t('프리셋 기본값', 'Preset default', '预设默认值')}
          onChange={deny => update({ toolFilter: { mode: role.toolFilter!.mode, deny } })} t={t} />}
      </div>}
      {field(t('역할 지침 (persona)', 'Role instructions (persona)', '角色指令（persona）'), <textarea rows={6} value={role.persona} placeholder={defaultPersona} onChange={e => update({ persona: e.target.value })} />)}
      <p className="studio-muted studio-hint">{t('이 지침은 이 역할로 새로 생성하는 서브에이전트에 적용됩니다. 세션의 Subagents 탭에서 역할을 재정의하면 세션 값이 우선합니다. 이미 생성한 자식의 지침은 바뀌지 않습니다.', 'These instructions apply to new subagents created with this role. A role override in the session’s Subagents tab takes precedence. Existing children keep their instructions.', '这些指令应用于使用此角色新建的子代理。会话 Subagents 标签中的角色覆盖优先，已创建的子代理指令不变。')}</p>
      {!role.persona && defaultPersona && <p className="studio-muted studio-hint">{t('흐린 글씨는 프리셋의 기본 persona입니다. 비워 두면 이 내용이 그대로 쓰입니다.', 'The dimmed text is the preset default persona; it is used while this field is empty.', '浅色文字是预设的默认 persona，留空时使用该内容。')}</p>}
</>}
    </DetailDialog>
  </>;
}

type Translate = (ko: string, en: string, zh: string) => string;
/** Tool Filter list: only tools the preset selects. A tool deselected there drops out here and on save.
 * `locked` tools come from the preset default (extend mode): shown on, not editable, not stored again. */
function ToolFilterPicker({ label, tools, selected, onChange, t, locked = [], lockedReason }: { label: string; tools: { name: string; description: string }[]; selected: string[]; onChange: (names: string[]) => void; t: Translate; locked?: readonly string[]; lockedReason?: string }) {
  const items = tools.map(tool => locked.includes(tool.name) && lockedReason ? { ...tool, lockedReason } : tool);
  return <ItemPicker label={label} items={items} selected={selected.filter(name => tools.some(tool => tool.name === name) && !locked.includes(name))} onChange={names => onChange(names.filter(name => !locked.includes(name)))} hasDetails={() => false}
    labels={{ filter: t('보기', 'Show', '显示'), search: t('도구 검색', 'Search tools', '搜索工具'), searchHint: t('이름, 설명으로 검색', 'Search names or descriptions', '按名称或描述搜索'), all: t('전체', 'All', '全部'), selected: t('제외됨', 'Filtered', '已排除'), modified: t('변경됨', 'Modified', '已修改'), settings: t('설정', 'Details', '设置'), done: t('완료', 'Close', '完成'), empty: t('이 프리셋에서 선택한 도구가 없습니다.', 'This preset selects no tools.', '此预设未选择任何工具。'), noResults: t('검색 결과가 없습니다.', 'No matching results.', '没有匹配结果。'), modifiedTag: t('변경됨', 'Modified', '已修改'), clear: t('전체 보기', 'Show all', '显示全部') }} />;
}
