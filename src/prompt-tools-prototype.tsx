import { ChangeIndicator } from './change-indicator.tsx';
import { BUILTIN_TOOL_PRESETS } from './optimized-preset.ts';
import React from 'react';
import { ItemPicker } from './item-picker.tsx';
import { Button, DetailDialog, Note, SectionHead } from './ui.tsx';
import { type PresetCatalog } from './preset-catalog.ts';
import { delegationTools, GENERIC_DELEGATION_TOOLS, LEGACY_ROLE_TOOL, renameLegacyRoleKey, ROLE_TOOL, WITHDRAWN_TOOLS } from './delegation.ts';
import type { PreviewAction, PreviewResult } from './prompt-composition.ts';

export const defaultProvidedTools: string[] = [];
export function PromptToolsPrototype({ locale, prompt, onPromptChange, provided, onProvidedChange, catalog, catalogError, onPreview, onRequestChange, initialRequest }: {
  initialRequest?: import('./prompt-composition.ts').PreviewRequest | undefined;
  onRequestChange?: ((request: import('./prompt-composition.ts').PreviewRequest) => void) | undefined;
  catalog?: PresetCatalog | undefined; catalogError?: string | undefined; onPreview?: PreviewAction | undefined;
  locale: string; prompt: string; onPromptChange: (value: string) => void;
  provided: string[]; onProvidedChange: (value: string[]) => void;
}) {
  const t = (ko: string, en: string, zh: string) => locale.startsWith('ko') ? ko : locale.startsWith('zh') ? zh : en;
  const base = initialRequest?.preset ?? 'studio-master';
  const [toolOverrides, setToolOverrides] = React.useState<Record<string, { description?: string; parameters?: Record<string, string> }>>(renameLegacyRoleKey(initialRequest?.toolOverrides) ?? {});
  const [sections, setSections] = React.useState<Record<string, string>>(initialRequest?.sections ?? {});
  const providers = initialRequest?.providers ?? ['@deepseek-ai/dsh-persona'];
  const [providerConfigs, setProviderConfigs] = React.useState<Record<string, Record<string, unknown>>>(initialRequest?.providerConfigs ?? {});
  const [result, setResult] = React.useState<PreviewResult>();
  const [resultKey, setResultKey] = React.useState('');
  const [error, setError] = React.useState('');
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const idBase = React.useId();
  const closePreview = () => setPreviewOpen(false);
  const [busy, setBusy] = React.useState(false);
  const presets = catalog?.presets ?? [];
  const toolSources = BUILTIN_TOOL_PRESETS.map(id => presets.find(p => p.id === id) ?? { id, name: id, tools: [], sections: [], error: 'Preset unavailable' });
  const tools = catalog?.tools ?? [];
  const current = presets.find(preset => preset.id === base);
  const selectedSections = new Set(tools.filter(tool => provided.includes(tool.name)).flatMap(tool => tool.promptSections?.map(section => section.name) ?? []));
  const request = { ...initialRequest, preset: base, providers, tools: provided, prompt, model: initialRequest?.model ?? 'testLLM',
    toolOverrides: Object.fromEntries(Object.entries(toolOverrides).filter(([name]) => provided.includes(name))),
    sections: Object.fromEntries(Object.entries(sections).filter(([name]) => selectedSections.has(name))),
    providerConfigs: Object.fromEntries(Object.entries(providerConfigs).filter(([name]) => providers.includes(name))),
  };
  const personaFields = current?.promptProviders?.find(provider => provider.name === providers[0])?.fields ?? [];
  const requestKey = JSON.stringify(request);
  React.useEffect(() => { onRequestChange?.(request); }, [requestKey, onRequestChange]);
  const labels = { filter: t('보기', 'Show', '显示'), search: t('도구 검색', 'Search tools', '搜索工具'), searchHint: t('이름, 설명, 인자로 검색', 'Search names, descriptions or parameters', '按名称、描述或参数搜索'), all: t('전체', 'All', '全部'), selected: t('선택됨', 'Selected', '已选'), modified: t('변경됨', 'Modified', '已修改'), settings: t('설정', 'Details', '详情'), done: t('완료', 'Close', '关闭'), empty: t('항목이 없습니다.', 'No items', '无项目'), noResults: t('검색 결과가 없습니다.', 'No matching results.', '没有匹配结果。'), modifiedTag: t('변경됨', 'Modified', '已修改'), clear: t('전체 보기', 'Show all', '显示全部') };
  // A tool set counts as included whenever all its tools are selected, so copied or edited presets toggle the same as fresh drafts.
  // Generic subagent tools are folded into subagent_role, so a set's delegation tools map to that one tool.
  const presetTools = (presetId: string) => delegationTools(presets.find(p => p.id === presetId)?.tools.map(tool => tool.name) ?? []);
  const togglePreset = (presetId: string) => {
    const names = presetTools(presetId);
    onProvidedChange(includesPreset(presetId) ? provided.filter(name => !names.includes(name)) : [...new Set([...provided, ...names])]);
  };
  const includesPreset = (presetId: string) => { const names = presetTools(presetId); return names.length > 0 && names.every(name => provided.includes(name)); };
  const changeTools = (next: string[]) => onProvidedChange(delegationTools(next));
  // Presets saved before the fold still list generic delegation tools; migrate them once on open.
  React.useEffect(() => {
    if (provided.some(name => name === LEGACY_ROLE_TOOL || GENERIC_DELEGATION_TOOLS.includes(name) || WITHDRAWN_TOOLS.includes(name))) onProvidedChange(delegationTools(provided));
  }, []);
  const preview = async () => {
    if (!onPreview) return;
    setPreviewOpen(true);
    setBusy(true); setError(''); setResult(undefined);
    try { const value = await onPreview(request); setResult(value); setResultKey(requestKey); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <React.Fragment>
    {catalogError ? <Note>{catalogError}</Note> : !catalog ? <Note>{t('불러오는 중…', 'Loading…', '正在加载…')}</Note> : null}
    <section className="studio-form-section">
    <SectionHead title={t('프롬프트', 'Prompt composition', '提示词组装')} description={t('에이전트에게 전달할 지침을 편집합니다. 미리보기로 조립 결과를 확인할 수 있습니다.', 'Edit Persona and Studio instructions, then preview the assembled result.', '编辑 Persona 与 Studio 专用指令，并预览组装结果。')} actions={<Button small disabled={!onPreview || !current || busy} onClick={() => void preview()}>{busy ? t('조립 중…', 'Assembling…', '组装中…') : t('프롬프트 미리보기', 'Preview prompt', '预览提示词')}</Button>} />
    {(['prefix', 'suffix'] as const).map(key => {
      const name = providers[0]!;
      const config = providerConfigs[name] ?? {};
      const original = personaFields.find(field => field.key === key)?.value;
      const fieldId = `${idBase}-${key}`;
      return <div className="studio-field" key={key}><div className="studio-field-head"><label htmlFor={fieldId}>{key === 'prefix' ? t('기본 지침 (Persona)', 'Persona instructions', 'Persona 基本指令') : t('끝에 붙일 지침 (Persona)', 'Persona suffix', 'Persona 后置指令')}</label>{Object.hasOwn(config, key) && <ChangeIndicator locale={locale} />}<Button small disabled={!Object.hasOwn(config, key)} onClick={() => { const next = { ...config }; delete next[key]; setProviderConfigs({ ...providerConfigs, [name]: next }); }}>{t('원래대로', 'Use original', '使用原始值')}</Button></div><textarea id={fieldId} rows={key === 'prefix' ? 6 : 3} value={typeof config[key] === 'string' ? config[key] : typeof original === 'string' ? original : ''} onChange={e => setProviderConfigs({ ...providerConfigs, [name]: { ...config, [key]: e.target.value } })} /></div>;
    })}
    <label className="studio-field"><span>{t('추가 지침', 'Additional Studio instructions', 'Studio 附加指令')}</span><textarea rows={6} value={prompt} onChange={e => onPromptChange(e.target.value)} /></label>
    </section>
    <section className="studio-form-section">
    <SectionHead title={t('도구', 'Provided tools', '提供的工具')} description={t('에이전트가 쓸 도구를 고릅니다. 설정에서 모델에 보이는 설명을 바꿀 수 있으며, 도구 동작은 바뀌지 않습니다.', 'Choose tools. Details edits model-facing descriptions only; tool behavior is unchanged.', '选择工具。详情只编辑模型可见的描述，工具行为不变。')} />
    <div className="studio-field"><span>{t('기본 프리셋에서 한 번에 추가', 'Include a built-in preset tool set', '引入内置预设工具集')}</span><div className="studio-inline-actions">{toolSources.map(p => <Button small key={p.id} disabled={!!p.error} aria-pressed={includesPreset(p.id)} onClick={() => togglePreset(p.id)}>{p.id === 'cordis' ? 'creator (cordis)' : p.id}</Button>)}</div></div>
    <ItemPicker label={t('도구', 'Provided tools', '提供的工具')} items={[...tools.map(tool => ({ ...tool, searchText: JSON.stringify(tool.parameters), ...(GENERIC_DELEGATION_TOOLS.includes(tool.name) ? { disabledReason: t(`${ROLE_TOOL}로 통합되었습니다. 서브에이전트 위임은 ${ROLE_TOOL}을 선택하세요.`, `Merged into ${ROLE_TOOL}. Select ${ROLE_TOOL} for subagent delegation.`, `已合并到 ${ROLE_TOOL}。请选择 ${ROLE_TOOL} 进行子代理委派。`) } : {}) })), ...provided.filter(name => !tools.some(tool => tool.name === name)).map(name => ({ name, description: t('현재 설치된 도구 목록에 없습니다.', 'Absent from current catalog', '不在当前目录中') }))]} selected={provided} onChange={changeTools} labels={labels} isModified={name => {
      const tool = tools.find(item => item.name === name);
      const override = toolOverrides[name];
      const parameters = parameterFields(tool?.parameters);
      return !!((override?.description !== undefined && override.description !== tool?.description)
        || Object.entries(override?.parameters ?? {}).some(([path, text]) => text !== parameters.find(p => p.path === path)?.description)
        || tool?.promptSections?.some(section => sections[section.name] !== undefined && sections[section.name] !== section.text));
    }} renderDetails={name => {
      const tool = tools.find(tool => tool.name === name);
      const parameters = parameterFields(tool?.parameters);
      const override = toolOverrides[name];
      return <><SectionHead title={t('도구 설명', 'Tool description', '工具描述')} description={t('모델이 보는 도구 설명입니다.', 'The overall tool description sent to the model.', '发送给模型的工具整体描述。')} /><label className="studio-field"><span className="studio-sr-only">{t('도구 설명', 'Tool description', '工具描述')}</span><textarea value={override?.description ?? tool?.description ?? ''} onChange={e => setToolOverrides({ ...toolOverrides, [name]: { ...override, description: e.target.value } })} /></label>
        <SectionHead title={t('사용 지침', 'Tool usage instructions', '工具使用指令')} description={t('시스템 프롬프트에 들어가는 사용 규칙입니다. 같은 섹션을 쓰는 도구는 이 지침을 함께 씁니다.', 'Usage rules included in the system prompt. Tools referencing the same section share these instructions.', '包含在系统提示词中的使用规则。引用同一章节的工具共享这些指令。')} />
        {!tool?.promptSections?.length && <Note>{t('편집할 수 있는 사용 지침이 없습니다.', 'No separately editable usage instructions.', '没有可单独编辑的使用指令。')}</Note>}
        {tool?.promptSections?.map(section => <section key={section.name}><label className="studio-field"><span>{section.name}</span><textarea rows={5} value={sections[section.name] ?? section.text} onChange={e => setSections({ ...sections, [section.name]: e.target.value })} /></label><Button small disabled={!Object.hasOwn(sections, section.name)} onClick={() => { const next = { ...sections }; delete next[section.name]; setSections(next); }}>{t('원래대로', 'Use original', '使用原始值')}</Button></section>)}
        <SectionHead title={t('인자 설명', 'Parameter descriptions', '参数描述')} description={t('설명 문구만 바꿀 수 있습니다. 이름, 타입, 필수 여부는 그대로입니다.', 'Edit only description text within the tool schema. Names, types, required status and constraints remain unchanged.', '仅编辑工具定义中的说明文字。名称、类型、必填状态与约束保持不变。')} />
        {!parameters.length && <Note>{t('편집 가능한 인자가 없습니다.', 'No editable parameters.', '没有可编辑的参数。')}</Note>}
        {parameters.map(parameter => <label className="studio-field" key={parameter.path}><span>{parameter.path} <span className="studio-schema-meta">{parameter.type} · {parameter.required ? t('필수', 'required', '必填') : t('선택', 'optional', '可选')}</span></span><textarea aria-label={parameter.path} value={override?.parameters?.[parameter.path] ?? parameter.description} onChange={e => setToolOverrides({ ...toolOverrides, [name]: { ...override, parameters: { ...override?.parameters, [parameter.path]: e.target.value } } })} /></label>)}
        <Button small disabled={!override} onClick={() => { const next = { ...toolOverrides }; delete next[name]; setToolOverrides(next); }}>{t('설명 모두 원래대로', 'Use original', '使用原始值')}</Button>
      </>;

    }} />
    </section>

    <DetailDialog wide open={previewOpen} title={t('프롬프트 미리보기', 'Prompt result preview', '提示词结果预览')} closeLabel={t('닫기', 'Close preview', '关闭预览')} onClose={closePreview}
      subtitle={result ? t(`섹션 ${result.sections.length}개 · 도구 ${result.tools.length}개`, `${result.sections.length} sections · ${result.tools.length} tools`, `${result.sections.length} 个章节 · ${result.tools.length} 个工具`) : undefined}>
      {busy && <p role="status" className="studio-muted">{t('조립 중…', 'Assembling…', '组装中…')}</p>}
      {error && <p role="alert">{error}</p>}
      {result && resultKey !== requestKey && <Note>{t('설정이 바뀌었습니다. 미리보기를 다시 실행하세요.', 'Configuration changed. Run preview again.', '配置已更改，请重新预览。')}</Note>}
      {result && <section className="studio-preview" aria-label={t('프롬프트 미리보기', 'Prompt preview', '提示词预览')}>
        <div className="studio-prompt-document" tabIndex={0} aria-label={t('조립 순서와 내용', 'Assembly order and content', '组装顺序和内容')}>
          {result.sections.map((section, index) => <section key={section.name} className="studio-prompt-section"><h3><span className="studio-prompt-index">{index + 1}</span>{section.name}</h3><p className="studio-tool-description">{section.text}</p></section>)}
        </div>
        <aside className="studio-prompt-tools"><h3>{t('모델에 전달되는 도구', 'Model-facing tool schemas', '提供给模型的工具定义')}<span className="studio-count">{result.tools.length}</span></h3>{result.tools.length ? result.tools.map(tool => <details className="studio-schema-tool" key={tool.name}><summary>{tool.name}</summary><p className="studio-tool-description">{tool.description}</p><SchemaValue value={tool.parameters} /></details>) : <p className="studio-muted">{labels.empty}</p>}</aside>
      </section>}
    </DetailDialog>
  </React.Fragment>;
}

/** Render every schema keyword recursively without hiding constraints in raw JSON. */
function SchemaValue({ value }: { value: unknown }): React.ReactElement {
  if (Array.isArray(value)) return <ul className="studio-schema-list">{value.map((entry, index) => <li key={index}><SchemaValue value={entry} /></li>)}</ul>;
  if (value !== null && typeof value === 'object') return <dl className="studio-schema-fields">{Object.entries(value).map(([key, entry]) => <div key={key}><dt>{key}</dt><dd>{key === 'properties' || key === 'items' || key === '$defs' ? <details><summary>{key}</summary><SchemaValue value={entry} /></details> : <SchemaValue value={entry} />}</dd></div>)}</dl>;
  return <span className="studio-tool-description">{String(value)}</span>;
}

/** Description-only paths match the composition override contract; schema structure stays read-only. */
function parameterFields(schema: unknown, prefix = ''): { path: string; type: string; required: boolean; description: string }[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const row = schema as Record<string, unknown>;
  if (!row.properties || typeof row.properties !== 'object' || Array.isArray(row.properties)) return [];
  return Object.entries(row.properties).flatMap(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const field = value as Record<string, unknown>;
    const path = prefix ? `${prefix}.${key}` : key;
    return [{ path, type: Array.isArray(field.type) ? field.type.join(' | ') : typeof field.type === 'string' ? field.type : '—', required: Array.isArray(row.required) && row.required.includes(key), description: typeof field.description === 'string' ? field.description : '' }, ...parameterFields(field, path)];
  });
}
