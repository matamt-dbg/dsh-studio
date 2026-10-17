/** Subagents conversation view: roles of this session. Node-testable: no host primitives. */
import React from 'react';
import { Badge, Button, DetailDialog, Notice, Note, PageHead } from './ui.tsx';
import type { RoleModelCatalog } from './role-editor.tsx';
import type { MergedRole, SessionRolePatch, SessionRolesView, TemporaryRoleInput } from './session-roles.ts';
import { sessionRolesText, type SessionRolesTextKey } from './session-roles-locale.ts';

/** What the Host returns for one session. */
export type SessionRolesViewValue = SessionRolesView;

/** Session-bound operations the tab uses. */
export interface SessionRolesActions {
  view(): Promise<SessionRolesViewValue>;
  /** Calls `listener` on connect and after each change of the roles that apply; returns a stop function. */
  follow(listener: () => void): () => void;
  edit(roleId: string, patch: SessionRolePatch): Promise<SessionRolesViewValue>;
  add(input: TemporaryRoleInput): Promise<SessionRolesViewValue>;
  remove(roleId: string): Promise<SessionRolesViewValue>;
  models(): Promise<RoleModelCatalog>;
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Edit target: an existing role, or a new temporary role. */
type Draft = { mode: 'edit'; role: MergedRole; presetCopy: boolean } | { mode: 'add' };
type Fields = { name: string; role: string; model: string; reasoning: string; persona: string };

export function SessionRolesTab({ actions, locale }: { actions: SessionRolesActions; locale: string }) {
  const t = (key: SessionRolesTextKey) => sessionRolesText(locale, key);
  const [view, setView] = React.useState<SessionRolesViewValue>();
  const [loadError, setLoadError] = React.useState('');
  const [changeError, setChangeError] = React.useState('');
  const [catalog, setCatalog] = React.useState<RoleModelCatalog>();
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>();

  const load = React.useCallback(async () => {
    try { const next = await actions.view(); setView(next); setLoadError(''); }
    catch (error) { setLoadError(messageOf(error)); }
  }, [actions]);
  React.useEffect(() => actions.follow(() => { void load(); }), [actions, load]);
  const refreshModels = React.useCallback(async () => {
    setLoadingModels(true);
    try { setCatalog(await actions.models()); } catch { /* the editor still offers inherit and the current value */ }
    finally { setLoadingModels(false); }
  }, [actions]);
  // Read-only child views load it too, so cards show model names instead of route ids.
  React.useEffect(() => { if (view?.available && !catalog) void refreshModels(); }, [view, catalog, refreshModels]);

  const models = (catalog?.groups ?? []).flatMap(group => group.models.map(model => ({ ...model, value: `${group.id}/${model.id}`, label: `${group.name} · ${model.name}` })));
  const modelLabel = (value: string) => value === 'inherit' ? t('inheritModel') : models.find(model => model.value === value)?.label ?? value;
  const change = async (run: () => Promise<SessionRolesViewValue>) => {
    try { setView(await run()); setChangeError(''); } catch (error) { setChangeError(`${t('changeFailed')} ${messageOf(error)}`); }
  };

  if (!view) return <div className="studio-page-stack studio-session-roles">
    {loadError ? <Notice action={<Button small onClick={() => void load()}>{t('retry')}</Button>}>{t('loadFailed')} {loadError}</Notice> : <p className="studio-muted" role="status">{t('loading')}</p>}
  </div>;
  const editable = view.available && !view.readOnly;
  return <div className="studio-page-stack studio-session-roles">
    <PageHead title={t('title')} description={t('description')} actions={editable ? <>
      <Button small disabled={loadingModels} onClick={() => void refreshModels()}>{loadingModels ? t('loadingModels') : t('refreshModels')}</Button>
      <Button small onClick={() => setDraft({ mode: 'add' })}>{t('add')}</Button>
    </> : undefined} />
    {!view.available && <Note>{t('unavailable')}</Note>}
    {view.available && view.readOnly && <Note>{t('readOnly')}</Note>}
    {loadError && <Notice action={<Button small onClick={() => void load()}>{t('retry')}</Button>}>{t('loadFailed')} {loadError}</Notice>}
    {changeError && <Notice action={<Button small onClick={() => setChangeError('')}>{t('dismiss')}</Button>}>{changeError}</Notice>}
    {view.available && !view.roles.length && <p className="studio-muted" role="status">{t('noRoles')}</p>}
    {view.available && view.roles.length > 0 && <div className="studio-tool-cards studio-card-pair">{view.roles.map(role => {
      const copy = role.source === 'session' && view.presetRoleIds.includes(role.role);
      return <article className="studio-role-card" key={role.role}>
        <div className="studio-card-head"><h3>{role.name}</h3>
          <Badge tone={role.source === 'session' ? 'info' : 'outline'}>{role.source === 'preset' ? t('sourcePreset') : copy ? t('sourceSessionCopy') : t('sourceSession')}</Badge>
        </div>
        <p className="studio-card-text studio-mono">{role.role}</p>
        <p className="studio-card-meta">{modelLabel(role.model)} · {t('reasoning')} {role.reasoning === 'inherit' ? t('reasoningDefault') : role.reasoning} · {role.spawn === 'fork' ? t('spawnFork') : t('spawnFresh')}</p>
        {editable && <div className="studio-card-footer">
          <Button small aria-haspopup="dialog" onClick={() => setDraft({ mode: 'edit', role, presetCopy: role.source === 'preset' || copy })}>{t('edit')}</Button>
          {role.source === 'session' && <Button small onClick={() => void change(() => actions.remove(role.role))}>{copy ? t('revert') : t('remove')}</Button>}
        </div>}
      </article>;
    })}</div>}
    {draft && <RoleDialog key={draft.mode === 'edit' ? draft.role.role : '+'} draft={draft} models={models} locale={locale} onClose={() => setDraft(undefined)}
      onSave={async fields => {
        const next = draft.mode === 'edit'
          ? await actions.edit(draft.role.role, { model: fields.model, reasoning: fields.reasoning, persona: fields.persona })
          : await actions.add(fields);
        setView(next); setDraft(undefined);
      }} />}
  </div>;
}

function RoleDialog({ draft, models, locale, onClose, onSave }: {
  draft: Draft; locale: string; onClose: () => void; onSave: (fields: Fields) => Promise<void>;
  models: { value: string; label: string; reasoning?: { efforts: { id: string; name: string }[] } }[];
}) {
  const t = (key: SessionRolesTextKey) => sessionRolesText(locale, key);
  const initial: Fields = draft.mode === 'edit'
    ? { name: draft.role.name, role: draft.role.role, model: draft.role.model, reasoning: draft.role.reasoning, persona: draft.role.persona }
    : { name: '', role: '', model: 'inherit', reasoning: 'inherit', persona: '' };
  const [fields, setFields] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const model = models.find(item => item.value === fields.model);
  const set = (patch: Partial<Fields>) => setFields(current => ({ ...current, ...patch }));
  const field = (label: string, content: React.ReactNode) => <label className="studio-field"><span>{label}</span>{content}</label>;
  const adding = draft.mode === 'add';
  const ready = !adding || (fields.name.trim() && fields.role.trim());
  const save = async () => {
    setSaving(true); setError('');
    try { await onSave(fields); } catch (failure) { setError(`${t('saveFailed')} ${messageOf(failure)}`); } finally { setSaving(false); }
  };
  return <DetailDialog open title={adding ? t('addTitle') : fields.name} subtitle={adding ? undefined : t('editTitle')} onClose={onClose}
    footer={<><Button small onClick={onClose}>{t('cancel')}</Button><Button small primary disabled={saving || !ready} onClick={() => void save()}>{saving ? t('saving') : t('save')}</Button></>}>
    <Note>{adding ? t('temporaryHint') : draft.presetCopy ? t('copyHint') : t('temporaryHint')}</Note>
    {error && <Notice>{error}</Notice>}
    {adding && <div className="studio-field-grid">
      {field(t('name'), <input value={fields.name} onChange={e => set({ name: e.target.value })} />)}
      {field(t('roleId'), <input className="studio-mono" value={fields.role} onChange={e => set({ role: e.target.value })} />)}
    </div>}
    <div className="studio-field-grid">
      {field(t('model'), <select value={fields.model} onChange={e => set({ model: e.target.value, reasoning: 'inherit' })}>
        <option value="inherit">{t('inheritModel')}</option>
        {fields.model !== 'inherit' && !model && <option value={fields.model} disabled>{fields.model} · {t('modelUnlisted')}</option>}
        {models.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>)}
      {field(t('reasoningLevel'), <select value={fields.reasoning} disabled={!model && fields.reasoning === 'inherit'} onChange={e => set({ reasoning: e.target.value })}>
        <option value="inherit">{fields.model === 'inherit' ? t('inheritSetting') : t('modelDefault')}</option>
        {fields.reasoning !== 'inherit' && !model?.reasoning?.efforts.some(effort => effort.id === fields.reasoning) && <option value={fields.reasoning} disabled>{fields.reasoning} · {t('effortUnconfirmed')}</option>}
        {model?.reasoning?.efforts.map(effort => <option value={effort.id} key={effort.id}>{effort.name}</option>)}
      </select>)}
    </div>
    {field(t('persona'), <textarea rows={8} value={fields.persona} onChange={e => set({ persona: e.target.value })} />)}
  </DetailDialog>;
}
