/** Run a saved recipe on one target for a gate or a hook script (#31 S15–S16). One item, inside the caller's signal. */
import type { LoopRun } from '../pixie-loop-contracts.ts';
import { recipeSpec, type LoopRecipe } from '../pixie-loop-recipes.ts';
import type { GateOutput } from '../pixie-gate-task-contracts.ts';
import { runLoop, type LoopEngineDeps } from './pixie-loop-engine.ts';

export interface RecipeOutcome { run: LoopRun; passed: boolean; output?: string; feedback?: string; reason: string }

/** `check` runs the recipe's review on the target as the output; `repair` lets the worker rework the target until it passes. */
export async function runRecipeOn(recipe: LoopRecipe, mode: 'check' | 'repair', target: string, deps: LoopEngineDeps, options: { sessionId: string; signal: AbortSignal; source: 'gate' | 'hook'; maxAttempts?: number }): Promise<RecipeOutcome> {
  if (recipe.spec.act) throw new Error(`Recipe ${recipe.name} runs commands (act); gates and hook scripts cannot run it. Use the pixie_loop tool instead.`);
  if (recipe.spec.mode === 'episode' || recipe.spec.select) throw new Error(`Recipe ${recipe.name} is an episode or selection; gates and hook scripts run only review recipes.`);
  if (!recipe.checks) throw new Error(`Recipe ${recipe.name} has no checks to judge with`);
  const base = recipeSpec(recipe, { inline: [{ id: 'target', input: target }] });
  const spec = mode === 'check'
    // Check: the target is the output to judge, so the worker echoes it once and never rewrites it.
    ? { ...base, maxAttempts: 1, concurrency: 1, work: { instruction: ECHO_INSTRUCTION } }
    : { ...base, concurrency: 1, ...(options.maxAttempts ? { maxAttempts: Math.min(options.maxAttempts, base.maxAttempts) } : {}) };
  const items = [{ id: 'target', input: target }];
  const run = await runLoop(spec, items, mode === 'check' ? { ...deps, llm: echo(target, deps.llm) } : deps,
    { sessionId: options.sessionId, signal: options.signal, recipe: recipe.name, source: options.source, checks: recipe.checks });
  const item = run.items[0];
  const last = item?.attempts.at(-1);
  if (run.status !== 'done' || !item || item.status === 'error') return { run, passed: false, reason: item?.error ?? run.reason ?? `Loop ${run.status}` };
  const failed = [...(last?.codeFailures.map(failure => `${failure.check}: ${failure.message}`) ?? [])];
  return {
    run, passed: item.status === 'passed', ...(item.output !== undefined ? { output: item.output } : {}), ...(last?.feedback ? { feedback: last.feedback } : {}),
    reason: item.status === 'passed' ? `Passed ${recipe.name}` : [`Did not pass ${recipe.name}`, ...failed, ...(last?.feedback ? [last.feedback] : [])].join('. '),
  };
}

const ECHO_INSTRUCTION = 'Reply with the user message exactly as given, unchanged.';
/** The worker returns the target verbatim, so `check` judges exactly what the gate saw; feedback still uses Pixie. */
const echo = (target: string, llm: LoopEngineDeps['llm']): LoopEngineDeps['llm'] => ({ stream: options => options.system?.startsWith(ECHO_INSTRUCTION) ? (async function* () {
  yield { type: 'text-delta', text: target }; yield { type: 'finish', reason: { kind: 'stop' } };
})() : llm.stream(options) });

/** Map a recipe outcome to the gate output contract; the gate's own application rules do the rest. */
export function recipeGateOutput(mode: 'check' | 'repair', outcome: RecipeOutcome): GateOutput {
  if (!outcome.passed) return { verdict: 'stop', reason: outcome.reason };
  if (mode === 'repair' && outcome.output !== undefined) return { verdict: 'pass', replace: outcome.output };
  return { verdict: 'pass' };
}
