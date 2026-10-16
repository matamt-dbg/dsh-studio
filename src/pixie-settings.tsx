/** Studio → Pixie settings service: default model and thread options, separate from presets. Node-testable.
 * Uses the same {@link DetailLayout} frame as the preset service so every Studio service looks alike.
 */
import React from 'react';
import { GateTaskCompositionPage, GateTaskScopePage, useGateTasks, type GateTaskActions } from './pixie-gate-task-pages.tsx';
import { gateComposeText } from './pixie-gate-compose-locale.ts';
import { Button, Notice, PageHead, Segmented, SettingsRow, Toggle } from './ui.tsx';
import { DetailLayout } from './detail-layout.tsx';
import type { PixieContextMode, PixieSettings } from './pixie-contracts.ts';
import { pixieText, type PixieTextKey } from './pixie-locale.ts';

/** Model catalog as `sessionController.modelCatalog()` returns it. */
export interface PixieSettingsCatalog {
  groups: readonly { id: string; name: string; models: readonly { id: string; name: string; reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string } }[] }[];
  failures?: readonly { id: string; name: string; message: string }[];
}

export interface PixieSettingsActions {
  read(): Promise<PixieSettings>;
  save(settings: PixieSettings): Promise<PixieSettings>;
  models(): Promise<PixieSettingsCatalog>;
}

const SEP = '\u0000';
const NO_GATES: GateTaskActions = {
  read: async () => ({ entries: [], invalid: [] }), save: async () => undefined, scripts: async () => ({ directory: '', defaultDirectory: '', custom: false, supported: false, scripts: [] }),
  saveScriptDirectory: async () => ({ directory: '', defaultDirectory: '', custom: false, supported: false, scripts: [] }),
  trial: () => ({ result: Promise.reject(new Error('Gate API unavailable')), cancel() {} }), presets: async () => [],
};
type PageId = 'model' | 'threads' | 'prompt' | 'gate-composition' | 'gate-scope';

