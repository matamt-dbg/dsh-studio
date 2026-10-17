import { JudgeValidationError, type JudgeAnswer, type JudgeQuestion, type PixieUsage } from './pixie-contracts.ts';

export function validateJudgePassRule(value: unknown, questions: Record<string, JudgeQuestion>): asserts value is JudgePassRule {
  if (!object(value) || !['all', 'any'].includes(value.mode as string) || !Array.isArray(value.conditions) || !value.conditions.length) throw new JudgeValidationError('conditions', 'Judge pass needs all/any and nonempty conditions');
  for (const condition of value.conditions) {
    if (!object(condition) || typeof condition.question !== 'string' || !Object.hasOwn(questions, condition.question)) throw new JudgeValidationError('unknownQuestion', 'Judge condition references unknown question');
    const question = questions[condition.question]!;
    if (condition.type !== question.type) throw new JudgeValidationError('conditionType', 'Judge condition type must match question');
    if (condition.type === 'choice') {
      if (question.type !== 'choice' || !Array.isArray(condition.allowed) || !condition.allowed.length || condition.allowed.some(key => typeof key !== 'string' || !Object.hasOwn(question.criteria, key))) throw new JudgeValidationError('allowed', 'Judge condition needs known allowed choices');
    } else {
      const number = condition.type === 'noul' ? condition.threshold : condition.min;
      const max = question.type === 'score' ? question.criteria.length - 1 : 1;
      if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > max) throw new JudgeValidationError('range', 'Judge condition threshold out of range');
    }
  }
}

/** Missing or mismatched answers are errors, never a successful any-rule fallback. */
export function evaluateJudgePass(rule: JudgePassRule, answers: Record<string, JudgeAnswer>): { pass: boolean; reason?: string; failedConditions?: JudgeFailedCondition[] } {
  const failedConditions: JudgeFailedCondition[] = [];
  const failed = rule.conditions.flatMap(condition => {
    const answer = answers[condition.question];
    if (!answer || answer.type !== condition.type) throw new Error(`Missing or mismatched judge answer: ${condition.question}`);
    const passed = condition.type === 'noul' && answer.type === 'noul' ? answer.noul >= condition.threshold : condition.type === 'score' && answer.type === 'score' ? answer.score >= condition.min : condition.type === 'choice' && answer.type === 'choice' && condition.allowed.includes(answer.choice);
    if (!passed) {
      if (condition.type === 'choice' && answer.type === 'choice') failedConditions.push({ ...condition, actual: answer.choice });
      if (condition.type === 'score' && answer.type === 'score') failedConditions.push({ ...condition, actual: answer.score });
      if (condition.type === 'noul' && answer.type === 'noul') failedConditions.push({ ...condition, actual: answer.noul });
    }
    return passed ? [] : [condition.type === 'choice' ? `${condition.question}: choice must be in [${condition.allowed.join(', ')}]` : condition.type === 'noul' ? `${condition.question}: noul must be >= ${condition.threshold}` : `${condition.question}: score must be >= ${condition.min}`];
  });
  const pass = rule.mode === 'all' ? failed.length === 0 : failed.length < rule.conditions.length;
  return { pass, ...(!pass ? { reason: failed.join('; '), failedConditions } : {}) };
}

export type GatePoint = 'input' | 'tool-before' | 'tool-after' | 'turn-end';
/** Typed question conditions; a nonempty flat group deliberately avoids recursive rule complexity. */
export type JudgePassCondition =
  | { question: string; type: 'noul'; threshold: number }
  | { question: string; type: 'score'; min: number }
  | { question: string; type: 'choice'; allowed: string[] };
export type JudgeFailedCondition =
  | (Extract<JudgePassCondition, { type: 'noul' | 'score' }> & { actual: number })
  | (Extract<JudgePassCondition, { type: 'choice' }> & { actual: string });
export interface JudgePassRule { mode: 'all' | 'any'; conditions: JudgePassCondition[] }
/** Error is a separate verdict, never a synthetic pass/fail. */
export interface StageResult {
  verdict: 'pass' | 'fail' | 'revise' | 'note' | 'error';
  text?: string; reason?: string; data?: unknown; error?: string; usage?: PixieUsage;
}
export interface StageRecord {
  id: string; result: StageResult;
  appliedPolicy?: 'pass' | 'block';
  subjectBytes: number; textBytes: number;
}
export type GateForward =
  | { kind: 'none' }
  | { kind: 'original'; text: string }
  | { kind: 'replace'; text: string }
  | { kind: 'append'; text: string; contexts: string[]; source: 'studio-pixie-gate' };
export interface GateResult {
  verdict: 'pass' | 'revise' | 'fail' | 'error' | 'skip' | 'cancelled';
  original: string; subject: string; notes: string[];
  stages: Record<string, StageResult>; records: StageRecord[];
  appliedPolicy?: 'pass' | 'block';
  forward: GateForward;
  hooks: { start?: StageResult; end?: StageResult };
  forwardError?: StageResult;
  /** Who produced the gate output; absent on records written before #27 and on runs that failed before concluding. */
  concludedBy?: GateConclusion;
}
export type GateConclusion = 'pixie' | 'script' | 'skipped' | 'loop';

/** Actual middleware action, never inferred from the result verdict. */
export type GateApplied = 'pass' | 'replaced' | 'appended' | 'rejected' | 'steered' | 'blocked' | 'denied' | 'none';
export type GateRunStatus = 'running' | 'done' | 'cancelled' | 'error';
export interface GateRejection {
  original: string;
  reason: string;
  suggestion?: string;
  status: 'pending' | 'resent' | 'dismissed';
}
export interface GateRun {
  when?: import('./pixie-gate-task.ts').GateWhen;
  output?: import('./pixie-gate-task-contracts.ts').GateOutput;
  id: string; gateId: string; gateName: string; point: GatePoint; sessionId: string;
  startedAt: number; endedAt?: number;
  original: string; finalText: string;
  result?: GateResult;
  applied: GateApplied;
  /** Gate calls only, independent of ordinary Pixie and DSH session usage. */
  usage: PixieUsage;
  status: GateRunStatus;
  rejection?: GateRejection;
  hooksInput?: 'observed' | 'unverified';
  reason?: string;
  turn?: number;
  steerCount?: number;
  tool?: { name: string; callId: string };
  /** Input points: the checked message, so the chat can place the result under it. */
  messageId?: string;
  /** The gate's chat-display setting when the run started; absent on older records means on. */
  showInChat?: boolean;
}
/** `disabledGateIds`: gates switched off for this session only; absent means none. Definitions are untouched. */
export interface GateRunRecord { sessionId: string; runs: GateRun[]; disabledGateIds?: string[] }
export type GateRunFrame = { type: 'sync' } | { type: 'run'; run: GateRun } | { type: 'session'; disabledGateIds: string[] };
/** A gate that applies to this session's preset, with its session switch. */
export interface SessionGate { id: string; name: string; when: string; script?: string; sessionEnabled: boolean }
export interface SessionGates { preset?: string; gates: SessionGate[] }

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
