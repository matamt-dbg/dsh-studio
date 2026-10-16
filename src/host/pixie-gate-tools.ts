import { readSessionGateDefinitions } from './pixie-gate-definition-reader.ts';
import { randomUUID } from 'node:crypto';
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm';
import type { PostToolDecision, PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import type { GateApplied } from '../pixie-gate-contracts.ts';
import type { GateInputDeps } from './pixie-gate-input.ts';
import { executeTask, recordAppliedResult, taskMatches, taskPoint } from './pixie-gate-task-executor.ts';

const textOf = (content: readonly ContentBlock[]) => content.filter(block => block.type === 'text').map(block => block.text).join('\n');
export function gateTools(deps: GateInputDeps) {
  async function execute(point: 'tool-before' | 'tool-after', exec: ToolExecution, decision: PreToolDecision | PostToolDecision, outcome?: Readonly<ToolExecutionResult>): Promise<PreToolDecision | PostToolDecision> {
    const agent = exec.agent;
    if (!agent) return decision;
    const preset = deps.preset(agent);
    if (!preset) return decision;
    const gate = (await readSessionGateDefinitions(deps, agent.id)).find(row => row.when === point && taskMatches(row, preset, deps.isRoot(agent)));
    if (!gate) return decision;
    const turn = [...agent.session.snapshotEvents()].reverse().find(event => event.type === 'turn/start')?.data.turn ?? 0;
    const contexts = 'additionalContexts' in decision ? decision.additionalContexts : undefined;
    const context = [...(outcome?.additionalContexts ?? []), ...(contexts ?? [])].map(message => textOf(message.content));
    const hooksInput = context.length || decision.kind === 'ask' || ('content' in decision && decision.content !== undefined) || ('value' in decision && decision.value !== undefined) ? 'observed' as const : 'unverified' as const;
    const original = outcome ? textOf('content' in decision && decision.content ? decision.content : outcome.content) : JSON.stringify(exec.arguments) ?? '';
    const run = await deps.recorder.start(agent.id, { ...gate, point: taskPoint(gate) }, original);
    deps.emit('pixie-gate/start', structuredClone(run));
    const execution = await executeTask(gate, original, exec.signal, deps.runner, () => deps.hookContext?.(agent, turn, { name: exec.name, arguments: exec.arguments }) ?? { sessionId: agent.id, cwd: agent.session.header.cwd, turn, agent: deps.isRoot(agent) ? 'root' : 'child' });
    const { result, plan } = execution;
    let committed = decision; let applied: GateApplied = 'none'; let reason: string | undefined;
    const failed = plan.stop;
    if (failed) {
      const text = plan.reason ?? 'Pixie Gate rejected this tool execution';
      committed = point === 'tool-before' ? { kind: 'deny', reason: text } : { kind: 'block', feedback: [{ type: 'text', text }], ...(contexts ? { additionalContexts: contexts } : {}) };
      applied = point === 'tool-before' ? 'denied' : 'blocked';
    } else if (point === 'tool-after' && decision.kind === 'accept') {
      if (plan.replacement !== undefined) {
        if ((outcome && !outcome.isError && 'value' in outcome) || ('value' in decision && decision.value !== undefined)) reason = 'value-bearing result';
        else { committed = { ...decision, content: [{ type: 'text', text: plan.replacement }] }; applied = 'replaced'; }
      }
      if (plan.addition !== undefined) {
        const message: UserMessage = { id: randomUUID() as UserMessage['id'], role: 'user', source: { kind: 'studio-pixie-gate' }, content: [{ type: 'text', text: plan.addition }] };
        committed = { ...(committed as Extract<PostToolDecision, { kind: 'accept' }>), additionalContexts: [...(contexts ?? []), message] }; applied = 'appended';
      }
    }
    // Commit exactly once before finish. A later abort is the runtime caller's responsibility.
    const cancelled = exec.signal.aborted || result.verdict === 'cancelled';
    if (cancelled) { committed = decision; applied = 'none'; reason = 'cancelled'; }
    recordAppliedResult(execution, {
      replacement: !cancelled && committed.kind === 'accept' && 'content' in committed && committed.content !== ('content' in decision ? decision.content : undefined),
      addition: !cancelled && applied === 'appended',
      withheld: committed.kind === 'deny' || committed.kind === 'block' || committed.kind === 'cancel',
    });
    const settlement = { status: cancelled ? 'cancelled' as const : result.verdict === 'error' ? 'error' as const : 'done' as const, result, output: execution.output, usage: execution.usage, applied, hooksInput, ...(reason ? { reason } : {}), turn, tool: { name: exec.name, callId: exec.callId } };
    await deps.recorder.finish(agent.id, run.id, settlement);
    deps.emit('pixie-gate/end', { ...run, ...settlement, endedAt: Date.now(), finalText: result.subject, usage: execution.usage });
    return committed;
  }
  return {
    before: async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
      const decision = await next();
      if (decision.kind === 'deny' || decision.kind === 'cancel') return decision;
      return await execute('tool-before', exec, decision) as PreToolDecision;
    },
    after: async (exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision> => {
      const decision = await next();
      if (decision.kind === 'block') return decision;
      return await execute('tool-after', exec, decision, result) as PostToolDecision;
    },
  };
}
