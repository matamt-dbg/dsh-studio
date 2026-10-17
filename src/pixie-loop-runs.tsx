/** Pixie tab › Loops (#31 S6): loop runs of this session with per-item attempts. Node-testable: no host primitives. */
import React from 'react';
import type { JudgeAnswer } from './pixie-contracts.ts';
import type { LoopItemResult, LoopRun, LoopRunRecord, LoopRunStatus } from './pixie-loop-contracts.ts';
import { loopText, type LoopTextKey } from './pixie-loop-locale.ts';
import { Badge, Button, IconButton, ModelText, Note, Notice, SectionHead } from './ui.tsx';

export interface LoopRunActions { loopRuns(): Promise<LoopRunRecord> }

const ACTIVE: readonly LoopRunStatus[] = ['compiling', 'running'];
const POLL_MS = 2000;
const runTone = (status: LoopRunStatus) => status === 'done' ? 'success' : status === 'error' || status === 'stopped' ? 'warning' : status === 'cancelled' ? 'neutral' : 'info';
const itemKey: Record<LoopItemResult['status'], LoopTextKey> = { passed: 'passed', escalated: 'escalated', error: 'itemError', cancelled: 'itemCancelled', skipped: 'skipped' };
const itemTone = (status: LoopItemResult['status']) => status === 'passed' ? 'success' : status === 'escalated' || status === 'error' ? 'warning' : 'neutral';
const answerText = (answer: JudgeAnswer) => answer.type === 'noul' ? answer.noul.toFixed(2) : answer.type === 'score' ? answer.score.toFixed(2) : answer.choice;

function RunDetail({ run, locale, onBack }: { run: LoopRun; locale: string; onBack: () => void }) {
  const t = (key: LoopTextKey, values?: Record<string, string | number>) => loopText(locale, key, values);
  const [openItem, setOpenItem] = React.useState<string>();
  const done = run.items.filter(item => item.status !== 'skipped').length;
  const count = (status: LoopItemResult['status']) => run.items.filter(item => item.status === status).length;
  return <div className="studio-pixie-detail">
    <div className="studio-pixie-detail-head">
      <span className="studio-pixie-back"><IconButton label={t('back')} onClick={onBack}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg></IconButton></span>
      <strong className="studio-loop-title">{run.instruction}</strong><Badge tone={runTone(run.status)}>{t(run.status)}</Badge>
    </div>
    <p className="studio-card-meta">{new Date(run.startedAt).toLocaleString(locale)} · {t('progress', { done, total: run.total })} · {t('counts', { passed: count('passed'), escalated: count('escalated'), errors: count('error') })}</p>
    <dl className="studio-gate-facts">
      {run.reason && <><dt>{t('reason')}</dt><dd>{run.reason}</dd></>}
      {run.recipe && <><dt>{t('recipe')}</dt><dd>{run.recipe}{run.source === 'gate' ? ` · ${t('sourceGate')}` : run.source === 'hook' ? ` · ${t('sourceHook')}` : ''}</dd></>}
      {run.mode === 'episode' && <><dt>{t('episode')}</dt><dd>{t('progress', { done: run.items.filter(item => item.status !== 'skipped').length, total: run.total })}</dd></>}
      {run.items.some(item => item.bucket) && <><dt>{t('groups')}</dt><dd>{Object.entries(run.items.reduce<Record<string, number>>((all, item) => { if (item.bucket) all[item.bucket] = (all[item.bucket] ?? 0) + 1; return all; }, {})).map(([name, count]) => `${name} ${count}`).join(' · ')}</dd></>}
      <dt>{t('answers')}</dt><dd>{t('usage', { pixieIn: run.usage.pixie.inputTokens, pixieOut: run.usage.pixie.outputTokens, judgeIn: run.usage.judge.inputTokens, judgeOut: run.usage.judge.outputTokens })}</dd>
      {run.outputPath && <><dt>{t('results')}</dt><dd className="studio-gate-text">{run.outputPath}</dd></>}
    </dl>
    {run.checks && <section className="studio-gate-block" aria-label={t('checks')}>
      <SectionHead title={t('checks')} description={t(run.compiledBy === 'spec' ? 'compiledSpec' : 'compiledPixie')} />
      <dl className="studio-gate-facts">{Object.entries(run.checks.questions).map(([id, question]) => {
        const rule = run.checks!.pass[id]!;
        return <React.Fragment key={id}><dt>{id} · {question.type}</dt><dd>{question.instructions} <span className="studio-card-meta">{t('passRule')}: {'min' in rule ? t('min', { value: rule.min }) : t('accept', { value: rule.accept.join(', ') })}</span></dd></React.Fragment>;
      })}</dl>
    </section>}
    <section className="studio-gate-block" aria-label={t('items')}>
      <SectionHead title={t('items')} />
      <ul className="studio-loop-items">{run.items.map(item => <li key={item.id} data-loop-item={item.id}>
        <button type="button" className="studio-loop-item" aria-expanded={openItem === item.id} onClick={() => setOpenItem(current => current === item.id ? undefined : item.id)}>
          <span className="studio-card-head"><strong>{item.id}</strong><span className="studio-inline-actions">{item.bucket && <Badge tone="outline">{item.bucket}</Badge>}<Badge tone={itemTone(item.status)}>{t(itemKey[item.status])}</Badge></span></span>
          <span className="studio-card-meta">{item.attempts.length ? t('attempts', { n: item.attempts.length }) : ''}{item.error ? ` · ${item.error}` : ''}</span>
        </button>
        {openItem === item.id && <ol className="studio-loop-attempts">{item.attempts.map((attempt, index) => <li key={index} className="studio-loop-attempt">
          <SectionHead title={t(run.mode === 'episode' ? 'step' : 'attempt', { n: index + 1 })} actions={<Badge tone={attempt.passed ? 'success' : 'warning'}>{t(attempt.passed ? 'passed' : 'attemptFailed')}</Badge>} />
          <p className="studio-pixie-answer studio-gate-text">{attempt.output}</p>
          {attempt.selection && <dl className="studio-gate-facts"><dt>{t('selection')}</dt><dd>{attempt.selection.choice} <span className="studio-card-meta">{t('confidence', { value: attempt.selection.confidence.toFixed(2) })}</span></dd></dl>}
          {attempt.observation !== undefined && <><SectionHead title={t('observation')} /><p className="studio-pixie-answer studio-gate-text">{attempt.observation}</p></>}
          {attempt.error && <dl className="studio-gate-facts"><dt>{t('reason')}</dt><dd>{attempt.error}</dd></dl>}
          {attempt.codeFailures.length > 0 && <dl className="studio-gate-facts"><dt>{t('codeFailures')}</dt><dd>{attempt.codeFailures.map(failure => `${failure.check}: ${failure.message}`).join(' · ')}</dd></dl>}
          {attempt.answers && <dl className="studio-gate-facts"><dt>{t('answers')}</dt><dd>{Object.entries(attempt.answers).map(([id, answer]) => `${id} ${answerText(answer)}`).join(' · ')}</dd></dl>}
          {attempt.feedback && <><SectionHead title={t('feedback')} /><ModelText text={attempt.feedback} locale={locale} /></>}
        </li>)}</ol>}
      </li>)}</ul>
    </section>
  </div>;
}

