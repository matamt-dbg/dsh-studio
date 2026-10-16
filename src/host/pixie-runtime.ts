import type { PixieAskFrame, PixieContextMode, PixieMessage, PixieModel, PixieSettings, PixieThread, PixieUsage } from '../pixie-contracts.ts';
import { threadMessages } from '../pixie-contracts.ts';
import { forkSnapshot, type ForkEvent } from './pixie-fork.ts';
import type { PixieStore } from './pixie-store.ts';

/** The slice of `ctx.llm` Pixie uses: one streaming call outside any session. */
export interface PixieLlm {
  stream(options: {
    provider: string; model: string; reasoningEffort?: string; maxTokens?: number; system?: string;
    messages: PixieRequestMessage[];
    signal?: AbortSignal;
  }): AsyncIterable<{ type: string; [key: string]: unknown }>;
}

/** A user input (no identity) or a complete assistant message, as `llm.stream` requires. */
export type PixieRequestMessage =
  | { role: 'user'; content: { type: 'text'; text: string }[] }
  | { role: 'assistant'; id: string; source: { kind: 'model'; provider: string; model: string }; content: { type: 'text'; text: string }[] };

/** Build request messages. Adapters read `source` on assistant history (replay state), so assistant entries
 * are complete messages attributed to the route that produced them, or the current route when unknown.
 */
export function requestMessages(messages: readonly PixieMessage[], route: { provider: string; model: string }): PixieRequestMessage[] {
  return messages.map((message, index) => message.role === 'user'
    ? { role: 'user', content: [{ type: 'text', text: message.text }] }
    : { role: 'assistant', id: `pixie-history-${index}`, source: { kind: 'model', provider: message.provider ?? route.provider, model: message.model ?? route.model }, content: [{ type: 'text', text: message.text }] });
}

export interface PixieRuntimeDeps {
  store: PixieStore;
  llm: PixieLlm;
  /** Optional total model-call timeout. Omitted preserves existing /pixie behavior. */
  timeoutMs?: number;
  settings: () => Promise<PixieSettings>;
  /** Read one session's logged events without activating its Agent. */
  sessionEvents: (sessionId: string, signal?: AbortSignal) => Promise<readonly ForkEvent[]>;
}

/** Pixie requests. Calls the model directly through `llm.stream`; nothing is appended to the session log. */
export class PixieRuntime {
  constructor(private readonly deps: PixieRuntimeDeps) {
    if (deps.timeoutMs !== undefined && (!Number.isFinite(deps.timeoutMs) || deps.timeoutMs <= 0)) throw new Error('Pixie timeoutMs must be positive');
  }

  get store(): PixieStore { return this.deps.store; }

  /** Create a thread and make it active. A fork thread snapshots the session's text once, now. */
  async createThread(sessionId: string, options: { mode?: PixieContextMode; model?: PixieModel }, signal?: AbortSignal): Promise<PixieThread> {
    const settings = await this.deps.settings();
    if (options.model && !settings.allowThreadModel) throw new Error('Pixie per-thread model selection is disabled in Studio settings');
    const model = options.model ? withDefaults(options.model, settings.model) : settings.model;
    if (!model) throw new Error('[pixie/no-model] No Pixie model is configured in Studio settings');
    const mode = options.mode ?? settings.contextMode;
    const forked = mode === 'fork' ? forkSnapshot(await this.deps.sessionEvents(sessionId, signal)) : [];
    return this.deps.store.createThread(sessionId, { mode, model, forked });
  }

