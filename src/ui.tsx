/** Studio-owned presentation; CSS ships inside each Client bundle, not a host package import.
 * This module must not import host primitives: Node unit tests load it, and primitives import CSS modules.
 * Primitive-backed parts live in `ui-host.tsx`. See `docs/design-system.md`.
 */
import React from 'react';
import { studioStyles as css } from './ui-styles.ts';

/** Scope theme aliases and styles to one mounted Studio surface.
 * @param props Localized content and optional layout class.
 * @returns A self-contained surface whose stylesheet leaves with its mount.
 */
export function StudioSurface({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  return <div className={`studio-ui ${className}`}><style>{css}</style>{children}</div>;
}
/** Preserve native button semantics while sharing Studio control styling.
 * @param props Native attributes, optional primary emphasis, and optional compact size.
 * @returns A keyboard-accessible button with no owned copy.
 */
export function Button({ primary = false, small = false, className = '', type = 'button', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; small?: boolean }) {
  return <button {...props} type={type} className={`studio-button ${primary ? 'studio-primary' : ''} ${small ? 'studio-small' : ''} ${className}`} />;
}

/** Mark a user override that differs from its inherited value. */
export function ChangeIndicator({ locale }: { locale: string }) {
  const labels = { ko: '변경됨', en: 'Modified', zh: '已修改' };
  const text = labels[locale.startsWith('ko') ? 'ko' : locale.startsWith('zh') ? 'zh' : 'en'];
  return <strong className="studio-schema-meta" data-studio-modified="true">{text}</strong>;
}

/** Page title block; at most one per section.
 * @param props Title, optional description, optional right-aligned actions, and extra lines such as a status line.
 * @returns Page header.
 */
export function PageHead({ title, description, actions, children }: React.PropsWithChildren<{ title: string; description?: string; actions?: React.ReactNode }>) {
  return <header className={`studio-page-head ${actions ? 'studio-page-head-actions' : ''}`}>
    <div>
      <h2>{title}</h2>
      {description && <p className="studio-muted">{description}</p>}
      {children}
    </div>
    {actions && <div className="studio-inline-actions">{actions}</div>}
  </header>;
}

/** Heading row inside a page with optional trailing actions.
 * @param props Heading, optional supporting line, optional actions, and whether the row holds a form field.
 * @returns Section heading row.
 */
export function SectionHead({ title, description, actions, field = false }: { title: React.ReactNode; description?: string; actions?: React.ReactNode; field?: boolean }) {
  return <div className={`studio-section-head ${field ? 'studio-section-head-field' : ''}`}>
    {description ? <div><h3 className="studio-panel-title">{title}</h3><p className="studio-muted">{description}</p></div> : typeof title === 'string' ? <h3 className="studio-panel-title">{title}</h3> : title}
    {actions && <div className="studio-inline-actions">{actions}</div>}
  </div>;
}

/** Quiet page-wide note, such as a preview or scope statement.
 * @param props Localized note.
 * @returns Note line.
 */
export function Note({ children }: React.PropsWithChildren) {
  return <p className="studio-note" role="note">{children}</p>;
}

/** Persistent in-place problem tied to the surface, with an optional recovery action.
 * @param props Localized message and optional action.
 * @returns Alert row that stays until its state resolves.
 */
export function Notice({ children, action }: React.PropsWithChildren<{ action?: React.ReactNode }>) {
  return <div role="alert" className="studio-notice-row"><span>{children}</span>{action}</div>;
}

/** One tab in a {@link TabBar}. */
export interface TabItem<Value extends string> { value: Value; label: React.ReactNode }

/** Sticky underline tabs; selecting a tab keeps the bar in view instead of returning to the page top.
 * @param props Accessible label, items, selected value, change callback, and an optional trailing action.
 * @returns Tab bar preceded by its scroll marker.
 */
export function TabBar<Value extends string>({ label, items, value, onChange, trailing }: {
  label: string; items: readonly TabItem<Value>[]; value: Value; onChange: (value: Value) => void; trailing?: { label: React.ReactNode; onClick: () => void };
}) {
  const marker = React.useRef<HTMLDivElement>(null);
  const select = (next: Value) => {
    onChange(next);
    const node = marker.current;
    let scroller = node?.closest<HTMLElement>('[data-studio-scroller]');
    // Narrow layouts scroll the whole Studio page instead of the content column.
    if (scroller && getComputedStyle(scroller).overflowY === 'visible') scroller = scroller.closest<HTMLElement>('.studio-page');
    if (!node || !scroller) return;
    const offset = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (offset < 0) scroller.scrollTop += offset;
  };
  return <>
    <div ref={marker} />
    <div className="studio-tabs" role="tablist" aria-label={label}>
      {items.map(item => <button key={item.value} type="button" role="tab" className="studio-tab" aria-selected={item.value === value} onClick={() => select(item.value)}>{item.label}</button>)}
      {trailing && <button type="button" className="studio-tab" onClick={trailing.onClick}>{trailing.label}</button>}
    </div>
  </>;
}

/** Tab content area; its minimum height keeps the sticky bar in place when a shorter tab replaces a longer one.
 * @param props Tab content.
 * @returns Tab panel.
 */
export function TabPanel({ children }: React.PropsWithChildren) {
  return <div role="tabpanel" className="studio-tab-panel">{children}</div>;
}

/** List on the left and detail on the right; stacks when the content column is narrow.
 * @param props Accessible list label, list items, and detail content.
 * @returns Two-column body.
 */
export function MasterDetail({ label, list, children }: React.PropsWithChildren<{ label: string; list: React.ReactNode }>) {
  return <div className="studio-master-detail">
    <nav className="studio-list" aria-label={label}>{list}</nav>
    <div className="studio-detail">{children}</div>
  </div>;
}

/** Selectable row in a {@link MasterDetail} list.
 * @param props Selection state, select callback, and content.
 * @returns List button.
 */
export function ListItem({ selected, onClick, children }: React.PropsWithChildren<{ selected: boolean; onClick: () => void }>) {
  return <button type="button" className="studio-list-item" aria-current={selected ? 'true' : undefined} onClick={onClick}>{children}</button>;
}

/** Group caption inside a list or navigation.
 * @param props Localized caption.
 * @returns Caption.
 */
export function ListGroup({ children }: React.PropsWithChildren) {
  return <span className="studio-list-group">{children}</span>;
}

/** Clickable summary card in a grid.
 * @param props Title row, detail lines, and select callback.
 * @returns Tile button.
 */
export function Tile({ title, onClick, children }: React.PropsWithChildren<{ title: React.ReactNode; onClick: () => void }>) {
  return <button type="button" className="studio-tile" onClick={onClick}><span className="studio-tile-title">{title}</span>{children}</button>;
}

/** Tone of a {@link Badge}; mirrors the DSH Tag status tones. */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'info' | 'outline';

/** Status capsule matching the DSH Tag geometry; usable from Node-tested modules.
 * @param props Tone and localized label.
 * @returns Inline badge.
 */
export function Badge({ tone = 'neutral', children }: React.PropsWithChildren<{ tone?: BadgeTone }>) {
  return <span className="studio-badge" data-tone={tone}>{children}</span>;
}

/** Collapsible advanced block styled as a component card.
 * @param props Title, optional one-line description, and body.
 * @returns Native details element.
 */
export function Disclosure({ title, description, children }: React.PropsWithChildren<{ title: React.ReactNode; description?: React.ReactNode }>) {
  return <details className="studio-disclosure">
    <summary><span className="studio-disclosure-summary"><span>{title}</span>{description && <span className="studio-muted">{description}</span>}</span></summary>
    <div className="studio-disclosure-body">{children}</div>
  </details>;
}

/** One secondary action in a {@link SplitButton} menu. */
export interface MenuAction { label: string; onSelect: () => void; disabled?: boolean }

/** One control: the main action plus a caret menu for related secondary actions.
 * @param props Main label and callback, emphasis, disabled state, menu actions, and the caret's accessible label.
 * @returns Joined button pair with a dismissible menu.
 */
export function SplitButton({ label, onClick, primary = false, disabled = false, actions = [], menuLabel }: {
  label: string; onClick: () => void; primary?: boolean; disabled?: boolean; actions?: readonly MenuAction[]; menuLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLSpanElement>(null);
  const menuId = React.useId();
  React.useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  const menu = actions.length > 0;
  return <span ref={root} className="studio-split" data-menu={menu}>
    <Button small primary={primary} disabled={disabled} onClick={onClick}>{label}</Button>
    {menu && <Button small primary={primary} className="studio-split-caret" disabled={disabled} aria-label={menuLabel} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)}>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </Button>}
    {menu && open && <span id={menuId} role="menu" className="studio-split-menu">
      {actions.map(action => <button key={action.label} type="button" role="menuitem" disabled={action.disabled} onClick={() => { setOpen(false); action.onSelect(); }}>{action.label}</button>)}
    </span>}
  </span>;
}

