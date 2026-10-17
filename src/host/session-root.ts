import type { Context } from '@deepseek-ai/cordis';

/** The header fields that decide whose roles a session follows and which preset it runs. */
export interface SessionLineage { parentSession?: string; origin?: string; agentPreset?: string }
export type LineageLookup = (sessionId: string) => SessionLineage | undefined | Promise<SessionLineage | undefined>;

/** Deeper than any delegation budget; a guard against corrupt lineage, not a product limit. */
const MAX_HOPS = 64;

/**
 * The root session whose roles apply: climb `parentSession` while the session is a subagent child.
 * A user fork has no `origin`, so it is its own root. An unknown parent ends the climb at the last known session.
 */
export async function resolveRootSession(sessionId: string, lookup: LineageLookup, known?: SessionLineage): Promise<string> {
  let current = sessionId;
  let header = known ?? await lookup(current);
  const seen = new Set([current]);
  for (let hop = 0; hop < MAX_HOPS && header?.origin === 'subagent' && header.parentSession; hop++) {
    const parent = header.parentSession;
    if (seen.has(parent)) break;
    const next = await lookup(parent);
    if (!next) break;
    seen.add(parent);
    current = parent; header = next;
  }
  return current;
}

interface SessionsSlice { get(id: string): { header: SessionLineage } | undefined }
interface InspectSlice { inspect(sessionId: string, signal?: AbortSignal): Promise<{ meta?: SessionLineage }> }

/**
 * Read a session header without resuming it: the live session first, then the session controller.
 * Both services are optional and read per call; an unreadable session is unknown.
 */
export function headerLookup(ctx: Context, signal?: AbortSignal): LineageLookup {
  return async sessionId => {
    const live = (ctx.get('sessions') as unknown as SessionsSlice | undefined)?.get(sessionId);
    if (live) return live.header;
    const controller = ctx.get('sessionController') as unknown as InspectSlice | undefined;
    if (!controller) return undefined;
    try { return (await controller.inspect(sessionId, signal)).meta; } catch { signal?.throwIfAborted(); return undefined; }
  };
}
