/** Pixie tab body for the Trajectory right sidebar. Node-testable: no host primitives. */
import React from 'react';
import { GateRunsPanel, type GateRunActions } from './pixie-gate-runs.tsx';
import { LoopRunsPanel, type LoopRunActions } from './pixie-loop-runs.tsx';
import { loopText } from './pixie-loop-locale.ts';
import { gateText } from './pixie-gate-locale.ts';
import { Badge, Button, IconButton, ModelText, Notice, Note, Segmented, StudioSurface, TabBar, TabPanel } from './ui.tsx';
import type { PixieAskFrame, PixieContextMode, PixieModel, PixieSessionRecord, PixieSettings, PixieThread, PixieTurn, PixieUsageTotal } from './pixie-contracts.ts';
import { pixieError, pixieText, type PixieTextKey } from './pixie-locale.ts';

/** What the Host returns for one session (mirrors `PixieView` on the Host). */
export interface PixieViewValue {
  record: PixieSessionRecord;
  total: PixieUsageTotal;
  running: boolean;
  frames: PixieAskFrame[];
  settings: PixieSettings;
  contextWindow?: number;
}

/** Model catalog shape returned by `sessionController.modelCatalog()`. */
export interface PixieModelCatalog { groups?: readonly { id: string; name: string; models: readonly { id: string; name: string }[] }[] }

/** Session-bound Pixie operations the tab uses. */
export interface PixieTabActions extends GateRunActions, Partial<LoopRunActions> {
  view(): Promise<PixieViewValue>;
  follow(listener: (frame: PixieAskFrame) => void): () => void;
  ask(question: string, threadId?: string): Promise<{ threadId: string; turnId: string }>;
  cancel(): Promise<boolean>;
  createThread(options: { mode?: PixieContextMode; model?: PixieModel }): Promise<PixieThread>;
  activate(threadId: string): Promise<boolean>;
  deleteThread(threadId: string): Promise<boolean>;
  models(): Promise<PixieModelCatalog>;
}

const PlusIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
const TrashIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
/** Pin = the thread /pixie sends to. Filled when it is the target, outlined when it can become one. */
const PinIcon = ({ filled }: { filled: boolean }) => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2.5h4l-.5 4 2.5 2.5H4l2.5-2.5zM8 9v4.5" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" /></svg>;
const BackIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** Message of a thrown value. */
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

type Live = { turnId: string; threadId: string; question: string; text: string };

function Turn({ turn, live, locale }: { turn: PixieTurn; live?: string; locale: string }) {
  const t = (key: PixieTextKey) => pixieText(locale, key);
  const answer = live ?? turn.answer;
  return <li className="studio-pixie-turn">
    <p className="studio-pixie-question">{turn.question}</p>
    {answer && <ModelText text={answer} locale={locale} streaming={live !== undefined || turn.status === 'streaming'} />}
    <div className="studio-pixie-turn-meta">
      {turn.status === 'streaming' && <Badge tone="info">{t('streaming')}</Badge>}
      {turn.status === 'cancelled' && <Badge tone="neutral">{t('cancelled')}</Badge>}
      {turn.status === 'error' && <Badge tone="warning">{t('error')}</Badge>}
      {turn.truncated && <Badge tone="warning">{t('truncated')}</Badge>}
    </div>
    {turn.error && <p className="studio-pixie-error" role="alert">{pixieError(locale, turn.error)}</p>}
  </li>;
}

/** Live status badges shared by a thread card and the open thread's head. The /pixie target is a pin, and the
 * context origin is meta text, so neither reads like a status.
 */
function ThreadBadges({ thread, answering, locale }: { thread: PixieThread; answering: boolean; locale: string }) {
  const t = (key: PixieTextKey) => pixieText(locale, key);
  const last = thread.turns.at(-1);
  return <>
    {answering && <Badge tone="info">{t('streaming')}</Badge>}
    {!answering && last?.status === 'error' && <Badge tone="warning">{t('error')}</Badge>}
  </>;
}

/** Meta line: model, how the thread's context started, and the question count. */
const threadMeta = (thread: PixieThread, locale: string, model: string) => [
  model, pixieText(locale, thread.mode === 'fork' ? 'forkMeta' : 'freshMeta'), `${thread.turns.length}${pixieText(locale, 'turnCount')}`,
].join(' · ');

/** Pixie for one session: every thread at a glance, one open thread with its conversation, and gate runs.
 * Wide panes show the thread list beside the open thread; narrow panes show one at a time.
 */
