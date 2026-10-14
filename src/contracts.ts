import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
export type StudioContext = Context;
export interface IconProps { size?: number; active?: boolean }
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'local.dsh-studio.services': { kind: 'list'; owner: { active: boolean } };
  }
}
