import type { PixieAskFrame } from '../pixie-contracts.ts';
import type { PixieRuntime } from './pixie-runtime.ts';
import type { PixieStore } from './pixie-store.ts';

interface Running { controller: AbortController; done: Promise<void>; frames: PixieAskFrame[] }

/** Background Pixie requests: started by `/pixie` or the tab, watched by any number of tab views, cancelled by id.
 * One request runs per session at a time.
 */
export class PixieLive {
  private running = new Map<string, Running>();
  private listeners = new Map<string, Set<(frame: PixieAskFrame) => void>>();
  constructor(private readonly runtime: PixieRuntime) {}

  get store(): PixieStore { return this.runtime.store; }

  /** Start an ask and resolve once its turn exists; the answer streams to subscribers.
   * @returns the thread and turn ids.
   */
  start(sessionId: string, request: { question: string; threadId?: string; commandId?: string }): Promise<{ threadId: string; turnId: string }> {
    if (this.running.has(sessionId)) return Promise.reject(new Error('[pixie/busy] A Pixie request is already running in this session'));
    const controller = new AbortController();
    const entry: Running = { controller, frames: [], done: Promise.resolve() };
    this.running.set(sessionId, entry);
    return new Promise((resolve, reject) => {
      let started = false;
      entry.done = (async () => {
        try {
          for await (const frame of this.runtime.ask(sessionId, request, controller.signal)) {
            entry.frames.push(frame);
            if (frame.type === 'start') { started = true; resolve({ threadId: frame.threadId, turnId: frame.turnId }); }
            for (const listener of this.listeners.get(sessionId) ?? []) listener(frame);
          }
        } catch (error) {
          if (!started) reject(error);
        } finally {
          this.running.delete(sessionId);
        }
      })();
    });
  }

  /** Delete a thread unless it is answering now. */
  async deleteThread(sessionId: string, threadId: string): Promise<void> {
    const running = this.running.get(sessionId)?.frames.find(frame => frame.type === 'start');
    if (running?.type === 'start' && running.threadId === threadId) throw new Error('[pixie/busy] Pixie is still answering in this thread');
    await this.store.deleteThread(sessionId, threadId);
  }

  /** Frames already emitted by the running request, for a view that opens mid-stream. */
  current(sessionId: string): PixieAskFrame[] { return [...this.running.get(sessionId)?.frames ?? []]; }

  /** Cancel the running request of a session. @returns whether one was running. */
  cancel(sessionId: string): boolean {
    const entry = this.running.get(sessionId);
    if (!entry) return false;
    entry.controller.abort(new Error('Pixie request cancelled'));
    return true;
  }

  subscribe(sessionId: string, listener: (frame: PixieAskFrame) => void): () => void {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => { set.delete(listener); if (set.size === 0) this.listeners.delete(sessionId); };
  }

  /** Resolve when the session has no running request. */
  async idle(sessionId: string): Promise<void> { await this.running.get(sessionId)?.done; }

  /** Cancel everything and wait; used on plugin disposal. */
  async dispose(): Promise<void> {
    for (const entry of this.running.values()) entry.controller.abort(new Error('Studio stopped'));
    await Promise.allSettled([...this.running.values()].map(entry => entry.done));
  }
}
