/** Studio → Plugins service (#38): installed plugins by run scope, and profile-wide settings. Node-testable. */
import React from 'react';
import { DetailLayout } from './detail-layout.tsx';
import { ConfigForm } from './config-editor.tsx';
import { pluginPurpose, pluginTitle } from './plugin-labels.ts';
import { Badge, Button, DetailDialog, Disclosure, Notice, PageHead, SectionHead, SettingsRow } from './ui.tsx';
import { pluginsText, type PluginsKey } from './plugins-locale.ts';
import type { InstalledPlugin } from './installed-plugins.ts';
import type { MigrationItem } from './extension-migration.ts';
import { profileSnippet, snippetId, type SecretAction } from './profile-config.ts';
import { hasEditableFields, withoutSecrets } from './secret-fields.ts';
import { groupOfService, groupTitle, matchesQuery, selectorOptions, type ProviderKind } from './service-groups.ts';

export interface ProfileConfigView {
  patchId: string; name: string; role: 'plugin' | 'service';
  schema?: Record<string, unknown>; schemaError?: string;
  effective: Record<string, unknown>; inherited: Record<string, unknown>; diff: Record<string, unknown>;
  secrets: Array<{ key: string; set: boolean }>;
  service?: string; provides?: Array<{ id: string; kind: ProviderKind }>; selectors?: Array<{ field: string; kind: ProviderKind }>; active?: boolean;
  credentials?: Array<{ field: string; ref: string; configured: boolean; source?: string }>;
}
export interface PluginsActions {
  installed(): Promise<{ plugins: InstalledPlugin[]; errors: Record<string, string> }>;
  migration(): Promise<MigrationItem[]>;
  migrate(id: string): Promise<{ appliedIn: Array<{ preset: string; name: string }> }>;
  include(name: string, config: Record<string, unknown>): Promise<void>;
  /** Projected Config schema for an installed entry, when the catalog knows it. */
  schema?(name: string): Promise<Record<string, unknown> | undefined>;
  profiles(): Promise<ProfileConfigView[]>;
  saveProfile(payload: { patchId: string; diff: Record<string, unknown>; secrets: Record<string, SecretAction> }): Promise<ProfileConfigView[]>;
  /** Register a profile-wide plugin in the profile patch and apply it; absent where the Host cannot. */
  register?(entry: string): Promise<{ id: string; warnings: number; restartReason?: string; profiles: ProfileConfigView[] }>;
  copy?(text: string): Promise<void>;
}

type PageId = 'installed' | 'profile';
const DEFAULT = '__studio_default__';
const MANUAL = '__studio_manual__';
const KIND_LABEL: Record<ProviderKind, PluginsKey> = { search: 'kindSearch', fetch: 'kindFetch', subagent: 'kindSubagent', mcp: 'kindMcp' };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const stateKey = (state: InstalledPlugin['state']) => `state_${state.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}` as PluginsKey;
const evidenceKey = (evidence: InstalledPlugin['evidence']) => `evidence_${evidence === 'profile-row' ? 'profileRow' : evidence}` as PluginsKey;

