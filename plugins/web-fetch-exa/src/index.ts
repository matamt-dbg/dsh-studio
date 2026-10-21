/**
 * Exa `/contents` fetch provider plugin (#39). Registers `exa-contents` into the Host `ctx.web`
 * registry; select it with the web service's `fetchProvider: exa-contents`. Function-plugin export
 * shape (no default export).
 */
import type { Context } from '@deepseek-ai/cordis';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import z from '@deepseek-ai/schemastery';
import type {} from '@deepseek-ai/dsh-web';
import {
  EXA_CONTENTS_DEFAULT_MAX_CHARACTERS,
  EXA_CONTENTS_DEFAULT_TIMEOUT_MS,
  EXA_DEFAULT_BASE_URL,
  ExaContentsFetchProvider,
} from './provider.ts';

export { EXA_CONTENTS_PROVIDER_ID, ExaContentsFetchProvider, mapContentsResponse } from './provider.ts';

export const name = 'web-fetch-exa';
export const inject = ['web'];

export interface Config {
  /** Exa API key. Falls back to `$EXA_API_KEY`. */
  apiKey?: string;
  baseURL?: string;
  maxCharacters?: number;
  timeoutMs?: number;
  maxAgeHours?: number;
  livecrawlTimeoutMs?: number;
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret').description('Exa API key. Empty uses $EXA_API_KEY.'),
  baseURL: z.string().description(`Exa API base URL. Default ${EXA_DEFAULT_BASE_URL}.`),
  maxCharacters: z.number().step(1).min(1).description(`Maximum characters of page text. Default ${EXA_CONTENTS_DEFAULT_MAX_CHARACTERS}.`),
  timeoutMs: z.number().step(1).min(1).description(`Request timeout in milliseconds. Default ${EXA_CONTENTS_DEFAULT_TIMEOUT_MS}.`),
  maxAgeHours: z.number().step(1).min(-1).max(720).description('Maximum age of cached content in hours; 0 always crawls live, -1 always uses the cache. Empty uses the Exa default.'),
  livecrawlTimeoutMs: z.number().step(1).min(1).max(90000).description('Live crawl timeout in milliseconds. Empty uses the Exa default.'),
});

export function apply(ctx: Context, config: Config = {}): void {
  ctx.web.registerFetchProvider(new ExaContentsFetchProvider({
    apiKey: config.apiKey || (launchEnvironmentOf(ctx).get('EXA_API_KEY')?.value ?? ''),
    baseURL: config.baseURL || EXA_DEFAULT_BASE_URL,
    maxCharacters: config.maxCharacters ?? EXA_CONTENTS_DEFAULT_MAX_CHARACTERS,
    timeoutMs: config.timeoutMs ?? EXA_CONTENTS_DEFAULT_TIMEOUT_MS,
    ...config.maxAgeHours !== undefined ? { maxAgeHours: config.maxAgeHours } : {},
    ...config.livecrawlTimeoutMs !== undefined ? { livecrawlTimeoutMs: config.livecrawlTimeoutMs } : {},
  }));
}
