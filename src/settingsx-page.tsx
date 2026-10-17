/** Studio → SettingsX service: Studio shortcut commands and provider definition routes. Node-testable.
 * Uses the shared {@link DetailLayout} frame like every Studio service.
 */
import React from 'react';
import { ProviderAccounts } from './settingsx-accounts.tsx';
import { DetailLayout } from './detail-layout.tsx';
import { Badge, Button, Notice, PageHead, SettingsRow, Toggle } from './ui.tsx';
import { protocolEndpoint, type ProviderAuthState, type ProviderDefinition, type ProviderEntry, type ProviderIssue, type ProviderList } from './provider-contract.ts';
import { STUDIO_COMMANDS, type StudioCommandSpec } from './settingsx-commands.ts';
import { settingsxText, type SettingsXKey } from './settingsx-locale.ts';

/** One Studio command row as the page shows it; `keys` comes from DSH's live shortcut catalog. */
export interface CommandRowState { id: string; enabled: boolean; keys: readonly string[] | null }
export interface SettingsXShortcuts {
  /** Current state per command id. */
  rows: readonly CommandRowState[];
  setEnabled(id: string, enabled: boolean): void;
}
export interface SettingsXProviderActions {
  list(): Promise<ProviderList>; reload(): Promise<ProviderList>;
  addTemplate?(template: string): Promise<ProviderList>;
  selectAccount?(route: string, accountId: string): Promise<ProviderList>;
  removeAccount?(route: string, accountId: string): Promise<ProviderList>;
  usage?(route: string, accountId: string): Promise<import('./provider-contract.ts').ProviderUsage>;
  signIn?(route: string): Promise<{ url: string }>; waitSignIn?(route: string): Promise<ProviderList>; cancelSignIn?(route: string): Promise<ProviderList>;
  signOut?(route: string): Promise<ProviderList>; setKey?(route: string, value: string): Promise<ProviderList>; openURL?(url: string): void;
}

type PageId = 'shortcuts' | 'providers';
const keysText = (keys: readonly string[]) => keys.join(' ');
const macDefault = (spec: StudioCommandSpec) => spec.defaultMac
  ? [...spec.defaultMac.modifiers.map(modifier => ({ primary: '⌘', shift: '⇧', alt: '⌥', control: '⌃' })[modifier]), spec.defaultMac.code.replace(/^Bracket(Left|Right)$/, (_, side: string) => (side === 'Left' ? '[' : ']'))].join('')
  : undefined;

/** Command label; `goto` commands carry their sidebar position. */
export function commandLabel(locale: string, spec: StudioCommandSpec): string {
  return settingsxText(locale, `command.${spec.key}` as SettingsXKey, { n: spec.position ?? '' });
}

function ShortcutsPage({ locale, shortcuts }: { locale: string; shortcuts: SettingsXShortcuts }) {
  const t = (key: SettingsXKey, values?: Record<string, string | number>) => settingsxText(locale, key, values);
  const state = new Map(shortcuts.rows.map(row => [row.id, row]));
  return <div className="studio-page-stack">
    <PageHead title={t('pageShortcuts')} description={t('pageShortcutsDescription')} />
    <section className="studio-settings-card" aria-label={t('pageShortcuts')}>
      {STUDIO_COMMANDS.map(spec => {
        const row = state.get(spec.id) ?? { id: spec.id, enabled: true, keys: null };
        const label = commandLabel(locale, spec);
        const fallback = macDefault(spec);
        const details = [
          `${t('keyAssigned')}: ${row.enabled && row.keys?.length ? keysText(row.keys) : t('keyNone')}`,
          ...fallback ? [`${t('defaultKey')}: ${fallback}`] : [],
        ].join(' · ');
        return <SettingsRow key={spec.id} title={label} description={details}
          control={<Toggle label={label} checked={row.enabled} onChange={enabled => shortcuts.setEnabled(spec.id, enabled)} />} />;
      })}
    </section>
  </div>;
}

function issueText(locale: string, issue: ProviderIssue) {
  const message = settingsxText(locale, `issue.${issue.code}` as SettingsXKey);
  return issue.path ? `${issue.path}: ${message}` : message;
}

