/** Client half of SettingsX: Studio shortcut commands and the SettingsX service page.
 * Commands register through DSH's public `shortcuts` service and leave with Studio. Session order reads DSH's saved
 * sidebar view (private, user-approved) and blocks when it cannot be read.
 */
import React from 'react';
import type { StudioContext } from './contracts.js';
import { currentCwd, DISABLED_KEY, readDisabled, registerIsolated, resolveSessionTarget, STUDIO_COMMANDS, type SessionSnapshots, type StudioCommandSpec } from './settingsx-commands.ts';
import { settingsxText } from './settingsx-locale.ts';
import { commandLabel, SettingsXPage, type CommandRowState, type SettingsXShortcuts } from './settingsx-page.tsx';

type Observable<T> = { getSnapshot(): T; subscribe(listener: () => void): () => void };
type ShortcutResolution = { status: 'handled'; run(): void } | { status: 'blocked'; reason: string };
interface ShortcutsSlice {
  readonly catalog: Observable<readonly { id: string; keys: readonly string[]; binding: unknown }[]>;
  register(command: {
    id: string; label: () => string; aliases: readonly string[];
    defaults: Record<string, { code: string; modifiers: readonly string[] }>;
    regions: readonly ('page' | 'editable' | 'terminal')[]; modals: readonly string[];
    resolve(context: { modal: string | null }): ShortcutResolution;
  }): () => void;
}
export function mountSettingsX(ctx: StudioContext, options: { navFooter?: (locale: string) => React.ReactNode } = {}) {
  const locale = () => ctx.locale.getLocale().active;
  const t = (key: Parameters<typeof settingsxText>[1]) => settingsxText(locale(), key);
  const storage = () => { try { return globalThis.localStorage; } catch { return undefined; } };
  let disabled = readDisabled(storage());
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());

  // Commands need shortcuts, sessions, workspaces, and the workspace browser; they appear once all exist.
  ctx.inject(['shortcuts', 'sessions', 'workspaces', 'uiWorkspace'] as never, scope => {
    const services = scope as unknown as {
      shortcuts: ShortcutsSlice;
      sessions: { list: Observable<SessionSnapshots['sessions']> };
      workspaces: { list: Observable<SessionSnapshots['workspaces']> };
      uiWorkspace: { openSession(target: string): void };
    };
    const snapshots = (): SessionSnapshots => ({ sessions: services.sessions.list.getSnapshot(), workspaces: services.workspaces.list.getSnapshot(), storage: storage() });
    const resolveFor = (spec: StudioCommandSpec, modal: string | null): ShortcutResolution => {
      if (spec.key === 'previous' || spec.key === 'next' || spec.key === 'goto') {
        // Desktop priority can bypass the declared modal restriction.
        if (modal !== null) return { status: 'blocked', reason: t('blocked.modal') };
        const resolved = resolveSessionTarget(snapshots(), spec.key === 'goto' ? { key: 'goto', position: spec.position! } : { key: spec.key });
        return resolved.status === 'handled'
          ? { status: 'handled', run: () => services.uiWorkspace.openSession(resolved.target) }
          : { status: 'blocked', reason: t(resolved.reason === 'unavailable' ? 'blocked.unavailable' : 'blocked.empty') };
      }
      if (spec.key === 'copyCwd') {
        const cwd = currentCwd(services.sessions.list.getSnapshot());
        return cwd ? { status: 'handled', run: () => { void navigator.clipboard?.writeText(cwd); } } : { status: 'blocked', reason: t('blocked.noCwd') };
      }
      const root = document.documentElement;
      if (!document.fullscreenEnabled || typeof root.requestFullscreen !== 'function') return { status: 'blocked', reason: t('blocked.fullscreen') };
      return { status: 'handled', run: () => { void (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen()).catch(() => undefined); } };
    };
    // One registration per enabled command; toggling re-registers only the changed command.
    const live = new Map<string, () => void>();
    const sync = () => {
      for (const spec of STUDIO_COMMANDS) {
        const want = !disabled.has(spec.id);
        if (want && !live.has(spec.id)) {
          const dispose = registerIsolated(command => services.shortcuts.register(command), {
            id: spec.id, label: () => commandLabel(locale(), spec), aliases: ['studio', 'settingsx', spec.key],
            defaults: spec.defaultMac ? { 'desktop:macos': spec.defaultMac } : {},
            regions: spec.key === 'fullscreen' || spec.key === 'copyCwd' ? ['page', 'editable', 'terminal'] : ['page', 'editable'], modals: [],
            resolve: context => resolveFor(spec, context.modal),
          } as Parameters<ShortcutsSlice['register']>[0], error => console.warn(`[studio] shortcut ${spec.id} was not registered`, error));
          if (dispose) live.set(spec.id, dispose);
        } else if (!want && live.has(spec.id)) { live.get(spec.id)!(); live.delete(spec.id); }
      }
    };
    sync();
    listeners.add(sync);
    scope.effect(() => () => { listeners.delete(sync); for (const dispose of live.values()) dispose(); live.clear(); });
  });

  const setEnabled = (id: string, enabled: boolean) => {
    const next = new Set(disabled);
    if (enabled) next.delete(id); else next.add(id);
    disabled = next;
    try { storage()?.setItem(DISABLED_KEY, JSON.stringify([...next])); } catch { /* the toggle still applies this session */ }
    notify();
  };

  function Page() {
    const active = React.useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getLocale().active);
    const [, rerender] = React.useReducer((value: number) => value + 1, 0);
    React.useEffect(() => { listeners.add(rerender); return () => { listeners.delete(rerender); }; }, []);
    const shortcuts = ctx.get('shortcuts' as never) as unknown as ShortcutsSlice | undefined;
    const catalog = React.useSyncExternalStore(listener => shortcuts?.catalog.subscribe(listener) ?? (() => {}), () => shortcuts?.catalog.getSnapshot() ?? []);
    const byId = new Map(catalog.map(entry => [entry.id, entry]));
    const rows: CommandRowState[] = STUDIO_COMMANDS.map(spec => ({ id: spec.id, enabled: !disabled.has(spec.id), keys: byId.get(spec.id)?.binding ? byId.get(spec.id)!.keys : null }));
    const state: SettingsXShortcuts = { rows, setEnabled };
    return <SettingsXPage locale={active} shortcuts={state} navFooter={options.navFooter?.(active)} />;
  }
  ctx.slots.inject('local.dsh-studio.services', () => ctx.slots.register({
    name: 'local.dsh-studio.services', id: 'settingsx', order: 20, label: () => t('serviceLabel'),
  }, Page));
}
