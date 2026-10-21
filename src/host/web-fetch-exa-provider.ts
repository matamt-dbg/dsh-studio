/**
 * `ExaContentsFetchProvider`: a `WebFetchProvider` backed by Exa `POST /contents` (#39). Exa crawls
 * the page and returns extracted text, so the body is always `text`. A crawl that reports the target
 * page's HTTP status resolves as a result with that status (a non-2xx page is not a fetch failure);
 * a crawl failure without one throws `WEB_PROVIDER_ERROR`. The credential-bearing request refuses
 * redirects.
 */
import { WebError } from '@deepseek-ai/dsh-web';
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web';

/** Stable id this provider registers under; distinct from the Exa search provider `exa`. */
export const EXA_CONTENTS_PROVIDER_ID = 'exa-contents';
export const EXA_DEFAULT_BASE_URL = 'https://api.exa.ai';
export const EXA_CONTENTS_DEFAULT_MAX_CHARACTERS = 100_000;
export const EXA_CONTENTS_DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT = 'dsh-web-fetch-exa';

export interface ExaContentsOptions {
  /** Exa API key. Empty makes the provider unavailable. */
  apiKey: string;
  /** Endpoint base; `/contents` is appended. */
  baseURL: string;
  /** Result character cap. One more character is requested so a cut at the cap is visible as `truncated`. */
  maxCharacters: number;
  /** Whole-request deadline in milliseconds (`WEB_FETCH_TIMEOUT`). */
  timeoutMs: number;
  /** Exa `maxAgeHours` (-1..720). Omitted = Exa default (cache, else live). */
  maxAgeHours?: number;
  /** Exa `livecrawlTimeout` in milliseconds (1..90000). */
  livecrawlTimeoutMs?: number;
}

interface ExaContentsResult { url?: string; text?: string | null }
interface ExaContentsStatus { id?: string; status?: string; error?: { tag?: string; httpStatusCode?: number | null } | null }
interface ExaContentsResponse { results?: ExaContentsResult[]; statuses?: ExaContentsStatus[] }
interface ExaErrorBody { error?: string; message?: string; tag?: string }

const isPositiveInteger = (value: number) => Number.isInteger(value) && value > 0;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Upstream text may echo the request; never let the key reach a surfaced message. Long details are cut. */
function redact(text: string, apiKey: string): string {
  const safe = apiKey ? text.split(apiKey).join('[redacted]') : text;
  return safe.length > 300 ? `${safe.slice(0, 300)}…` : safe;
}
const isAbortError = (error: unknown) => error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError');

/** Accept only absolute http(s) URLs; Exa reports other schemes as `UNSUPPORTED_URL` after billing a request. */
function targetUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch (cause) { throw new WebError(`invalid URL "${input}"`, 'WEB_INVALID_URL', { cause }); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new WebError(`unsupported URL scheme "${url.protocol}"`, 'WEB_INVALID_URL');
  if (url.username || url.password) throw new WebError('URLs with credentials are not fetched', 'WEB_INVALID_URL');
  return url.toString();
}

/**
 * Map one `/contents` response for `requested` to a fetch result.
 * @param response - the parsed 200 response body.
 * @param requested - the URL sent to Exa (fallback when Exa omits the final URL).
 * @param maxCharacters - result-side character cap.
 */
