/** Shared two-column service layout: grouped left navigation and an independently scrolling detail column. */
import React from 'react';

/** Mounted page, its navigation label, and the optional group caption it starts under. */
export interface DetailPage { id: string; label: string; group?: string; content: React.ReactNode }

/** Render a service's left navigation and independently scrolling detail pages.
 * Every Studio service uses this frame so switching services keeps the same layout; the service tab already names it, so the menu has no title.
 * @param props Navigation label, controlled page selection, and an optional navigation footer.
 * @returns Navigation with retained inactive pages.
 */
export function DetailLayout({ navigation, pages, selected, onSelect, footer }: {
  navigation: string; pages: readonly DetailPage[]; footer?: React.ReactNode;
  selected: string; onSelect: (id: string) => void;
}) {
  const id = React.useId();
  const scroller = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [selected]);
  return <div className="studio-layout">
    <nav className="studio-nav" aria-label={navigation}>
      {pages.map((page, index) => <React.Fragment key={page.id}>
        {page.group && page.group !== pages[index - 1]?.group && <span className="studio-nav-group">{page.group}</span>}
        <button type="button" className="studio-nav-item"
          aria-current={selected === page.id ? 'page' : undefined} aria-controls={`${id}-${page.id}`}
          onClick={() => onSelect(page.id)}>{page.label}</button>
      </React.Fragment>)}
      {footer}
    </nav>
    <div className="studio-scroller" ref={scroller} data-studio-scroller="">
      <div className="studio-content">
        {pages.map(page => <section key={page.id} id={`${id}-${page.id}`} aria-label={page.label}
          hidden={selected !== page.id}>{page.content}</section>)}
      </div>
    </div>
  </div>;
}
