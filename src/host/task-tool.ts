/** Success dependencies for session-owned jobs; ordinary bash remains independent. */
import type { Context } from '@deepseek-ai/cordis';
import { JobId, type JobView, type JobOutcome } from '@deepseek-ai/dsh-jobs';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { z } from 'zod';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
declare module '@deepseek-ai/dsh-jobs' { interface JobKindMap { task: 'task' } }
import type { Lifetime } from './tool-lifetime.ts';

const terminal = (job: JobView) => job.status !== 'running' && job.status !== 'stopping';
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Install detached tasks with explicit dependencies and cancellation-owned joins. */
export function installTasks(ctx: Context, life: Lifetime, taskWaitMs: number, bashWaitMs: number): () => void {
  const jobs = ctx.get('jobs');
  const tools = ctx.get('tools');
  if (!jobs || !tools) throw new Error('Studio tasks require jobs and tools');
  const owned = new Map<JobId, SessionId>();
  const successes = new Set<JobId>();
  function observe(id: JobId, owner: SessionId, signal: AbortSignal): Promise<JobView> {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const finish = (error: unknown, job?: JobView) => { unsubscribe(); signal.removeEventListener('abort', abort); if (job) resolve(job); else reject(error); };
      const abort = () => finish(signal.reason);
      unsubscribe = jobs!.events.subscribe({ owners: 'scope' }, event => {
        if (event.type === 'output' || event.job.id !== id) return;
        if (event.type === 'settled') finish(undefined, event.job);
        if (event.type === 'removed') finish(new Error('Dependency removed'));
      });
      signal.addEventListener('abort', abort, { once: true });
      try { signal.throwIfAborted(); const job = jobs!.get(id, owner); if (terminal(job)) finish(undefined, job); } catch (error) { finish(error); }
    });
  }
  async function settle(id: JobId, owner: SessionId, signal: AbortSignal): Promise<void> {
    while (!terminal(jobs!.get(id, owner))) { signal.throwIfAborted(); await jobs!.wait(id, bashWaitMs, owner, signal); }
    signal.throwIfAborted();
  }
  const input = z.object({ command: z.string().min(1), description: z.string().min(1), workdir: z.string().optional(), requires_success: z.array(z.string()).max(16).optional(), background: z.boolean().optional() }).strict();
  return tools.register({
    name: 'task_run',
    description: `Run a shell command as a managed task. Declare requires_success for existing task_run jobs in this session: the command starts only after all succeed. Failed, cancelled or unknown dependencies prevent execution. Collect task_id with job_output; cancel with job_kill. Dependencies are explicit, not inferred; ordinary bash bypasses them. Jobs are not resumed after runtime restart. Output is available after completion. Bash foreground wait requests ${bashWaitMs}ms (subject to runtime cap); if promoted, the task collects it but reports unknown_exit and blocks dependents rather than guessing success.`,
    parameters: { type: 'object', additionalProperties: false, required: ['command', 'description'], properties: { command: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 }, workdir: { type: 'string' }, requires_success: { type: 'array', uniqueItems: true, items: { type: 'string' }, maxItems: 16 }, background: { type: 'boolean', description: `Return the task id immediately. Otherwise wait up to ${taskWaitMs}ms and return its state; the task keeps running.` } } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(raw, exec) {
      const args = input.parse(raw);
      const owner = exec.agent?.id;
      if (!owner) throw new Error('task_run requires an owning agent');
      exec.signal.throwIfAborted();
      life.signal.throwIfAborted();
      const dependencies = [...new Set((args.requires_success ?? []).map(id => JobId(id)))];
      for (const id of dependencies) { if (owned.get(id) !== owner) throw new Error(`Unknown or foreign task dependency: ${id}`); jobs.get(id, owner); }
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, life.signal]);
      const id = jobs.start({ kind: 'task', owner, label: args.description, run(handle) {
        const done = life.run(async (): Promise<JobOutcome> => {
          try {
            for (const dependency of dependencies) { const job = await observe(dependency, owner, signal); if (job.status !== 'completed' || !successes.has(dependency)) return { status: 'failed', detail: `dependency_failed: ${dependency} (${job.status}: ${job.detail ?? 'unknown'})` }; }
            signal.throwIfAborted();
            const result = await tools.execute({ name: 'bash', arguments: { command: args.command, description: args.description, ...(args.workdir === undefined ? {} : { workdir: args.workdir }), timeoutMs: bashWaitMs }, ...(exec.agent ? { agent: exec.agent } : {}), signal, callId: ToolCallId(`${exec.callId}:task-bash`), rootCallId: exec.rootCallId, parent: exec.token });
            for (const block of result.content) if (block.type === 'text') handle.append(block.text);
            for (const context of result.additionalContexts ?? []) handle.append(JSON.stringify(context));
            const value = record(result.value);
            if (value?.kind === 'promoted' && typeof value.jobId === 'string') {
              const promoted = JobId(value.jobId);
              try { await settle(promoted, owner, signal); }
              catch (error) { jobs.kill(promoted, owner, 'Owning task cancelled'); await settle(promoted, owner, new AbortController().signal); throw error; }
              const output = jobs.read(promoted, owner);
              for (const chunk of output.chunks) handle.append(chunk.text, chunk.channel === undefined ? {} : { channel: chunk.channel });
              if (output.lossy) handle.append('[Output lost from memory; inspect spill files.]');
              for (const path of output.job.output?.spillPaths ?? []) handle.append(`Full output: ${path}`);
              return { status: 'failed', detail: 'unknown_exit: bash exceeded its effective foreground cap; process joined but dependencies remain blocked' };
            }
            const sandbox = record(value?.sandbox);
            const success = !result.isError && value?.kind === 'foreground' && value.exitCode === 0 && value.signal === null && !value.timedOut && !value.aborted && !sandbox?.denied && !sandbox?.runnerFailed;
            if (success && !signal.aborted) successes.add(handle.id);
            return { status: signal.aborted ? 'killed' : success ? 'completed' : 'failed', detail: `exit code: ${value?.exitCode ?? 'unknown'}` };
          } catch (error) { return { status: signal.aborted ? 'killed' : 'failed', detail: String(error) }; }
        });
        return { done, cancel: reason => { controller.abort(new Error(reason ?? 'Task cancelled')); } };
      } });
      owned.set(id, owner);
      if (args.background !== true) await jobs.wait(id, taskWaitMs, owner, exec.signal);
      const job = jobs.get(id, owner);
      return { task_id: id, status: job.status, detail: job.detail ?? null, requires_success: dependencies };
    },
  });
}

import { createLifetime } from "./tool-lifetime.ts";
export const inject = ["tools", "jobs"];
export function apply(ctx: Context) { const life = createLifetime(); ctx.effect(() => installTasks(ctx, life, 120000, 600000)); ctx.effect(() => () => life.dispose()); }
