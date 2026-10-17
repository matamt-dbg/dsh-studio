import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptySessionRoles, parseSessionRoles, type SessionRoles } from '../session-roles.ts';

const SESSION_ID = /^[\w-]{1,200}$/;

/** Studio data directory → the session roles directory. Shared by the Remote service and the role tool. */
export const sessionRolesRoot = (dataDir: string) => join(dataDir, 'session-roles');

/** Session ids are file names here, so only plain ids are accepted. */
export function sessionRolesFile(root: string, sessionId: string): string {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new Error(`Invalid session id for session roles: ${JSON.stringify(sessionId)}`);
  return join(root, `${sessionId}.json`);
}

/** Read one root session's roles. A missing file means none; an invalid file is an error, never silently dropped. */
export async function readSessionRoles(root: string, sessionId: string): Promise<SessionRoles> {
  const file = sessionRolesFile(root, sessionId);
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptySessionRoles();
    throw error;
  }
  try { return parseSessionRoles(JSON.parse(text)); }
  catch (error) { throw new Error(`Invalid session roles for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`); }
}

/**
 * Roles owned by root sessions, one file per root under `<data>/session-roles/`.
 * Changes for one session are serialized, and followers hear about a change only after it is written.
 * Readers in other plugins read the file directly; writes are atomic renames.
 */
export class SessionRoleStore {
  private queues = new Map<string, Promise<unknown>>();
  private listeners = new Map<string, Set<() => void>>();
  constructor(readonly root: string) {}

  read(sessionId: string): Promise<SessionRoles> { return readSessionRoles(this.root, sessionId); }

  /** Read, change and write one session's record; an empty record removes the file. */
  update(sessionId: string, change: (record: SessionRoles) => SessionRoles | Promise<SessionRoles>): Promise<SessionRoles> {
    return this.enqueue(sessionId, async () => {
      const next = parseSessionRoles(await change(await this.read(sessionId)));
      const file = sessionRolesFile(this.root, sessionId);
      if (!next.roles.length) await rm(file, { force: true });
      else {
        await mkdir(this.root, { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try { await writeFile(temporary, JSON.stringify(next)); await rename(temporary, file); }
        finally { await rm(temporary, { force: true }); }
      }
      for (const listener of this.listeners.get(sessionId) ?? []) listener();
      return next;
    });
  }

  /** Called after each committed change of this session's record. */
  subscribe(sessionId: string, listener: () => void): () => void {
    sessionRolesFile(this.root, sessionId);
    const listeners = this.listeners.get(sessionId) ?? new Set();
    listeners.add(listener); this.listeners.set(sessionId, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(sessionId); };
  }

  /** Remove records of sessions missing from the complete durable list. A failed list removes nothing. */
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
      await this.enqueue(id, async () => { await rm(sessionRolesFile(this.root, id), { force: true }); removed.push(id); });
    }
    return removed;
  }

  private enqueue<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    sessionRolesFile(this.root, sessionId);
    const next = (this.queues.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(action);
    const tracked = next.catch(() => {}).finally(() => { if (this.queues.get(sessionId) === tracked) this.queues.delete(sessionId); });
    this.queues.set(sessionId, tracked);
    return next;
  }
}
