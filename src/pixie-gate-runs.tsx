import React from 'react';
import type { GateRun, GateRunFrame, GateRunRecord, SessionGates } from './pixie-gate-contracts.ts';
import { gateText, gatePointText, type GateTextKey } from './pixie-gate-locale.ts';
import { GateResultDetails } from './pixie-gate-result.tsx';
import { gateTaskText, type GateTaskKey } from './pixie-gate-task-locale.ts';
import { Badge, Button, IconButton, SectionHead, Notice, Note, Toggle } from './ui.tsx';

export interface GateRunActions {
  gateRuns(): Promise<GateRunRecord>;
  followGates(listener: (frame: GateRunFrame) => void): () => void;
  resolveGateRejection(runId: string, status: 'resent' | 'dismissed'): Promise<unknown>;
  fillDraft(text: string): void;
  /** Gates for this session's preset with their session switch; absent on hosts without the feature. */
  sessionGates?(): Promise<SessionGates>;
  setSessionGate?(gateId: string, enabled: boolean): Promise<string[]>;
}

/** Gates that apply to this session, each with an on/off switch for this session only. */
export function SessionGateList({ actions, locale, disabled }: { actions: GateRunActions; locale: string; disabled?: readonly string[] | undefined }) {
  const t = (key: GateTextKey) => gateText(locale, key);
  const [view, setView] = React.useState<SessionGates>();
  const [busy, setBusy] = React.useState<string>();
  const [error, setError] = React.useState('');
  const load = actions.sessionGates;
  React.useEffect(() => {
    if (!load) return;
    let active = true;
    void load().then(next => { if (active) setView(next); }, cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [load]);
  // Another surface (the chat block, another window) may switch a gate; the live frame is authoritative.
  React.useEffect(() => {
    if (!disabled) return;
    const off = new Set(disabled);
    setView(current => current && { ...current, gates: current.gates.map(gate => ({ ...gate, sessionEnabled: !off.has(gate.id) })) });
  }, [disabled]);
  if (!load || !actions.setSessionGate || !view) return null;
  const toggle = async (id: string, enabled: boolean) => {
    setBusy(id); setError('');
    try {
      const off = new Set(await actions.setSessionGate!(id, enabled));
      setView(current => current && { ...current, gates: current.gates.map(gate => ({ ...gate, sessionEnabled: !off.has(gate.id) })) });
    } catch (cause) { setError(`${t('sessionGateFailed')} (${cause instanceof Error ? cause.message : String(cause)})`); }
    finally { setBusy(undefined); }
  };
  return <section className="studio-gate-block studio-gate-session" aria-label={t('sessionGates')}>
    <SectionHead title={t('sessionGates')} description={t('sessionGatesHint')} />
    {error && <Notice>{error}</Notice>}
    {!view.gates.length ? <Note>{t('sessionGatesEmpty')}</Note> : <ul className="studio-gate-session-list">{view.gates.map(gate => <li key={gate.id} className="studio-gate-session-row" data-gate-session={gate.id}>
      <span className="studio-gate-session-name"><strong>{gate.name}</strong><span className="studio-card-meta">{gateTaskText(locale, `when-${gate.when}` as GateTaskKey)}{gate.script ? ` · ${gate.script}` : ''}{gate.sessionEnabled ? '' : ` · ${t('sessionGateOff')}`}</span></span>
      <Toggle label={t('sessionGateToggle').replace('{name}', gate.name)} checked={gate.sessionEnabled} disabled={busy === gate.id} onChange={checked => { void toggle(gate.id, checked); }} />
    </li>)}</ul>}
  </section>;
}

/** Applied is authoritative; lifecycle states only override when no action was applied. */
export function gateRunStatus(run: GateRun): GateTextKey {
  return run.applied !== 'none' ? run.applied : run.status === 'done' ? 'none' : run.status;
}

export function GateRunsPanel({ actions, locale }: { actions: GateRunActions; locale: string }) {
  const t = (key: GateTextKey) => gateText(locale, key);
  const [runs, setRuns] = React.useState<GateRun[]>([]);
  const [openId, setOpenId] = React.useState<string>();
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [disabled, setDisabled] = React.useState<string[]>();
  React.useEffect(() => {
    let active = true;
    let generation = 0;
    // Run frames arriving during a snapshot read must win over that older snapshot.
    let updates = new Map<string, GateRun>();
    const refresh = async () => {
      const request = ++generation;
      updates = new Map();
      try {
        const record = await actions.gateRuns();
        if (!active || request !== generation) return;
        const merged = new Map(record.runs.map(run => [run.id, run]));
        for (const [id, run] of updates) merged.set(id, run);
        setRuns([...merged.values()]); setError('');
      } catch (cause) { if (active && request === generation) setError(String(cause)); }
    };
    const stop = actions.followGates(frame => {
      if (!active) return;
      if (frame.type === 'sync') { void refresh(); return; }
      if (frame.type === 'session') { setDisabled(frame.disabledGateIds); return; }
      updates.set(frame.run.id, frame.run);
      setRuns(current => [...current.filter(run => run.id !== frame.run.id), frame.run]);
    });
    void refresh();
    return () => { active = false; stop(); };
  }, [actions]);
  const time = (at: number) => Number.isFinite(at) && at > 0 && Number.isFinite(new Date(at).getTime()) ? new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const fullTime = (at: number) => Number.isFinite(at) && at > 0 && Number.isFinite(new Date(at).getTime()) ? new Date(at).toLocaleString(locale) : '—';
  const sorted = [...runs].sort((a, b) => Number(b.rejection?.status === 'pending') - Number(a.rejection?.status === 'pending') || b.startedAt - a.startedAt);
  const opened = sorted.find(run => run.id === openId);
  const shown = opened ?? sorted[0];
  const rejectionOriginal = shown?.rejection?.original || shown?.original || '';
  const badges = (run: GateRun) => <><Badge tone={run.rejection?.status === 'pending' || run.status === 'error' ? 'warning' : 'neutral'}>{t(run.rejection?.status === 'pending' ? 'pending' : gateRunStatus(run))}</Badge></>;
  const resolve = async (run: GateRun, status: 'resent' | 'dismissed') => {
    setBusy(true); setError('');
    try {
      await actions.resolveGateRejection(run.id, status);
      setRuns(current => current.map(item => item.id === run.id && item.rejection ? { ...item, rejection: { ...item.rejection, status } } : item));
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="studio-pixie-chat">
    <SessionGateList actions={actions} locale={locale} disabled={disabled} />
    {error && <Notice>{error}</Notice>}
    {!runs.length && <Note>{t('emptyRuns')}</Note>}
    <div className="studio-pixie-threads" data-open={opened ? 'true' : 'false'}>
      <div className="studio-pixie-list">
        <div className="studio-pixie-list-head"><span className="studio-pixie-list-title">{t('allRuns')}<span className="studio-count">{runs.length}</span></span></div>
        <ul className="studio-pixie-thread-list">{sorted.map(run => <li key={run.id}>
          <button type="button" className="studio-pixie-thread studio-gate-run-item" aria-current={shown?.id === run.id ? 'true' : undefined} onClick={() => setOpenId(run.id)}>
            <span className="studio-card-head"><strong>{run.gateName}</strong>{badges(run)}</span>
            <span className="studio-card-meta">{gatePointText(locale, run.point)} · {time(run.startedAt)}{run.tool ? ` · ${run.tool.name}` : ''}</span>
          </button>
        </li>)}</ul>
      </div>
      {shown && <div className="studio-pixie-detail">
        <div className="studio-pixie-detail-head"><span className="studio-pixie-back"><IconButton label={t('allRuns')} onClick={() => setOpenId(undefined)}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg></IconButton></span><strong>{shown.gateName}</strong>{badges(shown)}</div>
        <p className="studio-card-meta">{gatePointText(locale, shown.point)} · {fullTime(shown.startedAt)}{shown.hooksInput === 'unverified' ? ` · ${t('unverified')}` : ''}</p>
        <dl className="studio-gate-facts">
          <dt>{t('applied')}</dt><dd><Badge tone={shown.applied === 'none' || shown.applied === 'pass' ? 'neutral' : 'info'}>{t(shown.applied)}</Badge></dd>
          {shown.result?.concludedBy && <><dt>{t('concludedBy')}</dt><dd>{t(shown.result.concludedBy === 'script' ? 'concludedScript' : shown.result.concludedBy === 'skipped' ? 'concludedSkipped' : 'concludedPixie')}</dd></>}
          {shown.output && <><dt>{t('verdict')}</dt><dd><Badge tone={shown.output.verdict === 'stop' ? 'warning' : 'success'}>{t(shown.output.verdict === 'stop' ? 'stop' : 'pass')}</Badge></dd></>}
          {shown.output?.reason !== undefined && !shown.rejection && <><dt>{t('reason')}</dt><dd>{shown.output.reason}</dd></>}
          {shown.reason && <><dt>{t('applyNote')}</dt><dd>{shown.reason}</dd></>}
          {shown.point === 'turn-end' && <><dt>{t('turn')}</dt><dd>{shown.turn ?? '—'} · {t('steerCount')}: {shown.steerCount ?? '—'}</dd></>}
          {shown.point.startsWith('tool-') && shown.tool && <><dt>{t('tool')}</dt><dd>{shown.tool.name} <span className="studio-card-meta">{t('callId')}: {shown.tool.callId}</span></dd></>}
          {(shown.usage?.inputTokens ?? 0) + (shown.usage?.outputTokens ?? 0) > 0 && <><dt>{t('tokens')}</dt><dd>{t('usage').replace('{input}', String(shown.usage.inputTokens ?? 0)).replace('{output}', String(shown.usage.outputTokens ?? 0))}</dd></>}
        </dl>
        {shown.rejection && <section className="studio-gate-block" aria-label={t('rejected')}>
          {rejectionOriginal && <><SectionHead title={t('original')} /><p className="studio-pixie-answer studio-gate-text">{rejectionOriginal}</p></>}
          <SectionHead title={t('reason')} />
          <p className="studio-pixie-answer">{shown.rejection.reason}</p>
          {shown.rejection.suggestion && <><SectionHead title={t('suggestion')} /><p className="studio-pixie-answer studio-gate-text">{shown.rejection.suggestion}</p></>}
          {shown.rejection.status === 'pending' && <><Note>{t('draftNote')}</Note><div className="studio-inline-actions">
            <Button small disabled={busy} onClick={() => { try { actions.fillDraft(shown.rejection!.suggestion || rejectionOriginal); setError(''); } catch { setError(t('composerUnavailable')); } }}>{t('editSend')}</Button>
            <Button small disabled={busy} onClick={() => { void resolve(shown, 'resent'); }}>{t('resent')}</Button>
            <Button small disabled={busy} onClick={() => { void resolve(shown, 'dismissed'); }}>{t('dismissed')}</Button>
          </div></>}
        </section>}
        {shown.output && (['replace', 'append', 'note'] as const).some(key => shown.output![key] !== undefined) && <section className="studio-gate-block" aria-label={t('output')}>
          <SectionHead title={t(shown.result?.concludedBy === 'script' ? 'scriptOutput' : 'output')} />
          <dl className="studio-gate-facts">{(['replace', 'append', 'note'] as const).map(key => shown.output![key] !== undefined && <React.Fragment key={key}><dt>{t(key === 'note' ? 'notes' : key)}</dt><dd className="studio-gate-text">{shown.output![key]}</dd></React.Fragment>)}</dl>
        </section>}
        {shown.result ? <GateResultDetails result={shown.result} locale={locale} compact hideOriginal={!!shown.rejection} /> : !shown.rejection && shown.original && <section className="studio-gate-block"><SectionHead title={t('original')} /><p className="studio-pixie-answer studio-gate-text">{shown.original}</p></section>}
      </div>}
    </div>
  </div>;
}
