/** Pixie: a side model whose conversation never enters the session's model-visible log.
 * Shared by Host and Client; no runtime imports so Node tests and both bundles can load it.
 */

/** Token usage reported by a provider for one Pixie request. */
export interface PixieUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/** Model route and request options a Pixie thread uses. */
export interface PixieModel {
  provider: string;
  model: string;
  reasoningEffort?: string;
  maxTokens?: number;
}

/** How a thread starts: empty, or with a one-time text snapshot of the session. */
export type PixieContextMode = 'fresh' | 'fork';

/** One plain-text message in a thread. */
/** One plain-text message in a thread; assistant text keeps the route that produced it when known. */
export interface PixieMessage { role: 'user' | 'assistant'; text: string; provider?: string; model?: string }

/** Terminal state of one Pixie request. */
export type PixieTurnStatus = 'streaming' | 'done' | 'cancelled' | 'error';

/** One user request and its answer. */
export interface PixieTurn {
  id: string;
  question: string;
  answer: string;
  status: PixieTurnStatus;
  /** The answer stopped at the output token limit. */
  truncated?: boolean;
  error?: string;
  usage?: PixieUsage;
  model: PixieModel;
  /** The `/pixie` command that started this turn, so the conversation row can show its answer. */
  commandId?: string;
  startedAt: number;
  endedAt?: number;
}

/** One Pixie conversation inside a session. */
export interface PixieThread {
  id: string;
  title: string;
  mode: PixieContextMode;
  model: PixieModel;
  /** Text-only session snapshot captured once when a fork thread is created. */
  forked: PixieMessage[];
  turns: PixieTurn[];
  createdAt: number;
}

/** All Pixie state of one session. */
export interface PixieSessionRecord {
  sessionId: string;
  activeThreadId?: string;
  threads: PixieThread[];
}

/** Studio-wide Pixie defaults, separate from presets. */
export interface PixieSettings {
  model?: PixieModel;
  judgeModel?: PixieModel;
  judgeSystemPrompt?: string;
  contextMode: PixieContextMode;
  systemPrompt: string;
  allowThreadModel: boolean;
}

export const DEFAULT_PIXIE_SETTINGS: PixieSettings = {
  contextMode: 'fresh',
  systemPrompt: 'You are Pixie, a concise side assistant. Answer the user directly. You are not the session agent and cannot act on its workspace.',
  allowThreadModel: true,
};

/** Accumulated usage over a session's Pixie requests. */
export interface PixieUsageTotal extends PixieUsage { requests: number }

/** One streamed item the Host sends for an ask. */
export type PixieAskFrame =
  | { type: 'sync' }
  | { type: 'start'; threadId: string; turnId: string; question: string; commandId?: string }
  | { type: 'text'; text: string }
  | { type: 'usage'; usage: PixieUsage }
  | { type: 'end'; status: Exclude<PixieTurnStatus, 'streaming'>; error?: string; truncated?: true };

/** Sum usage over every turn of every thread. */
export function totalUsage(record: PixieSessionRecord): PixieUsageTotal {
  const total: PixieUsageTotal = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
  for (const thread of record.threads) for (const turn of thread.turns) {
    if (!turn.usage) continue;
    total.requests += 1;
    total.inputTokens += turn.usage.inputTokens;
    total.outputTokens += turn.usage.outputTokens;
    total.cacheReadTokens! += turn.usage.cacheReadTokens ?? 0;
    total.cacheWriteTokens! += turn.usage.cacheWriteTokens ?? 0;
    total.reasoningTokens! += turn.usage.reasoningTokens ?? 0;
  }
  return total;
}

/** Messages a thread sends to the model: fork snapshot, then completed turns. */
export function threadMessages(thread: PixieThread): PixieMessage[] {
  const messages = [...thread.forked];
  for (const turn of thread.turns) {
    if (turn.status !== 'done') continue;
    messages.push({ role: 'user', text: turn.question }, { role: 'assistant', text: turn.answer, provider: turn.model.provider, model: turn.model.model });
  }
  return messages;
}

// ---------- Judge (Jev-compatible System One contract) ----------

/** One judge question, keyed by id in a request. */
export type JudgeQuestion =
  | { type: 'choice'; options: Record<string, string> }
  | { type: 'score'; levels: string[] }
  | { type: 'noul'; question: string; criteria?: { true?: string; false?: string } };

/** One judge answer matching its question type. */
export type JudgeAnswer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: number[]; confidence: number }
  | { type: 'noul'; noul: number };

export interface JudgeRequest { state: unknown; questions: Record<string, JudgeQuestion> }

/** Failure stays a failure; it is never turned into a low score or a "no". */
export type JudgeResult = ({ ok: true; answers: Record<string, JudgeAnswer> } | { ok: false; error: string }) & { usage?: PixieUsage };

export const DEFAULT_JUDGE_SYSTEM_PROMPT = [
  'You are a judgment component. Evaluate the given state against each question independently.',
  'Reply with exactly one JSON object and nothing else: {"answers": {<question id>: <answer>}}.',
  'choice answer: {"choice": <option name>, "probabilities": {<every option name>: number}} — probabilities sum to 1.',
  'score answer: {"score": number from 0 to levels-1 (fractional allowed), "probabilities": [one number per level, in order]} — probabilities sum to 1.',
  'noul answer: {"noul": probability from 0 to 1 that the answer is yes}.',
].join('\n');

/** Reject requests that a Jev endpoint would reject, so the LLM and Jev engines accept the same inputs.
 * @returns the request, typed.
 */
export class JudgeValidationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function validateJudgeRequest(value: unknown): JudgeRequest {
  if (!value || typeof value !== 'object') throw new Error('Judge request must be an object');
  const { state, questions } = value as { state?: unknown; questions?: unknown };
  if (state === undefined) throw new Error('Judge request needs a state');
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) throw new Error('Judge request needs questions by id');
  const entries = Object.entries(questions as Record<string, unknown>);
  if (entries.length === 0) throw new JudgeValidationError('questions', 'Judge request needs at least one question');
  for (const [id, raw] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new JudgeValidationError('questionId', `Invalid judge question id: ${id}`);
    const question = raw as Partial<JudgeQuestion> & Record<string, unknown>;
    if (question?.type === 'choice') {
      const options = question.options as Record<string, unknown> | undefined;
      if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).length < 2 || Object.values(options).some(item => typeof item !== 'string' || !item.trim())) throw new JudgeValidationError('options', `Choice "${id}" needs at least two options with descriptions`);
    } else if (question?.type === 'score') {
      const levels = question.levels as unknown;
      if (!Array.isArray(levels) || levels.length < 2 || levels.length > 10 || levels.some(item => typeof item !== 'string')) throw new JudgeValidationError('levels', `Score "${id}" needs 2–10 levels`);
    } else if (question?.type === 'noul') {
      if (typeof question.question !== 'string' || !question.question.trim()) throw new JudgeValidationError('question', `Noul "${id}" needs a question`);
      if (question.criteria !== undefined && (!question.criteria || typeof question.criteria !== 'object' || Array.isArray(question.criteria) || Object.entries(question.criteria).some(([key, value]) => !['true', 'false'].includes(key) || typeof value !== 'string'))) throw new JudgeValidationError('criteria', `Invalid noul criteria: ${id}`);
    } else throw new JudgeValidationError('questionType', `Question "${id}" must be choice, score, or noul`);
  }
  return { state, questions: questions as Record<string, JudgeQuestion> };
}
