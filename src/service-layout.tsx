/** Studio service navigation; registered pages remain mounted across selection changes. */
import React from 'react';
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from './contracts.ts';

/** Display metadata projected from the service Slot's active registrations. */
export interface StudioServiceItem { id: string; label: string }

const ko = { navigation: 'Studio 서비스', empty: '사용 가능한 서비스가 없습니다.' };
const en: typeof ko = { navigation: 'Studio services', empty: 'No services are available.' };
const zh: typeof ko = { navigation: 'Studio 服务', empty: '没有可用的服务' };

/** Select a registered service without discarding inactive page state.
 * @param props Localized navigation metadata and the corresponding Slot-rendered pages.
 * @returns Service navigation and mounted panels, or an empty state.
 */
export function ServiceLayout({ locale, services, renderSlot }: PropsRenderSlots<'local.dsh-studio.services'> & {
  locale: string; services: readonly StudioServiceItem[];
}) {
  const t = locale.startsWith('ko') ? ko : locale.startsWith('zh') ? zh : en;
  const [selection, setSelection] = React.useState<string | null>(null);
  const active = services.some(service => service.id === selection) ? selection : services[0]?.id;
  React.useEffect(() => {
    if (selection !== null && !services.some(service => service.id === selection)) setSelection(null);
  }, [selection, services]);
  const id = React.useId();
  return <div className="studio-services">
    {services.length > 1 && <nav className="studio-service-nav" aria-label={t.navigation}>
      {services.map(service => <button key={service.id} type="button" className="studio-nav-item"
        aria-current={service.id === active ? 'page' : undefined} aria-controls={`${id}-${service.id}`}
        onClick={() => setSelection(service.id)}>{service.label}</button>)}
    </nav>}
    {!services.length && <p role="status" className="studio-muted">{t.empty}</p>}
    {services.map(service => <section className="studio-service-panel" key={service.id}
      id={`${id}-${service.id}`} hidden={service.id !== active}>{renderSlot('local.dsh-studio.services', { active: service.id === active }, { only: service.id })}</section>)}
  </div>;
}
