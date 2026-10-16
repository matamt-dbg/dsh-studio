/** Chat gate results: shows a gate result where it happened (under a turn's answer, a tool call, or an input message) when the gate's chat display is on. */
import React from 'react';
import type { GateRun, GateRunFrame, GateRunRecord } from './pixie-gate-contracts.ts';
import { gatePointText, gateText, type GateTextKey } from './pixie-gate-locale.ts';
import { Badge, Button, Disclosure, ModelText, Notice } from './ui.tsx';
import { applyGateFrame, bufferGateFrame } from './pixie-gate-chat-node.ts';

export interface GateTailActions {
  gateRuns(): Promise<GateRunRecord>;
  followGates(listener: (frame: GateRunFrame) => void): () => void;
  setSessionGate(gateId: string, enabled: boolean): Promise<string[]>;
  openTab(): void;
}

/** Marker a script may put on the first line of its note to say a check did not pass, e.g. "[한국어 번역 — 충실도 미확인]". */
const UNVERIFIED = /미확인|not verified|unverified|未确认/i;

/** Where a result belongs in the chat: under a turn's answer, a tool call, or an input message. */
export type GateAnchor = { kind: 'turn'; turn: number } | { kind: 'tool'; callId: string } | { kind: 'message'; messageId: string };

const atAnchor = (run: GateRun, anchor: GateAnchor) => anchor.kind === 'turn' ? run.point === 'turn-end' && run.turn === anchor.turn
  : anchor.kind === 'tool' ? (run.point === 'tool-before' || run.point === 'tool-after') && run.tool?.callId === anchor.callId
  : run.point === 'input' && run.messageId === anchor.messageId;

/**
 * The results to show at one anchor: per point, the last settled run whose gate had chat display on when it ran.
 * Who concluded the run does not matter. Skipped, running, and cancelled runs and runs elsewhere are ignored.
 * @returns runs in start order (a tool call can show its before and after results), empty when nothing shows.
 */
