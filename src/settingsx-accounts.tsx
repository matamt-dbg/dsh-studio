/** Safe subscription metadata and explicitly refreshed usage; no credentials reach this view. */
import React from 'react';
import { Badge, Button, DetailDialog, Notice, SectionHead } from './ui.tsx';
import type { ProviderAccount, ProviderList, ProviderUsage } from './provider-contract.ts';
import type { SettingsXProviderActions } from './settingsx-page.tsx';
const copy = {
  en: { accounts: 'Connected accounts', manage: 'Manage accounts', close: 'Close', default: 'Default', select: 'Use as default', remove: 'Sign out', confirm: 'Confirm sign out', cancel: 'Cancel', refresh: 'Refresh usage', empty: 'No accounts connected', unknown: 'Usage has not been checked', unavailable: 'Usage unavailable. Try refreshing.', unsupported: 'Usage is not supported for this provider.', checked: 'Checked', reset: 'Resets', expires: 'Token expires', primary: 'Primary window', secondary: 'Secondary window', failed: 'Could not update this account. Try again.', note: 'Choose the default manually. Studio never switches accounts automatically when a limit is reached.' },
  ko: { accounts: '연결된 계정', manage: '계정 관리', close: '닫기', default: '기본', select: '기본으로 사용', remove: '로그아웃', confirm: '로그아웃 확인', cancel: '취소', refresh: '사용량 새로 고침', empty: '연결된 계정 없음', unknown: '아직 사용량을 조회하지 않았습니다', unavailable: '사용량을 가져오지 못했습니다. 다시 조회해 주세요.', unsupported: '이 프로바이더의 사용량 조회는 지원하지 않습니다.', checked: '조회 시각', reset: '초기화', expires: '토큰 만료', primary: '기본 사용 기간', secondary: '추가 사용 기간', failed: '계정을 변경하지 못했습니다. 다시 시도해 주세요.', note: '기본 계정은 직접 선택합니다. 한도에 도달해도 자동으로 계정을 전환하지 않습니다.' },
  zh: { accounts: '已连接账户', manage: '管理账户', close: '关闭', default: '默认', select: '设为默认', remove: '退出登录', confirm: '确认退出', cancel: '取消', refresh: '刷新用量', empty: '未连接账户', unknown: '尚未查询用量', unavailable: '无法查询用量，请重试。', unsupported: '此提供商不支持用量查询。', checked: '查询时间', reset: '重置', expires: '令牌到期', primary: '主要周期', secondary: '次要周期', failed: '无法更新账户，请重试。', note: '请手动选择默认账户，达到限额时不会自动切换。' },
};
export function ProviderAccounts({ route, accounts, locale, actions, onList }: { route: string; accounts: ProviderAccount[]; locale: string; actions: SettingsXProviderActions; onList(list: ProviderList): void }) {
  const t = copy[locale.startsWith('ko') ? 'ko' : locale.startsWith('zh') ? 'zh' : 'en'];
  const [open, setOpen] = React.useState(false); const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState(false);
  const [remove, setRemove] = React.useState<string>(); const [usage, setUsage] = React.useState<Record<string, ProviderUsage>>({});
  const stamp = (time: number) => new Date(time).toLocaleString(locale);
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(false); try { await operation(); } catch { setError(true); } finally { setBusy(false); } };
  return <div className="studio-page-stack">
    <SectionHead title={`${t.accounts}: ${accounts.length}`} description={t.note} actions={<Button small onClick={() => setOpen(true)}>{t.manage}</Button>} />
    {!accounts.length && <p className="studio-muted">{t.empty}</p>}
    {accounts.map(account => <div className="studio-settings-row" key={account.id}><div><span>{account.email ?? account.label}</span> {account.isDefault && <Badge>{t.default}</Badge>}{account.plan && <span className="studio-muted"> · {account.plan}</span>}</div></div>)}
    <DetailDialog open={open} title={t.manage} closeLabel={t.close} onClose={() => setOpen(false)}>
      <div className="studio-page-stack">
        {error && <Notice>{t.failed}</Notice>}
        {accounts.map(account => { const result = usage[account.id]; return <section className="studio-settings-card" key={account.id}>
          <SectionHead title={account.email ?? account.label} actions={account.isDefault && <Badge>{t.default}</Badge>} />
          {account.expiresAt && <p className="studio-muted">{t.expires}: {stamp(account.expiresAt)}</p>}
          {result?.status === 'ready' ? <div className="studio-page-stack">{result.plan && <p>{result.plan}</p>}{result.windows.map(window => <div key={window.id}><label className="studio-subscription-meter"><span>{window.id === 'primary' ? t.primary : t.secondary}: {window.usedPercent}%</span><progress max={100} value={window.usedPercent} /></label>{window.resetAt && <p className="studio-muted">{t.reset}: {stamp(window.resetAt)}</p>}</div>)}</div> : <p className="studio-muted">{result ? t[result.status] : t.unknown}</p>}
          {result && <p className="studio-muted">{t.checked}: {stamp(result.checkedAt)}</p>}
          <div className="studio-inline-actions">
            <Button small disabled={busy || !actions.usage} onClick={() => void run(async () => { const next = await actions.usage!(route, account.id); setUsage(previous => ({ ...previous, [account.id]: next })); })}>{t.refresh}</Button>
            <Button small disabled={busy || account.isDefault || !actions.selectAccount} onClick={() => void run(async () => onList(await actions.selectAccount!(route, account.id)))}>{t.select}</Button>
            <Button small disabled={busy || !actions.removeAccount} onClick={() => setRemove(account.id)}>{t.remove}</Button>
          </div>
          {remove === account.id && <div className="studio-inline-actions"><Button disabled={busy} onClick={() => void run(async () => { onList(await actions.removeAccount!(route, account.id)); setRemove(undefined); setUsage(previous => { const next = { ...previous }; delete next[account.id]; return next; }); })}>{t.confirm}</Button><Button disabled={busy} onClick={() => setRemove(undefined)}>{t.cancel}</Button></div>}
        </section>; })}
        {!accounts.length && <p>{t.empty}</p>}
      </div>
    </DetailDialog>
  </div>;
}
