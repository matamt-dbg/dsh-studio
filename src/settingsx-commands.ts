/** SettingsX keyboard commands: what Studio adds to DSH's shortcut catalog. Pure and Node-testable.
 * Commands DSH already ships are not repeated. Only session previous/next carry a default (desktop macOS, as the
 * session-cycle plugin did); the rest register unbound and users assign keys in DSH's shortcut settings.
 */
import { adjacentSession, currentSessionId, orderedSessionIds, readView } from './session-order.ts';

export type CommandKey = 'previous' | 'next' | 'goto' | 'copyCwd' | 'fullscreen';
export interface StudioCommandSpec {
  key: CommandKey;
  /** DSH shortcut command id. */
  id: string;
  /** Desktop macOS default; omitted means unbound everywhere. */
  defaultMac?: { code: string; modifiers: ('primary' | 'shift' | 'alt' | 'control')[] };
  /** For `goto`: 1-based sidebar position. */
  position?: number;
}

const prefix = 'studio.settingsx';
/** Every command in display order. Ids are stable: saved DSH bindings refer to them. */
export const STUDIO_COMMANDS: readonly StudioCommandSpec[] = [
  { key: 'previous', id: 'studio.session-cycle.previous', defaultMac: { code: 'BracketLeft', modifiers: ['primary', 'shift'] } },
  { key: 'next', id: 'studio.session-cycle.next', defaultMac: { code: 'BracketRight', modifiers: ['primary', 'shift'] } },
  ...Array.from({ length: 9 }, (_, index) => ({ key: 'goto' as const, id: `${prefix}.session-${index + 1}`, position: index + 1 })),
  { key: 'copyCwd', id: `${prefix}.copy-cwd` },
  { key: 'fullscreen', id: `${prefix}.fullscreen` },
];

/** The slice of Client services session navigation reads. */
export interface SessionSnapshots {
  sessions: { phase: string; ids: string[]; byId: Record<string, { id: string; cwd?: string } & Record<string, unknown>> };
  workspaces: { phase: string; state: string } & Record<string, unknown>;
  storage: Pick<Storage, 'getItem'> | undefined;
}
export type Resolved = { status: 'handled'; target: string } | { status: 'blocked'; reason: 'unavailable' | 'empty' | 'none' };

/** Sidebar-ordered ids, or `unavailable` while lists load or the saved view cannot be read. */
function ordered(snapshots: SessionSnapshots): string[] | 'unavailable' {
  const { sessions, workspaces } = snapshots;
  if (sessions.phase !== 'ready' || workspaces.phase !== 'ready' || workspaces.state === 'loading') return 'unavailable';
  try { return orderedSessionIds(sessions, workspaces, readView(snapshots.storage)); } catch { return 'unavailable'; }
}

/** Target of a session navigation command, computed fresh on every key press. */
export function resolveSessionTarget(snapshots: SessionSnapshots, command: { key: 'previous' | 'next' } | { key: 'goto'; position: number }): Resolved {
  const ids = ordered(snapshots);
  if (ids === 'unavailable') return { status: 'blocked', reason: 'unavailable' };
  if (command.key === 'goto') {
    const target = ids[command.position - 1];
    return target === undefined ? { status: 'blocked', reason: 'empty' } : { status: 'handled', target };
  }
  let current: string | undefined;
  try { current = currentSessionId(snapshots.sessions); } catch { return { status: 'blocked', reason: 'unavailable' }; }
  const target = adjacentSession(ids, current, command.key === 'next' ? 1 : -1);
  return target === null ? { status: 'blocked', reason: 'empty' } : { status: 'handled', target };
}

/** Working folder of the session in the main view. */
export function currentCwd(sessions: SessionSnapshots['sessions']): string | undefined {
  try { const id = currentSessionId(sessions); return id ? sessions.byId[id]?.cwd : undefined; } catch { return undefined; }
}

/** Command ids the user switched off; stored in this browser only. */
export const DISABLED_KEY = 'studio.settingsx.disabledCommands.v1';
export function readDisabled(storage: Pick<Storage, 'getItem'> | undefined): Set<string> {
  try {
    const parsed = JSON.parse(storage?.getItem(DISABLED_KEY) ?? '[]') as unknown;
    const known = new Set(STUDIO_COMMANDS.map(command => command.id));
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && known.has(id)) : []);
  } catch { return new Set(); }
}