export function anchorRuns(runs: readonly GateRun[], anchor: GateAnchor): GateRun[] {
  const last = new Map<string, GateRun>();
  for (const run of runs.filter(run => atAnchor(run, anchor) && run.showInChat !== false
    && (run.status === 'done' || run.status === 'error') && run.result?.concludedBy !== 'skipped')
    .sort((a, b) => a.startedAt - b.startedAt)) last.set(run.point, run);
  return [...last.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** The turn-end result for one turn. */
export const tailRun = (runs: readonly GateRun[], turn: number): GateRun | undefined => anchorRuns(runs, { kind: 'turn', turn }).at(-1);

/** What the block shows: the note when there is one, otherwise the error, otherwise the verdict and its reason. */
export type TailContent =
  | { kind: 'note'; label?: string; body: string }
  | { kind: 'error'; reason: string }
  | { kind: 'verdict'; verdict: 'pass' | 'stop'; reason?: string; replace?: string; append?: string };

export function tailContent(run: GateRun): TailContent {
  const output = run.output;
  if (output?.note?.trim()) return { kind: 'note', ...splitNote(output.note) };
  if (run.status === 'error') return { kind: 'error', reason: output?.reason ?? run.result?.forwardError?.reason ?? run.reason ?? '' };
  return { kind: 'verdict', verdict: output?.verdict ?? 'pass',
    ...(output?.reason?.trim() ? { reason: output.reason } : {}), ...(output?.replace?.trim() ? { replace: output.replace } : {}), ...(output?.append?.trim() ? { append: output.append } : {}) };
}

/** Splits a leading "[label]" line off the note so the label becomes the block title. */
export function splitNote(note: string): { label?: string; body: string } {
  const match = /^\s*\[([^\]\n]{1,80})\]\s*\n?/.exec(note);
  return match ? { label: match[1]!, body: note.slice(match[0].length) } : { body: note };
}

/** `Surface` wraps the blocks only when there is something to show, so empty anchors mount nothing. */
export function GateResults({ actions, anchor, locale, Surface = React.Fragment }: { actions: GateTailActions; anchor: GateAnchor; locale: string; Surface?: React.ComponentType<React.PropsWithChildren> }) {
  const [runs, setRuns] = React.useState<GateRun[]>([]);
  const [disabled, setDisabled] = React.useState<readonly string[]>([]);
  React.useEffect(() => {
    let active = true;
    // Frames received while a refresh is in flight are replayed onto its snapshot; only the latest refresh publishes.
    let refreshing: { id: number; frames: Exclude<GateRunFrame, { type: 'sync' }>[] } | undefined;
    let latest = 0;
    const refresh = () => {
      const id = ++latest;
      const own = { id, frames: [] as Exclude<GateRunFrame, { type: 'sync' }>[] };
      refreshing = own;
      actions.gateRuns().then(snapshot => {
        if (!active || id !== latest) return;
        const record = own.frames.reduce(applyGateFrame, snapshot);
        refreshing = undefined;
        setRuns(record.runs); setDisabled(record.disabledGateIds ?? []);
      }, () => { if (id === latest) refreshing = undefined; });
    };
    const stop = actions.followGates(frame => {
      if (!active) return;
      if (frame.type === 'sync') { refresh(); return; }
      if (refreshing) bufferGateFrame(refreshing.frames, frame);
      if (frame.type === 'session') { setDisabled(frame.disabledGateIds); return; }
      setRuns(current => [...current.filter(run => run.id !== frame.run.id), frame.run]);
    });
    refresh();
    return () => { active = false; stop(); };
  }, [actions]);
  const shown = anchorRuns(runs, anchor);
  if (!shown.length) return null;
  return <Surface>{shown.map(run => <GateResultBlock key={run.id} run={run} actions={actions} locale={locale} off={disabled.includes(run.gateId)} onDisabled={setDisabled} />)}</Surface>;
}

/** The turn-end result under that turn's answer. */
export function GateTail({ turn, ...props }: { actions: GateTailActions; turn: number; locale: string; Surface?: React.ComponentType<React.PropsWithChildren> }) {
  const anchor = React.useMemo<GateAnchor>(() => ({ kind: 'turn', turn }), [turn]);
  return <GateResults {...props} anchor={anchor} />;
}

function GateResultBlock({ run, actions, locale, off, onDisabled }: { run: GateRun; actions: GateTailActions; locale: string; off: boolean; onDisabled: (ids: readonly string[]) => void }) {
  const t = (key: GateTextKey) => gateText(locale, key);
  const [open, setOpen] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const content = tailContent(run);
  const label = content.kind === 'note' ? content.label : undefined;
  const unverified = !!label && UNVERIFIED.test(label);
  const turnOff = async () => {
    setBusy(true); setError('');
    try { onDisabled(await actions.setSessionGate(run.gateId, false)); }
    catch (cause) { setError(`${t('sessionGateFailed')} (${cause instanceof Error ? cause.message : String(cause)})`); }
    finally { setBusy(false); }
  };
  return <section className="studio-gate-tail-body" aria-label={t('tailTitle').replace('{name}', run.gateName)} data-gate-tail={run.gateId} data-gate-point={run.point} data-tail-kind={content.kind} data-unverified={unverified ? 'true' : undefined}>
    <div className="studio-gate-tail-head">
      <strong>{label ?? run.gateName}</strong>
      {unverified && <Badge tone="warning">{t('tailUnverified')}</Badge>}
      {content.kind === 'verdict' && <Badge tone={content.verdict === 'stop' ? 'warning' : 'success'}>{t(content.verdict)}</Badge>}
      {content.kind === 'error' && <Badge tone="warning">{t('error')}</Badge>}
      <span className="studio-card-meta">{`${t('tailTitle').replace('{name}', run.gateName)} · ${gatePointText(locale, run.point)}`}</span>
      <span className="studio-inline-actions">
        {content.kind !== 'error' && <Button small onClick={() => setOpen(value => !value)}>{t(open ? 'tailHide' : 'tailShow')}</Button>}
        <Button small onClick={actions.openTab}>{t('tailOpen')}</Button>
        {!off && <Button small disabled={busy} onClick={() => { void turnOff(); }}>{t('tailOff')}</Button>}
      </span>
    </div>
    {error && <Notice>{error}</Notice>}
    {off && <p role="status" className="studio-muted">{t('tailOffDone')}</p>}
    {content.kind === 'error' && content.reason && <p className="studio-muted">{content.reason}</p>}
    {open && content.kind === 'note' && <ModelText text={content.body} locale={locale} />}
    {open && content.kind === 'verdict' && <>
      {content.reason && <ModelText text={content.reason} locale={locale} />}
      {content.replace && <Disclosure title={t('replace')}><ModelText text={content.replace} locale={locale} /></Disclosure>}
      {content.append && <Disclosure title={t('append')}><ModelText text={content.append} locale={locale} /></Disclosure>}
    </>}
  </section>;
}
