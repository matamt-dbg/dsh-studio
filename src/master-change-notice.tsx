import React from 'react';
import type { CatalogChange } from './master-snapshot.ts';
import { Badge, Button, DetailDialog, Notice } from './ui.tsx';

export interface CatalogChangeActions {
  read(): Promise<CatalogChange | { error: string } | null>;
  confirm(): Promise<{ cleaned: number }>;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Restart-time catalog differences. Nothing is cleaned until the user confirms; until then the
 * notice stays and saved presets are untouched. Shows names only, never Config values.
 */
export function CatalogChangeNotice({ actions, locale, onConfirmed }: { actions?: CatalogChangeActions | undefined; locale: string; onConfirmed(): void }) {
  const t = (ko: string, en: string, zh: string) => locale.startsWith('ko') ? ko : locale.startsWith('zh') ? zh : en;
  const [change, setChange] = React.useState<CatalogChange | { error: string } | null>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let active = true;
    actions?.read().then(value => { if (active) setChange(value); }, value => { if (active) setChange({ error: message(value) }); });
    return () => { active = false; };
  }, [actions]);
  if (!actions || !change) return null;
  if ('error' in change) return <Notice>{t(`도구·Config 변경을 확인하지 못했습니다. 저장된 프리셋은 그대로입니다. (${change.error})`, `Could not check tool and Config changes. Saved presets were not changed. (${change.error})`, `无法检查工具与 Config 变化，已保存的预设未改变（${change.error}）`)}</Notice>;
  const confirm = async () => {
    setBusy(true); setError('');
    try { await actions.confirm(); setOpen(false); setChange(null); onConfirmed(); }
    catch (value) { setError(message(value)); } finally { setBusy(false); }
  };
  const list = (sign: string, names: string[]) => names.map(name => <li key={`${sign}${name}`} className="studio-mono">{sign} {name}</li>);
  return <>
    <Notice tone="info" action={<Button small onClick={() => setOpen(true)}>{t('내역 보기', 'Review', '查看')}</Button>}>
      {t('재시작 후 사용할 수 있는 도구나 Config가 바뀌었습니다. 확인하면 사라진 항목을 프리셋에서 정리합니다.', 'Available tools or Configs changed since the last start. Confirm to clean removed items from presets.', '自上次启动后可用的工具或 Config 已变化。确认后将从预设中清理已移除的项目')}
    </Notice>
    <DetailDialog open={open} onClose={() => setOpen(false)} title={t('도구·Config 변경', 'Tool and Config changes', '工具与 Config 变化')}
      footer={<><Button disabled={busy} onClick={() => setOpen(false)}>{t('나중에', 'Later', '稍后')}</Button><Button primary disabled={busy} onClick={() => void confirm()}>{busy ? t('정리 중…', 'Cleaning…', '清理中…') : t('확인하고 정리', 'Confirm and clean', '确认并清理')}</Button></>}>
      {error && <Notice>{t(`정리하지 못했습니다. 저장된 프리셋은 그대로입니다. (${error})`, `Could not clean up. Saved presets were not changed. (${error})`, `无法清理，已保存的预设未改变（${error}）`)}</Notice>}
      <ul className="studio-change-list" aria-label={t('추가·제거', 'Added and removed', '新增与移除')}>
        {list('+', [...change.added.tools, ...change.added.configs])}
        {list('-', [...change.removed.tools, ...change.removed.configs])}
        {list('~', change.changed.tools)}
      </ul>
      {change.changed.tools.length > 0 && <p className="studio-muted">{t('~ 항목은 입력 형식이 바뀌었습니다. 관련 덮어쓰기는 다음 반영 때 다시 검사합니다.', '~ items changed their input schema. Related overrides are checked again on the next apply.', '~ 项目的输入结构已变化，相关覆盖将在下次应用时重新检查')}</p>}
      {change.cleanup.length > 0 ? <ul className="studio-change-list" aria-label={t('정리될 프리셋 설정', 'Preset settings to clean', '将清理的预设设置')}>{change.cleanup.map(item => <li key={item.id}>
        <Badge tone="warning">{item.name}</Badge> <span className="studio-mono">{[...item.tools, ...item.configs].join(', ')}</span>
      </li>)}</ul> : <p className="studio-muted">{t('정리할 프리셋 설정은 없습니다.', 'No preset settings need cleaning.', '没有需要清理的预设设置')}</p>}
      <p className="studio-muted">{t('정리한 프리셋은 다시 반영이 필요합니다. 이미 실행 중인 세션은 바뀌지 않습니다.', 'Cleaned presets need to be reapplied. Running sessions are not changed.', '清理后的预设需要重新应用，正在运行的会话不受影响')}</p>
    </DetailDialog>
  </>;
}
