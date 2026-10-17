import type { HookContext } from './pixie-gate-script.ts';
import { enabledFor, type GateTask } from '../pixie-gate-task.ts';
import type { GateResult } from '../pixie-gate-contracts.ts';
import { gateOutputPlan, type GateOutput } from '../pixie-gate-task-contracts.ts';
import type { GateTaskRunner, GateTaskExecution } from './pixie-gate-task-runner.ts';

/** Compatibility projection for the R3 execution cards, not a stage executor. */
export async function executeTask(task: GateTask, original: string, signal: AbortSignal, runner: () => Promise<GateTaskRunner>, context?: () => HookContext) {
  let execution: GateTaskExecution;
  // Scripts need the hook context; loop gates need its session id to record their run in that session.
  try { execution = await (await runner()).run(task, original, signal, task.advanced.script || task.advanced.loop ? context?.() : undefined); }
  catch (error) { execution = { status: signal.aborted ? 'cancelled' : 'error', error: String(error), usage: { inputTokens: 0, outputTokens: 0 } }; }
  const output: GateOutput = execution.output ?? { verdict: execution.status === 'error' && task.advanced.onError === 'block' ? 'stop' : 'pass', ...(execution.error ? { reason: execution.error } : {}) };
  const plan = gateOutputPlan(task, output, original);
  const result: GateResult = {
    verdict: execution.status === 'cancelled' ? 'cancelled' : execution.status === 'error' ? 'error' : plan.stop ? 'fail' : 'pass',
    original, subject: plan.replacement ?? original, notes: plan.notes, stages: {}, records: execution.helperCalls ?? [], hooks: {},
    appliedPolicy: task.advanced.onError, ...(execution.concludedBy ? { concludedBy: execution.concludedBy } : {}),
    ...(plan.stop || execution.error ? { forwardError: { verdict: execution.error ? 'error' as const : 'fail' as const, reason: plan.reason ?? 'Revision requires confirmation', ...(plan.suggestion !== undefined ? { text: plan.suggestion } : {}) } } : {}),
    forward: plan.stop ? { kind: 'none' } : plan.replacement !== undefined ? { kind: 'replace', text: plan.replacement } : plan.addition !== undefined ? { kind: 'append', text: original, contexts: [plan.addition], source: 'studio-pixie-gate' } : { kind: 'original', text: original },
  };
  return { ...execution, output, plan, result };
}

/** Settle the card projection only after the middleware's commit decision. */
export function recordAppliedResult(execution: Awaited<ReturnType<typeof executeTask>>, options: { replacement?: boolean; addition?: boolean; withheld?: boolean }) {
  const { result, output, plan } = execution;
  const subject = options.replacement ? plan.replacement ?? result.original : result.original;
  result.subject = subject;
  result.notes = [
    ...(output.note === undefined ? [] : [output.note]),
    ...(output.replace === undefined || options.replacement ? [] : [output.replace]),
    ...(output.append === undefined || options.addition ? [] : [output.append]),
  ];
  result.forward = options.withheld ? { kind: 'none' }
    : options.addition ? { kind: 'append', text: subject, contexts: [plan.addition!], source: 'studio-pixie-gate' }
    : options.replacement ? { kind: 'replace', text: subject } : { kind: 'original', text: subject };
}

export const taskPoint = (task: GateTask) => task.when === 'user-message' || task.when === 'agent-message' ? 'input' as const : task.when;
export const taskMatches = (task: GateTask, preset: string, root: boolean) => enabledFor(task, preset) && (task.advanced.agents === 'any' || (task.advanced.agents === 'root') === root);
