/** Session-scoped ChatGPT priority control; no browser/global preference writes. */
import React from 'react';
import type { StudioContext } from './contracts.js';
import { PACKAGE_NAME } from './package-name.ts';
import { Button, StudioSurface } from './ui.tsx';

const copy = {
  en: { on: 'Fast: on', off: 'Fast: off', hint: 'ChatGPT fast mode for this session (priority service tier). Higher usage limits or costs may apply.', error: 'Could not load or save fast mode. Retry.', retry: 'Retry' },
  ko: { on: '빠른 모드: 켜짐', off: '빠른 모드: 꺼짐', hint: '이 세션의 ChatGPT 빠른 모드(priority 서비스 등급)입니다. 사용량 한도나 비용이 달라질 수 있습니다.', error: '빠른 모드를 불러오거나 저장하지 못했습니다. 다시 시도하세요.', retry: '다시 시도' },
  zh: { on: '快速模式：开', off: '快速模式：关', hint: '此会话的 ChatGPT 快速模式（priority 服务等级）。使用限额或费用可能有所不同。', error: '无法读取或保存快速模式，请重试。', retry: '重试' },
};
export interface SpeedActions { get(): Promise<boolean>; save(enabled: boolean): Promise<boolean> }

/** Only mount for supported selections. Server acknowledgement owns the displayed value. */
export function ChatGptSpeedControl({ actions, locale }: { actions: SpeedActions; locale: string }) {
  const text = copy[locale.startsWith('ko') ? 'ko' : locale.startsWith('zh') ? 'zh' : 'en'];
  const [enabled, setEnabled] = React.useState(false);
  const [pending, setPending] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const generation = React.useRef(0);
  React.useEffect(() => {
    const current = ++generation.current;
    setPending(true); setError(false);
    void actions.get().then(value => { if (generation.current === current) setEnabled(value); }, () => { if (generation.current === current) setError(true); }).finally(() => { if (generation.current === current) setPending(false); });
    return () => { generation.current++; };
  }, [actions, reload]);
  const toggle = async () => {
    const current = generation.current;
    setPending(true); setError(false);
    try { const value = await actions.save(!enabled); if (generation.current === current) setEnabled(value); }
    catch { if (generation.current === current) setError(true); }
    finally { if (generation.current === current) setPending(false); }
  };
  return <StudioSurface><Button small aria-pressed={enabled} disabled={pending || error} title={text.hint} onClick={() => { void toggle(); }}>{enabled ? text.on : text.off}</Button>{error && <Button small title={text.error} aria-label={text.error} onClick={() => setReload(value => value + 1)}>{text.retry}</Button>}</StudioSurface>;
}

const namespace = 'studioProviderSpeed';
const stringCodec = { mode: 'strict', typeSymbol: 'string', create: () => ({ parse: (value: unknown) => { if (typeof value !== 'string') throw new TypeError('Expected a string'); return value; } }) } as const;
export const settingsxSpeedDescriptors = () => ['get', 'save'].map(method => ({
  id: `${PACKAGE_NAME}#${namespace}/${method}`, service: namespace, namespace, method,
  invocation: { kind: 'direct' }, parameters: (method === 'get' ? ['sessionId'] : ['sessionId', 'payload']).map(name => ({ name, wire: name, source: 'json', codec: stringCodec })), result: { mode: 'src-json' },
}));
type RemoteValue = Promise<{ ok: true; value: boolean } | { ok: false; error: { message: string } }>;
interface SpeedRemote { get(sessionId: string): RemoteValue; save(sessionId: string, payload: string): RemoteValue }
async function unwrap(call: RemoteValue) { const result = await call; if (!result.ok) throw new Error(result.error.message); return result.value; }
interface ComposerProps {
  sessionId: string;
  useProjection(key: 'modelSelection'): { next?: { provider: string; model: string } | null; lastUsed?: { provider: string; model: string } | null } | undefined;
}
/** Public conversation.input.left is session-scoped and supplies useProjection/sessionId.
 * Use a fresh cell ID; never replace the built-in model or permission controls.
 */
export function mountSettingsXSpeed(ctx: StudioContext): void {
  function Composer({ sessionId, useProjection }: ComposerProps) {
    const projection = useProjection('modelSelection');
    const selection = projection?.next ?? projection?.lastUsed;
    const locale = React.useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getLocale().active);
    const actions = React.useMemo<SpeedActions>(() => {
      const remote = () => (ctx as unknown as { remote: { studioProviderSpeed: SpeedRemote } }).remote.studioProviderSpeed;
      return { get: () => unwrap(remote().get(sessionId)), save: enabled => unwrap(remote().save(sessionId, String(enabled))) };
    }, [sessionId]);
    if (selection?.provider !== 'studio-chatgpt' || selection.model !== 'gpt-5.5' || !sessionId) return null;
    return <ChatGptSpeedControl key={sessionId} actions={actions} locale={locale} />;
  }
  ctx.slots.inject('conversation.input.left' as never, () => ctx.slots.register({ name: 'conversation.input.left', id: `${PACKAGE_NAME}/chatgpt-speed`, order: 100 } as never, Composer as never));
}
