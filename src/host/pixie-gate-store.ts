import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GateApplied, GatePoint, GateRejection, GateResult, GateRun, GateRunFrame, GateRunRecord, GateRunStatus } from '../pixie-gate-contracts.ts';
import type { PixieUsage } from '../pixie-contracts.ts';

export const MAX_GATE_RUNS = 200;
const SESSION_ID = /^[\w-]{1,200}$/;
type Settlement = { output?: GateRun['output']; usage?: PixieUsage; tool?: { name: string; callId: string }; messageId?: string; reason?: string; turn?: number; steerCount?: number; status: Exclude<GateRunStatus, 'running'>; result?: GateResult; applied: GateApplied; hooksInput?: 'observed' | 'unverified'; rejection?: { reason: string; suggestion?: string } };

/** Persist start before applying destructive decisions. */
export interface PixieGateRecorder {
  start(sessionId: string, gate: { id: string; name: string; point: GatePoint; when?: GateRun['when'] }, original: string): Promise<GateRun>;
  finish(sessionId: string, runId: string, settlement: Settlement): Promise<boolean>;
}

/** One owner per Pixie root. Commits and notifications share the same per-session queue. */
export class PixieGateStore implements PixieGateRecorder {
  private readonly root: string;
  private queues = new Map<string, Promise<unknown>>();
  private owned = new Map<string, GateRun>();
  private committed = new Map<string, GateRun>();
  private listeners = new Map<string, Set<(frame: GateRunFrame) => void>>();
  constructor(pixieRoot: string) { this.root = join(pixieRoot, 'gates'); }

