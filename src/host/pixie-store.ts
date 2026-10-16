import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_PIXIE_SETTINGS } from '../pixie-contracts.ts';
import type { PixieContextMode, PixieMessage, PixieModel, PixieSessionRecord, PixieSettings, PixieThread, PixieTurn, PixieTurnStatus, PixieUsage } from '../pixie-contracts.ts';

const SESSION_ID = /^[\w-]{1,200}$/;

/** Pixie history, one JSON file per session under a Studio-owned directory.
 * Nothing here touches the session log. Writes per session are serialized.
 */
export class PixieStore {
  private queues = new Map<string, Promise<unknown>>();
  /** Turns this process is still streaming; any other streaming turn was cut off by a restart. */
  private live = new Set<string>();
  constructor(private readonly root: string) {}

  /** Read one session's record; a missing file is an empty record. A turn left streaming by a restart reads as cancelled. */
  async read(sessionId: string): Promise<PixieSessionRecord> {
    const file = this.file(sessionId);
    let record: PixieSessionRecord;
    try { record = JSON.parse(await readFile(file, 'utf8')) as PixieSessionRecord; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sessionId, threads: [] };
      throw error;
    }
    for (const thread of record.threads) for (const turn of thread.turns) {
      if (turn.status === 'streaming' && !this.live.has(turn.id)) turn.status = 'cancelled';
    }
    return record;
  }

  createThread(sessionId: string, options: { mode: PixieContextMode; model: PixieModel; forked?: PixieMessage[] }): Promise<PixieThread> {
    return this.mutate(sessionId, record => {
      const thread: PixieThread = {
        id: randomUUID(), title: `Thread ${record.threads.length + 1}`, mode: options.mode, model: options.model,
        forked: options.mode === 'fork' ? options.forked ?? [] : [], turns: [], createdAt: Date.now(),
      };
      record.threads.push(thread);
      record.activeThreadId = thread.id;
      return thread;
    });
  }

  activate(sessionId: string, threadId: string): Promise<void> {
    return this.mutate(sessionId, record => { this.thread(record, threadId); record.activeThreadId = threadId; });
  }

  /** Delete a thread; the latest remaining thread becomes active when the deleted one was. */
  deleteThread(sessionId: string, threadId: string): Promise<void> {
    return this.mutate(sessionId, record => {
      this.thread(record, threadId);
      record.threads = record.threads.filter(thread => thread.id !== threadId);
      if (record.activeThreadId === threadId) {
        const next = record.threads.at(-1)?.id;
        if (next) record.activeThreadId = next; else delete record.activeThreadId;
      }
    });
  }

  startTurn(sessionId: string, threadId: string, question: string, commandId?: string): Promise<PixieTurn> {
    return this.mutate(sessionId, record => {
      const thread = this.thread(record, threadId);
      const turn: PixieTurn = { id: randomUUID(), question, answer: '', status: 'streaming', model: thread.model, ...(commandId ? { commandId } : {}), startedAt: Date.now() };
      thread.turns.push(turn);
      this.live.add(turn.id);
      return turn;
    });
  }

  /** Settle a streaming turn once; later settlements (a late answer after cancel) are ignored. */
  finishTurn(sessionId: string, threadId: string, turnId: string, result: { status: Exclude<PixieTurnStatus, 'streaming'>; answer: string; error?: string; usage?: PixieUsage; truncated?: boolean }): Promise<void> {
    return this.mutate(sessionId, record => {
      const turn = this.thread(record, threadId).turns.find(item => item.id === turnId);
      if (!turn) throw new Error(`Unknown Pixie turn ${turnId}`);
      this.live.delete(turnId);
      if (turn.status !== 'streaming') return;
      turn.status = result.status;
      turn.answer = result.answer;
      turn.endedAt = Date.now();
      if (result.error !== undefined) turn.error = result.error;
      if (result.usage !== undefined) turn.usage = result.usage;
      if (result.truncated) turn.truncated = true;
    });
  }

  /** Delete records of sessions that no longer exist. Archived sessions still exist, so their records stay.
   * @returns removed session ids.
   */
  async prune(exists: (sessionId: string) => Promise<boolean>): Promise<string[]> {
    let names: string[];
    try { names = await readdir(this.root); } catch { return []; }
    const removed: string[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const sessionId = name.slice(0, -'.json'.length);
      if (!SESSION_ID.test(sessionId) || this.queues.has(sessionId) || await exists(sessionId)) continue;
      // This directory can contain legacy non-session JSON; never prune by filename alone.
      let record: unknown;
      try { record = JSON.parse(await readFile(join(this.root, name), 'utf8')); } catch { continue; }
      if (!record || typeof record !== 'object' || Array.isArray(record) || (record as PixieSessionRecord).sessionId !== sessionId || !Array.isArray((record as PixieSessionRecord).threads)) continue;
      await rm(join(this.root, name), { force: true });
      removed.push(sessionId);
    }
    return removed;
  }

  private thread(record: PixieSessionRecord, threadId: string): PixieThread {
    const thread = record.threads.find(item => item.id === threadId);
    if (!thread) throw new Error(`Unknown Pixie thread ${threadId}`);
    return thread;
  }

  private file(sessionId: string): string {
    if (!SESSION_ID.test(sessionId)) throw new Error(`Invalid session id for Pixie: ${JSON.stringify(sessionId)}`);
    return join(this.root, `${sessionId}.json`);
  }

  private async mutate<T>(sessionId: string, change: (record: PixieSessionRecord) => T): Promise<T> {
    const file = this.file(sessionId);
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const record = await this.read(sessionId);
      const value = change(record);
      await mkdir(this.root, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(record));
      await rename(temporary, file);
      return value;
    });
    // The queue entry only orders later writes; the caller observes the failure through `next`.
    const tracked = next.catch(() => {}).finally(() => { if (this.queues.get(sessionId) === tracked) this.queues.delete(sessionId); });
    this.queues.set(sessionId, tracked);
    return next;
  }
}

