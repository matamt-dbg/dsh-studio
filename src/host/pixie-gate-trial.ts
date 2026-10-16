import { validateGateTask, gateOutputPlan, type GateOutput } from '../pixie-gate-task-contracts.ts';
import type { PixieUsage } from '../pixie-contracts.ts';
import type { GateTaskRunner } from './pixie-gate-task-runner.ts';

export interface GateTrialResult {
  output: GateOutput;
  plan: ReturnType<typeof gateOutputPlan>;
  usage: PixieUsage;
  skipped?: 'script';
}
/** Agentless preview: no persistence, shell, or session effects. */
export async function trialGate(payload: unknown, deps: { runner(): Promise<GateTaskRunner> }, signal: AbortSignal): Promise<GateTrialResult> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid gate trial');
  const raw = payload as Record<string, unknown>;
  const task = validateGateTask(raw.task);
  if (typeof raw.text !== 'string') throw new Error('Trial text is required');
  if (raw.toolName !== undefined && typeof raw.toolName !== 'string') throw new Error('Invalid sample tool name');
  if (task.advanced.script !== undefined) {
    const output: GateOutput = { verdict: 'pass', note: 'skipped: script' };
    return { output, plan: gateOutputPlan(task, output, raw.text), usage: { inputTokens: 0, outputTokens: 0 }, skipped: 'script' };
  }
  const execution = await (await deps.runner()).run(task, raw.text, signal);
  if (!execution.output) throw new Error(execution.error ?? execution.status);
  return { output: execution.output, plan: gateOutputPlan(task, execution.output, raw.text), usage: execution.usage };
}
