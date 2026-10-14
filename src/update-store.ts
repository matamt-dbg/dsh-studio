/** One Client-wide update state shared by the sidebar entry and the Studio navigation footer. */
import type { UpdateResult, UpdateStatus } from './update-check.ts';

/** Host calls the store needs; rejections carry a displayable message. */
export interface UpdateActions {
  status(force: boolean): Promise<UpdateStatus>;
  update(version: string): Promise<UpdateResult>;
}

/** What the indicators render. `version` is the offered version while one is installable. */
export type UpdateState =
  | { phase: 'idle'; current: string; version?: string }
  | { phase: 'updating'; current: string; version: string }
  | { phase: 'installed'; current: string; version: string }
  | { phase: 'failed'; current: string; version: string; message: string };

/** Subscribable update state with one in-flight install at a time. */
export interface UpdateStore {
  getSnapshot(): UpdateState;
  subscribe(listener: () => void): () => void;
  refresh(force?: boolean): Promise<void>;
  update(): Promise<void>;
}

/** Create the store; nothing is requested until {@link UpdateStore.refresh}.
 * @param actions Host calls.
 * @param current The running build's version, shown before the Host answers.
 */
export function createUpdateStore(actions: UpdateActions, current: string): UpdateStore {
  let state: UpdateState = { phase: 'idle', current };
  const listeners = new Set<() => void>();
  const set = (next: UpdateState) => { state = next; listeners.forEach(listener => listener()); };
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async refresh(force = false) {
      if (state.phase === 'updating' || state.phase === 'installed') return;
      try {
        const status = await actions.status(force);
        // An install may have started while the lookup was in flight.
        const phase = (): UpdateState['phase'] => state.phase;
        if (phase() === 'updating' || phase() === 'installed') return;
        if (status.installed) { set({ phase: 'installed', current: status.current, version: status.installed }); return; }
        // Only an install this profile can perform is offered; every other answer shows just the version.
        const version = status.available && !status.blocked ? status.available : undefined;
        set({ phase: 'idle', current: status.current, ...(version ? { version } : {}) });
      } catch { /* A failed lookup offers nothing; the version stays visible. */ }
    },
    async update() {
      if (state.phase !== 'idle' && state.phase !== 'failed') return;
      const version = state.version;
      if (!version) return;
      set({ phase: 'updating', current: state.current, version });
      try {
        const result = await actions.update(version);
        if (result.status === 'restart-required' || result.status === 'applied') set({ phase: 'installed', current: state.current, version: result.version });
        else set({ phase: 'failed', current: state.current, version, message: result.message ?? result.status });
      } catch (error) {
        set({ phase: 'failed', current: state.current, version, message: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}