export function PixieTab({ actions, locale }: { actions: PixieTabActions; locale: string }) {
  const t = (key: PixieTextKey) => pixieText(locale, key);
  const [view, setView] = React.useState<PixieViewValue>();
  const [loadError, setLoadError] = React.useState('');
  const [actionError, setActionError] = React.useState('');
  const [question, setQuestion] = React.useState('');
  const [live, setLive] = React.useState<Live>();
  const [section, setSection] = React.useState<'chat' | 'gates' | 'loops'>('chat');
  // The thread shown in detail; undefined shows the overview on narrow panes and the /pixie target on wide ones.
  const [openId, setOpenId] = React.useState<string>();
  const [newMode, setNewMode] = React.useState<PixieContextMode | ''>('');
  const [catalog, setCatalog] = React.useState<PixieModelCatalog>();
  const [newModel, setNewModel] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try { setView(await actions.view()); setLoadError(''); } catch (error) { setLoadError(messageOf(error)); }
  }, [actions]);

  React.useEffect(() => {
    let active = true;
    // Subscribe before the first read so no frame falls between the snapshot and the stream.
    const stop = actions.follow(frame => {
      if (frame.type === 'sync') { setLive(undefined); void refresh(); }
      else if (frame.type === 'start') { setLive({ turnId: frame.turnId, threadId: frame.threadId, question: frame.question, text: '' }); void refresh(); }
      else if (frame.type === 'text') setLive(current => current && { ...current, text: current.text + frame.text });
      else if (frame.type === 'end') { setLive(undefined); void refresh(); }
    });
    void actions.view().then(value => {
      if (!active) return;
      setView(value); setLoadError('');
      // A view opened mid-answer replays the frames already streamed, unless the stream already reported this turn.
      const start = value.frames.find(frame => frame.type === 'start');
      if (start?.type === 'start') {
        const text = value.frames.flatMap(frame => frame.type === 'text' ? [frame.text] : []).join('');
        setLive(current => current ?? { turnId: start.turnId, threadId: start.threadId, question: start.question, text });
      }
    }, error => { if (active) setLoadError(messageOf(error)); });
    return () => { active = false; stop(); };
  }, [actions, refresh]);

  React.useEffect(() => {
    if (!view?.settings.allowThreadModel || catalog) return;
    actions.models().then(setCatalog, () => setCatalog({ groups: [] }));
  }, [actions, view?.settings.allowThreadModel, catalog]);

  const guard = async (operation: () => Promise<unknown>) => {
    setActionError('');
    try { await operation(); } catch (error) { setActionError(messageOf(error)); }
  };

  if (loadError) return <StudioSurface className="studio-pixie"><Notice action={<Button small onClick={() => { void refresh(); }}>{t('retry')}</Button>}>{loadError}</Notice></StudioSurface>;
  if (!view) return <StudioSurface className="studio-pixie"><p className="studio-muted">{t('loading')}</p></StudioSurface>;

  const record = view.record;
  const opened = record.threads.find(thread => thread.id === openId);
  // Wide panes always show a thread: the opened one, else the /pixie target, else the newest.
  const shown = opened ?? record.threads.find(thread => thread.id === record.activeThreadId) ?? record.threads.at(-1);
  const running = live !== undefined || view.running;
  const configured = Boolean(view.settings.model);
  const answering = (thread: PixieThread) => live?.threadId === thread.id || thread.turns.some(turn => turn.status === 'streaming');
  const submit = () => guard(async () => {
    const text = question.trim();
    if (!text) return;
    await actions.ask(text, shown?.id);
    setQuestion('');
  });
  const createThread = () => guard(async () => {
    const [provider, model] = newModel ? newModel.split('\u0000') as [string, string] : [];
    const thread = await actions.createThread({ ...(newMode ? { mode: newMode } : {}), ...(provider && model ? { model: { provider, model } } : {}) });
    setCreating(false); setNewMode(''); setNewModel('');
    setOpenId(thread.id);
    await refresh();
  });
  const target = (thread: PixieThread) => guard(async () => { await actions.activate(thread.id); await refresh(); });
  const remove = (thread: PixieThread) => guard(async () => {
    await actions.deleteThread(thread.id);
    if (openId === thread.id) setOpenId(undefined);
    await refresh();
  });

  const list = <div className="studio-pixie-list">
    <div className="studio-pixie-list-head">
      <span className="studio-pixie-list-title">{t('allThreads')}<span className="studio-count">{record.threads.length}</span></span>
      {configured && <IconButton label={t('newThread')} onClick={() => setCreating(open => !open)}><PlusIcon /></IconButton>}
    </div>
    {configured && creating && <div className="studio-pixie-new">
      <Segmented label={t('mode')} value={newMode || view.settings.contextMode} onChange={(mode: PixieContextMode) => setNewMode(mode)}
        options={[{ value: 'fresh', label: t('fresh') }, { value: 'fork', label: t('fork') }]} />
      {view.settings.allowThreadModel && <select className="studio-compact" aria-label={t('model')} value={newModel} onChange={event => setNewModel(event.target.value)}>
        <option value="">{view.settings.model!.model}</option>
        {catalog?.groups?.map(group => <optgroup key={group.id} label={group.name}>
          {group.models.map(model => <option key={model.id} value={`${group.id}\u0000${model.id}`}>{model.name}</option>)}
        </optgroup>)}
      </select>}
      <Button small primary onClick={() => { void createThread(); }}>{t('create')}</Button>
    </div>}
    {record.threads.length === 0 && <p role="status" className="studio-muted">{t('noThreads')}</p>}
    <ul className="studio-pixie-thread-list" aria-label={t('threads')}>
      {[...record.threads].reverse().map(thread => {
        const last = thread.id === live?.threadId && !thread.turns.some(turn => turn.id === live.turnId) ? live.question : thread.turns.at(-1)?.question;
        return <li key={thread.id}>
          <button type="button" className="studio-pixie-thread" aria-current={thread.id === shown?.id ? 'true' : undefined} onClick={() => setOpenId(thread.id)}>
            <span className="studio-card-head"><span className="studio-pixie-title"><strong>{thread.title}</strong>
              {thread.id === record.activeThreadId && <span className="studio-pixie-pin" role="img" aria-label={t('activeBadge')} title={t('activeBadge')}><PinIcon filled /></span>}</span>
              <ThreadBadges thread={thread} answering={answering(thread)} locale={locale} /></span>
            <span className="studio-pixie-thread-preview">{last ?? t('noTurns')}</span>
            <span className="studio-card-meta">{threadMeta(thread, locale, thread.model.model)}</span>
          </button>
        </li>;
      })}
    </ul>
  </div>;

  const detail = shown && <div className="studio-pixie-detail">
    <div className="studio-pixie-detail-head">
      <span className="studio-pixie-back"><IconButton label={t('allThreads')} onClick={() => setOpenId(undefined)}><BackIcon /></IconButton></span>
      <span className="studio-card-head"><span className="studio-pixie-title"><strong>{shown.title}</strong>
        {/* Right of the title, away from Delete. Pressed = this thread is the /pixie target; press another thread's pin to move it. */}
        <span className="studio-pixie-pin-toggle" data-target={shown.id === record.activeThreadId}>
          <IconButton label={shown.id === record.activeThreadId ? t('activeBadge') : t('makeTarget')} pressed={shown.id === record.activeThreadId}
            onClick={() => { if (shown.id !== record.activeThreadId) void target(shown); }}><PinIcon filled={shown.id === record.activeThreadId} /></IconButton>
        </span></span>
        <ThreadBadges thread={shown} answering={answering(shown)} locale={locale} /></span>
      <span className="studio-inline-actions">
        <IconButton label={t('deleteThread')} tone="error" disabled={running && live?.threadId === shown.id} onClick={() => { void remove(shown); }}><TrashIcon /></IconButton>
      </span>
    </div>
    <p className="studio-card-meta">{threadMeta(shown, locale, `${shown.model.provider} / ${shown.model.model}`)}</p>
    <ol className="studio-pixie-turns">
      {shown.turns.map(turn => <Turn key={turn.id} turn={turn} locale={locale} {...(live?.turnId === turn.id ? { live: live.text } : {})} />)}
      {live && live.threadId === shown.id && !shown.turns.some(turn => turn.id === live.turnId) && <Turn locale={locale} live={live.text}
        turn={{ id: live.turnId, question: live.question, answer: '', status: 'streaming', model: shown.model, startedAt: 0 }} />}
    </ol>
    {shown.turns.length === 0 && !(live && live.threadId === shown.id) && <p className="studio-muted">{t('noTurns')}</p>}
    {configured && <div className="studio-pixie-compose">
      <textarea aria-label={t('question')} placeholder={t('placeholder')} value={question} rows={2} onChange={event => setQuestion(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); } }} />
      <div className="studio-pixie-compose-bar">
        {running && <Button small onClick={() => { void guard(() => actions.cancel()); }}>{t('cancel')}</Button>}
        <Button small primary disabled={running || !question.trim()} onClick={() => { void submit(); }}>{t('ask')}</Button>
      </div>
    </div>}
  </div>;

  return <StudioSurface className="studio-pixie">
    <TabBar label={t('title')} value={section} onChange={setSection} items={[{ value: 'chat', label: t('chat') }, { value: 'gates', label: gateText(locale, 'gates') }, ...(actions.loopRuns ? [{ value: 'loops' as const, label: loopText(locale, 'loops') }] : [])]} />
    <TabPanel>
      {section === 'gates' ? <GateRunsPanel actions={actions} locale={locale} /> : section === 'loops' && actions.loopRuns ? <LoopRunsPanel actions={{ loopRuns: actions.loopRuns }} locale={locale} /> : <div className="studio-pixie-chat">
        {!configured && <Note>{t('noModel')}</Note>}
        {actionError && <p className="studio-pixie-error" role="alert">{pixieError(locale, actionError)}</p>}
        <div className="studio-pixie-threads" data-open={opened ? 'true' : 'false'}>
          {list}
          {detail}
        </div>
      </div>}
    </TabPanel>
  </StudioSurface>;
}

