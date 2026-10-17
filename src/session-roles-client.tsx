/** Client half of session roles: Remote descriptors and the Subagents conversation view. */
import type { StudioContext } from './contracts.js';
import { PACKAGE_NAME } from './package-name.ts';
import { StudioSurface } from './ui.tsx';
import { followPixieStream } from './pixie-client.tsx';
import { SessionRolesTab, type SessionRolesActions } from './session-roles-tab.tsx';
import { sessionRolesText } from './session-roles-locale.ts';
import type { SessionRolesView } from './session-roles.ts';

const NAMESPACE = 'studioSessionRoles';
const VIEW_ID = 'studio-subagents';
/** After Chat (0) and Trajectory (10). */
const VIEW_ORDER = 20;

const stringCodec = { mode: 'strict', typeSymbol: 'string', create: () => ({ parse: (value: unknown) => { if (typeof value !== 'string') throw new TypeError('Expected a string'); return value; } }) } as const;
const parameter = (name: string) => ({ name, wire: name, source: 'json', codec: stringCodec });
const descriptor = (method: string, parameters: string[], extra: Record<string, unknown> = {}) => ({
  id: `${PACKAGE_NAME}#${NAMESPACE}/${method}`, service: NAMESPACE, namespace: NAMESPACE, method,
  invocation: { kind: 'direct' }, parameters: parameters.map(parameter), result: { mode: 'src-json' }, ...extra,
});

/** Session role Remote descriptors. The shell mounts them with its own contribution (one per package). */
export function sessionRoleDescriptors() {
  return [
    descriptor('view', ['sessionId']),
    descriptor('editRole', ['sessionId', 'payload']),
    descriptor('addRole', ['sessionId', 'payload']),
    descriptor('removeRole', ['sessionId', 'roleId']),
    descriptor('follow', ['sessionId'], { mode: 'stream', cancellation: { parameter: 'signal' } }),
  ];
}

type RemoteValue<T> = Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>;
interface SessionRolesRemote {
  view(sessionId: string): RemoteValue<SessionRolesView>;
  editRole(sessionId: string, payload: string): RemoteValue<SessionRolesView>;
  addRole(sessionId: string, payload: string): RemoteValue<SessionRolesView>;
  removeRole(sessionId: string, roleId: string): RemoteValue<SessionRolesView>;
  follow(sessionId: string): AsyncIterable<{ type: 'sync' }> & { dispose(): void };
}
async function unwrap<T>(call: RemoteValue<T>): Promise<T> {
  const result = await call;
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Register the Subagents view beside Chat in every session. Call after the shell mounted {@link sessionRoleDescriptors}. */
export function mountSessionRoles(ctx: StudioContext): void {
  const remote = () => {
    const service = ctx.get(`remote.${NAMESPACE}` as never) as unknown as SessionRolesRemote | undefined;
    if (!service) throw new Error('Session roles API unavailable');
    return service;
  };
  const locale = () => ctx.locale.getLocale().active;
  const models = async () => {
    const catalog = ctx.get('remote.studioCatalog' as never) as unknown as { roleModels(): RemoteValue<import('./role-editor.tsx').RoleModelCatalog> };
    return unwrap(catalog.roleModels());
  };
  const actionsFor = (sessionId: string): SessionRolesActions => ({
    view: () => unwrap(remote().view(sessionId)),
    follow: listener => followPixieStream(() => remote().follow(sessionId), () => listener()),
    edit: (role, patch) => unwrap(remote().editRole(sessionId, JSON.stringify({ ...patch, role }))),
    add: input => unwrap(remote().addRole(sessionId, JSON.stringify(input))),
    remove: role => unwrap(remote().removeRole(sessionId, role)),
    models,
  });
  // One stable source: the renderer binds it to `useStudioLocale` (hook binding is cached per source).
  const localeSource = { getSnapshot: locale, subscribe: (listener: () => void) => ctx.locale.subscribe(listener) };
  /** Props the renderer derives from the inject face below. */
  interface SubagentsProps { sessionRoles: SessionRolesActions; useStudioLocale: <T>(select: (value: string) => T) => T }
  function SubagentsView({ sessionRoles, useStudioLocale }: SubagentsProps) {
    const active = useStudioLocale(value => value);
    return <StudioSurface className="studio-session-roles-view"><SessionRolesTab actions={sessionRoles} locale={active} /></StudioSurface>;
  }
  ctx.slots.inject('conversation.view' as never, () => ctx.slots.register({
    name: 'conversation.view', id: VIEW_ID, order: VIEW_ORDER,
    label: () => sessionRolesText(locale(), 'tab'),
    inject: (sessionId: string) => ({ sessionRoles: actionsFor(sessionId), hooks: { studioLocale: localeSource } }),
  } as never, SubagentsView as never));
}
