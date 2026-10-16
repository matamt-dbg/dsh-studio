import type { JudgeAnswer, JudgeQuestion, JudgeRequest, JudgeResult, PixieModel } from '../pixie-contracts.ts';
import { DEFAULT_JUDGE_SYSTEM_PROMPT, validateJudgeRequest } from '../pixie-contracts.ts';
import { untilAborted } from './pixie-runtime.ts';
import type { PixieLlm } from './pixie-runtime.ts';

/** A System One decision component: state plus typed questions in, typed answers out (Jev contract). */
export interface JudgeEngine {
  readonly kind: 'judge';
  /** Recorded with each helper call: `llm` or `jev`. */
  readonly label: string;
  judge(request: JudgeRequest, signal: AbortSignal): Promise<JudgeResult>;
}

const TOLERANCE = 0.02;

export { validateJudgeRequest } from "../pixie-contracts.ts";

const isProbability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const sumsToOne = (values: number[]) => Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= TOLERANCE;

/** Validate one answer against its question. Confidence is the engine-reported value when valid (Jev derives it from the
 * distribution), else the top probability; either is a distribution property, not a correctness guarantee.
 */
export function checkAnswer(id: string, question: JudgeQuestion, raw: unknown): JudgeAnswer {
  const answer = raw as Record<string, unknown> | undefined;
  if (!answer || typeof answer !== 'object') throw new Error(`Missing answer for "${id}"`);
  if (question.type === 'choice') {
    const names = Object.keys(question.criteria);
    const probabilities = answer.probabilities as Record<string, unknown> | undefined;
    if (typeof answer.choice !== 'string' || !names.includes(answer.choice)) throw new Error(`Answer "${id}" chose an unknown option`);
    if (!probabilities || names.some(name => !isProbability(probabilities[name])) || Object.keys(probabilities).some(name => !names.includes(name))) throw new Error(`Answer "${id}" needs a probability per option`);
    const values = names.map(name => probabilities[name] as number);
    if (!sumsToOne(values)) throw new Error(`Answer "${id}" probabilities must sum to 1`);
    return { type: 'choice', choice: answer.choice, probabilities: Object.fromEntries(names.map(name => [name, probabilities[name] as number])), confidence: isProbability(answer.confidence) ? answer.confidence : Math.max(...values) };
  }
  if (question.type === 'score') {
    const probabilities = answer.probabilities as unknown;
    const top = question.criteria.length - 1;
    if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > top) throw new Error(`Answer "${id}" score must be within 0..${top}`);
    if (!Array.isArray(probabilities) || probabilities.length !== question.criteria.length || !probabilities.every(isProbability) || !sumsToOne(probabilities)) throw new Error(`Answer "${id}" needs one probability per level summing to 1`);
    return { type: 'score', score: answer.score, probabilities, confidence: isProbability(answer.confidence) ? answer.confidence : Math.max(...probabilities) };
  }
  if (!isProbability(answer.noul)) throw new Error(`Answer "${id}" noul must be a probability in 0..1`);
  return { type: 'noul', noul: answer.noul };
}

/** Parse model output strictly: one JSON object, optionally fenced, with an answer for every question. */
export function parseJudgeOutput(text: string, questions: Record<string, JudgeQuestion>): Record<string, JudgeAnswer> {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  let parsed: unknown;
  try { parsed = JSON.parse(fenced ? fenced[1]! : text.trim()); } catch { throw new Error('Judge model did not return JSON'); }
  const answers = (parsed as { answers?: unknown } | undefined)?.answers as Record<string, unknown> | undefined;
  if (!answers || typeof answers !== 'object') throw new Error('Judge model output has no answers object');
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, checkAnswer(id, question, answers[id])]));
}



/** Judge with a conversation model, held to the same output contract a Jev engine returns. */
export class LlmJudgeEngine implements JudgeEngine {
  readonly kind = 'judge' as const;
  readonly label = 'llm';
  constructor(private readonly llm: PixieLlm, private readonly model: PixieModel, private readonly system = DEFAULT_JUDGE_SYSTEM_PROMPT) {}

  async judge(request: JudgeRequest, signal: AbortSignal): Promise<JudgeResult> {
    let usage: JudgeResult['usage'];
    try {
      const { state, questions } = validateJudgeRequest(request);
      const prompt = `State:\n${typeof state === 'string' ? state : JSON.stringify(state, null, 2)}\n\nQuestions:\n${JSON.stringify(questions, null, 2)}`;
      let text = '';
      let finished = false;
      for await (const chunk of untilAborted(this.llm.stream({
        provider: this.model.provider, model: this.model.model,
        ...(this.model.reasoningEffort ? { reasoningEffort: this.model.reasoningEffort } : {}),
        ...(this.model.maxTokens ? { maxTokens: this.model.maxTokens } : {}),
        system: this.system, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], signal,
      }), signal)) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
        if (chunk.type === 'usage' && chunk.usage && typeof chunk.usage === 'object') {
          const raw = chunk.usage as Record<string, unknown>;
          usage = { inputTokens: typeof raw.inputTokens === 'number' ? raw.inputTokens : 0, outputTokens: typeof raw.outputTokens === 'number' ? raw.outputTokens : 0 };
          for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) if (typeof raw[key] === 'number') usage[key] = raw[key];
        }
        if (chunk.type === 'finish') {
          const reason = chunk.reason as { kind?: string; failure?: { message?: string } } | undefined;
          if (reason?.kind !== 'stop') throw new Error(reason?.failure?.message ?? `Judge model ended with ${reason?.kind ?? 'unknown'}`);
          finished = true;
        }
      }
      signal.throwIfAborted();
      if (!finished) throw new Error('Judge model stream ended without a finish');
      return { ok: true, answers: parseJudgeOutput(text, questions), ...(usage ? { usage } : {}) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), ...(usage ? { usage } : {}) };
    }
  }
}
