import React from 'react';
import type { ExecutionDefaults } from './execution-defaults.ts';
import type { PresetCatalog } from './preset-catalog.ts';
import { ItemPicker, type PickerItem } from './item-picker.tsx';
import { Button, Note, SectionHead } from './ui.tsx';

export type ExecutionDraft = ExecutionDefaults;
type Translate = (ko: string, en: string, zh: string) => string;
type Wait = { tool: string; parameter: string; supported: boolean; minimum?: number; maximum?: number; defaultValue?: number };

/** Plain-language names for the tools Studio knows; others show the tool name. */
function toolTitle(tool: string, t: Translate): string {
  if (tool === 'bash') return t('bash 명령 대기 시간', 'bash command wait', 'bash 命令等待时间');
  if (tool === 'job_output') return t('백그라운드 작업 결과 대기 시간', 'Background job result wait', '后台任务结果等待时间');
  if (tool === 'read_batch') return t('read_batch 최대 개수', 'read_batch max items', 'read_batch 最多条目数');
  return tool;
}
/** What applies while nothing is overridden. */
function original(tool: string, t: Translate): string {
  if (tool === 'bash') return t('기본값: DSH 설정 → 셸의 명령 타임아웃', 'Default: command timeout in DSH Settings → Shell', '默认：DSH 设置 → Shell 中的命令超时');
  if (tool === 'job_output') return t('기본값: DSH 백그라운드 작업 기본값', 'Default: DSH background job default', '默认：DSH 后台任务默认值');
  if (tool === 'read_batch') return t('기본값: 도구 상한. 더 낮게만 바꿀 수 있습니다.', 'Default: the tool limit. Can only be lowered.', '默认：工具上限，只能调低。');
  return t('기본값: 도구 기본값', 'Default: tool default', '默认：工具默认值');
}

/**
 * Execution values Studio overrides for one preset, edited like Config overrides: turn a tool on, open its
 * settings and change a field. A field reset or a turned-off tool removes the override, so the tool and
 * executor settings apply again (for bash, the command timeout in DSH Settings → Shell).
 */