function IncludeDialog({ locale, plugin, actions, onClose, onDone }: { locale: string; plugin: InstalledPlugin; actions: PluginsActions; onClose(): void; onDone(): void }) {
  const t = (key: PluginsKey) => pluginsText(locale, key);
  const [schema, setSchema] = React.useState<Record<string, unknown>>();
  const [config, setConfig] = React.useState<Record<string, unknown>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => { let live = true; void actions.schema?.(plugin.entry).then(value => { if (live) setSchema(value); }, () => undefined); return () => { live = false; }; }, [plugin.entry]);
  const include = async () => {
    setBusy(true); setError('');
    try { await actions.include(plugin.entry, config); onDone(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  return <DetailDialog open title={t('includeTitle')} subtitle={plugin.entry} onClose={onClose} closeLabel={t('done')}
    footer={<Button primary disabled={busy} onClick={() => void include()}>{busy ? t('including') : t('includeButton')}</Button>}>
    <p className="studio-muted">{t('includeHint')}</p>
    {plugin.scope === 'unknown' && <Notice tone="info">{t('unknownWarn')}</Notice>}
    {error && <Notice>{error}</Notice>}
    {schema && <ConfigForm schema={schema} base={{}} value={config} onChange={setConfig} entryId={plugin.entry} locale={locale} />}
  </DetailDialog>;
}

function RegisterDialog({ locale, plugin, actions, onClose, onDone }: { locale: string; plugin: InstalledPlugin; actions: PluginsActions; onClose(): void; onDone(restart?: string): void }) {
  const t = (key: PluginsKey) => pluginsText(locale, key);
  const snippet = profileSnippet(plugin.entry, snippetId(plugin.entry));
  const [copied, setCopied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const register = async () => {
    setBusy(true); setError('');
    try { const result = await actions.register!(plugin.entry); onDone(result.restartReason); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  return <DetailDialog open title={t('registerTitle')} subtitle={plugin.entry} onClose={onClose} closeLabel={t('done')}
    footer={actions.register && <Button primary disabled={busy} onClick={() => void register()}>{busy ? t('registering') : t('registerButton')}</Button>}>
    <p className="studio-muted">{actions.register ? t('registerDirectHint') : t('registerHint')}</p>
    {error && <Notice>{t('registerFailed')} {error}</Notice>}
    <Disclosure title={t('registerManual')}>
      <SectionHead title={t('patchFile')} actions={actions.copy && <Button small onClick={() => void actions.copy!(snippet).then(() => setCopied(true), () => setCopied(false))}>{copied ? t('copied') : t('copy')}</Button>} />
      <pre className="studio-turn-text" aria-label={t('patchFile')}>{snippet}</pre>
    </Disclosure>
  </DetailDialog>;
}

function InstalledPage({ locale, actions, onOpenProfile }: { locale: string; actions: PluginsActions; onOpenProfile(): void }) {
  const t = (key: PluginsKey) => pluginsText(locale, key);
  const [plugins, setPlugins] = React.useState<InstalledPlugin[]>();
  const [migration, setMigration] = React.useState<MigrationItem[]>([]);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [including, setIncluding] = React.useState<InstalledPlugin>();
  const [registering, setRegistering] = React.useState<InstalledPlugin>();
  const [query, setQuery] = React.useState('');
  const shown = plugins?.filter(plugin => matchesQuery(query, plugin.entry, plugin.version, pluginTitle(plugin.entry, locale), pluginPurpose(plugin.entry, locale), t(`scope_${plugin.scope}` as PluginsKey)));
  const load = React.useCallback(async () => {
    setError('');
    try { const [list, moves] = await Promise.all([actions.installed(), actions.migration()]); setPlugins(list.plugins); setMigration(moves); }
    catch (cause) { setError(message(cause)); }
  }, [actions]);
  React.useEffect(() => { void load(); }, [load]);
  const migrate = async (item: MigrationItem) => {
    setBusy(item.id); setError(''); setNotice('');
    try { const result = await actions.migrate(item.id); if (result.appliedIn.length) setNotice(`${t('migratedApplied')}${result.appliedIn.map(p => p.name).join(', ')}`); await load(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(''); }
  };
  const action = (plugin: InstalledPlugin): React.ReactNode => {
    if (plugin.state === 'in-master' || plugin.state === 'profile-unaddressable') return null;
    if (plugin.scope === 'profile') return plugin.state !== 'installed'
      ? <Button small onClick={onOpenProfile}>{t('profileSettings')}</Button>
      : plugin.pendingPresets?.length
        ? <span className="studio-muted studio-hint">{t('reapplyFirst')}</span>
        : <Button small onClick={() => setRegistering(plugin)}>{t('register')}</Button>;
    if (plugin.state !== 'installed') return null;
    return <Button small primary={plugin.scope === 'agent'} onClick={() => setIncluding(plugin)}>{plugin.scope === 'agent' ? t('include') : t('includeAgent')}</Button>;
  };
  return <div className="studio-page-stack">
    <PageHead title={t('pageInstalled')} description={t('pageInstalledDescription')} actions={<Button onClick={() => void load()}>{t('refresh')}</Button>} />
    {error && <Notice action={<Button small onClick={() => setError('')}>{t('dismiss')}</Button>}>{t('loadFailed')} {error}</Notice>}
    {notice && <Notice tone="info" action={<Button small onClick={() => setNotice('')}>{t('dismiss')}</Button>}>{notice}</Notice>}
    {migration.length > 0 && <section className="studio-settings-card" aria-label={t('migrateTitle')}>
      <SectionHead title={t('migrateTitle')} description={t('migrateHint')} />
      {migration.map(item => <SettingsRow key={item.id} title={pluginTitle(item.entry, locale)}
        description={[item.entry, ...item.overrides.length ? [`${t('migrateOverrides')}: ${item.overrides.map(o => o.name).join(', ')}`] : []].join(' · ')}
        control={<Button small disabled={!!busy} onClick={() => void migrate(item)}>{busy === item.id ? t('migrating') : t('migrate')}</Button>} />)}
    </section>}
    {plugins === undefined && !error && <p className="studio-muted" role="status">{t('loading')}</p>}
    {plugins?.length === 0 && <p className="studio-muted" role="status">{t('empty')}</p>}
    {plugins && plugins.length > 0 && <input type="search" className="studio-search" aria-label={t('search')} placeholder={t('searchInstalled')} value={query} onChange={event => setQuery(event.target.value)} />}
    {plugins && plugins.length > 0 && shown?.length === 0 && <p className="studio-muted" role="status">{t('noResults')}</p>}
    {shown && shown.length > 0 && <section className="studio-settings-card" aria-label={t('pageInstalled')}>
      {shown.map(plugin => <SettingsRow key={plugin.entry}
        title={<>{pluginTitle(plugin.entry, locale)} <Badge tone={plugin.scope === 'agent' ? 'info' : plugin.scope === 'profile' ? 'outline' : 'warning'}>{t(`scope_${plugin.scope}` as PluginsKey)}</Badge>{plugin.state === 'installed' && <Badge tone="neutral">{t('state_installed')}</Badge>}</>}
        description={[plugin.entry + (plugin.version ? `@${plugin.version}` : ''), plugin.state === 'installed' ? t(evidenceKey(plugin.evidence)) : t(stateKey(plugin.state)), pluginPurpose(plugin.entry, locale), ...(plugin.pendingPresets?.length ? [`${t('migratedApplied')}${plugin.pendingPresets.map(p => p.name).join(', ')}`] : [])].filter(Boolean).join(' · ')}
        control={action(plugin)} />)}
    </section>}
    <p className="studio-muted studio-hint">{t('installHint')}</p>
    {including && <IncludeDialog locale={locale} plugin={including} actions={actions} onClose={() => setIncluding(undefined)} onDone={() => { setIncluding(undefined); void load(); }} />}
    {registering && <RegisterDialog locale={locale} plugin={registering} actions={actions} onClose={() => setRegistering(undefined)} onDone={restart => { setRegistering(undefined); setNotice(restart ? `${t('registeredRestart')} (${restart})` : t('registered')); void load(); }} />}
  </div>;
}

function ProfileDialog({ locale, view, actions, onClose, onSaved }: { locale: string; view: ProfileConfigView; actions: PluginsActions; onClose(): void; onSaved(next: ProfileConfigView[]): void }) {
  const t = (key: PluginsKey) => pluginsText(locale, key);
  const [diff, setDiff] = React.useState<Record<string, unknown>>(view.diff);
  const [secrets, setSecrets] = React.useState<Record<string, SecretAction>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const dirty = JSON.stringify(diff) !== JSON.stringify(view.diff) || Object.values(secrets).some(action => action.action !== 'keep');
  const save = async () => {
    setBusy(true); setError('');
    try { onSaved(await actions.saveProfile({ patchId: view.patchId, diff, secrets })); setSecrets({}); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  const schema = view.schema && withoutSecrets(view.schema);
  return <DetailDialog open title={pluginTitle(view.name, locale)} subtitle={`${view.patchId} · ${t('allSessions')}`} onClose={onClose} closeLabel={t('done')}
    footer={<Button primary disabled={!dirty || busy} onClick={() => void save()}>{busy ? t('saving') : dirty ? t('save') : t('saved')}</Button>}>
    {error && <Notice>{t('saveFailed')} {error}</Notice>}
    {view.secrets.length > 0 && <section className="studio-settings-card" aria-label={t('secret')}>
      {view.secrets.map(({ key, set }) => {
        const action = secrets[key] ?? { action: 'keep' };
        return <SettingsRow key={key} title={<span className="studio-mono">{key}</span>} description={`${t('secret')} · ${set ? t('secretSet') : t('secretUnset')}`}
          control={<span className="studio-inline-actions">
            <select aria-label={`${key}: ${t('secret')}`} value={action.action} onChange={event => setSecrets({ ...secrets, [key]: event.target.value === 'replace' ? { action: 'replace', value: '' } : { action: event.target.value as 'keep' | 'delete' } })}>
              <option value="keep">{t('secretKeep')}</option><option value="replace">{t('secretReplace')}</option>{set && <option value="delete">{t('secretDelete')}</option>}
            </select>
            {action.action === 'replace' && <input type="password" autoComplete="off" aria-label={`${key}: ${t('secretPlaceholder')}`} placeholder={t('secretPlaceholder')} value={action.value} onChange={event => setSecrets({ ...secrets, [key]: { action: 'replace', value: event.target.value } })} />}
          </span>} />;
      })}
      <p className="studio-muted studio-hint">{t('secretHint')}</p>
    </section>}
    {schema ? <ConfigForm schema={schema} base={view.inherited} value={diff} onChange={setDiff} entryId={view.patchId} locale={locale} /> : <Notice tone="info">{view.schemaError ?? t('noSchema')}</Notice>}
  </DetailDialog>;
}

function ProfilePage({ locale, actions, active }: { locale: string; actions: PluginsActions; active: boolean }) {
  const t = (key: PluginsKey) => pluginsText(locale, key);
  const [views, setViews] = React.useState<ProfileConfigView[]>();
  const [error, setError] = React.useState('');
  const [open, setOpen] = React.useState<string>();
  const load = React.useCallback(async () => { setError(''); try { setViews(await actions.profiles()); } catch (cause) { setError(message(cause)); } }, [actions]);
  // Pages stay mounted; reload whenever this one is shown so a registration made elsewhere appears.
  React.useEffect(() => { if (active) void load(); }, [load, active]);
  const [query, setQuery] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const current = views?.find(view => view.patchId === open);
  const shown = views?.filter(view => matchesQuery(query, view.patchId, view.name, pluginTitle(view.name, locale), groupTitle(view.service, locale), ...(view.provides ?? []).map(p => p.id)));
  // One card per grouped service (owner first), then ungrouped rows.
  const groups = new Map<string, ProfileConfigView[]>();
  for (const view of shown ?? []) { const key = view.service && groupTitle(view.service, locale) ? view.service : ''; groups.set(key, [...groups.get(key) ?? [], view]); }
  const running = (views ?? []).filter(view => view.active !== false).flatMap(view => view.provides ?? []);
  // Empty id removes the override, so the service falls back to its default (auto-selection).
  const pick = async (owner: ProfileConfigView, field: string, id: string) => {
    setBusy(`${owner.patchId}.${field}`); setError('');
    const { [field]: _old, ...rest } = owner.diff;
    try { setViews(await actions.saveProfile({ patchId: owner.patchId, diff: id ? { ...rest, [field]: id } : rest, secrets: {} })); setTyping(undefined); }
    catch (cause) { setError(message(cause)); } finally { setBusy(''); }
  };
  const [typing, setTyping] = React.useState<{ key: string; value: string }>();
  const row = (view: ProfileConfigView) => {
    const kinds = [...new Set((view.provides ?? []).map(p => p.kind))].map(kind => t(KIND_LABEL[kind]));
    const inUse = (view.provides ?? []).filter(p => views?.some(owner => owner.selectors?.some(sel => sel.kind === p.kind && (owner.effective[sel.field] ?? owner.inherited[sel.field]) === p.id)));
    return <SettingsRow key={view.patchId}
      title={<>{pluginTitle(view.name, locale)} {view.role === 'service' && <Badge tone="outline">{t('service')}</Badge>}{kinds.length > 0 && <Badge tone="neutral">{kinds.join(' · ')}</Badge>}{inUse.length > 0 && <Badge tone="success">{t('inUse')}</Badge>}{view.active === false && <Badge tone="warning">{t('inactive')}</Badge>}<Badge tone={Object.keys(view.diff).length ? 'info' : 'outline'}>{Object.keys(view.diff).length ? t('changed') : t('defaults')}</Badge></>}
      description={[view.patchId, ...(view.provides ?? []).map(p => `${t('providerId')}: ${p.id}`), ...Object.entries(view.diff).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`), ...(view.credentials ?? []).map(c => `${c.ref}: ${c.configured ? t('secretSet') : t('secretUnset')} (${t('credentialStore')})`), ...view.secrets.filter(s => s.set || !view.credentials?.some(c => c.configured)).map(s => `${s.key}: ${s.set ? t('secretSet') : t('secretUnset')}`)].join(' · ')}
      control={hasEditableFields(view.schema, view.secrets.length) ? <Button small disabled={view.active === false} onClick={() => setOpen(view.patchId)}>{t('edit')}</Button> : <span className="studio-muted studio-hint">{t('noSettings')}</span>}>
      {view.selectors?.map(sel => {
        const overridden = Object.hasOwn(view.diff, sel.field);
        const value = view.effective[sel.field] ?? view.inherited[sel.field];
        const options = selectorOptions(sel.kind, running, value);
        const label = t(sel.kind === 'search' ? 'pickSearch' : 'pickFetch');
        const key = `${view.patchId}.${sel.field}`;
        const manual = typing?.key === key;
        const disabled = !!busy || view.active === false;
        return <div key={sel.field} className="studio-field">
          <span className="studio-muted">{label}</span>
          <div className="studio-inline-actions">
            <select aria-label={label} value={manual ? MANUAL : overridden && typeof value === 'string' ? value : DEFAULT} disabled={disabled} onChange={event => {
              const next = event.target.value;
              if (next === MANUAL) setTyping({ key, value: overridden && typeof value === 'string' ? value : '' });
              else void pick(view, sel.field, next === DEFAULT ? '' : next);
            }}>
              <option value={DEFAULT}>{typeof view.inherited[sel.field] === 'string' ? `${t('useDefault')} (${view.inherited[sel.field] as string})` : `${t('useDefault')} (${t('autoSelect')})`}</option>
              {options.map(option => <option key={option.id} value={option.id}>{option.known ? option.id : `${option.id} (${t('notRunning')})`}</option>)}
              <option value={MANUAL}>{t('manualEntry')}</option>
            </select>
            {manual && <>
              <input aria-label={`${label}: ${t('manualEntry')}`} placeholder={t('manualPlaceholder')} value={typing.value} disabled={disabled} onChange={event => setTyping({ key, value: event.target.value })} />
              <Button small primary disabled={disabled} onClick={() => void pick(view, sel.field, typing.value.trim())}>{t('save')}</Button>
              <Button small disabled={disabled} onClick={() => setTyping(undefined)}>{t('cancel')}</Button>
            </>}
          </div>
          {manual && <span className="studio-muted studio-hint">{t('manualHint')}</span>}
        </div>;
      })}
    </SettingsRow>;
  };
  return <div className="studio-page-stack">
    <PageHead title={t('pageProfile')} description={t('pageProfileDescription')} actions={<Button onClick={() => void load()}>{t('refresh')}</Button>} />
    {error && <Notice action={<Button small onClick={() => setError('')}>{t('dismiss')}</Button>}>{t('loadFailed')} {error}</Notice>}
    {views === undefined && !error && <p className="studio-muted" role="status">{t('loading')}</p>}
    {views?.length === 0 && <p className="studio-muted" role="status">{t('noProfile')}</p>}
    {views && views.length > 0 && <input type="search" className="studio-search" aria-label={t('search')} placeholder={t('searchProfile')} value={query} onChange={event => setQuery(event.target.value)} />}
    {views && views.length > 0 && shown?.length === 0 && <p className="studio-muted" role="status">{t('noResults')}</p>}
    {[...groups].map(([service, list]) => <section key={service || 'other'} className="studio-settings-card" aria-label={service ? groupTitle(service, locale) : t('otherSettings')}>
      <SectionHead title={service ? groupTitle(service, locale)! : t('otherSettings')} {...(groupOfService(service)?.selectors ? { description: t('groupHint') } : {})} />
      {list.map(row)}
    </section>)}
    {current && <ProfileDialog key={current.patchId} locale={locale} view={current} actions={actions} onClose={() => setOpen(undefined)} onSaved={setViews} />}
  </div>;
}

export function PluginsPage({ locale, actions, navFooter }: { locale: string; actions: PluginsActions; navFooter?: React.ReactNode }) {
  const t = (key: PluginsKey) => pluginsText(locale, key);
  const [page, setPage] = React.useState<PageId>('installed');
  return <DetailLayout footer={navFooter} navigation={t('navigation')} selected={page} onSelect={next => setPage(next as PageId)} pages={[
    { id: 'installed', label: t('pageInstalled'), group: t('group'), content: <InstalledPage locale={locale} actions={actions} onOpenProfile={() => setPage('profile')} /> },
    { id: 'profile', label: t('pageProfile'), group: t('group'), content: <ProfilePage locale={locale} actions={actions} active={page === 'profile'} /> },
  ]} />;
}
