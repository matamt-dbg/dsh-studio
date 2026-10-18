/** `pixie_loop` (#31 S5): run a Pixie Loop spec outside the caller's context and return a summary (D9).
 * Item files are read and results written through the session's own `read`/`write` tools, so file policy and
 * sandbox apply. Background runs are owned DSH jobs: `job_kill` cancels, and the summary is the job result.
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-tools';
import type { JobId } from '@deepseek-ai/dsh-jobs';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { PixieSettings } from '../pixie-contracts.ts';
import { parseLoopItemsFile, validateLoopSpec, type LoopItem, type LoopRun, type LoopSpec, type LoopSummary } from '../pixie-loop-contracts.ts';
import { judgeEngineFor, type JevCredentials } from './jev-judge.ts';
import { runLoop } from './pixie-loop-engine.ts';
import { PixieLoopStore } from './pixie-loop-store.ts';
import { runRecordedTool } from './pixie-loop-recording.ts';
import { PixieLoopRecipes } from './pixie-loop-recipe-store.ts';
import { recipeSpec, type LoopRecipe } from '../pixie-loop-recipes.ts';
import type { LoopChecks } from '../pixie-loop-contracts.ts';
import type { PixieLlm } from './pixie-runtime.ts';
import { PixieSettingsStore } from './pixie-store.ts';
import { studioStorePath } from './preset-store.ts';
import { createLifetime, type Lifetime } from './tool-lifetime.ts';
declare module '@deepseek-ai/dsh-jobs' { interface JobKindMap { 'pixie-loop': 'pixie-loop' } }

export const LOOP_TOOL = 'pixie_loop';
/** Rendered result ceiling; the summary is already bounded, this guards very long escalation lists. */
const MAX_RESULT_CHARS = 20_000;
/** Lines read per `read` call when loading an items file. */
const READ_PAGE = 2000;

const TEXT = { type: 'string', minLength: 1 } as const;
const EXAMPLE = { type: 'object', additionalProperties: false, required: ['input', 'output'], properties: { input: { type: 'string' }, output: { type: 'string' }, observation: { type: 'string', description: 'What running this output produced; needed when act is used.' } } } as const;
export const LOOP_PARAMETERS = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: { description: 'Items to process: inline [{id, input}] or a JSONL file path (one {"id","input"} per line).', oneOf: [
      { type: 'object', additionalProperties: false, required: ['inline'], properties: { inline: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['id', 'input'], properties: { id: TEXT, input: TEXT } } } } },
      { type: 'object', additionalProperties: false, required: ['path'], properties: { path: TEXT } },
    ] },
    shared: { type: 'string', description: 'Fixed context every item sees (glossary, style guide). Items never see each other.' },
    work: { type: 'object', description: 'Required unless recipe is given.', additionalProperties: false, required: ['instruction'], properties: { instruction: { ...TEXT, description: 'What the worker does with one item input. The worker has no tools.' } } },
    criteria: { type: 'string', description: 'Review criteria in plain words; compiled once into fixed judge questions. Give this or checks.' },
    checks: { type: 'object', description: 'Judge questions and pass rules given directly instead of criteria: {questions: {id: noul|choice|score question about `input`/`output`}, pass: {id: {min} | {accept: [options]}}}.' },
    codeChecks: { type: 'array', description: 'Exact checks run before the judge: {type:"placeholders"} keeps {x}, {{x}}, %s and tags; {type:"regex", pattern, flags?, expect:"match"|"no-match"}; {type:"json", keys?}.', items: { type: 'object' } },
    calibration: { type: 'object', additionalProperties: false, required: ['pass', 'fail'], description: 'Examples the checks must pass and fail before the run starts. Required with criteria or checks.',
      properties: { pass: { type: 'array', minItems: 1, items: EXAMPLE }, fail: { type: 'array', minItems: 1, items: EXAMPLE } } },
    mode: { type: 'string', enum: ['retry', 'episode'], description: 'retry (default): retry each item until it passes. episode: each reply is one step; act runs it and the next step sees the new observation, until the checks pass. Needs act.' },
    act: { type: 'object', additionalProperties: false, required: ['tool', 'command', 'safeToRepeat'], description: 'Run each output with the session bash tool and judge what it printed (`observation`). The worker still has no tools.',
      properties: { tool: { const: 'bash' }, command: { ...TEXT, description: 'Shell command; {{output}}, {{input}}, {{id}} become single-quoted words.' }, safeToRepeat: { const: true, description: 'Retries and steps run the command again; only use commands that are safe to repeat.' },
        isolated: { type: 'boolean', description: 'true when each item works on its own state (new page, temp dir) so acts may overlap. Default false: acts run one at a time.' }, timeoutMs: { type: 'integer', minimum: 1000 }, maxObservationChars: { type: 'integer', minimum: 100 } } },
    extract: { type: 'object', additionalProperties: false, required: ['instruction'], description: 'Shorten each observation with Pixie before judging.', properties: { instruction: TEXT, maxChars: { type: 'integer', minimum: 100 } } },
    select: { type: 'object', additionalProperties: false, required: ['instructions', 'optionsFrom'], description: 'The decision engine picks one option instead of the worker writing an output. Options come from JSON {"options": [name | {name, description}]} in the item input or, in episodes, the act observation.',
      properties: { instructions: TEXT, optionsFrom: { type: 'string', enum: ['input', 'observation'] }, minConfidence: { type: 'number', minimum: 0, maximum: 1, description: 'Escalate instead of acting when the pick is less certain.' } } },
    route: { type: 'object', additionalProperties: false, required: ['question'], description: 'Group results by the final answer of one choice question in checks; the summary counts each group.', properties: { question: TEXT } },
    maxAttempts: { type: 'integer', minimum: 1, maximum: 100, description: 'Tries per item (retry, at most 10) or steps per episode (at most 100), each seeing its own previous output and feedback. Default 3.' },
    concurrency: { type: 'integer', minimum: 1, maximum: 8, description: 'Items in flight. Default 4.' },
    limits: { type: 'object', additionalProperties: false, required: ['tokens', 'timeMs'], description: 'Required unless recipe is given. Run stops when either is reached; remaining items are reported as skipped.',
      properties: { tokens: { type: 'integer', minimum: 1000 }, timeMs: { type: 'integer', minimum: 1000 } } },
    output: { type: 'string', description: 'JSONL results file: one {id, status, output?, attempts} per item.' },
    recipe: { ...TEXT, description: 'Run a recipe saved in DSH Studio (its checks were calibrated when saved). Give only items, output, and run_in_background with it.' },
    run_in_background: { type: 'boolean', description: 'Return a job id at once; collect the summary with job_output, cancel with job_kill.' },
  },
} as const;

