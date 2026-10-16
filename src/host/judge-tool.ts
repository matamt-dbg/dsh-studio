/** `judge`: the decision engine as an agent tool. Takes the Jev request shape and returns typed answers. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-tools';
import { dirname, join } from 'node:path';
import type { JudgeRequest, JudgeResult, PixieSettings } from '../pixie-contracts.ts';
import { validateJudgeRequest } from '../pixie-contracts.ts';
import { judgeEngineFor, type JevCredentials } from './jev-judge.ts';
import type { JudgeEngine } from './pixie-judge.ts';
import type { PixieLlm } from './pixie-runtime.ts';
import { PixieSettingsStore } from './pixie-store.ts';
import { studioStorePath } from './preset-store.ts';
import { createLifetime, type Lifetime } from './tool-lifetime.ts';

export const JUDGE_TOOL = 'judge';

const TEXT = { type: 'string', minLength: 1 } as const;
/** Jev question shapes with string instructions and criteria, matching the Studio judge contract. */
export const JUDGE_PARAMETERS = {
  type: 'object', additionalProperties: false, required: ['state', 'questions'],
  properties: {
    state: { description: 'What to judge: text, or a JSON object/array. Name its fields in instructions with backticks, e.g. `source`.', anyOf: [{ type: 'string' }, { type: 'object' }, { type: 'array' }] },
    questions: {
      type: 'object', minProperties: 1, description: 'Questions by id. The id is never shown to the judge, so instructions must carry the full meaning. Questions are judged independently and cannot see each other.',
      additionalProperties: { oneOf: [
        { type: 'object', additionalProperties: false, required: ['type', 'instructions'], properties: { type: { const: 'noul' }, instructions: TEXT,
          criteria: { type: 'object', additionalProperties: false, properties: { true: TEXT, false: TEXT }, description: 'What yes and no mean.' } }, description: 'Yes/no: returns the probability of yes.' },
        { type: 'object', additionalProperties: false, required: ['type', 'instructions', 'criteria'], properties: { type: { const: 'choice' }, instructions: TEXT,
          criteria: { type: 'object', minProperties: 2, maxProperties: 255, additionalProperties: TEXT, description: 'Option name → description. Include a no-match option when nothing may fit.' } }, description: 'Pick one option: returns the choice, probabilities, and confidence.' },
        { type: 'object', additionalProperties: false, required: ['type', 'instructions', 'criteria'], properties: { type: { const: 'score' }, instructions: TEXT,
          criteria: { type: 'array', minItems: 2, maxItems: 10, items: TEXT, description: 'Level descriptions, lowest first.' } }, description: 'Rate on ordered levels: returns a fractional score from 0, probabilities, and confidence.' },
      ] },
    },
  },
} as const;

const DESCRIPTION = 'Judge text with the decision engine (TypeSafe Jev or an LLM, set in DSH Studio). Returns typed answers with probabilities instead of prose: noul for yes/no, choice to pick one option, score to rate on levels. Use it to rank, filter, or verify; it does not write or rewrite text. Ask several independent questions over the same state in one call. Probabilities are calibrated signals, not proof; a failed judgment is an error, never a "no".';

/** Run one request through `engine`; failures throw so the tool reports an error result. */
export async function runJudge(engine: JudgeEngine | undefined, raw: unknown, signal: AbortSignal): Promise<Extract<JudgeResult, { ok: true }> & { engine: string }> {
  const request: JudgeRequest = validateJudgeRequest(raw);
  if (!engine) throw new Error('No decision engine is configured: set a Pixie model or choose Jev in DSH Studio → Pixie → Gates → Decision engine');
  const result = await engine.judge(request, signal);
  if (!result.ok) throw new Error(result.error);
  return { ...result, engine: engine.label };
}

export function installJudge(ctx: Context, life: Lifetime, settings: () => Promise<PixieSettings>): () => void {
  const tools = ctx.get('tools');
  if (!tools) throw new Error('Studio judge tool requires tools');
  return tools.register({
    name: JUDGE_TOOL, description: DESCRIPTION, parameters: JUDGE_PARAMETERS as unknown as Record<string, unknown>,
    output: { schema: { type: 'object' }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute(raw: unknown, exec: { signal: AbortSignal }) {
      return life.run(async owned => {
        const signal = AbortSignal.any([owned, exec.signal]);
        const llm = ctx.get('llm') as unknown as PixieLlm | undefined;
        const engine = judgeEngineFor(await settings(), {
          llm: llm ?? { stream: () => { throw new Error('DSH llm service is unavailable'); } },
          credentials: ctx.get('credentials') as unknown as JevCredentials | undefined,
        });
        const { answers, usage, engine: label } = await runJudge(engine, raw, signal);
        return JSON.parse(JSON.stringify({ answers, engine: label, ...(usage ? { usage } : {}) }));
      });
    },
  });
}

export const inject = ['tools'];
export function apply(ctx: Context) {
  // Same file the Pixie settings page writes (`<profile>/studio-data/pixie-settings.json`), read per call.
  const store = new PixieSettingsStore(join(dirname(studioStorePath(process.env, ctx.get('profileContext'))), 'pixie-settings.json'));
  const life = createLifetime();
  ctx.effect(() => installJudge(ctx, life, () => store.read()));
  ctx.effect(() => () => life.dispose());
}
