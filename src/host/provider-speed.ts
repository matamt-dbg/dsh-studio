/** ChatGPT fast mode is Studio-owned session state: DSH's public ModelSelection and
 * GenerateOptions do not expose arbitrary model options. Never rewrite frozen llm/stream
 * requests or smuggle this preference through reasoning effort/provider metadata.
 * A dedicated public storage domain survives restart without changing global defaults.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';

export interface SessionSpeedStore {
  get(sessionId: string): Promise<boolean>;
  set(sessionId: string, enabled: boolean): Promise<void>;
}
interface SpeedDomain {
  table(name: 'sessions'): { get(key: string): boolean | undefined; put(key: string, value: boolean): Promise<void> };
  close(): Promise<void>;
}
interface StorageDomainSlice {
  open(spec: { name: string; version: number; tables: { sessions: { valueSchema: ReturnType<typeof z.boolean> } } }): Promise<SpeedDomain>;
}

/** Exact allowlist, not model-prefix matching. Auxiliary session calls stay unchanged. */
export async function applyChatGptSpeed<T extends Record<string, unknown>>(
  body: T, options: Pick<GenerateOptions, 'provider' | 'model' | 'sessionId' | 'purpose'>,
  store?: Pick<SessionSpeedStore, 'get'>,
): Promise<T> {
  if (!store || options.provider !== 'studio-chatgpt' || options.model !== 'gpt-5.5' || !options.sessionId || options.purpose) return body;
  return await store.get(options.sessionId) ? { ...body, service_tier: 'priority' } : body;
}

function checkSessionId(sessionId: string): void {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 512) throw new TypeError('Invalid session ID');
}

/** Install with ctx.plugin(StudioProviderSpeed). The plugin owns and closes its domain. */
export class StudioProviderSpeed extends TypertRemoteService implements SessionSpeedStore {
  static inject = ['storageDomain'];
  private readonly domain: Promise<SpeedDomain>;
  constructor(ctx: Context) {
    super(ctx, 'studioProviderSpeed');
    const storage = ctx.get('storageDomain') as unknown as StorageDomainSlice;
    this.domain = storage.open({ name: 'studio-provider-speed', version: 1, tables: { sessions: { valueSchema: z.boolean() } } });
    // Opening can fail before the first Remote call; retain the rejection for callers.
    void this.domain.catch(() => undefined);
    ctx.effect(() => async () => { await (await this.domain.catch(() => undefined))?.close(); });
  }
  @Remote
  async get(sessionId: string): Promise<boolean> {
    checkSessionId(sessionId);
    return (await this.domain).table('sessions').get(sessionId) === true;
  }
  /** String payload keeps the manually registered Client descriptor strict and simple. */
  @Remote
  async save(sessionId: string, payload: string): Promise<boolean> {
    if (payload !== 'true' && payload !== 'false') throw new TypeError('Expected a boolean');
    const enabled = payload === 'true';
    await this.set(sessionId, enabled);
    return enabled;
  }
  async set(sessionId: string, enabled: boolean): Promise<void> {
    checkSessionId(sessionId);
    if (typeof enabled !== 'boolean') throw new TypeError('Expected a boolean');
    await (await this.domain).table('sessions').put(sessionId, enabled);
  }
}
