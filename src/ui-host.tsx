/** The only Studio module that imports host primitives; feature modules take them from here.
 * Primitives import CSS modules, so Node unit tests must not load this module. See `docs/design-system.md`.
 */
import React from 'react';
import { Tag, type StateDotState, type TagTone } from '@deepseek-ai/dsh-client-ui-primitives';

export { Checkbox, Menu, MenuItemButton, Modal, SegmentedControl, StateDot, Tag, Toast } from '@deepseek-ai/dsh-client-ui-primitives';
export type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives';

/** Whether Studio can deliver a setting, component, or system as configured. */
export type SupportState = 'supported' | 'conditional' | 'unsupported' | 'missing';

/** State dot for each support state: done, partial, not offered, absent. */
export const SUPPORT_DOT: Record<SupportState, StateDotState> = { supported: 'done', conditional: 'warning', unsupported: 'idle', missing: 'error' };
const SUPPORT_TONE: Record<Exclude<SupportState, 'supported'>, TagTone> = { conditional: 'info', unsupported: 'neutral', missing: 'warning' };

/** @param props Support state and its localized label. @returns A tag for limited states; supported shows nothing. */
export function SupportTag({ support, label }: { support: SupportState; label: string }) {
  return support === 'supported' ? null : <Tag tone={SUPPORT_TONE[support]}>{label}</Tag>;
}

/** Collapsible card for one configurable component.
 * Expanded order is fixed: limitation reason, editor, model-visible effect, card actions.
 * @param props Heading, one-line summary, support state and label, optional reason and effect with its caption, open state, actions, and editor.
 * @returns Component card.
 */
export function ComponentCard({ title, summary, support, supportLabel, reason, effectLabel, effect, open, onToggle, actions, children }: React.PropsWithChildren<{
  title: string; summary: string; support: SupportState; supportLabel: string; reason?: string | undefined;
  effectLabel?: string; effect?: string; open: boolean; onToggle: () => void; actions?: React.ReactNode;
}>) {
  const bodyId = React.useId();
  return <section className="studio-component">
    <button type="button" className="studio-component-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
      <span className="studio-component-title">{title}</span>
      <span className="studio-component-summary">{summary}</span>
      <SupportTag support={support} label={supportLabel} />
      <svg className="studio-chevron" data-open={open} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && <div id={bodyId} className="studio-component-body">
      {reason && <p className="studio-reason">{reason}</p>}
      {children}
      {effect && <div className="studio-effect"><span>{effectLabel}</span><p>{effect}</p></div>}
      {actions && <div className="studio-card-actions">{actions}</div>}
    </div>}
  </section>;
}

/** Dialog content; Modal portals to the document body, so the content re-enters the Studio style scope.
 * @param props Dialog body.
 * @returns Scoped body.
 */
export function DialogBody({ children }: React.PropsWithChildren) {
  return <div className="studio-ui">{children}</div>;
}

/** @param props Dialog actions, cancel first and the confirming action last. @returns Scoped, right-aligned footer. */
export function DialogFooter({ children }: React.PropsWithChildren) {
  return <div className="studio-ui studio-modal-footer">{children}</div>;
}