/** Validate settings from the Client; throws with the offending field name. */
export function parsePixieSettings(value: unknown): PixieSettings {
  const raw = value as Partial<PixieSettings> | undefined;
  if (!raw || typeof raw !== 'object') throw new Error('Pixie settings must be an object');
  if (raw.contextMode !== 'fresh' && raw.contextMode !== 'fork') throw new Error('Pixie settings contextMode must be fresh or fork');
  if (typeof raw.systemPrompt !== 'string') throw new Error('Pixie settings systemPrompt must be a string');
  if (typeof raw.allowThreadModel !== 'boolean') throw new Error('Pixie settings allowThreadModel must be a boolean');
  const settings: PixieSettings = { contextMode: raw.contextMode, systemPrompt: raw.systemPrompt, allowThreadModel: raw.allowThreadModel };
  if (raw.model !== undefined) settings.model = parsePixieModel(raw.model);
  if (raw.judgeModel !== undefined) settings.judgeModel = parsePixieModel(raw.judgeModel);
  if (raw.judgeSystemPrompt !== undefined) {
    if (typeof raw.judgeSystemPrompt !== 'string') throw new Error('Pixie settings judgeSystemPrompt must be a string');
    settings.judgeSystemPrompt = raw.judgeSystemPrompt;
  }
  if (raw.judgeEngine !== undefined) {
    if (raw.judgeEngine !== 'llm' && raw.judgeEngine !== 'jev') throw new Error('Pixie settings judgeEngine must be llm or jev');
    settings.judgeEngine = raw.judgeEngine;
  }
  if (raw.jevModel !== undefined) {
    if (typeof raw.jevModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw.jevModel)) throw new Error('Pixie settings jevModel must be a model ID');
    settings.jevModel = raw.jevModel;
  }
  return settings;
}

export function parsePixieModel(value: unknown): PixieModel {
  const raw = value as Partial<PixieModel> | undefined;
  if (!raw || typeof raw !== 'object') throw new Error('Pixie model must be an object');
  if (typeof raw.provider !== 'string' || !raw.provider) throw new Error('Pixie model provider is required');
  if (typeof raw.model !== 'string' || !raw.model) throw new Error('Pixie model id is required');
  const model: PixieModel = { provider: raw.provider, model: raw.model };
  if (raw.reasoningEffort !== undefined) {
    if (typeof raw.reasoningEffort !== 'string' || !raw.reasoningEffort) throw new Error('Pixie model reasoningEffort must be a non-empty string');
    model.reasoningEffort = raw.reasoningEffort;
  }
  if (raw.maxTokens !== undefined) {
    if (!Number.isInteger(raw.maxTokens) || raw.maxTokens <= 0) throw new Error('Pixie model maxTokens must be a positive integer');
    model.maxTokens = raw.maxTokens;
  }
  return model;
}

/** Studio-wide Pixie settings file, separate from presets. */
export class PixieSettingsStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async read(): Promise<PixieSettings> {
    try { return parsePixieSettings(JSON.parse(await readFile(this.file, 'utf8'))); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(DEFAULT_PIXIE_SETTINGS);
      throw error;
    }
  }
  save(value: unknown): Promise<PixieSettings> {
    const run = this.tail.catch(() => {}).then(async () => {
      const settings = parsePixieSettings(value);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(settings, null, 2));
      await rename(temporary, this.file);
      return settings;
    });
    this.tail = run;
    return run;
  }
}
