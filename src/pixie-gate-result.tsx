import React from 'react';
import { judgeText } from './pixie-gate-judge-locale.ts';
import type { JudgeAnswer, JudgeQuestion } from './pixie-contracts.ts';
import type { GateResult, StageResult, JudgeFailedCondition } from './pixie-gate-contracts.ts';
import { gateText } from './pixie-gate-locale.ts';
import { Badge, Notice, SectionHead } from './ui.tsx';

function wasSkipped(result: StageResult): boolean {
  return !!result.data && typeof result.data === 'object' && 'skipped' in result.data && result.data.skipped === true;
}

/** Shared trial/run detail; deliberately omits model usage and never infers applied actions. */
export function GateResultDetails({ result, locale, durations = {}, skipped = [], compact = false, hideOriginal = false }: {
  result: GateResult; locale: string; durations?: Record<string, number>; skipped?: string[];
  /** Run detail: the caller already shows verdict and applied action, so only text and evidence remain. */
  compact?: boolean; hideOriginal?: boolean;
}): React.ReactElement {
  const t = (key: Parameters<typeof gateText>[1]) => gateText(locale, key);
  const skippedCount = new Set([...skipped.filter(id => !id.startsWith('hooks.')), ...Object.entries(result.stages).filter(([, value]) => wasSkipped(value)).map(([id]) => id)]).size;
  const duration = (ms: number) => ms < 1 ? t('milliseconds').replace('{value}', '<1') : ms < 1000 ? t('milliseconds').replace('{value}', String(Math.round(ms))) : t('seconds').replace('{value}', (ms / 1000).toFixed(1));
  const stage = (id: string, value: StageResult, label = id) => {
    const omitted = skipped.includes(id) || wasSkipped(value);
    const questions = value.data && typeof value.data === 'object' && 'questions' in value.data && value.data.questions && typeof value.data.questions === 'object' ? value.data.questions as Record<string, JudgeQuestion> : {};
    const failures = value.data && typeof value.data === 'object' && 'failedConditions' in value.data && Array.isArray(value.data.failedConditions) ? value.data.failedConditions as JudgeFailedCondition[] : [];
    const reason = failures.length ? failures.map(condition => {
      const q = questions[condition.question];
      const question = q?.type === 'noul' ? q.question || condition.question : condition.question;
      const actual = condition.type === 'choice' && q?.type === 'choice' ? q.options[condition.actual] ?? condition.actual : condition.type === 'score' && q?.type === 'score' ? q.levels[condition.actual] ?? condition.actual : condition.actual;
      const text = judgeText(locale, condition.type === 'noul' ? 'failedNoul' : condition.type === 'score' ? 'failedScore' : 'failedChoice');
      const values: Record<string, string | number> = { question, actual, threshold: condition.type === 'noul' ? condition.threshold : '', min: condition.type === 'score' ? (q?.type === 'score' ? q.levels[condition.min] ?? condition.min : condition.min) : '' };
      return text.replace(/\{(question|actual|threshold|min)\}/g, (_, key: string) => String(values[key]));
    }).join('; ') : value.reason;
    return <section key={id} className="studio-pixie-turn" data-gate-stage={id}>
      <SectionHead title={label} actions={<Badge tone={!omitted && (value.verdict === 'error' || value.verdict === 'fail') ? 'warning' : 'neutral'}>{t(omitted ? 'skipped' : value.verdict)}</Badge>} />
      {value.text !== undefined && <p className="studio-pixie-answer">{value.text}</p>}
      {(reason || omitted) && <p className="studio-pixie-answer">{t('reason')}: {omitted && (!value.reason || value.reason === 'skipped: 시험 실행에서 명령 미실행') ? t('skippedCommand') : reason}</p>}
      {!!value.data && typeof value.data === 'object' && 'answers' in value.data && !!value.data.answers && typeof value.data.answers === 'object' && <section aria-label={judgeText(locale, 'answers')}>
        <SectionHead title={judgeText(locale, 'answers')} />
        {Object.entries(value.data.answers as Record<string, JudgeAnswer>).map(([questionId, answer]) => {
          const q = questions[questionId];
          if (!answer || !['choice', 'score', 'noul'].includes(answer.type)) return null;
          const percent = (number: number) => `${Math.round(number * 100)}%`;
          return <p key={questionId} className="studio-pixie-answer">{q?.type === 'noul' ? q.question || questionId : questionId}: {answer.type === 'noul' ? answer.noul : answer.type === 'choice' ? <>
            {q?.type === 'choice' ? q.options[answer.choice] || answer.choice : answer.choice} · {judgeText(locale, 'probability')}: {percent(answer.probabilities?.[answer.choice] ?? 0)} · {judgeText(locale, 'confidence')}: {percent(answer.confidence)}
          </> : <>{q?.type === 'score' ? q.levels[answer.score] || answer.score : answer.score} · {judgeText(locale, 'confidence')}: {percent(answer.confidence)}</>}</p>;
        })}
      </section>}
      {!!value.data && typeof value.data === 'object' && 'noul' in value.data && 'threshold' in value.data && <p className="studio-card-meta">{t('helperNoul').replace('{noul}', String(value.data.noul)).replace('{threshold}', String(value.data.threshold))}</p>}
      {value.error && <Notice>{t('error')}: {value.error}</Notice>}
      {durations[id] !== undefined && <p className="studio-muted">{t('elapsed')}: {duration(durations[id]!)}</p>}
    </section>;
  };
  if (compact) {
    const original = result.original;
    const changed = result.subject !== original;
    const forwarded = result.forward.kind === 'append' ? result.forward.contexts : [];
    return <div className="studio-pixie-turns studio-gate-compact">
      {!hideOriginal && <section className="studio-gate-block" aria-label={t('original')}>
        <SectionHead title={changed ? t('original') : t('originalSame')} />
        <p className="studio-pixie-answer studio-gate-text">{original}</p>
      </section>}
      {changed && <section className="studio-gate-block" aria-label={t('subject')}><SectionHead title={t('subject')} /><p className="studio-pixie-answer studio-gate-text">{result.subject}</p></section>}
      {forwarded.length > 0 && <section className="studio-gate-block" aria-label={t('forward')}><SectionHead title={t('sentAlong')} />{forwarded.map((text, index) => <p key={index} className="studio-pixie-answer studio-gate-text">{text}</p>)}</section>}
      {result.notes.length > 0 && <section className="studio-gate-block" aria-label={t('notes')}><SectionHead title={t('notes')} />{result.notes.map((note, index) => <p key={index} className="studio-pixie-answer">{note}</p>)}</section>}
      {result.records.length > 0 && <section className="studio-gate-block" aria-label={t('helperCalls')}><SectionHead title={t('helperCalls')} />{result.records.map(record => stage(record.id, record.result))}</section>}
      {result.forwardError?.verdict === 'error' && <Notice>{t('error')}: {result.forwardError.reason}</Notice>}
    </div>;
  }
  return <div className="studio-pixie-turns">
    <SectionHead title={t('verdict')} actions={<><Badge>{t(result.verdict)}</Badge>{skippedCount > 0 && <span className="studio-muted">{t('skippedCount').replace('{count}', String(skippedCount))}</span>}</>} />
    <section><SectionHead title={t('original')} /><p className="studio-pixie-answer">{result.original}</p></section>
    <section><SectionHead title={t('subject')} /><p className="studio-pixie-answer">{result.subject}</p></section>
    {result.hooks.start && stage('start', result.hooks.start, t('start'))}
    {(Object.keys(result.stages).length > 0 || skipped.some(id => !id.startsWith('hooks.'))) && <SectionHead title={t('stages')} />}
    {Object.entries(result.stages).map(([id, value]) => stage(id, value))}
    {skipped.filter(id => !id.startsWith('hooks.') && !result.stages[id]).map(id => stage(id, { verdict: 'pass' }))}
    {result.notes.length > 0 && <section aria-label={t('notes')}><SectionHead title={t('notes')} />{result.notes.map((note, index) => <p key={index} className="studio-pixie-answer">{note}</p>)}</section>}
    {result.records.length > 0 && <section aria-label={t('helperCalls')}><SectionHead title={t('helperCalls')} />{result.records.map(record => stage(record.id, record.result))}</section>}
    <SectionHead title={t('forward')} actions={<Badge>{t(result.forward.kind)}</Badge>} />
    {result.forward.kind !== 'none' && <p className="studio-pixie-answer">{result.forward.text}</p>}
    {result.forward.kind === 'append' && result.forward.contexts.map((text, index) => <p key={index} className="studio-pixie-answer">{text}</p>)}
    {result.forwardError && <>
      {Object.entries(result.stages).some(([id, value]) => skipped.includes(id) || wasSkipped(value)) && <Notice>{t('skippedForward')}</Notice>}
      {stage('forward', result.forwardError, t('forwardError'))}
    </>}
    {result.hooks.end && stage('end', result.hooks.end, t('end'))}
  </div>;
}