const DESCRIPTION = 'Run a repeated generate-and-review loop outside your context with the lightweight Pixie model and the decision engine. For each item: the worker produces an output from `work.instruction` and `shared`; exact codeChecks run; the decision engine judges it with fixed questions; on failure Pixie writes feedback and the worker retries with only that item\'s history. Criteria are compiled once and must separate the calibration examples, or the run does not start. You get counts, the results file, and only the items that still failed (escalated) or errored — handle those yourself. Use it for many independent items judged by the same criteria (translation review, copy edits, per-file audits). With act, each output is run by the session bash tool and judged by what it printed (experiments such as trying selectors in a page). With select, the decision engine picks one listed option per item or per step. Item inputs go to the configured model providers.';

interface ToolExec { agent?: { id: string }; signal: AbortSignal; callId: string; rootCallId?: string; token?: unknown }
type ToolsSlice = { register(definition: unknown): () => void; execute(call: unknown): Promise<{ isError: boolean; value?: unknown; content: { type: string; text?: string }[] }> };

/** Render a summary for the model, bounded. */
export function renderSummary(summary: LoopSummary): string {
  const lines = [`pixie_loop ${summary.status}${summary.reason ? `: ${summary.reason}` : ''}`,
    `passed ${summary.passed}, escalated ${summary.escalated.length}, errors ${summary.errors.length}, skipped ${summary.skipped}`,
    ...(summary.buckets ? [`groups: ${Object.entries(summary.buckets).map(([name, count]) => `${name} ${count}`).join(', ')}`] : []),
    ...(summary.outputPath ? [`results: ${summary.outputPath}`] : []),
    `usage: pixie ${summary.usage.pixie.inputTokens}/${summary.usage.pixie.outputTokens}, judge ${summary.usage.judge.inputTokens}/${summary.usage.judge.outputTokens} (input/output tokens)`];
  const detail = JSON.stringify({ escalated: summary.escalated, errors: summary.errors });
  const text = `${lines.join('\n')}\n${detail}`;
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated; see the results file and the Pixie tab › Loops]` : text;
}

export interface LoopToolDeps {
  settings: () => Promise<PixieSettings>;
  store: PixieLoopStore;
  llm: () => PixieLlm | undefined;
  credentials: () => JevCredentials | undefined;
  jobs: () => { start(spec: unknown): JobId; wait(id: JobId, timeoutMs: number, caller?: SessionId, signal?: AbortSignal): Promise<unknown>; kill(id: JobId, caller?: SessionId, reason?: string): unknown } | undefined;
  recipes?: PixieLoopRecipes;
}

export function installLoop(ctx: Context, life: Lifetime, deps: LoopToolDeps): () => void {
  const tools = ctx.get('tools') as unknown as ToolsSlice | undefined;
  if (!tools) throw new Error('Studio pixie_loop requires tools');
  const nested = async (exec: ToolExec, name: string, args: Record<string, unknown>, signal: AbortSignal, keepErrors = false) => {
    const result = await tools.execute({ name, arguments: args, ...(exec.agent ? { agent: exec.agent } : {}), signal, callId: ToolCallId(`${exec.callId}:loop-${name}-${randomUUID().slice(0, 8)}`), rootCallId: exec.rootCallId, parent: exec.token });
    if (result.isError) {
      const text = result.content.map(block => block.text ?? '').join(' ').slice(0, 2000);
      // A failing act command is an observation, not a loop failure.
      if (keepErrors) return { kind: 'foreground', exitCode: null, stdout: { text }, stderr: { text: '' } };
      throw new Error(`${name} failed: ${text.slice(0, 500)}`);
    }
    return result.value as Record<string, unknown>;
  };
  /** Kill a job and wait until it is no longer running, whatever the caller's signal says. */
  async function stopJob(id: string, owner: string) {
    const jobs = deps.jobs();
    if (!jobs) throw new Error('act command was promoted to a job, but the DSH jobs service is unavailable to stop it');
    const jobId = id as unknown as JobId, caller = owner as unknown as SessionId;
    jobs.kill(jobId, caller, 'pixie_loop act timed out');
    for (let waited = 0; waited < 60_000; waited += 5_000) {
      const view = await jobs.wait(jobId, 5_000, caller) as { status?: string };
      if (view.status !== 'running' && view.status !== 'stopping') return;
    }
    throw new Error(`act job ${id} did not stop within 60s`);
  }
  async function loadItems(spec: LoopSpec, exec: ToolExec, signal: AbortSignal): Promise<LoopItem[]> {
    if ('inline' in spec.items) return spec.items.inline;
    const lines: string[] = [];
    for (let offset = 1; ; offset += READ_PAGE) {
      const value = await nested(exec, 'read', { file_path: spec.items.path, offset, limit: READ_PAGE }, signal);
      const page = (value.lines as { number: number; text: string }[] | undefined) ?? [];
      for (const line of page) {
        if (/\.\.\. \(line truncated to \d+ chars\)$/.test(line.text)) throw new Error(`items file line ${line.number} is too long to read whole; keep each item under the read tool's line limit`);
        lines.push(line.text);
      }
      if (!page.length || page.at(-1)!.number >= (value.totalLines as number)) break;
    }
    return parseLoopItemsFile(lines.join('\n'));
  }
  async function execute(spec: LoopSpec, items: LoopItem[], exec: ToolExec, runId: string, signal: AbortSignal, outputPath: string | undefined, onProgress?: (run: LoopRun) => void, recipe?: LoopRecipe): Promise<LoopSummary> {
    const settings = await deps.settings();
    const llm = deps.llm() ?? { stream: () => { throw new Error('DSH llm service is unavailable'); } };
    const judge = judgeEngineFor(settings, { llm, credentials: deps.credentials() });
    const act = async (command: string, timeoutMs: number, actSignal: AbortSignal) => {
      const value = await nested(exec, 'bash', { command, description: 'pixie_loop act', timeoutMs }, actSignal, true) as { kind?: string; jobId?: string; exitCode?: number | null; timedOut?: boolean; stdout?: { text?: string }; stderr?: { text?: string } };
      if (value.kind === 'promoted' && typeof value.jobId === 'string') {
        // bash kept a timed-out command running as a job. Stop it and wait until it settles, so an act never
        // outlives its turn: serialized acts must not overlap and cancellation must own the process.
        await stopJob(value.jobId, exec.agent!.id);
        return { ok: false, text: `[timed out after ${timeoutMs}ms; the command was stopped]` };
      }
      if (value.kind !== 'foreground') return { ok: false, text: 'act command did not finish in the foreground; lower its run time or raise act.timeoutMs' };
      const out = [value.stdout?.text ?? '', value.stderr?.text ? `[stderr]\n${value.stderr.text}` : ''].filter(Boolean).join('\n');
      return { ok: value.exitCode === 0 && !value.timedOut, text: `${out}${value.timedOut ? '\n[timed out]' : ''}\n[exit code: ${value.exitCode ?? 'none'}]` };
    };
    return runRecordedTool(update => runLoop(spec, items, { llm, model: settings.model, judge, act, update },
      { sessionId: exec.agent!.id, signal, runId, source: 'tool', ...(outputPath ? { outputPath } : {}), ...(recipe ? { recipe: recipe.name, ...(recipe.checks ? { checks: recipe.checks as LoopChecks } : {}) } : {}) }), {
      record: run => deps.store.put(run),
      warn: error => ctx.logger?.warn?.(`studio pixie_loop: record write failed: ${String(error)}`),
      ...(onProgress ? { progress: onProgress } : {}),
      ...(outputPath ? { output: { write: (content: string) => nested(exec, 'write', { file_path: outputPath, content }, new AbortController().signal) } } : {}),
    });
  }
  return tools.register({
    name: LOOP_TOOL, description: DESCRIPTION, parameters: LOOP_PARAMETERS as unknown as Record<string, unknown>,
    output: { schema: { type: 'object' }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: (value as { kind?: string }).kind === 'background' ? JSON.stringify(value) : renderSummary(value as LoopSummary) }] },
    async execute(raw: unknown, exec: ToolExec) {
      const { run_in_background: background, recipe: recipeName, ...rest } = (raw ?? {}) as Record<string, unknown>;
      let recipe: LoopRecipe | undefined;
      let spec: LoopSpec;
      if (recipeName !== undefined) {
        if (typeof recipeName !== 'string' || !deps.recipes) throw new Error('recipe must name a saved recipe');
        const extra = Object.keys(rest).filter(key => key !== 'items' && key !== 'output');
        if (extra.length) throw new Error(`With recipe give only items, output, and run_in_background (got ${extra.join(', ')})`);
        recipe = await deps.recipes.get(recipeName);
        const items = validateLoopSpec({ ...recipeSpec(recipe, rest.items as LoopSpec['items']), ...(rest.output !== undefined ? { output: rest.output } : {}) });
        spec = items;
      } else spec = validateLoopSpec(rest);
      const owner = exec.agent?.id;
      if (!owner) throw new Error('pixie_loop requires a calling agent');
      const items = await loadItems(spec, exec, exec.signal);
      const runId = randomUUID();
      if (background !== true) {
        return life.run(async owned => JSON.parse(JSON.stringify(await execute(spec, items, exec, runId, AbortSignal.any([owned, exec.signal]), spec.output, undefined, recipe))));
      }
      const jobs = deps.jobs();
      if (!jobs) throw new Error('Background pixie_loop requires the DSH jobs service');
      const id = jobs.start({ kind: 'pixie-loop', owner: owner as SessionId, label: `pixie_loop: ${items.length} item(s) — ${spec.work.instruction.slice(0, 60)}`,
        run(handle: { append(text: string): void; updateProgress(line: string): void }) {
          const controller = new AbortController();
          let reported = 0;
          const done = life.run(async owned => {
            try {
              const summary = await execute(spec, items, exec, runId, AbortSignal.any([owned, controller.signal]), spec.output, run => {
                const finished = run.items.filter(item => item.status !== 'skipped').length;
                handle.updateProgress(`${run.status} ${finished}/${run.total}`);
                for (const item of run.items.slice(reported)) handle.append(`${item.id}: ${item.status}${item.attempts.length ? ` after ${item.attempts.length} attempt(s)` : ''}\n`);
                reported = run.items.length;
              }, recipe);
              const result = renderSummary(summary);
              return summary.status === 'cancelled' ? { status: 'killed' as const, detail: summary.reason ?? 'cancelled', result }
                : summary.status === 'error' ? { status: 'failed' as const, detail: summary.reason ?? 'error', result }
                  : { status: 'completed' as const, detail: `${summary.passed} passed, ${summary.escalated.length} escalated`, result };
            } catch (error) { return { status: controller.signal.aborted ? 'killed' as const : 'failed' as const, detail: String(error) }; }
          }).catch(error => ({ status: 'failed' as const, detail: String(error) }));
          return { done, cancel: (reason?: string) => controller.abort(new Error(reason ?? 'pixie_loop cancelled')) };
        } });
      return { kind: 'background', jobId: id, runId };
    },
  });
}

export const inject = ['tools'];
export function apply(ctx: Context) {
  // Same files the Pixie settings page and the Pixie tab use, under `<profile>/studio-data/`.
  const dataDir = dirname(studioStorePath(process.env, ctx.get('profileContext')));
  const settings = new PixieSettingsStore(join(dataDir, 'pixie-settings.json'));
  const store = new PixieLoopStore(join(dataDir, 'pixie'));
  const recipes = new PixieLoopRecipes(join(dataDir, 'pixie-loop', 'recipes.json'));
  const life = createLifetime();
  ctx.effect(() => installLoop(ctx, life, {
    settings: () => settings.read(), store, recipes,
    llm: () => ctx.get('llm') as unknown as PixieLlm | undefined,
    credentials: () => ctx.get('credentials') as unknown as JevCredentials | undefined,
    jobs: () => ctx.get('jobs') as unknown as ReturnType<LoopToolDeps['jobs']>,
  }));
  ctx.effect(() => () => life.dispose());
}
