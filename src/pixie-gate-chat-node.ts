/** Chat placement of gate results at tool calls and input messages, plus one shared gate-run subscription per session.
 * Node-testable: no DSH runtime imports. The Definition reads only existing session events; gate records stay in Studio data.
 */
import type { GateRunFrame, GateRunRecord } from './pixie-gate-contracts.ts';
import type { GateAnchor } from './pixie-gate-tail.tsx';

/** Chat node kind and Definition kind; also the keyed renderer key. */
export const GATE_RESULT_NODE = 'studio-pixie-gate-result';
/** After its subject event and the Chat's own follow-ups (0.1), before the next durable event. */
const ANCHOR_OFFSET = 0.2;
const SESSION_LOCATION = Object.freeze({ kind: 'session' as const });

interface EventLike { type: string; seq: number; surfaceOp?: string; data?: unknown }
interface MatchLike { event: EventLike; location?: unknown }
interface ContextLike { key: string; id: string; start?: MatchLike; matches: readonly MatchLike[]; state?: GateResultState; current: ReadonlyMap<string, unknown> }
export interface GateResultState { anchor: Exclude<GateAnchor, { kind: 'turn' }>; seq: number }
export interface GateResultNode { key: string; kind: string; id: string; target: 'chat'; anchorSeq: number; location: unknown; visibility: 'visible'; data: { anchor: GateResultState['anchor'] } }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
/** Replacements re-surface an existing range (compaction); only the first append places the result. */
const appended = (event: EventLike) => event.surfaceOp === undefined || event.surfaceOp === 'append';

/** @returns the anchor an event can carry gate results for, or undefined. */
export function eventAnchor(event: EventLike): GateResultState['anchor'] | undefined {
  if (!appended(event) || !record(event.data)) return undefined;
  if (event.type === 'tool/result') {
    const message = event.data.message;
    return record(message) && typeof message.toolCallId === 'string' ? { kind: 'tool', callId: message.toolCallId } : undefined;
  }
  const source = event.data.source;
  if (event.type === 'user/message' && typeof event.data.id === 'string' && record(source) && (source.kind === 'user' || source.kind === 'agent-message')) return { kind: 'message', messageId: event.data.id };
  return undefined;
}

const anchorId = (anchor: GateResultState['anchor']) => anchor.kind === 'tool' ? `tool:${anchor.callId}` : `message:${anchor.messageId}`;
const match = (event: EventLike) => { const anchor = eventAnchor(event); return anchor ? { id: anchorId(anchor), role: 'start' as const } : null; };

/** One empty-by-default Chat row per tool result and input message; its renderer shows nothing unless a displayed gate result exists. */
export const gateResultDefinition = {
  kind: GATE_RESULT_NODE,
  target: 'chat',
  // Function form: DSH 0.2.0-rc.2 does not accept the event-type table form.
  match,
  start: (_context: ContextLike, start: MatchLike): GateResultState => ({ anchor: eventAnchor(start.event)!, seq: start.event.seq }),
  update: (context: ContextLike & { state: GateResultState }) => context.state,
  buildViewNode: (context: ContextLike): GateResultNode | null => {
    const state = context.state;
    if (!state) return null;
    // Tool results stay in their step, next to the tool call (folded with the turn's process).
    // Message results take a session location: the Chat orders them by seq right under the message, outside the fold.
    const location = state.anchor.kind === 'message' ? SESSION_LOCATION : context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' };
    const anchorSeq = state.seq + ANCHOR_OFFSET;
    const current = context.current.get('chat') as GateResultNode | null | undefined;
    if (current && current.anchorSeq === anchorSeq && current.location === location) return current;
    return { key: context.key, kind: GATE_RESULT_NODE, id: context.id, target: 'chat', anchorSeq, location, visibility: 'visible', data: { anchor: state.anchor } };
  },
};

export interface GateRunSource {
  gateRuns(): Promise<GateRunRecord>;
  followGates(listener: (frame: GateRunFrame) => void): () => void;
}

/** Applies one run or session frame to a record. Idempotent, so replaying a frame the record already has is harmless. */
export function applyGateFrame(record: GateRunRecord, frame: Exclude<GateRunFrame, { type: 'sync' }>): GateRunRecord {
  return frame.type === 'session' ? { ...record, disabledGateIds: frame.disabledGateIds }
    : { ...record, runs: [...record.runs.filter(run => run.id !== frame.run.id), frame.run] };
}

/** Buffers a frame for replay, keeping only the latest frame per run and the latest session frame, so a stalled fetch stays bounded. */
export function bufferGateFrame(frames: Exclude<GateRunFrame, { type: 'sync' }>[], frame: Exclude<GateRunFrame, { type: 'sync' }>): void {
  const same = frames.findIndex(old => old.type === frame.type && (frame.type === 'session' || (old.type === 'run' && old.run.id === frame.run.id)));
  if (same >= 0) frames.splice(same, 1);
  frames.push(frame);
}

/**
 * Many Chat rows read the same session's gate runs. One stream and one fetch per sync serve them all.
 * Frames that arrive while a fetch is pending are replayed onto its snapshot, so a late snapshot never drops a live result.
 * Each load has a generation: a superseded load neither publishes its snapshot nor clears a newer one.
 * @param fetch reads the session record. @param connect opens the session stream and returns its stop.
 */
export function gateRunHub(fetch: () => Promise<GateRunRecord>, connect: (listener: (frame: GateRunFrame) => void) => () => void): GateRunSource {
  let state: GateRunRecord | undefined;
  let pending: { generation: number; promise: Promise<GateRunRecord>; frames: Exclude<GateRunFrame, { type: 'sync' }>[] } | undefined;
  let generation = 0;
  let stop: (() => void) | undefined;
  const listeners = new Set<(frame: GateRunFrame) => void>();
  const load = (): Promise<GateRunRecord> => {
    const id = ++generation;
    const frames: Exclude<GateRunFrame, { type: 'sync' }>[] = [];
    const promise = fetch().then(value => {
      const next = frames.reduce(applyGateFrame, value);
      if (id === generation) { state = next; pending = undefined; }
      return next;
    }, error => {
      if (id === generation) pending = undefined;
      throw error;
    });
    // Callers handle their own copy; the hub's reference must not surface as an unhandled rejection.
    promise.catch(() => {});
    pending = { generation: id, promise, frames };
    return promise;
  };
  const apply = (frame: GateRunFrame) => {
    if (frame.type === 'sync') { state = undefined; void load(); }
    else {
      if (state) state = applyGateFrame(state, frame);
      if (pending) bufferGateFrame(pending.frames, frame);
    }
    for (const listener of [...listeners]) listener(frame);
  };
  return {
    gateRuns: () => state ? Promise.resolve(state) : pending ? pending.promise : load(),
    followGates(listener) {
      listeners.add(listener);
      if (listeners.size === 1) stop = connect(apply);
      return () => {
        if (!listeners.delete(listener) || listeners.size) return;
        stop?.(); stop = undefined; state = undefined; pending = undefined; generation++;
      };
    },
  };
}
