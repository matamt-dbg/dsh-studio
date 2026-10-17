/** Read-only subscription usage. Never forwards arbitrary definition URLs or response error bodies. */
import type { ProviderDefinition, ProviderUsage, UsageWindow } from '../provider-contract.ts';
import { attributionHeaders } from '@deepseek-ai/dsh-llm';
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function parseChatgptUsage(value: unknown, checkedAt = Date.now()): ProviderUsage {
  const raw = object(value); const rate = object(raw.rate_limit); const windows: UsageWindow[] = [];
  for (const [key, id] of [['primary_window', 'primary'], ['secondary_window', 'secondary']] as const) {
    const row = object(rate[key]);
    if (typeof row.used_percent !== 'number' || !Number.isFinite(row.used_percent) || row.used_percent < 0 || row.used_percent > 100) continue;
    windows.push({ id, usedPercent: row.used_percent, ...(typeof row.reset_at === 'number' && Number.isFinite(row.reset_at) && row.reset_at > 0 ? { resetAt: row.reset_at * 1000 } : {}) });
  }
  if (!windows.length) return { status: 'unavailable', checkedAt };
  return { status: 'ready', checkedAt, windows, ...(typeof raw.plan_type === 'string' ? { plan: raw.plan_type.slice(0, 80) } : {}) };
}
export async function fetchProviderUsage(definition: ProviderDefinition, headers: (signal: AbortSignal) => Promise<Record<string, string>>, fetchImpl: typeof fetch = fetch): Promise<ProviderUsage> {
  if (definition.protocol !== 'openai-responses' || definition.baseURL !== 'https://chatgpt.com/backend-api/codex' || definition.credential.kind !== 'oauth') return { status: 'unsupported', checkedAt: Date.now() };
  try {
    const signal = AbortSignal.timeout(15000);
    const response = await fetchImpl('https://chatgpt.com/backend-api/wham/usage', { headers: { ...await headers(signal), ...attributionHeaders(), accept: 'application/json' }, signal, redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); return { status: 'unavailable', checkedAt: Date.now() }; }
    return parseChatgptUsage(await response.json());
  } catch { return { status: 'unavailable', checkedAt: Date.now() }; }
}
