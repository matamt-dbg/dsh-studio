import type { JudgeAnswer, JudgeQuestion, JudgeRequest, JudgeResult, PixieSettings, PixieUsage } from '../pixie-contracts.ts';
import { validateJudgeRequest } from '../pixie-contracts.ts';
import { checkAnswer, LlmJudgeEngine, type JudgeEngine } from './pixie-judge.ts';
import type { PixieLlm } from './pixie-runtime.ts';

/** TypeSafe System One evaluation endpoint. */
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
/** Credential reference holding the TypeSafe API key; resolved per request through DSH `credentials`. */
export const JEV_KEY_REF = 'TYPESAFE_API_KEY';
export const DEFAULT_JEV_MODEL = 'jev-latest';
/** Retries after 429/529 before the call fails; each wait stays inside the caller's signal. */
const RETRIES = 2;
const MAX_WAIT_MS = 4000;

/** The slice of DSH `credentials` this engine reads. */
export interface JevCredentials { resolve(ref: string): Promise<{ value: string } | undefined> }
export type JevFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  status: number; headers: { get(name: string): string | null }; text(): Promise<string>;
}>;

/** The Jev wire answer for one score question keys probabilities by level index; the shared contract orders them. */
function fromWire(question: JudgeQuestion, raw: unknown): unknown {
  if (question.type !== 'score' || !raw || typeof raw !== 'object') return raw;
  const answer = raw as Record<string, unknown>;
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) return raw;
  const keyed = probabilities as Record<string, unknown>;
  if (Object.keys(keyed).length !== question.criteria.length) return { ...answer, probabilities: undefined };
  return { ...answer, probabilities: question.criteria.map((_, index) => keyed[String(index)]) };
}

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener('abort', abort, { once: true });
});

/** Delay before retry `attempt` (0-based): `retry-after` seconds when given, else exponential, capped. */
function retryDelay(retryAfter: string | null, attempt: number): number {
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  return Math.min(Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 500 * 2 ** attempt, MAX_WAIT_MS);
}

/** Judge through the TypeSafe Jev HTTP API. Failures stay failures (D5); the key never appears in an error. */
export class JevJudgeEngine implements JudgeEngine {
  readonly kind = 'judge' as const;
  readonly label = 'jev';
  constructor(private readonly deps: { credentials: JevCredentials | undefined; model: string; fetch?: JevFetch }) {}

  async judge(request: JudgeRequest, signal: AbortSignal): Promise<JudgeResult> {
    let usage: PixieUsage | undefined;
    try {
      const { state, questions } = validateJudgeRequest(request);
      if (!this.deps.credentials) throw new Error('DSH credentials service is unavailable');
      const key = (await this.deps.credentials.resolve(JEV_KEY_REF))?.value;
      if (!key) throw new Error(`Jev API key is not configured (${JEV_KEY_REF})`);
      signal.throwIfAborted();
      const send = this.deps.fetch ?? (globalThis.fetch as unknown as JevFetch);
      const body = JSON.stringify({ model: this.deps.model, state, questions });
      for (let attempt = 0; ; attempt++) {
        const response = await send(JEV_ENDPOINT, { method: 'POST', signal, body,
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' } });
        const text = await response.text();
        if ((response.status === 429 || response.status === 529) && attempt < RETRIES) {
          await wait(retryDelay(response.headers.get('retry-after'), attempt), signal);
          continue;
        }
        if (response.status !== 200) throw new Error(`Jev request failed: HTTP ${response.status}${text ? `: ${text.slice(0, 500)}` : ''}`);
        let parsed: { answers?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
        try { parsed = JSON.parse(text); } catch { throw new Error('Jev response is not JSON'); }
        const raw = parsed.usage;
        if (raw && typeof raw.input_tokens === 'number' && typeof raw.output_tokens === 'number') usage = { inputTokens: raw.input_tokens, outputTokens: raw.output_tokens };
        const answers = parsed.answers;
        if (!answers || typeof answers !== 'object') throw new Error('Jev response has no answers object');
        const typed: Record<string, JudgeAnswer> = Object.fromEntries(Object.entries(questions).map(([id, question]) =>
          [id, checkAnswer(id, question, fromWire(question, (answers as Record<string, unknown>)[id]))]));
        return { ok: true, answers: typed, ...(usage ? { usage } : {}) };
      }
    } catch (error) {
      const message = signal.aborted ? String(signal.reason instanceof Error ? signal.reason.message : signal.reason ?? 'aborted') : error instanceof Error ? error.message : String(error);
      return { ok: false, error: message, ...(usage ? { usage } : {}) };
    }
  }
}

/** The engine `pixie judge` uses under the saved settings: LLM (judge model, else the Pixie model) or Jev.
 * @returns the engine, or undefined when the LLM engine has no model configured.
 */
export function judgeEngineFor(settings: PixieSettings, deps: { llm: PixieLlm; credentials: JevCredentials | undefined; fetch?: JevFetch }): JudgeEngine | undefined {
  if (settings.judgeEngine === 'jev') return new JevJudgeEngine({ credentials: deps.credentials, model: settings.jevModel ?? DEFAULT_JEV_MODEL, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  const model = settings.judgeModel ?? settings.model;
  return model ? new LlmJudgeEngine(deps.llm, model, settings.judgeSystemPrompt || undefined) : undefined;
}
