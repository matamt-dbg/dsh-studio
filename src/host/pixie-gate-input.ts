import type { HookContext } from './pixie-gate-script.ts';
import { readSessionGateDefinitions } from './pixie-gate-definition-reader.ts';
import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { GateApplied, GateResult, GateRun } from '../pixie-gate-contracts.ts';
import { type PixieGateRecorder } from './pixie-gate-store.ts';
import type { PresetGate } from './pixie-gate-definitions.ts';
import { executeTask, recordAppliedResult, taskMatches, taskPoint } from './pixie-gate-task-executor.ts';
import type { GateTaskRunner } from './pixie-gate-task-runner.ts';

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'studio-pixie-gate': { kind: 'studio-pixie-gate' } }
}
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Observation only; decisions cannot be changed by listeners. */
    'pixie-gate/start'(run: GateRun): void;
    'pixie-gate/end'(run: GateRun): void;
  }
}
type Decision = { kind: 'reject' } | { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true };
export interface InputAgent { id: string; ctx: Context; session: { header: { cwd?: string } } }
export interface GateInputDeps {
  definitions(): Promise<PresetGate[] | import('../pixie-gate-definitions.ts').GateTasksRead>;
  warn?(message: string): void;
  disabledGates?(sessionId: string): Promise<readonly string[]>;
  preset(agent: InputAgent): string | undefined;
  isRoot(agent: InputAgent): boolean;
  hookContext?(agent: InputAgent, turn: number, tool?: HookContext['tool']): HookContext;
  runner(): Promise<GateTaskRunner>;
  recorder: PixieGateRecorder;
  emit(event: 'pixie-gate/start' | 'pixie-gate/end', run: GateRun): void;
}
const textOf = (message: UserMessage) => message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
/** One transaction per pre-step: a later rejection/cancellation must not partially apply earlier rewrites. */
export function gateInput(deps: GateInputDeps) {
  return async (payload: { agent: InputAgent; turn: number; signal: AbortSignal }, next: () => Promise<Decision>): Promise<Decision> => {
    const decision = await next();
    if (decision.kind === 'reject') return decision;
    const preset = deps.preset(payload.agent);
    if (!preset) return decision;
    const rows = await readSessionGateDefinitions(deps, payload.agent.id);
    const root = deps.isRoot(payload.agent);
    const targets = decision.messages.flatMap(message => {
      const when = message.source.kind === 'user' ? 'user-message' : message.source.kind === 'agent-message' ? 'agent-message' : undefined;
      const gate = when && rows.find(task => task.when === when && taskMatches(task, preset, root));
      return gate ? [{ message, gate }] : [];
    });
    if (!targets.length) return decision;
    const context = decision.messages.filter(message => ['hooks-claude-code', 'hooks-codex'].includes(message.source.kind)).map(textOf);
    const hooksInput = context.length ? 'observed' as const : 'unverified' as const;
    const pending: { messageId: string; run: GateRun; execution: Awaited<ReturnType<typeof executeTask>>; result: GateResult; applied: GateApplied; rejection?: { reason: string; suggestion?: string } }[] = [];
    let messages = [...decision.messages];
    let rejected = false;
    for (const { message, gate } of targets) {
      const original = textOf(message);
      const run = await deps.recorder.start(payload.agent.id, { ...gate, point: taskPoint(gate) }, original);
      deps.emit('pixie-gate/start', structuredClone(run));
      const execution = await executeTask(gate, original, payload.signal, deps.runner, () => deps.hookContext?.(payload.agent, payload.turn) ?? { sessionId: payload.agent.id, cwd: payload.agent.session.header.cwd, turn: payload.turn, agent: root ? 'root' : 'child' });
      const { result, plan } = execution;
      const item: typeof pending[number] = { messageId: String(message.id), run, execution, result, applied: execution.skipped ? 'none' : 'pass' };
      pending.push(item);
      if (payload.signal.aborted || result.verdict === 'cancelled') break;
      const suggestion = plan.suggestion;
      if (plan.stop) {
        item.applied = 'rejected';
        item.rejection = { reason: plan.reason ?? 'Revision requires confirmation', ...(suggestion !== undefined ? { suggestion } : {}) };
        rejected = true; break;
      }
      if (plan.replacement !== undefined) {
        let inserted = false;
        const content = message.content.flatMap<UserMessage['content'][number]>(block => {
          if (block.type !== 'text') return [block];
          if (inserted) return [];
          inserted = true; return [{ type: 'text' as const, text: plan.replacement ?? original }];
        });
        if (!inserted) content.push({ type: 'text', text: plan.replacement });
        messages = messages.map(value => value === message ? { ...message, content } : value);
        item.applied = 'replaced';
      }
      if (plan.addition !== undefined) {
        messages.push({ id: randomUUID() as UserMessage['id'], role: 'user', source: { kind: 'studio-pixie-gate' }, content: [{ type: 'text', text: plan.addition }] });
        item.applied = 'appended';
      }
    }
    // Commit once before persistence: late cancellation belongs to the caller's turn loop.
    const cancelled = payload.signal.aborted || pending.some(item => item.result.verdict === 'cancelled');
    const committed: Decision = cancelled ? decision : rejected ? { kind: 'reject' }
      : pending.some(item => item.applied === 'replaced' || item.applied === 'appended') ? { ...decision, messages } : decision;
    for (const item of pending) {
      const applied = cancelled || (rejected && item.applied !== 'rejected') ? 'none' : item.applied;
      recordAppliedResult(item.execution, {
        replacement: !cancelled && !rejected && item.execution.plan.replacement !== undefined,
        addition: !cancelled && !rejected && item.execution.plan.addition !== undefined,
        withheld: !cancelled && rejected,
      });
      await deps.recorder.finish(payload.agent.id, item.run.id, { status: cancelled ? 'cancelled' : item.result.verdict === 'error' ? 'error' : 'done', result: item.result, output: item.execution.output, usage: item.execution.usage, applied, hooksInput, messageId: item.messageId, ...(applied === 'rejected' ? { rejection: item.rejection } : {}) });
      const usage = item.execution.usage;
      deps.emit('pixie-gate/end', { ...item.run, messageId: item.messageId, result: item.result, output: item.execution.output, finalText: item.result.subject, applied, hooksInput, usage, endedAt: Date.now(), status: cancelled ? 'cancelled' : item.result.verdict === 'error' ? 'error' : 'done', ...(applied === 'rejected' && item.rejection ? { rejection: { ...item.rejection, original: item.run.original, status: 'pending' as const } } : {}) });
    }
    return committed;
  };
}
