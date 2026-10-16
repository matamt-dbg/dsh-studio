/** Chat turn tail: shows the note a hook script concluded at turn end (e.g. a translation) under that turn's answer. */
import React from 'react';
import type { GateRun, GateRunFrame, GateRunRecord } from './pixie-gate-contracts.ts';
import { gateText, type GateTextKey } from './pixie-gate-locale.ts';
import { Badge, Button, ModelText, Notice } from './ui.tsx';

export interface GateTailActions {
  gateRuns(): Promise<GateRunRecord>;
  followGates(listener: (frame: GateRunFrame) => void): () => void;
  setSessionGate(gateId: string, enabled: boolean): Promise<string[]>;
  openTab(): void;
}

/** Marker a script may put on the first line of its note to say a check did not pass, e.g. "[한국어 번역 — 충실도 미확인]". */
const UNVERIFIED = /미확인|not verified|unverified|未确认/i;

/**
 * The note to show for one turn: the last finished turn-end run that a script concluded with a note.
 * Runs Pixie concluded, skipped runs, and runs from other turns are ignored.
 * @returns the run, or undefined when the turn has nothing to show.
 */
export function tailRun(runs: readonly GateRun[], turn: number): GateRun | undefined {
  return runs.filter(run => run.point === 'turn-end' && run.turn === turn && run.status === 'done'
    && run.result?.concludedBy === 'script' && typeof run.output?.note === 'string' && run.output.note.trim() !== '')
    .sort((a, b) => a.startedAt - b.startedAt).at(-1);
}

/** Splits a leading "[label]" line off the note so the label becomes the block title. */
export function splitNote(note: string): { label?: string; body: string } {
  const match = /^\s*\[([^\]\n]{1,80})\]\s*\n?/.exec(note);
  return match ? { label: match[1]!, body: note.slice(match[0].length) } : { body: note };
}

/** `Surface` wraps the block only when there is something to show, so empty turns mount nothing. */
export function GateTail({ actions, turn, locale, Surface = React.Fragment }: { actions: GateTailActions; turn: number; locale: string; Surface?: React.ComponentType<React.PropsWithChildren> }) {
  const t = (key: GateTextKey) => gateText(locale, key);
  const [runs, setRuns] = React.useState<GateRun[]>([]);
  const [disabled, setDisabled] = React.useState<readonly string[]>([]);
  const [open, setOpen] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let active = true;
    const refresh = () => actions.gateRuns().then(record => { if (active) { setRuns(record.runs); setDisabled(record.disabledGateIds ?? []); } }, () => {});
    const stop = actions.followGates(frame => {
      if (!active) return;
      if (frame.type === 'sync') { void refresh(); return; }
      if (frame.type === 'session') { setDisabled(frame.disabledGateIds); return; }
      setRuns(current => [...current.filter(run => run.id !== frame.run.id), frame.run]);
    });
    void refresh();
    return () => { active = false; stop(); };
  }, [actions]);
  const run = tailRun(runs, turn);
  if (!run) return null;
  const { label, body } = splitNote(run.output!.note!);
  const off = disabled.includes(run.gateId);
  const unverified = !!label && UNVERIFIED.test(label);
  const turnOff = async () => {
    setBusy(true); setError('');
    try { setDisabled(await actions.setSessionGate(run.gateId, false)); }
    catch (cause) { setError(`${t('sessionGateFailed')} (${cause instanceof Error ? cause.message : String(cause)})`); }
    finally { setBusy(false); }
  };
  return <Surface><section className="studio-gate-tail-body" aria-label={t('tailTitle').replace('{name}', run.gateName)} data-gate-tail={run.gateId} data-unverified={unverified ? 'true' : undefined}>
    <div className="studio-gate-tail-head">
      <strong>{label ?? run.gateName}</strong>
      {unverified && <Badge tone="warning">{t('tailUnverified')}</Badge>}
      <span className="studio-card-meta">{t('tailTitle').replace('{name}', run.gateName)}</span>
      <span className="studio-inline-actions">
        <Button small onClick={() => setOpen(value => !value)}>{t(open ? 'tailHide' : 'tailShow')}</Button>
        <Button small onClick={actions.openTab}>{t('tailOpen')}</Button>
        {!off && <Button small disabled={busy} onClick={() => { void turnOff(); }}>{t('tailOff')}</Button>}
      </span>
    </div>
    {error && <Notice>{error}</Notice>}
    {off && <p role="status" className="studio-muted">{t('tailOffDone')}</p>}
    {open && <ModelText text={body} locale={locale} />}
  </section></Surface>;
}
