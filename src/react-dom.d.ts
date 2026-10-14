/** Minimal typing for the host-shared react-dom module; Studio does not depend on @types/react-dom. */
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal;
}
