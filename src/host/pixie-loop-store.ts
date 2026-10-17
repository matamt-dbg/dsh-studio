/** Pixie Loop run records (#31 S6): `<profile>/studio-data/pixie/loops/<sessionId>.json`.
 * The `pixie_loop` tool plugin writes; the Studio Remote reads. They run as separate plugins, so the file is the only
 * shared state: writes are serialized per session and replace the file atomically (temp + rename).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LoopRun, LoopRunRecord } from '../pixie-loop-contracts.ts';

export const MAX_LOOP_RUNS = 50;
/** The writer saves active runs at least this often; one silent for {@link STALE_MS} was interrupted. */
export const HEARTBEAT_MS = 30_000;
export const STALE_MS = 3 * HEARTBEAT_MS;
const SESSION_ID = /^[\w-]{1,200}$/;
const ACTIVE = new Set<LoopRun['status']>(['compiling', 'running']);

export class PixieLoopStore {
  private readonly root: string;
  private queues = new Map<string, Promise<unknown>>();
  constructor(pixieRoot: string) { this.root = join(pixieRoot, 'loops'); }

  async read(sessionId: string): Promise<LoopRunRecord> {
    let record: LoopRunRecord;
    try { record = JSON.parse(await readFile(this.file(sessionId), 'utf8')) as LoopRunRecord; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, runs: [] };
      throw error;
    }
    if (!record || record.version !== 1 || !Array.isArray(record.runs) || record.runs.some(run => !run || run.sessionId !== sessionId)) throw new Error(`Invalid Pixie Loop record for session ${sessionId}`);
    return record;
  }

  /** Runs with interrupted ones (active but silent past {@link STALE_MS}) shown as cancelled. */
  async view(sessionId: string, now = Date.now()): Promise<LoopRunRecord> {
    const record = await this.read(sessionId);
    for (const run of record.runs) if (ACTIVE.has(run.status) && now - (run.updatedAt ?? run.startedAt) > STALE_MS) { run.status = 'cancelled'; run.reason ??= 'Interrupted (DSH restarted or the tool scope closed)'; }
    return record;
  }

  /** Insert or replace one run snapshot. */
  put(run: LoopRun): Promise<void> {
    const snapshot = { ...structuredClone(run), updatedAt: Date.now() };
    return this.enqueue(snapshot.sessionId, async () => {
      const record = await this.read(snapshot.sessionId);
      const index = record.runs.findIndex(item => item.id === snapshot.id);
      if (index >= 0) record.runs[index] = snapshot; else record.runs.push(snapshot);
      let excess = record.runs.length - MAX_LOOP_RUNS;
      record.runs = record.runs.filter(item => { if (excess > 0 && !ACTIVE.has(item.status)) { excess--; return false; } return true; });
      await mkdir(this.root, { recursive: true });
      const file = this.file(snapshot.sessionId), temporary = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(record)); await rename(temporary, file); }
      finally { await rm(temporary, { force: true }); }
    });
  }

  /** Delete records of sessions not in the complete durable list; a failed list deletes nothing. */
  async prune(list: () => Promise<readonly { sessionId: string }[]>): Promise<string[]> {
    let existing: Set<string>;
    try { existing = new Set((await list()).map(item => item.sessionId)); } catch { return []; }
    let names: string[];
    try { names = await readdir(this.root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const removed: string[] = [];
    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!SESSION_ID.test(id) || existing.has(id)) continue;
      await this.enqueue(id, async () => { await rm(this.file(id), { force: true }); removed.push(id); });
    }
    return removed;
  }

  private file(sessionId: string): string {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new Error(`Invalid session id for Pixie Loop: ${JSON.stringify(sessionId)}`);
    return join(this.root, `${sessionId}.json`);
  }
  private enqueue<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    this.file(sessionId);
    const next = (this.queues.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(action);
    const tracked = next.catch(() => {}).finally(() => { if (this.queues.get(sessionId) === tracked) this.queues.delete(sessionId); });
    this.queues.set(sessionId, tracked);
    return next;
  }
}

/** Coalesce frequent run updates into at most one write per `intervalMs`, and rewrite the last snapshot every
 * {@link HEARTBEAT_MS} while nothing changes so readers can tell a live run from an interrupted one. `flush` writes the
 * latest now and stops the heartbeat.
 */
export function throttledWriter(write: (run: LoopRun) => Promise<void>, intervalMs = 500, onError: (error: unknown) => void = () => {}, heartbeatMs = HEARTBEAT_MS) {
  let latest: LoopRun | undefined, last: LoopRun | undefined, timer: ReturnType<typeof setTimeout> | undefined, chain: Promise<void> = Promise.resolve();
  const drain = () => { timer = undefined; const run = latest; latest = undefined; if (run) { last = run; chain = chain.then(() => write(run)).catch(onError); } return chain; };
  const beat = setInterval(() => { if (!latest && last) { latest = last; void drain(); } }, heartbeatMs);
  beat.unref?.();
  return {
    update(run: LoopRun) { latest = run; timer ??= setTimeout(drain, intervalMs); },
    flush() { clearInterval(beat); if (timer) clearTimeout(timer); return drain(); },
  };
}