export function PixieSettingsPage({ actions, gateActions, locale, navFooter }: { actions: PixieSettingsActions; gateActions?: GateTaskActions; locale: string; navFooter?: React.ReactNode }) {
  const t = (key: PixieTextKey) => pixieText(locale, key);
  const [page, setPage] = React.useState<PageId>('model');
  // Both gate pages share one draft list; Save replaces the stored definitions.
  const gates = useGateTasks(gateActions ?? NO_GATES);
  const [gatePresets, setGatePresets] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => { if (gateActions) void gateActions.presets().then(setGatePresets, () => setGatePresets([])); }, [gateActions]);
  const gt = (key: Parameters<typeof gateComposeText>[1]) => gateComposeText(locale, key);
  const [draft, setDraft] = React.useState<PixieSettings>();
  const [catalog, setCatalog] = React.useState<PixieSettingsCatalog>();
  const [error, setError] = React.useState('');
  const [status, setStatus] = React.useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = React.useState('');
  // The last loaded or saved value; Save stays disabled until the draft differs from it.
  const [stored, setStored] = React.useState('');
  const load = React.useCallback(async () => {
    setError('');
    try {
      const [settings, models] = await Promise.all([actions.read(), actions.models()]);
      setDraft(settings); setCatalog(models); setStored(JSON.stringify(settings));
    } catch (reason) { setError((reason instanceof Error ? reason.message : String(reason))); }
  }, [actions]);
  React.useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    setStatus('saving'); setSaveError('');
    try { const next = await actions.save(draft); setDraft(next); setStored(JSON.stringify(next)); setStatus('saved'); }
    catch (reason) { setStatus('idle'); setSaveError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const update = (next: Partial<PixieSettings>) => { if (draft) { setDraft({ ...draft, ...next }); setStatus('idle'); } };
  const replace = (next: PixieSettings) => { setDraft(next); setStatus('idle'); };
  const dirty = draft !== undefined && JSON.stringify(draft) !== stored;

  /** One page: the shared head with Save, the shared state lines, then the page's settings card. */
  const section = (title: PixieTextKey, description: PixieTextKey, body: (draft: PixieSettings, catalog: PixieSettingsCatalog) => React.ReactNode) => <div className="studio-page-stack">
    <PageHead title={t(title)} description={t(description)}
      actions={draft && catalog ? <Button primary disabled={status === 'saving' || !dirty} onClick={() => { void save(); }}>{status === 'saving' ? t('saving') : dirty ? t('save') : t('savedButton')}</Button> : undefined} />
    {saveError && <Notice action={<Button small onClick={() => setSaveError('')}>{t('dismiss')}</Button>}>{`${t('saveFailed')} (${saveError})`}</Notice>}
    {error && <Notice action={!draft ? <Button small onClick={() => { void load(); }}>{t('retry')}</Button> : undefined}>{error}</Notice>}
    {!error && (!draft || !catalog) && <p role="status" className="studio-muted">{t('loading')}</p>}
    {draft && catalog && body(draft, catalog)}
  </div>;

  const modelPage = section('pageModel', 'pageModelDescription', (draft, catalog) => {
    const selected = draft.model ? catalog.groups.find(group => group.id === draft.model!.provider)?.models.find(model => model.id === draft.model!.model) : undefined;
    const efforts = selected?.reasoning?.efforts ?? [];
    return <>
      {catalog.failures && catalog.failures.length > 0 && <Notice>{`${t('catalogFailed')} ${catalog.failures.map(failure => failure.name).join(', ')}`}</Notice>}
      <section className="studio-settings-card">
        <SettingsRow title={t('settingsModel')} description={t('settingsModelHint')} control={
          <select className="studio-compact" aria-label={t('settingsModel')} value={draft.model ? `${draft.model.provider}${SEP}${draft.model.model}` : ''} onChange={event => {
            const [provider, model] = event.target.value.split(SEP);
            const { model: _previous, ...rest } = draft;
            replace(provider && model ? { ...rest, model: { provider, model } } : rest);
          }}>
            <option value="">{t('settingsNoModel')}</option>
            {catalog.groups.map(group => <optgroup key={group.id} label={group.name}>
              {group.models.map(model => <option key={model.id} value={`${group.id}${SEP}${model.id}`}>{model.name}</option>)}
            </optgroup>)}
          </select>} />
        <SettingsRow title={t('settingsEffort')} control={
          <select className="studio-compact" aria-label={t('settingsEffort')} disabled={!draft.model || efforts.length === 0} value={draft.model?.reasoningEffort ?? ''} onChange={event => {
            if (!draft.model) return;
            const { reasoningEffort: _previous, ...model } = draft.model;
            update({ model: event.target.value ? { ...model, reasoningEffort: event.target.value } : model });
          }}>
            <option value="">{t('settingsEffortDefault')}</option>
            {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
          </select>} />
        <SettingsRow title={t('settingsMaxTokens')} control={
          <input className="studio-compact" aria-label={t('settingsMaxTokens')} type="number" min={1} step={1} disabled={!draft.model} placeholder={t('settingsEffortDefault')} value={draft.model?.maxTokens ?? ''} onChange={event => {
            if (!draft.model) return;
            const { maxTokens: _previous, ...model } = draft.model;
            const value = Number(event.target.value);
            update({ model: event.target.value && Number.isInteger(value) && value > 0 ? { ...model, maxTokens: value } : model });
          }} />} />
      </section>
    </>;
  });

  const threadsPage = section('pageThreads', 'pageThreadsDescription', draft => <section className="studio-settings-card">
    <SettingsRow title={t('settingsMode')} description={t(draft.contextMode === 'fresh' ? 'settingsModeFresh' : 'settingsModeFork')} control={
      <Segmented label={t('settingsMode')} value={draft.contextMode} onChange={(mode: PixieContextMode) => update({ contextMode: mode })}
        options={[{ value: 'fresh', label: t('fresh') }, { value: 'fork', label: t('fork') }]} />} />
    <SettingsRow title={t('settingsAllowThreadModel')} description={t(draft.allowThreadModel ? 'settingsThreadModelOnHint' : 'settingsThreadModelOffHint')} control={
      <Toggle label={t('settingsAllowThreadModel')} checked={draft.allowThreadModel} onChange={allowThreadModel => update({ allowThreadModel })} />} />
  </section>);

  const promptPage = section('pagePrompt', 'pagePromptDescription', draft => <section className="studio-settings-card">
    <SettingsRow title={t('settingsPrompt')}>
      <textarea className="studio-pixie-prompt" aria-label={t('settingsPrompt')} value={draft.systemPrompt} onChange={event => update({ systemPrompt: event.target.value })} />
    </SettingsRow>
  </section>);

  return <DetailLayout footer={navFooter} navigation={t('settingsNavigation')} selected={page} onSelect={next => setPage(next as PageId)} pages={[
    { id: 'model', group: t('settingsGroup'), label: t('pageModel'), content: modelPage },
    { id: 'threads', group: t('settingsGroup'), label: t('pageThreads'), content: threadsPage },
    { id: 'prompt', group: t('settingsGroup'), label: t('pagePrompt'), content: promptPage },
    ...(gateActions ? [
      { id: 'gate-composition', group: gt('group'), label: gt('composition'), content: <GateTaskCompositionPage gates={gates} locale={locale} /> },
      { id: 'gate-scope', group: gt('group'), label: gt('scope'), content: <GateTaskScopePage gates={gates} presets={gatePresets} locale={locale} /> },
    ] : []),
  ]} />;
}