/** Credential status and controls for one registered route. Values go in only; nothing secret is shown. */
function CredentialControl({ locale, definition, state, actions, onList }: { locale: string; definition: ProviderDefinition; state: ProviderAuthState | undefined; actions: SettingsXProviderActions; onList: (list: ProviderList) => void }) {
  const t = (key: SettingsXKey, values?: Record<string, string | number>) => settingsxText(locale, key, values);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const run = async (work: () => Promise<ProviderList | void>) => {
    setBusy(true); setError('');
    try { const next = await work(); if (next) onList(next); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  const credential = definition.credential;
  let status: string;
  let controls: React.ReactNode = null;
  if (credential.kind === 'none') status = t('credentialNone');
  else if (credential.kind === 'command') status = t('credentialCommand', { command: credential.command[0] ?? '' });
  else if (credential.kind === 'credential') {
    const info = state?.kind === 'credential' ? state : undefined;
    status = info?.configured ? t('keySet', { ref: credential.ref }) + (info.source ? ` (${info.source})` : '') : t('keyMissing', { ref: credential.ref });
    if (actions.setKey && info?.writable !== false) controls = <span className="studio-inline-form">
      <input type="password" autoComplete="off" aria-label={t('keyPlaceholder')} placeholder={t('keyPlaceholder')} value={draft} onChange={event => setDraft(event.target.value)} />
      <Button small disabled={busy || !draft.trim()} onClick={() => { void run(async () => { const next = await actions.setKey!(definition.id, draft); setDraft(''); return next; }); }}>{t('keySave')}</Button>
      {info?.configured && <Button small disabled={busy} onClick={() => { void run(() => actions.setKey!(definition.id, '')); }}>{t('keyDelete')}</Button>}
    </span>;
  } else {
    const info = state?.kind === 'oauth' ? state : undefined;
    status = info?.pending ? t('signingIn') : info?.signedIn ? t('signedIn') : t('signedOut');
    const start = () => run(async () => {
      const { url } = await actions.signIn!(definition.id);
      actions.openURL?.(url);
      onList(await actions.list());
      return actions.waitSignIn!(definition.id);
    });
    if (actions.signIn) controls = info?.pending
      ? <span className="studio-inline-form"><Button small onClick={() => actions.openURL?.(info.pending!.url)}>{t('openSignIn')}</Button><Button small onClick={() => { void run(() => actions.cancelSignIn!(definition.id)); }}>{t('cancel')}</Button></span>
      : <span className="studio-inline-form"><Button small disabled={busy} onClick={() => { void start(); }}>{info?.signedIn ? t('signInAgain') : t('signIn')}</Button>
</span>;
  }
  return <div className="studio-provider-credential">
    <p className="studio-muted">{t('credential')}: {status}</p>
    {controls}
    {error && <Notice action={<Button small onClick={() => setError('')}>{t('dismiss')}</Button>}>{error}</Notice>}
  </div>;
}

function ProviderRow({ locale, entry, state, actions, onList }: { locale: string; entry: ProviderEntry; state: ProviderAuthState | undefined; actions: SettingsXProviderActions; onList: (list: ProviderList) => void }) {
  const t = (key: SettingsXKey, values?: Record<string, string | number>) => settingsxText(locale, key, values);
  if (entry.status === 'invalid') {
    return <SettingsRow title={<>{entry.file} <Badge tone="warning">{t('statusInvalid')}</Badge></>}>
      <ul className="studio-muted">{entry.issues.map((issue, index) => <li key={index}>{issueText(locale, issue)}</li>)}</ul>
    </SettingsRow>;
  }
  const { definition } = entry;
  const facts = [`${t('protocol')}: ${definition.protocol}`, `${t('endpoint')}: ${protocolEndpoint(definition)}`].join(' · ');
  return <SettingsRow title={<>{definition.name} <code className="studio-mono">{definition.id}</code>{' '}
    {entry.status === 'registered' ? <Badge tone="success">{t('statusRegistered')}</Badge> : <Badge tone="warning">{t('statusConflict')}</Badge>}</>}
  description={`${entry.file} · ${facts}`}>
    {entry.status === 'conflict' && <p className="studio-muted">{t(entry.detail === 'duplicate' ? 'conflictDuplicate' : 'conflictRoute', { id: definition.id })}</p>}
    <p className="studio-muted">{t('models')}: {definition.models.map(model => model.name ?? model.id).join(', ')}</p>
    {entry.status === 'registered' && <CredentialControl locale={locale} definition={definition} state={state} actions={actions} onList={onList} />}
  </SettingsRow>;
}

function ProvidersPage({ locale, actions }: { locale: string; actions: SettingsXProviderActions }) {
  const t = (key: SettingsXKey) => settingsxText(locale, key);
  const [list, setList] = React.useState<ProviderList>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    actions.list().then(next => { if (active) setList(next); }, cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [actions]);
  const reload = async () => {
    setBusy(true); setError('');
    try { setList(await actions.reload()); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  return <div className="studio-page-stack">
    <PageHead title={t('pageProviders')} description={t('pageProvidersDescription')}
      actions={<Button disabled={busy} onClick={() => { void reload(); }}>{busy ? t('reloading') : t('reload')}</Button>} />
    {actions.addTemplate && <section className="studio-settings-card" aria-label={t('addProvider')}>
      <p className="studio-muted">{t('templateNote')}</p>
      <div className="studio-inline-form">{(['chatgpt', 'claude'] as const).map(template => <Button key={template} disabled={busy || !list || list.entries.some(entry => entry.status !== 'invalid' && entry.definition.id === `studio-${template}`)} onClick={() => {
        setBusy(true); setError('');
        void (async () => {
          try {
            const next = await actions.addTemplate!(template); setList(next);
            const route = `studio-${template}`;
            if (next.entries.some(entry => entry.status === 'registered' && entry.definition.id === route) && actions.signIn) {
              const { url } = await actions.signIn(route); actions.openURL?.(url);
              setList(await actions.list());
              // Waiting must not lock the entire page: cancellation stays accessible on the row.
              void actions.waitSignIn?.(route).then(setList, cause => setError(String(cause)));
            }
          } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
        })();
      }}>{t(template === 'chatgpt' ? 'addChatgpt' : 'addClaude')}</Button>)}</div>
    </section>}
    {error && <Notice action={<Button small onClick={() => setError('')}>{t('dismiss')}</Button>}>{t('loadFailed')} {error}</Notice>}
    {list && <div className="studio-gate-path"><span className="studio-muted">{t('folder')}</span><code>{list.directory}</code>
      <Button small onClick={async () => { try { await navigator.clipboard.writeText(list.directory); setCopied(true); } catch { setCopied(false); } }}>{copied ? t('copied') : t('copyPath')}</Button></div>}
    {list && (list.entries.length
      ? <section className="studio-page-stack" aria-label={t('pageProviders')}>{list.entries.map(entry => <article className="studio-settings-card" key={entry.file}><ProviderRow locale={locale} entry={entry} state={entry.status === 'registered' ? list.auth?.[entry.definition.id] : undefined} actions={actions} onList={setList} />{entry.status === 'registered' && entry.definition.credential.kind === 'oauth' && <ProviderAccounts route={entry.definition.id} accounts={list.accounts?.[entry.definition.id] ?? []} locale={locale} actions={actions} onList={setList} />}</article>)}</section>
      : <p className="studio-muted" role="status">{t('emptyProviders')}</p>)}
    <p className="studio-muted">{t('skillNote')}</p>
    <p className="studio-muted">{t('termsNote')}</p>
  </div>;
}

export function SettingsXPage({ locale, shortcuts, providers, navFooter }: {
  locale: string; shortcuts: SettingsXShortcuts; providers?: SettingsXProviderActions; navFooter?: React.ReactNode;
}) {
  const t = (key: SettingsXKey) => settingsxText(locale, key);
  const [page, setPage] = React.useState<PageId>('shortcuts');
  return <DetailLayout footer={navFooter} navigation={t('navigation')} selected={page} onSelect={next => setPage(next as PageId)} pages={[
    { id: 'shortcuts', label: t('pageShortcuts'), group: t('group'), content: <ShortcutsPage locale={locale} shortcuts={shortcuts} /> },
    ...(providers ? [{ id: 'providers', label: t('pageProviders'), group: t('group'), content: <ProvidersPage locale={locale} actions={providers} /> }] : []),
  ]} />;
}