  async read(sessionId: string): Promise<GateRunRecord> {
    const file = this.file(sessionId);
    let record: GateRunRecord;
    try { record = JSON.parse(await readFile(file, 'utf8')) as GateRunRecord; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sessionId, runs: [] };
      throw error;
    }
    if (!record || typeof record !== 'object' || Array.isArray(record) || record.sessionId !== sessionId || !Array.isArray(record.runs)
      || record.runs.some(run => !run || typeof run !== 'object' || Array.isArray(run) || run.sessionId !== sessionId)
      || (record.disabledGateIds !== undefined && (!Array.isArray(record.disabledGateIds) || record.disabledGateIds.some(id => typeof id !== 'string')))) {
      throw new Error(`Invalid Pixie Gate record for session ${sessionId}`);
    }
    for (const run of record.runs) if (run.status === 'running' && !this.owned.has(run.id)) run.status = 'cancelled';
    return record;
  }

  start(sessionId: string, gate: { id: string; name: string; point: GatePoint; when?: GateRun['when']; advanced?: { showInChat?: boolean } }, original: string): Promise<GateRun> {
    const snapshot = structuredClone(gate);
    return this.enqueue(sessionId, async () => {
      const record = await this.read(sessionId);
      const run: GateRun = { id: randomUUID(), gateId: snapshot.id, gateName: snapshot.name, point: snapshot.point, ...(snapshot.when ? { when: snapshot.when } : {}), sessionId,
        ...(snapshot.advanced ? { showInChat: snapshot.advanced.showInChat !== false } : {}),
        startedAt: Date.now(), original, finalText: original, applied: 'none', usage: { inputTokens: 0, outputTokens: 0 }, status: 'running' };
      record.runs.push(run);
      // Reserve ownership before rename exposes the running record to concurrent readers.
      this.owned.set(run.id, run);
      try { await this.save(sessionId, record); }
      catch (error) { this.owned.delete(run.id); throw error; }
      // Replay visibility and publish are synchronous: followers see either snapshot or event, never both.
      this.committed.set(run.id, run);
      this.publish(run);
      return structuredClone(run);
    });
  }

  finish(sessionId: string, runId: string, settlement: Settlement): Promise<boolean> {
    const value = structuredClone(settlement);
    return this.enqueue(sessionId, async () => {
      const record = await this.read(sessionId);
      const run = record.runs.find(item => item.id === runId);
      // Retention/prune may have removed an already settled run. Late results remain harmless.
      if (!run || run.status !== 'running') return false;
      if (value.rejection && (run.point !== 'input' || value.applied !== 'rejected')) throw new Error('Rejection requires a rejected input');
      if (value.applied === 'rejected' && (run.point !== 'input' || !value.rejection)) throw new Error('Rejected input requires rejection details');
      if (value.result && value.result.original !== run.original) throw new Error('Gate original cannot change');
      run.status = value.status; run.applied = value.applied; run.endedAt = Date.now();
      if (value.hooksInput) run.hooksInput = value.hooksInput;
      if (value.reason !== undefined) run.reason = value.reason;
      if (value.turn !== undefined) run.turn = value.turn;
      if (value.tool !== undefined) run.tool = value.tool;
      if (value.messageId !== undefined) run.messageId = value.messageId;
      if (value.steerCount !== undefined) run.steerCount = value.steerCount;
      if (value.result) {
        run.result = value.result; run.finalText = value.result.subject;
        run.usage = gateUsage(value.result);
      }
      if (value.output) run.output = value.output;
      if (value.usage) run.usage = value.usage;
      if (value.rejection) run.rejection = { ...value.rejection, original: run.original, status: 'pending' };
      await this.save(sessionId, record);
      this.owned.delete(runId);
      this.committed.delete(runId);
      this.publish(run);
      return true;
    });
  }

  resolveRejection(sessionId: string, runId: string, status: Exclude<GateRejection['status'], 'pending'>): Promise<GateRun> {
    return this.enqueue(sessionId, async () => {
      if (status !== 'resent' && status !== 'dismissed') throw new Error('Invalid rejection transition');
      const record = await this.read(sessionId);
      const run = record.runs.find(item => item.id === runId);
      if (!run?.rejection || run.rejection.status !== 'pending') throw new Error('Rejection is not pending');
      run.rejection.status = status;
      await this.save(sessionId, record);
      this.publish(run);
      return structuredClone(run);
    });
  }

  /** Gates switched off for this session; a missing record means none. */
  async disabledGates(sessionId: string): Promise<string[]> { return [...(await this.read(sessionId)).disabledGateIds ?? []]; }

  /** Switch one gate for this session only. Shares the run queue, so it never races a run commit. */
  setGateEnabled(sessionId: string, gateId: string, enabled: boolean): Promise<string[]> {
    if (typeof gateId !== 'string' || !gateId) throw new Error('Gate id is required');
    return this.enqueue(sessionId, async () => {
      const record = await this.read(sessionId);
      const current = new Set(record.disabledGateIds ?? []);
      if (enabled) current.delete(gateId); else current.add(gateId);
      const next = [...current];
      if (next.length) record.disabledGateIds = next; else delete record.disabledGateIds;
      await this.save(sessionId, record);
      for (const listener of this.listeners.get(sessionId) ?? []) listener({ type: 'session', disabledGateIds: [...next] });
      return next;
    });
  }

  /** Sync means refetch durable history; only committed running executions are replayed. No await between snapshot and subscribe. */
  async *follow(sessionId: string, signal: AbortSignal): AsyncIterable<GateRunFrame> {
    this.file(sessionId);
    const queue: GateRunFrame[] = [{ type: 'sync' }, ...[...this.committed.values()].filter(run => run.sessionId === sessionId).map(run => ({ type: 'run' as const, run: structuredClone(run) }))];
    let wake: (() => void) | undefined;
    const listener = (frame: GateRunFrame) => { queue.push(frame); wake?.(); };
    const listeners = this.listeners.get(sessionId) ?? new Set();
    listeners.add(listener); this.listeners.set(sessionId, listeners);
    const abort = () => wake?.();
    signal.addEventListener('abort', abort);
    try {
      while (!signal.aborted) {
        while (queue.length && !signal.aborted) yield queue.shift()!;
        if (signal.aborted) break;
        await new Promise<void>(resolve => { wake = resolve; });
        wake = undefined;
      }
    } finally {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(sessionId);
      signal.removeEventListener('abort', abort);
    }
  }

  /** Fetch the complete durable session list before deleting anything; a failed list deletes nothing. */
  async prune(list: () => Promise<readonly { sessionId: string }[]>): Promise<string[]> {
    let existing: Set<string>;
    try { existing = new Set((await list()).map(item => item.sessionId)); } catch { return []; }
    let names: string[];
    try { names = await readdir(this.root); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const removed: string[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (!SESSION_ID.test(id) || existing.has(id)) continue;
      await this.enqueue(id, async () => {
        // Do not remove a record that a producer still owns; a later prune retries it.
        if ([...this.owned.values()].some(run => run.sessionId === id)) return;
        await rm(this.file(id), { force: true });
        removed.push(id);
      });
    }
    return removed;
  }

  private file(sessionId: string): string {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new Error(`Invalid session id for Pixie Gate: ${JSON.stringify(sessionId)}`);
    return join(this.root, `${sessionId}.json`);
  }
  private publish(run: GateRun): void {
    for (const listener of this.listeners.get(run.sessionId) ?? []) listener({ type: 'run', run: structuredClone(run) });
  }
  private async save(sessionId: string, record: GateRunRecord): Promise<void> {
    let excess = record.runs.length - MAX_GATE_RUNS;
    // Insertion order is execution start order. Pending input and running work must never disappear.
    record.runs = record.runs.filter(run => {
      if (excess > 0 && run.status !== 'running' && run.rejection?.status !== 'pending') { excess--; return false; }
      return true;
    });
    await mkdir(this.root, { recursive: true });
    const file = this.file(sessionId);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(record)); await rename(temporary, file); }
    finally { await rm(temporary, { force: true }); }
  }
  private async enqueue<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    this.file(sessionId);
    const next = (this.queues.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(action);
    const tracked = next.catch(() => {}).finally(() => { if (this.queues.get(sessionId) === tracked) this.queues.delete(sessionId); });
    this.queues.set(sessionId, tracked);
    return next;
  }
}

/** records and stages reference the same calls; count records only, never command hooks. */
export function gateUsage(result: GateResult): PixieUsage {
  const total: PixieUsage = { inputTokens: 0, outputTokens: 0 };
  for (const { result: stage } of result.records) if (stage.usage) {
    for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
      if (stage.usage[key] !== undefined) total[key] = (total[key] ?? 0) + stage.usage[key];
    }
  }
  return total;
}
