import React from 'react';
import { Button, DetailDialog } from './ui.tsx';

/** One pickable row. `name` is the stable key; `title` and `subtitle` only change what is shown. */
export interface PickerItem { name: string; description: string; title?: string; subtitle?: string; searchText?: string; disabledReason?: string;
  /** Shown on and cannot be turned off; `lockedReason` explains why (for example, inherited from a default). */
  lockedReason?: string }

export type Filter = 'all' | 'selected' | 'modified';

/** Single list with in-place selection: a row never moves when it is added or removed.
 * Search and the all/selected/modified filter narrow the same list; item settings open in a dialog.
 */
export function ItemPicker({ label, items, selected, onChange, labels, renderDetails, isModified, hasDetails, filters = ['all', 'selected', 'modified'], badge }: {
  label: string;
  items: PickerItem[];
  selected: string[];
  onChange: (names: string[]) => void;
  labels: { search: string; searchHint: string; filter: string; all: string; selected: string; modified: string; settings: string; done: string; empty: string; noResults: string; modifiedTag: string; clear: string };
  renderDetails?: (name: string) => React.ReactNode;
  isModified?: (name: string) => boolean;
  hasDetails?: (name: string) => boolean;
  /** Filter tabs to offer; `all` should stay first. */
  filters?: readonly Filter[];
  /** Extra state tag after the title (e.g. Defaults/Override/Excluded). */
  badge?: (name: string) => React.ReactNode;
}) {
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [detail, setDetail] = React.useState<string>();
  const chosen = new Set(selected);
  const isOn = (item: PickerItem) => item.lockedReason !== undefined || chosen.has(item.name);
  const modified = (name: string) => chosen.has(name) && (isModified?.(name) ?? false);
  const text = query.trim().toLowerCase();
  const visible = items.filter(item => (filter === 'all' || (filter === 'selected' ? isOn(item) : modified(item.name)))
    && (!text || `${item.name}\n${item.title ?? ''}\n${item.description}\n${item.searchText ?? ''}`.toLowerCase().includes(text)));
  const counts: Record<Filter, number> = { all: items.length, selected: items.filter(isOn).length, modified: items.filter(item => modified(item.name)).length };
  const toggle = (name: string) => onChange(chosen.has(name) ? selected.filter(value => value !== name) : [...selected, name]);
  const open = items.find(item => item.name === detail && chosen.has(item.name));
  return <div className="studio-picker">
    <div className="studio-picker-bar">
      <input type="search" aria-label={labels.search} placeholder={labels.searchHint} value={query} onChange={event => setQuery(event.target.value)} />
      <div className="studio-picker-filters" role="radiogroup" aria-label={labels.filter}>
        {filters.map(value => <button key={value} type="button" role="radio" aria-checked={filter === value} className="studio-picker-filter" onClick={() => setFilter(value)}>
          {labels[value]}<span className="studio-count">{counts[value]}</span>
        </button>)}
      </div>
    </div>
    <ul className="studio-picker-list" aria-label={label}>
      {visible.map(item => {
        const locked = item.lockedReason !== undefined;
        const on = locked || chosen.has(item.name);
        const blocked = locked || (!on && item.disabledReason !== undefined);
        const details = on && renderDetails !== undefined && (hasDetails?.(item.name) ?? true);
        return <li key={item.name} className="studio-picker-row" data-selected={on}>
          <button type="button" role="switch" aria-checked={on} disabled={blocked} className="studio-picker-toggle" aria-label={`${item.title ?? item.name}`} onClick={() => toggle(item.name)}>
            <span className="studio-picker-check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            <span className="studio-picker-text">
              <span className="studio-picker-title">{item.title ?? item.name}{item.subtitle && <span className="studio-picker-subtitle studio-mono">{item.subtitle}</span>}</span>
              {(locked ? item.lockedReason : item.disabledReason && !on ? item.disabledReason : item.description) && <span className="studio-picker-description">{locked ? item.lockedReason : item.disabledReason && !on ? item.disabledReason : item.description}</span>}
            </span>
          </button>
          {badge?.(item.name)}
          {modified(item.name) && <span className="studio-badge" data-tone="info" data-studio-modified="true">{labels.modifiedTag}</span>}
          {details && <Button small aria-label={`${labels.settings}: ${item.name}`} aria-haspopup="dialog" onClick={() => setDetail(item.name)}>{labels.settings}</Button>}
        </li>;
      })}
      {!visible.length && <li className="studio-picker-empty" role="status">{text ? labels.noResults : labels.empty}{(text || filter !== 'all') && <Button small onClick={() => { setQuery(''); setFilter('all'); }}>{labels.clear}</Button>}</li>}
    </ul>
    {renderDetails && <DetailDialog open={open !== undefined} title={open?.title ?? open?.name} subtitle={open?.subtitle} closeLabel={labels.done} onClose={() => setDetail(undefined)}>
      {open && renderDetails(open.name)}
    </DetailDialog>}
  </div>;
}
