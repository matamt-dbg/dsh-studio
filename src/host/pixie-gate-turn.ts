import { readSessionGateDefinitions } from './pixie-gate-definition-reader.ts';
import { randomUUID } from 'node:crypto';
import type { Message, UserMessage } from '@deepseek-ai/dsh-llm';
import type { GateInputDeps, InputAgent } from './pixie-gate-input.ts';
import { executeTask, recordAppliedResult, taskMatches, taskPoint } from './pixie-gate-task-executor.ts';

export interface TurnAgent extends InputAgent {
  session: InputAgent['session'] & { deriveMessages(): Message[] };
  inbox: { readonly nextStep: readonly UserMessage[] };
  steer(message: UserMessage): void;
}
const textOf = (message: Message) => message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
export function gateTurn(deps: GateInputDeps) {
  // Runtime Agent lifetime, not durable session lineage. Repeated boundaries retain the same turn budget.
  const budgets = new WeakMap<TurnAgent, { turn: number; gates: Map<string, number> }>();
  return async ({ agent, turn, signal }: { agent: TurnAgent; turn: number; signal: AbortSignal }): Promise<void> => {
    const preset = deps.preset(agent);
    if (!preset) return;
    const gate = (await readSessionGateDefinitions(deps, agent.id)).find(row => row.when === 'turn-end' && taskMatches(row, preset, deps.isRoot(agent)));
    if (!gate) return;
    const original = [...agent.session.deriveMessages()].reverse().find(message => message.role === 'assistant');
    const subject = original ? textOf(original) : '';
    const context = agent.inbox.nextStep.map(textOf);
    const hooksInput = context.length ? 'observed' : 'unverified';
    const run = await deps.recorder.start(agent.id, { ...gate, point: taskPoint(gate) }, subject);
    deps.emit('pixie-gate/start', structuredClone(run));
    const execution = await executeTask(gate, subject, signal, deps.runner, () => deps.hookContext?.(agent, turn) ?? { sessionId: agent.id, cwd: agent.session.header.cwd, turn, agent: deps.isRoot(agent) ? 'root' : 'child' });
    const { result, plan } = execution;
    let budget = budgets.get(agent);
    if (!budget || budget.turn !== turn) { budget = { turn, gates: new Map() }; budgets.set(agent, budget); }
    const count = budget.gates.get(gate.id) ?? 0;
    const failed = plan.stop;
    const reason = failed ? agent.inbox.nextStep.length ? 'existing steering' : count >= gate.advanced.maxSteers ? 'maxSteersPerTurn reached' : undefined : undefined;
    // Single commit point: persistence cannot reopen the cancellation decision.
    const cancelled = signal.aborted || result.verdict === 'cancelled';
    const applied = cancelled || !failed || reason ? 'none' : 'steered';
    const message: UserMessage | undefined = applied === 'steered' ? { id: randomUUID() as UserMessage['id'], role: 'user', source: { kind: 'studio-pixie-gate' }, content: [{ type: 'text', text: plan.reason ?? 'Please correct the response.' }] } : undefined;
    if (message) budget.gates.set(gate.id, count + 1);
    recordAppliedResult(execution, {});
    const settlement = { status: cancelled ? 'cancelled' as const : result.verdict === 'error' ? 'error' as const : 'done' as const, result, output: execution.output, usage: execution.usage, applied, hooksInput, ...(cancelled ? { reason: 'cancelled' } : reason ? { reason } : {}), turn, steerCount: count + (message ? 1 : 0) } as const;
    await deps.recorder.finish(agent.id, run.id, settlement);
    deps.emit('pixie-gate/end', { ...run, ...settlement, endedAt: Date.now(), finalText: result.subject, usage: execution.usage });
    if (message) agent.steer(message);
  };
}