  /** Ask in a thread (the active one by default; a default thread is created when none exists).
   * Yields a start frame, text deltas, usage, and one end frame. Cancellation ends with `cancelled`;
   * provider failures end with `error` and are never recorded as answers.
   */
  async *ask(sessionId: string, request: { question: string; threadId?: string; commandId?: string }, signal: AbortSignal): AsyncIterable<PixieAskFrame> {
    const settings = await this.deps.settings();
    let record = await this.deps.store.read(sessionId);
    let threadId = request.threadId ?? record.activeThreadId;
    if (!threadId || !record.threads.some(thread => thread.id === threadId)) {
      if (request.threadId) throw new Error(`Unknown Pixie thread ${request.threadId}`);
      if (!settings.model) throw new Error('[pixie/no-model] No Pixie model is configured in Studio settings');
      threadId = (await this.createThread(sessionId, {}, signal)).id;
      record = await this.deps.store.read(sessionId);
    }
    const thread = record.threads.find(item => item.id === threadId)!;
    const history = threadMessages(thread);
    const turn = await this.deps.store.startTurn(sessionId, thread.id, request.question, request.commandId);
    yield { type: 'start', threadId: thread.id, turnId: turn.id, question: request.question, ...(request.commandId ? { commandId: request.commandId } : {}) };
    let answer = '';
    let usage: PixieUsage | undefined;
    let finished = false;
    let truncated = false;
    const settle = (status: 'done' | 'cancelled' | 'error', error?: string) => this.deps.store.finishTurn(sessionId, thread.id, turn.id, {
      status, answer, ...(error === undefined ? {} : { error }), ...(usage === undefined ? {} : { usage }), ...(truncated ? { truncated } : {}),
    });
    const deadline = new AbortController();
    const modelSignal = AbortSignal.any([signal, deadline.signal]);
    const timeout = this.deps.timeoutMs;
    const timer = timeout === undefined ? undefined : setTimeout(() => deadline.abort(new Error(`Pixie model timed out after ${timeout}ms`)), timeout);
    try {
      modelSignal.throwIfAborted();
      const stream = this.deps.llm.stream({
        provider: thread.model.provider, model: thread.model.model,
        ...(thread.model.reasoningEffort ? { reasoningEffort: thread.model.reasoningEffort } : {}),
        ...(thread.model.maxTokens ? { maxTokens: thread.model.maxTokens } : {}),
        ...(settings.systemPrompt.trim() ? { system: settings.systemPrompt } : {}),
        messages: requestMessages([...history, { role: 'user', text: request.question }], thread.model),
        signal: modelSignal,
      });
      for await (const chunk of untilAborted(stream, modelSignal)) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          answer += chunk.text;
          yield { type: 'text', text: chunk.text };
        } else if (chunk.type === 'usage' && chunk.usage && typeof chunk.usage === 'object') {
          usage = pickUsage(chunk.usage as Record<string, unknown>);
          yield { type: 'usage', usage };
        } else if (chunk.type === 'finish') {
          const reason = chunk.reason as { kind?: string; failure?: { message?: string } } | undefined;
          if (reason?.kind !== 'stop' && reason?.kind !== 'max-tokens') {
            throw new Error(reason?.failure?.message ?? `Pixie model ended with ${reason?.kind ?? 'unknown'}`);
          }
          finished = true;
          truncated = reason.kind === 'max-tokens';
        }
      }
    } catch (error) {
      if (signal.aborted) { await settle('cancelled'); yield { type: 'end', status: 'cancelled' }; return; }
      const message = error instanceof Error ? error.message : String(error);
      await settle('error', message);
      yield { type: 'end', status: 'error', error: message };
      return;
    } finally { if (timer !== undefined) clearTimeout(timer); }
    if (signal.aborted) { await settle('cancelled'); yield { type: 'end', status: 'cancelled' }; return; }
    if (!finished) {
      const message = 'Pixie model stream ended without a finish';
      await settle('error', message);
      yield { type: 'end', status: 'error', error: message };
      return;
    }
    await settle('done');
    yield truncated ? { type: 'end', status: 'done', truncated: true } : { type: 'end', status: 'done' };
  }
}

/** A per-thread model keeps the configured token limit, and the reasoning effort only on the same provider (effort ids are adapter-owned). */
function withDefaults(model: PixieModel, configured: PixieModel | undefined): PixieModel {
  const result: PixieModel = { ...model };
  if (result.maxTokens === undefined && configured?.maxTokens !== undefined) result.maxTokens = configured.maxTokens;
  if (result.reasoningEffort === undefined && configured?.reasoningEffort !== undefined && configured.provider === model.provider) result.reasoningEffort = configured.reasoningEffort;
  return result;
}

/** Iterate a stream but stop as soon as the signal aborts, even if the producer ignores it; its late chunks are dropped. */
export async function* untilAborted<T>(stream: AsyncIterable<T>, signal: AbortSignal): AsyncIterable<T> {
  const iterator = stream[Symbol.asyncIterator]();
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('aborted'));
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => {});
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    // Do not wait for a producer that ignores cancellation.
    void Promise.resolve(iterator.return?.()).catch(() => {});
  }
}

function pickUsage(raw: Record<string, unknown>): PixieUsage {
  const number = (key: string) => typeof raw[key] === 'number' ? raw[key] as number : undefined;
  const usage: PixieUsage = { inputTokens: number('inputTokens') ?? 0, outputTokens: number('outputTokens') ?? 0 };
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    const value = number(key);
    if (value !== undefined) usage[key] = value;
  }
  return usage;
}