/** Square icon-only button; the label is its accessible name and tooltip.
 * @param props Localized label, tone, disabled and busy states, click handler, and the icon.
 * @returns Compact button for footers and rows.
 */
export function IconButton({ label, tone = 'info', disabled = false, busy = false, onClick, children }: React.PropsWithChildren<{
  label: string; tone?: 'info' | 'success' | 'error'; disabled?: boolean; busy?: boolean; onClick: () => void;
}>) {
  return <button type="button" className="studio-icon-button" data-tone={tone} title={label} aria-label={label} aria-busy={busy || undefined} disabled={disabled} onClick={onClick}>{children}</button>;
}

/** Native modal dialog for editing one item without growing the page layout.
 * The element stays inside the Studio surface, so scoped styles apply in the top layer.
 * @param props Open state, title, optional subtitle, close callback with optional header close label, body, and footer actions.
 * @returns Dialog that restores focus to its opener when it closes.
 */
export function DetailDialog({ open, title, subtitle, onClose, closeLabel, footer, wide = false, compact = false, children }: React.PropsWithChildren<{
  open: boolean; wide?: boolean; compact?: boolean; title: React.ReactNode; subtitle?: React.ReactNode; onClose: () => void; closeLabel?: string; footer?: React.ReactNode;
}>) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) {
      opener.current = document.activeElement as HTMLElement | null;
      if (typeof node.showModal === 'function') node.showModal(); else node.setAttribute('open', '');
    } else if (!open && node.open) {
      if (typeof node.close === 'function') node.close(); else node.removeAttribute('open');
      opener.current?.focus?.();
    }
  }, [open]);
  return <dialog ref={ref} className={`studio-detail-dialog ${wide ? 'studio-dialog-wide' : compact ? 'studio-dialog-compact' : ''}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="studio-dialog">
      <header><div><h2 id={titleId}>{title}</h2>{subtitle && <p className="studio-muted">{subtitle}</p>}</div>{closeLabel && <Button small onClick={onClose}>{closeLabel}</Button>}</header>
      <div className="studio-dialog-body studio-selection-detail">{children}</div>
      {footer && <footer>{footer}</footer>}
    </div>
  </dialog>;
}

/** One choice in a picker list inside a dialog.
 * @param props Title row, description, optional radio selection state, and select callback.
 * @returns Picker option button.
 */
export function PickOption({ title, description, checked, onClick }: { title: React.ReactNode; description: React.ReactNode; checked?: boolean; onClick: () => void }) {
  return <button type="button" className="studio-pick" {...(checked === undefined ? {} : { role: 'radio', 'aria-checked': checked })} onClick={onClick}>
    <span className="studio-pick-title">{title}</span>
    <span className="studio-muted">{description}</span>
  </button>;
}