export function ExecutionSettings({ catalog, selected, value, onChange, locale }: { catalog?: PresetCatalog | undefined; selected: string[]; value: ExecutionDraft; onChange(value: ExecutionDraft): void; locale: string }): React.ReactElement {
  const t: Translate = (ko, en, zh) => locale.startsWith('ko') ? ko : locale.startsWith('zh') ? zh : en;
  const capabilities = catalog?.execution;
  const known: Wait[] = (capabilities?.waits ?? []).filter(item => selected.includes(item.tool));
  // Saved values whose tool no longer publishes the parameter stay listed so they can be removed.
  const orphans: Wait[] = Object.entries(value.defaults).flatMap(([tool, fields]) => selected.includes(tool) ? Object.keys(fields).filter(parameter => !known.some(item => item.tool === tool && item.parameter === parameter)).map(parameter => ({ tool, parameter, supported: false })) : []);
  const waits = [...known, ...orphans];
  const batch = capabilities?.batch && selected.includes(capabilities.batch.tool) ? capabilities.batch : undefined;
  const batchValue = value.batch && selected.includes(value.batch.tool) ? value.batch : undefined;
  const tools = [...new Set(waits.map(item => item.tool)), ...(batch ? [batch.tool] : [])];
  // A tool turned on with nothing changed yet stays on screen; saving drops it (see selectedExecution).
  const has = (tool: string) => Object.keys(value.defaults[tool] ?? {}).length > 0 || batchValue?.tool === tool;
  // A tool once overridden stays on after a field reset, like a Config override reset to its base value;
  // only turning it off removes it from the list of enabled entries.
  const [opened, setOpened] = React.useState<string[]>([]);
  const overriddenKey = tools.filter(has).join(',');
  React.useEffect(() => { setOpened(current => [...new Set([...current, ...tools.filter(has)])]); }, [overriddenKey]);
  const on = tools.filter(tool => has(tool) || opened.includes(tool));

  const setWait = (tool: string, parameter: string, next: number | undefined) => {
    const defaults = structuredClone(value.defaults);
    const fields = defaults[tool] ??= {};
    if (next === undefined) delete fields[parameter]; else fields[parameter] = next;
    if (!Object.keys(fields).length) delete defaults[tool];
    onChange({ ...value, defaults });
  };
  const setBatch = (maxItems: number | undefined) => {
    const next: ExecutionDraft = { defaults: value.defaults };
    if (maxItems !== undefined && batch) next.batch = { tool: 'read_batch', parameter: batch.parameter, maxItems };
    onChange(next);
  };
  const toggle = (names: string[]) => {
    const removed = on.filter(tool => !names.includes(tool));
    setOpened(names);
    if (!removed.length) return;
    const defaults = Object.fromEntries(Object.entries(value.defaults).filter(([tool]) => !removed.includes(tool)));
    onChange({ defaults, ...(value.batch && !removed.includes(value.batch.tool) ? { batch: value.batch } : {}) });
  };

  const labels = { overridden: t('변경됨', 'Override', '覆盖'), inherited: t('기본값', 'Base value (not overridden)', '基础值（未覆盖）'), reset: t('기본값으로', 'Reset override', '重置覆盖') };
  /** One numeric field, laid out like a Config editor field. */
  const field = (name: string, current: number | undefined, hint: string, props: { min: number; max?: number | undefined; placeholder: string; disabled?: boolean }, write: (next: number | undefined) => void) => {
    const id = `studio-execution-${name.replace(/[^\w-]/g, '-')}`;
    const overridden = current !== undefined;
    return <div className="studio-field studio-config-field" data-overridden={overridden} key={name}>
      <div className="studio-field-head"><label htmlFor={id} className="studio-mono">{name}</label><span className="studio-config-state">{overridden ? labels.overridden : labels.inherited}</span>
        {overridden && <Button small aria-label={`${labels.reset}: ${name}`} onClick={() => write(undefined)}>{labels.reset}</Button>}</div>
      <span className="studio-muted studio-hint">{hint}</span>
      <input id={id} type="number" inputMode="numeric" min={props.min} max={props.max} step={1} disabled={props.disabled} placeholder={props.placeholder} value={current ?? ''}
        onChange={e => write(e.target.value.trim() === '' || !Number.isFinite(Number(e.target.value)) ? undefined : Number(e.target.value))} />
    </div>;
  };
  const details = (tool: string) => <>
    {waits.filter(item => item.tool === tool).map(item => field(`${item.parameter} (ms)`, value.defaults[tool]?.[item.parameter],
      item.supported ? t('모델이 이 인자를 생략했을 때만 채웁니다. 모델이 적은 값과 실행기 상한은 그대로 둡니다.', 'Filled only when the model omits this argument. Values the model sets and executor caps stay as they are.', '仅在模型省略此参数时填入。模型设置的值和执行器上限保持不变。')
        : t('더 이상 지원하지 않는 값입니다. 기본값으로 되돌려 지우세요.', 'No longer supported. Reset it to remove the override.', '已不再支持，请重置以删除覆盖。'),
      { min: Math.max(1, item.minimum ?? 1), max: item.maximum, placeholder: item.defaultValue !== undefined ? String(item.defaultValue) : t('DSH 설정', 'DSH setting', 'DSH 设置'), disabled: !item.supported && value.defaults[tool]?.[item.parameter] === undefined },
      next => setWait(tool, item.parameter, next)))}
    {batch?.tool === tool && field(batch.parameter, batchValue?.maxItems,
      batch.maxItems !== undefined ? t(`한 번에 읽는 최대 개수입니다. 원래 상한 ${batch.maxItems}보다 낮게만 바꿀 수 있습니다.`, `Most items per call. Can only be lowered below the original limit of ${batch.maxItems}.`, `单次最多条目数，只能低于原始上限 ${batch.maxItems}。`) : t('한 번에 읽는 최대 개수입니다. 원래 상한보다 낮게만 바꿀 수 있습니다.', 'Most items per call. Can only be lowered.', '单次最多条目数，只能调低。'),
      { min: 1, max: batch.maxItems, placeholder: batch.maxItems !== undefined ? String(batch.maxItems) : '' }, setBatch)}
  </>;

  const items: PickerItem[] = tools.map(tool => ({ name: tool, title: toolTitle(tool, t), subtitle: tool === batch?.tool ? `${tool} · ${batch.parameter}` : `${tool} · ${waits.filter(item => item.tool === tool).map(item => item.parameter).join(', ')}`, description: original(tool, t) }));
  const picker = { filter: t('보기', 'Show', '显示'), search: t('실행 기본값 검색', 'Search execution defaults', '搜索执行默认值'), searchHint: t('도구 이름이나 인자로 검색', 'Search tool names or arguments', '按工具名称或参数搜索'), all: t('전체', 'All', '全部'), selected: t('켜짐', 'On', '已开启'), modified: t('변경됨', 'Modified', '已修改'), settings: t('설정', 'Edit', '设置'), done: t('완료', 'Done', '完成'), empty: t('항목이 없습니다.', 'No items', '无项目'), noResults: t('검색 결과가 없습니다.', 'No matching results.', '没有匹配结果。'), modifiedTag: t('변경됨', 'Modified', '已修改'), clear: t('전체 보기', 'Show all', '显示全部') };
  return <section className="studio-form-section" aria-label={t('실행 기본값', 'Execution defaults', '执行默认值')}>
    <SectionHead title={t('실행 기본값', 'Execution defaults', '执行默认值')} description={t('모델이 값을 생략할 때 Studio가 이 프리셋에서 채우는 값입니다. 항목을 켜고 설정에서 바꾼 값만 저장되며, 끄면 DSH 설정을 따릅니다.', 'Values Studio fills in for this preset when the model leaves them out. Turn an entry on and edit it; only changed values are saved, and turning it off follows DSH settings.', '模型省略时 Studio 在此预设中填入的值。启用条目并编辑，只保存修改的值；关闭即使用 DSH 设置。')} />
    {!capabilities ? <Note>{t('도구 정보를 불러오지 못했습니다.', 'Could not load tool information.', '无法加载工具信息。')}</Note>
      : !items.length ? <Note>{t('선택한 도구 중에는 바꿀 수 있는 실행 값이 없습니다.', 'No selected tool has execution values to change.', '所选工具中没有可修改的执行值。')}</Note>
      : <ItemPicker label={t('실행 기본값', 'Execution defaults', '执行默认值')} items={items} selected={on} onChange={toggle} labels={picker} filters={['all', 'modified']} isModified={has} renderDetails={details} />}
  </section>;
}
