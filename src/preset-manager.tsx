import React from 'react';
import { Badge, Button, DetailDialog, Notice, PageHead, SplitButton, type BadgeTone } from './ui.tsx';
import { executionOverrideCount } from './execution-defaults.ts';
import type { PreviewRequest } from './prompt-composition.ts';
import { CatalogChangeNotice, type CatalogChangeActions } from './master-change-notice.tsx';
import { featureLabel } from './feature-inclusion.tsx';

export type SavedPreset = { readOnly?: boolean; nonDeletable?: boolean; template?: boolean; id: string; name: string; description: string; request: PreviewRequest; agents: import('./role-settings.ts').StudioRole[]; conveniences?: { spill?: string }; status: 'draft' | 'applied' | 'modified'; applyWarning?: string; missingFeatures?: string[];
  /** Optimized only: edited by the user / shipped defaults changed since the edit. */
  customized?: boolean; newDefaults?: boolean };
export type PresetActions = {
  list(): Promise<SavedPreset[]>;
  save(payload: string): Promise<SavedPreset>;
  apply(id: string): Promise<SavedPreset>;
  models?(): Promise<import('./role-editor.tsx').RoleModelCatalog>;
  unapply?(id: string): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  /** Replace Optimized with the shipped defaults and apply them. */
  restoreOptimized?(): Promise<SavedPreset>;
};
type ListLoad = { phase: 'loading' | 'ready' | 'failed'; items?: SavedPreset[]; error?: string };
type ActionKind = 'apply' | 'unapply' | 'delete' | 'recover' | 'restore';
type ActionState = { id: string; kind: ActionKind; error?: string };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function PresetList({ locale, api, revision, onEdit, onCopy, changes }: { locale: string; api?: PresetActions | undefined; revision: number; onEdit?: ((preset: SavedPreset) => void) | undefined; onCopy?: ((preset: SavedPreset) => void) | undefined; changes?: CatalogChangeActions | undefined }) {
  const t = (ko: string, en: string, zh: string) => locale.startsWith('ko') ? ko : locale.startsWith('zh') ? zh : en;
  // `items` survives a failed reload so a transient error never looks like data loss.
  const [load, setLoad] = React.useState<ListLoad>({ phase: 'loading' });
  const [action, setAction] = React.useState<ActionState>();
  const [deleting, setDeleting] = React.useState<SavedPreset>();
  const [confirming, setConfirming] = React.useState(false);
  const [recovering, setRecovering] = React.useState<SavedPreset>();
  const [restoring, setRestoring] = React.useState<SavedPreset>();
  const request = React.useRef(0);
  const refresh = React.useCallback(async () => {
    if (!api) return;
    const ticket = ++request.current;
    setLoad(old => ({ phase: 'loading', ...(old.items ? { items: old.items } : {}) }));
    try {
      const items = await api.list();
      if (ticket === request.current) setLoad({ phase: 'ready', items });
    } catch (error) {
      if (ticket === request.current) setLoad(old => ({ phase: 'failed', error: message(error), ...(old.items ? { items: old.items } : {}) }));
    }
  }, [api]);
  React.useEffect(() => { void refresh(); return () => { request.current++; }; }, [refresh, revision]);
  const busy = action !== undefined && action.error === undefined;
  const run = async (id: string, kind: ActionKind, perform: () => Promise<unknown>) => {
    if (busy) return;
    setAction({ id, kind });
    try { await perform(); } catch (error) { setAction({ id, kind, error: message(error) }); return; }
    setAction(undefined);
    await refresh();
  };
  const items = load.items ?? [];
  const failedName = action?.error !== undefined ? items.find(item => item.id === action.id)?.name ?? deleting?.name ?? action.id : '';
  const failure = action?.error === undefined ? '' : action.kind === 'apply'
    ? t(`${failedName}을(를) 반영하지 못했습니다. 이전에 반영한 구성은 그대로 유지됩니다.`, `Could not apply ${failedName}. A previously applied configuration stays in effect.`, `无法应用 ${failedName}。之前已应用的配置保持不变`)
    : action.kind === 'restore'
      ? t(`${failedName}을(를) 기본값으로 복구하지 못했습니다. 저장된 설정과 반영 상태는 그대로입니다.`, `Could not restore ${failedName} to defaults. Its saved settings and applied state did not change.`, `无法将 ${failedName} 恢复为默认值。已保存设置和应用状态未改变`)
    : action.kind === 'recover'
      ? t(`${failedName}을(를) 복구하지 못했습니다. 이전에 반영한 구성은 그대로 유지됩니다.`, `Could not restore ${failedName}. A previously applied configuration stays in effect.`, `无法恢复 ${failedName}。之前已应用的配置保持不变`)
    : action.kind === 'unapply'
      ? t(`${failedName}의 반영을 해제하지 못했습니다. 반영 상태는 그대로입니다.`, `Could not unapply ${failedName}. Its applied state did not change.`, `无法取消应用 ${failedName}。应用状态未改变`)
      : t(`${failedName}을(를) 삭제하지 못했습니다. 프리셋은 그대로 남아 있습니다.`, `Could not delete ${failedName}. The preset was not deleted.`, `无法删除 ${failedName}。预设未被删除`);
  const pending = (item: SavedPreset, kind: ActionKind) => busy && action?.id === item.id && action.kind === kind;
  const status = (item: SavedPreset) => item.status === 'applied' ? t('반영됨', 'Applied', '已应用') : item.status === 'modified' ? t('다시 반영 필요', 'Needs reapply', '需要重新应用') : t('반영 안 됨', 'Not applied', '未应用');
  const tone: Record<SavedPreset['status'], BadgeTone> = { applied: 'success', modified: 'warning', draft: 'neutral' };
  // The same apply warning usually repeats across presets; show each distinct one once above the cards.
  const warnings = [...items.reduce((groups, item) => item.applyWarning
    ? groups.set(item.applyWarning, [...groups.get(item.applyWarning) ?? [], item.name]) : groups, new Map<string, string[]>())];
  const retry = <Button small disabled={load.phase === 'loading'} onClick={() => void refresh()}>{t('다시 시도', 'Retry', '重试')}</Button>;
  return <><PageHead title={t('프리셋 목록', 'Preset list', '预设列表')} description={t('새 세션에 적용하려면 DSH에 반영하세요. 이미 실행 중인 세션은 바뀌지 않습니다.', 'Apply to DSH to use these settings in new sessions. Changes do not affect sessions that are already running.', '请应用到 DSH，以便在新会话中使用这些设置。更改不会影响正在运行的会话。')} actions={<Button disabled={busy || !api || load.phase === 'loading'} onClick={() => void refresh()}>{load.phase === 'loading' && load.items ? t('새로고침 중…', 'Refreshing…', '刷新中…') : t('새로고침', 'Refresh', '刷新')}</Button>} />
    {!api && <Notice>{t('Studio 서버에 연결되지 않아 프리셋을 불러올 수 없습니다.', 'Presets are unavailable because the Studio Host API is not connected.', 'Studio Host API 未连接，无法加载预设')}</Notice>}
    {api && load.phase === 'loading' && !load.items && <p role="status" className="studio-muted">{t('프리셋을 불러오는 중…', 'Loading presets…', '正在加载预设…')}</p>}
    {load.phase === 'failed' && <Notice action={retry}>{load.items
      ? t(`목록을 새로 불러오지 못해 이전 목록을 표시합니다. (${load.error})`, `Could not reload the list. Showing the last loaded list. (${load.error})`, `无法重新加载列表，正在显示上次加载的列表（${load.error}）`)
      : t(`프리셋 목록을 불러오지 못했습니다. 저장된 프리셋에는 영향이 없습니다. (${load.error})`, `Could not load presets. Saved presets were not changed. (${load.error})`, `无法加载预设，已保存的预设未被更改（${load.error}）`)}</Notice>}
    {failure && <Notice action={<Button small onClick={() => setAction(undefined)}>{t('닫기', 'Dismiss', '关闭')}</Button>}>{failure} ({action!.error})</Notice>}
    {load.phase === 'ready' && !items.length && <p role="status" className="studio-muted">{t('저장된 프리셋이 없습니다. 프리셋 만들기에서 새로 만들어 보세요.', 'No saved presets. Use Create preset to make one.', '没有已保存的预设。请从创建预设菜单开始。')}</p>}
    <CatalogChangeNotice actions={changes} locale={locale} onConfirmed={() => void refresh()} />
    {warnings.length > 0 && <ul className="studio-preset-warnings" aria-label={t('주의사항', 'Notices', '注意事项')}>{warnings.map(([text, names]) => <li key={text}>
      <Badge tone="warning">{t('주의', 'Notice', '注意')}</Badge><span>{text} <span className="studio-card-meta">({t('대상', 'Affects', '涉及')}: {names.join(', ')})</span></span>
    </li>)}</ul>}
    <div className="studio-tool-cards studio-card-pair" aria-busy={load.phase === 'loading' || busy}>{items.map(item => <article className="studio-preset-card" key={item.id}>
      <div className="studio-card-head"><h3>{item.name}</h3>{item.readOnly && <Badge tone="outline">{t('읽기 전용', 'Read-only', '只读')}</Badge>}{item.template && !item.readOnly && <Badge tone="info">{t('기본 제공', 'Built-in', '内置')}</Badge>}{item.customized && <Badge tone="outline">{t('직접 편집함', 'Edited', '已编辑')}</Badge>}<Badge tone={tone[item.status]}>{status(item)}</Badge></div>
      {item.template ? <p className="studio-card-text">{t('코딩 에이전트에 맞춘 도구와 지침, 작업을 맡길 Worker 역할이 포함된 기본 프리셋입니다. 편집할 수 있으며 언제든 기본값으로 복구할 수 있습니다.', 'Default preset with tools and instructions tuned for coding agents and a Worker role for delegated work. You can edit it and restore the defaults at any time.', '为编码代理调校的工具与指令，并附带承担委派工作的 Worker 角色的默认预设。可编辑，并可随时恢复默认值')}</p> : item.description && !item.readOnly && <p className="studio-card-text">{item.description}</p>}
      {item.missingFeatures && item.missingFeatures.length > 0 && <div className="studio-inline-actions"><Badge tone="warning">{t('기능 누락', 'Missing features', '缺少功能')}</Badge><span className="studio-card-meta">{item.missingFeatures.map(name => featureLabel(name, locale)).join(', ')}</span>
        <Button small disabled={busy || !api || !!item.readOnly} onClick={() => setRecovering(item)}>{t('복구', 'Restore', '恢复')}</Button></div>}
      {item.newDefaults && <div className="studio-inline-actions"><Badge tone="warning">{t('새 기본값', 'New defaults', '新默认值')}</Badge><span className="studio-card-meta">{t('Studio 기본값이 바뀌었습니다. 편집한 설정은 그대로 두었습니다.', 'Studio defaults changed. Your edited settings were kept.', 'Studio 默认值已更改。已保留您编辑的设置')}</span></div>}
      <p className="studio-card-meta">{t('도구', 'Tools', '工具')} {item.request.tools.length} · {t('서브에이전트 역할', 'Subagent roles', '子代理角色')} {Array.isArray(item.agents) ? item.agents.length : 0}{!item.readOnly && executionOverrideCount(item.request.execution) > 0 && <> · {t(`실행 기본값 덮어씀 ${executionOverrideCount(item.request.execution)}`, `Execution defaults overridden: ${executionOverrideCount(item.request.execution)}`, `已覆盖执行默认值 ${executionOverrideCount(item.request.execution)}`)}</>}</p>
      {item.readOnly ? <p className="studio-card-meta studio-card-note">{t('DSH standard 프리셋에 Studio 플러그인과 직접 추가한 플러그인을 더한 기준 프리셋입니다. 편집하거나 삭제할 수 없습니다.', 'Reference preset: DSH standard plus Studio plugins and the ones you added. It cannot be edited or deleted.', '基准预设：DSH standard 加上 Studio 插件和您添加的插件，无法编辑或删除')}</p> : <div className="studio-card-footer">
        <Button small disabled={busy || item.readOnly || !onEdit} onClick={() => onEdit?.(item)}>{t('편집', 'Edit', '编辑')}</Button>
        <Button small disabled={busy || !onCopy} onClick={() => onCopy?.(item)}>{t('복사', 'Create copy', '创建副本')}</Button>
        <Button small disabled={busy || !api || item.readOnly || item.nonDeletable} title={item.nonDeletable ? t('기본 제공 프리셋은 삭제할 수 없습니다.', 'Built-in presets cannot be deleted.', '内置预设无法删除') : undefined} onClick={() => { setDeleting(item); setConfirming(true); }}>{t('삭제', 'Delete', '删除')}</Button>
        {item.template && <Button small disabled={busy || !api?.restoreOptimized} onClick={() => setRestoring(item)}>{pending(item, 'restore') ? t('복구 중…', 'Restoring…', '恢复中…') : t('기본값으로 복구', 'Restore defaults', '恢复默认值')}</Button>}
        <span className="studio-card-footer-end">
          <SplitButton primary={item.status !== 'applied'} disabled={busy || !api || !!item.readOnly} onClick={() => void run(item.id, "apply", () => api!.apply(item.id))} menuLabel={t('반영 옵션', 'Apply options', '应用选项')}
            label={pending(item, 'apply') ? t('반영 중…', 'Applying…', '应用中…') : pending(item, 'unapply') ? t('해제 중…', 'Unapplying…', '取消中…') : item.status === 'draft' ? t('DSH에 반영', 'Apply to DSH', '应用到 DSH') : t('DSH에 다시 반영', 'Reapply to DSH', '重新应用到 DSH')}
            actions={item.status === 'draft' || !api?.unapply ? [] : [{ label: t('반영 해제', 'Unapply from DSH', '取消应用到 DSH'), onSelect: () => void run(item.id, 'unapply', () => api!.unapply!(item.id)) }]} />
        </span>
      </div>}
    </article>)}</div>
    <DetailDialog compact open={recovering !== undefined} onClose={() => setRecovering(undefined)} title={t('누락된 기능 복구', 'Restore missing features', '恢复缺少的功能')} subtitle={recovering?.name}
      footer={<><Button disabled={busy} onClick={() => setRecovering(undefined)}>{t('취소', 'Cancel', '取消')}</Button><Button primary disabled={busy || !recovering} onClick={() => { const target = recovering!; setRecovering(undefined); void run(target.id, 'recover', () => api!.apply(target.id)); }}>{t('복구하고 다시 반영', 'Restore and reapply', '恢复并重新应用')}</Button></>}>
      <p className="studio-muted">{t('이전 버전에서 반영할 때 빠진 기능입니다. 복구하면 저장된 설정으로 다시 반영하며, 아래 기능이 DSH 기본값으로 포함됩니다.', 'An earlier version left these out when applying. Restoring reapplies the saved settings and includes the features below with DSH defaults.', '早期版本应用时遗漏了这些功能。恢复后将按已保存设置重新应用，并以 DSH 默认值包含以下功能')}</p>
      <ul className="studio-change-list">{(recovering?.missingFeatures ?? []).map(name => <li key={name}>+ {featureLabel(name, locale)} <span className="studio-mono studio-card-meta">{name}</span></li>)}</ul>
      <p className="studio-muted">{t('덮어쓰기, 서브에이전트 역할, Pixie Gate 연결, 프리셋 ID는 그대로입니다. 빼고 싶은 기능은 편집에서 끈 뒤 반영하세요. 실행 중인 세션은 바뀌지 않습니다.', 'Overrides, subagent roles, Pixie Gate links and the preset ID are kept. To leave a feature out, turn it off in Edit and apply. Running sessions are not changed.', '覆盖、子代理角色、Pixie Gate 连接和预设 ID 保持不变。如需排除某功能，请在编辑中关闭后应用。正在运行的会话不受影响')}</p>
    </DetailDialog>
    <DetailDialog compact open={restoring !== undefined} onClose={() => setRestoring(undefined)} title={t('기본값으로 복구', 'Restore defaults', '恢复默认值')} subtitle={restoring?.name}
      footer={<><Button disabled={busy} onClick={() => setRestoring(undefined)}>{t('취소', 'Cancel', '取消')}</Button><Button primary disabled={busy || !restoring} onClick={() => { const target = restoring!; setRestoring(undefined); void run(target.id, 'restore', () => api!.restoreOptimized!()); }}>{t('복구하고 반영', 'Restore and apply', '恢复并应用')}</Button></>}>
      <p className="studio-muted">{t('도구, 지침, 도구 설명, Config, 실행 기본값, 서브에이전트 역할을 Studio가 제공하는 현재 기본값으로 바꾸고 DSH에 반영합니다. 직접 편집한 내용은 사라집니다. 실행 중인 세션은 바뀌지 않습니다.', 'Replaces tools, instructions, tool descriptions, Configs, execution defaults and subagent roles with the current Studio defaults, then applies them to DSH. Your edits are discarded. Running sessions are not changed.', '将工具、指令、工具描述、Config、执行默认值和子代理角色替换为 Studio 当前默认值，并应用到 DSH。您的编辑将被丢弃。正在运行的会话不受影响')}</p>
    </DetailDialog>
    <DetailDialog compact open={confirming} onClose={() => setConfirming(false)} title={t('프리셋 삭제', 'Delete preset', '删除预设')} subtitle={deleting?.name}
      footer={<><Button disabled={busy} onClick={() => setConfirming(false)}>{t('취소', 'Cancel', '取消')}</Button><Button primary disabled={busy || !deleting} onClick={() => { const target = deleting!; setConfirming(false); void run(target.id, 'delete', () => api!.delete(target.id)).then(() => setDeleting(undefined)); }}>{t('삭제 확인', 'Confirm delete', '确认删除')}</Button></>}>
      <p className="studio-muted">{t('저장된 프리셋과 DSH에 반영된 프리셋을 함께 삭제합니다. 기존 대화는 남아 있습니다.', 'Deletes the saved preset and removes it from DSH. Existing conversations are kept.', '删除已保存预设及 Studio 注册的 DSH 预设，不删除现有对话。')}</p>
    </DetailDialog>
  </>;
}
