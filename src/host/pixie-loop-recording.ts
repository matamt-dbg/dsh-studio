/** Entry-point recording lifetimes. Tool progress is live; gate/hook records remain final-only. */
import { summarizeRun, type LoopRun } from '../pixie-loop-contracts.ts';
import { throttledWriter } from './pixie-loop-store.ts';
import { runRecipeOn } from './pixie-loop-recipe-run.ts';

/** Own result-file finalization before the final record and summary. Session file policy stays in writeOutput. */
export async function runRecordedTool(
  execute: (update: (run: LoopRun) => void) => Promise<LoopRun>,
  options: {
    record(run: LoopRun): Promise<void>;
    warn(error: unknown): void;
    progress?(run: LoopRun): void;
    output?: { write(content: string): Promise<unknown> };
  },
) {
  const writer = throttledWriter(options.record, 500, options.warn);
  const run = await execute(value => { writer.update(value); options.progress?.(value); });
  if (options.output && run.items.some(item => item.status !== 'skipped')) {
    const body = run.items.filter(item => item.status !== 'skipped').map(item => JSON.stringify({ id: item.id, status: item.status, ...(item.output !== undefined ? { output: item.output } : {}), ...(item.bucket ? { bucket: item.bucket } : {}), attempts: item.attempts.length, ...(item.error ? { error: item.error } : {}) })).join('\n') + '\n';
    try { await options.output.write(body); }
    catch (error) { run.reason = `${run.reason ? `${run.reason}; ` : ''}results file not written: ${error instanceof Error ? error.message : String(error)}`; delete run.outputPath; }
  }
  writer.update(run);
  await writer.flush();
  return summarizeRun(run);
}

/** No heartbeat or progress writes for recipes; rejected final writes do not change the verdict. */
export async function runRecordedRecipe(record: (run: LoopRun) => Promise<void>, ...args: Parameters<typeof runRecipeOn>) {
  const outcome = await runRecipeOn(...args);
  await record(outcome.run).catch(() => {});
  return outcome;
}