export function mapContentsResponse(response: unknown, requested: string, maxCharacters: number): WebFetchResult {
  if (!isObject(response) || (response.results !== undefined && !Array.isArray(response.results)) || (response.statuses !== undefined && !Array.isArray(response.statuses))) {
    throw new WebError('Exa returned an unexpected response shape', 'WEB_PROVIDER_ERROR');
  }
  const envelope = response as ExaContentsResponse;
  const rawStatus: unknown = envelope.statuses?.[0];
  const status = isObject(rawStatus) ? rawStatus as ExaContentsStatus : undefined;
  if (status?.status === 'error') {
    const code = status.error?.httpStatusCode;
    const tag = typeof status.error?.tag === 'string' && /^[A-Z0-9_]{1,64}$/.test(status.error.tag) ? status.error.tag : 'unknown';
    if (typeof code === 'number' && Number.isInteger(code) && code >= 100 && code <= 599) {
      return { url: requested, statusCode: code, body: { kind: 'text', content: '' }, truncated: false };
    }
    throw new WebError(`Exa could not fetch the page (${tag})`, 'WEB_PROVIDER_ERROR');
  }
  const rawResult: unknown = envelope.results?.[0];
  const result = isObject(rawResult) ? rawResult as ExaContentsResult : undefined;
  if (!result) throw new WebError('Exa returned no content for the page', 'WEB_PROVIDER_ERROR');
  const text = typeof result.text === 'string' ? result.text : '';
  const truncated = text.length > maxCharacters;
  return {
    url: typeof result.url === 'string' && result.url ? result.url : requested,
    statusCode: 200,
    body: { kind: 'text', content: truncated ? text.slice(0, maxCharacters) : text },
    truncated,
  };
}

export class ExaContentsFetchProvider implements WebFetchProvider {
  readonly id = EXA_CONTENTS_PROVIDER_ID;

  constructor(private readonly options: ExaContentsOptions) {}

  available(): boolean {
    const { apiKey, baseURL, maxCharacters, timeoutMs, maxAgeHours, livecrawlTimeoutMs } = this.options;
    return apiKey.length > 0 && URL.canParse(baseURL) && isPositiveInteger(maxCharacters) && isPositiveInteger(timeoutMs)
      && (maxAgeHours === undefined || (Number.isInteger(maxAgeHours) && maxAgeHours >= -1 && maxAgeHours <= 720))
      && (livecrawlTimeoutMs === undefined || (isPositiveInteger(livecrawlTimeoutMs) && livecrawlTimeoutMs <= 90_000));
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED');
    const url = targetUrl(request.url);
    const { apiKey, baseURL, maxCharacters, timeoutMs, maxAgeHours, livecrawlTimeoutMs } = this.options;
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const failure = (error: unknown, what: string): WebError => {
      if (signal?.aborted) return new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error });
      if (timeout.aborted) return new WebError('web fetch timed out', 'WEB_FETCH_TIMEOUT', { cause: error });
      if (isAbortError(error)) return new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error });
      return new WebError(`${what}: ${redact(String(error), apiKey)}`, 'WEB_PROVIDER_ERROR');
    };

    let response: Response;
    try {
      response = await fetch(`${baseURL.replace(/\/+$/, '')}/contents`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'x-api-key': apiKey, 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({
          urls: [url],
          // Exa cuts at exactly maxCharacters without saying so; the extra character reveals truncation.
          text: { maxCharacters: maxCharacters + 1 },
          ...maxAgeHours !== undefined ? { maxAgeHours } : {},
          ...livecrawlTimeoutMs !== undefined ? { livecrawlTimeout: livecrawlTimeoutMs } : {},
        }),
        signal: combined,
      });
    } catch (error) { throw failure(error, 'Exa contents request failed'); }

    if (!response.ok) {
      let message = `Exa API error (HTTP ${response.status})`;
      try {
        const body = await response.json() as ExaErrorBody | null;
        const tag = typeof body?.tag === 'string' ? body.tag : undefined;
        const detail = typeof body?.error === 'string' ? body.error : typeof body?.message === 'string' ? body.message : undefined;
        if (detail || tag) message = redact(`Exa API error (HTTP ${response.status}${tag ? `, ${tag}` : ''})${detail ? `: ${detail}` : ''}`, apiKey);
      } catch (error) {
        if (combined.aborted) throw failure(error, 'Exa contents request failed');
        // A non-JSON error body (gateway 5xx/429) only costs the detail; the status is kept.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR');
    }

    let payload: unknown;
    try { payload = await response.json(); } catch (error) { throw failure(error, 'Exa returned an unprocessable response body'); }
    return mapContentsResponse(payload, url, maxCharacters);
  }
}