/** What the `/pixie` row needs: its recorded turn and the live stream of its session. */
export interface PixieCommandRowActions {
  commandId: string;
  commandTurn(): Promise<PixieTurn | null>;
  follow(listener: (frame: PixieAskFrame) => void): () => void;
}

/** The conversation row for `/pixie`: question, then Pixie's answer (shown here and in the tab, never added to the model context). */
export function PixieCommandRow({ question, outcome, locale, onOpen, actions }: { question: string; outcome: { kind: 'success' | 'error'; text?: string } | null; locale: string; onOpen: () => void; actions?: PixieCommandRowActions }) {
  const t = (key: PixieTextKey) => pixieText(locale, key);
  const [turn, setTurn] = React.useState<PixieTurn | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [live, setLive] = React.useState<string>();
  React.useEffect(() => {
    if (!actions || outcome?.kind !== 'success') return;
    let active = true;
    // Frames belong to this row only between its own start and the next start or end.
    let mine = false;
    const load = () => actions.commandTurn().then(value => { if (!active) return; setTurn(value); setLoaded(true); if (value && value.status !== 'streaming') setLive(undefined); }, () => { if (active) setLoaded(true); });
    const stop = actions.follow(frame => {
      if (frame.type === 'sync') { mine = false; setLive(undefined); void load(); }
      else if (frame.type === 'start') { mine = frame.commandId === actions.commandId; if (mine) setLive(''); }
      else if (frame.type === 'text') { if (mine) setLive(current => (current ?? '') + frame.text); }
      else if (frame.type === 'end') {
        // The row subscribes after command completion and may miss its start.
        // Reconcile by command id even then; another request cannot replace this answer.
        mine = false;
        void load();
      }
    });
    void load();
    return () => { active = false; stop(); };
  }, [actions, outcome?.kind]);
  const answer = live ?? turn?.answer ?? '';
  const status = turn?.status === 'streaming' || live !== undefined ? 'streaming' : turn?.status;
  return <div className="studio-pixie-row">
    <div className="studio-pixie-row-head">
      <Badge tone="outline">Pixie</Badge>
      <span className="studio-pixie-row-question">{question}</span>
      <Button small onClick={onOpen}>{t('openTab')}</Button>
    </div>
    {outcome?.kind === 'error' ? <p className="studio-pixie-error" role="alert">{pixieError(locale, outcome.text ?? '')}</p>
      : turn?.status === 'error' ? <p className="studio-pixie-error" role="alert">{pixieError(locale, turn.error ?? '')}</p>
        : answer ? <ModelText text={answer} locale={locale} streaming={live !== undefined && !outcome} />
          // A row from an older Studio has no linked turn: point to the tab instead of waiting forever.
          : <p className="studio-muted">{!outcome ? t('streaming') : status === 'cancelled' ? t('cancelled') : loaded && !turn ? t('rowAsked') : t('rowWaiting')}</p>}
    <div className="studio-pixie-turn-meta">
      {status === 'cancelled' && answer && <Badge tone="neutral">{t('cancelled')}</Badge>}
      {turn?.truncated && <Badge tone="warning">{t('truncated')}</Badge>}
    </div>
  </div>;
}