export function LoopRunsPanel({ actions, locale }: { actions: LoopRunActions; locale: string }) {
  const t = (key: LoopTextKey, values?: Record<string, string | number>) => loopText(locale, key, values);
  const [runs, setRuns] = React.useState<LoopRun[]>();
  const [error, setError] = React.useState('');
  const [openId, setOpenId] = React.useState<string>();
  const load = React.useCallback(async () => {
    try { setRuns((await actions.loopRuns()).runs); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [actions]);
  React.useEffect(() => { void load(); }, [load]);
  // The tool plugin writes records; poll only while a run is active.
  const active = runs?.some(run => ACTIVE.includes(run.status)) ?? false;
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);
  const sorted = [...(runs ?? [])].sort((a, b) => b.startedAt - a.startedAt);
  const opened = sorted.find(run => run.id === openId);
  const shown = opened ?? sorted[0];
  return <div className="studio-pixie-chat">
    {error && <Notice action={<Button small onClick={() => { void load(); }}>{t('refresh')}</Button>}>{error}</Notice>}
    {runs && !runs.length && <Note>{t('emptyLoops')}</Note>}
    {sorted.length > 0 && <div className="studio-pixie-threads" data-open={opened ? 'true' : 'false'}>
      <div className="studio-pixie-list">
        <div className="studio-pixie-list-head"><span className="studio-pixie-list-title">{t('allLoops')}<span className="studio-count">{sorted.length}</span></span>
          <Button small onClick={() => { void load(); }}>{t('refresh')}</Button></div>
        <ul className="studio-pixie-thread-list">{sorted.map(run => <li key={run.id}>
          <button type="button" className="studio-pixie-thread" aria-current={shown?.id === run.id ? 'true' : undefined} onClick={() => setOpenId(run.id)}>
            <span className="studio-card-head"><strong className="studio-loop-title">{run.instruction}</strong><Badge tone={runTone(run.status)}>{t(run.status)}</Badge></span>
            <span className="studio-card-meta">{new Date(run.startedAt).toLocaleTimeString(locale)} · {t('progress', { done: run.items.filter(item => item.status !== 'skipped').length, total: run.total })}</span>
          </button>
        </li>)}</ul>
      </div>
      {shown && <RunDetail key={shown.id} run={shown} locale={locale} onBack={() => setOpenId(undefined)} />}
    </div>}
  </div>;
}
