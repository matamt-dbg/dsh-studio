/** Version footer for the Studio navigation and the update mark beside the sidebar entry. Node-tested: no primitives. */
import React from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './ui.tsx';
import { sidebarMarkStyles } from './ui-styles.ts';
import type { UpdateState, UpdateStore } from './update-store.ts';

const ko = {
  available: (v: string) => `v${v}로 업데이트`, updating: (v: string) => `v${v} 설치 중`,
  installed: (v: string) => `v${v}를 설치했습니다. DSH를 다시 시작하면 적용됩니다.`,
  failed: (v: string, message: string) => `v${v}로 업데이트하지 못했습니다. 다시 시도하려면 누르세요. (${message})`,
};
type Copy = typeof ko;
const en: Copy = {
  available: v => `Update to v${v}`, updating: v => `Installing v${v}`,
  installed: v => `Installed v${v}. Restart DSH to use it.`,
  failed: (v, message) => `Could not update to v${v}. Select to try again. (${message})`,
};
const zh: Copy = {
  available: v => `更新到 v${v}`, updating: v => `正在安装 v${v}`,
  installed: v => `已安装 v${v}。重启 DSH 后生效`,
  failed: (v, message) => `无法更新到 v${v}。点击重试（${message}）`,
};
const copy = (locale: string) => locale.startsWith('ko') ? ko : locale.startsWith('zh') ? zh : en;

/** Subscribe a component to the shared update state. */
export function useUpdateState(store: UpdateStore): UpdateState {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Describe the state for a tooltip and accessible name; undefined while nothing is offered. */
export function updateLabel(state: UpdateState, locale: string): string | undefined {
  const t = copy(locale);
  if (state.phase === 'updating') return t.updating(state.version);
  if (state.phase === 'installed') return t.installed(state.version);
  if (state.phase === 'failed') return t.failed(state.version, state.message);
  return state.version ? t.available(state.version) : undefined;
}

/** Icon for each state: arrow (available, installing), check (installed), alert (failed). */
export function UpdateGlyph({ phase, size = 14 }: { phase: UpdateState['phase']; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" />
    {phase === 'installed' ? <path d="M5.2 8.2l1.9 1.9 3.7-4" />
      : phase === 'failed' ? <path d="M8 4.8v3.8M8 11.2v.01" />
        : <path d="M8 11V5.2M5.4 7.6L8 5l2.6 2.6" />}
  </svg>;
}

/** Bottom of the Studio navigation: the installed version, and one icon button while an update applies.
 * @param props Shared store and locale.
 * @returns `v0.2.7` and, when relevant, an update control whose tooltip carries the detail.
 */
export function VersionFooter({ store, locale }: { store: UpdateStore; locale: string }) {
  const state = useUpdateState(store);
  const label = updateLabel(state, locale);
  return <div className="studio-nav-footer">
    <span className="studio-mono">v{state.current}</span>
    {label && <IconButton label={label} tone={state.phase === 'failed' ? 'error' : state.phase === 'installed' ? 'success' : 'info'}
      disabled={state.phase === 'updating' || state.phase === 'installed'} busy={state.phase === 'updating'}
      onClick={() => { void store.update(); }}><UpdateGlyph phase={state.phase} /></IconButton>}
  </div>;
}

/** Studio's sidebar icon. With an update offered, a wide row gets a trailing mark and a narrow one a corner dot.
 * The sidebar owns the row; the mark is portaled into that row's button and pushed to its end with CSS order.
 * @param props Glyph size from the sidebar, shared store, and locale.
 * @returns The Studio glyph plus the update mark.
 */
export function SidebarIcon({ size = 20, store, locale }: { size?: number; store: UpdateStore; locale: string }) {
  const state = useUpdateState(store);
  const label = updateLabel(state, locale);
  const glyph = React.useRef<SVGSVGElement>(null);
  const [row, setRow] = React.useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => { setRow(glyph.current?.closest('button') ?? null); }, [size]);
  // The sidebar draws a wide row's label at 16px and a collapsed icon-only row at 18px.
  const wide = size <= 16;
  const marked = label !== undefined && state.phase !== 'installed';
  return <>
    <span className="studio-ui studio-sidebar-glyph">
      {marked && !wide && <style>{sidebarMarkStyles}</style>}
      <svg ref={glyph} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <path d="M17.5 14v7M14 17.5h7" />
        {marked && !wide && <circle className="studio-sidebar-dot" cx="21" cy="3" r="3" stroke="none" />}
      </svg>
    </span>
    {marked && wide && row && createPortal(<span className="studio-ui studio-sidebar-update" data-phase={state.phase} title={label} role="img" aria-label={label}>
      <style>{sidebarMarkStyles}</style><UpdateGlyph phase={state.phase} size={14} />
    </span>, row)}
  </>;
}
