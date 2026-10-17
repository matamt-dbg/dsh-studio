/** SettingsX provider definition contract: one JSON file per provider route, validated before registration.
 * Pure and Node-testable; shared by the Host adapter, the Client page, and the authoring skill.
 * Definitions hold no secrets: keys live in DSH credentials, OAuth tokens in a DSH credential record, and command
 * output only in memory. The definition declares how to obtain them.
 * Requests carry text only: DSH replaces image attachments with text handles before the adapter sees them.
 */

/** Wire protocols a definition may name. */
export const PROVIDER_PROTOCOLS = ['openai-responses', 'openai-chat', 'anthropic-messages'] as const;
export type ProviderProtocol = typeof PROVIDER_PROTOCOLS[number];
/** Credential supply kinds. */
export type CredentialKind = typeof CREDENTIAL_KINDS_ALL[number];
export const CREDENTIAL_KINDS_ALL = ['none', 'credential', 'command', 'oauth'] as const;
/** Version of the definition file format. */
export const PROVIDER_DEFINITION_VERSION = 1;

export interface ProviderModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
}
export interface ProviderDefinition {
  version: 1;
  /** Route key shown in DSH model selection; lowercase letters, digits, and hyphens. */
  id: string;
  name: string;
  protocol: ProviderProtocol;
  /** Base URL; the protocol appends its path (`/responses` or `/chat/completions`). */
  baseURL: string;
  headers?: Record<string, string>;
  models: ProviderModel[];
  credential: ProviderCredential;
}

/** How a request authenticates. Every kind except `none` adds `Authorization: Bearer <token>` unless `header` says otherwise. */
export type ProviderCredential =
  | { kind: 'none' }
  /** A DSH credential reference (environment-variable name), resolved on every request. */
  | { kind: 'credential'; ref: string; header?: string; scheme?: string }
  /** A program run without a shell; stdout is `{ "token": string, "expiresAt"?: epoch ms, "headers"?: {...} }`. */
  | { kind: 'command'; command: string[]; timeoutMs?: number; header?: string; scheme?: string }
  /** OAuth 2.0 authorization code with PKCE and a loopback redirect; tokens stay in a DSH credential record. */
  | { kind: 'oauth'; authorizeURL: string; tokenURL: string; clientId: string; scopes?: string[]; redirectPort: number; redirectPath?: string;
      tokenFormat?: 'form' | 'json'; authorizeParams?: Record<string, string>; claimHeaders?: Record<string, string[]>; header?: string; scheme?: string };


/** One rejection reason with a stable code and the offending field path. */
export interface ProviderIssue { code: ProviderIssueCode; path: string; detail?: string }
export type ProviderIssueCode =
  | 'json' | 'shape' | 'unknown-field' | 'required' | 'version' | 'id' | 'protocol' | 'url' | 'header'
  | 'models-empty' | 'model-duplicate' | 'number' | 'credential-kind' | 'credential-field';
export type ProviderParse = { ok: true; definition: ProviderDefinition } | { ok: false; issues: ProviderIssue[] };

const ROUTE_ID = /^[a-z][a-z0-9-]{0,62}$/;
/** Header names DSH or the protocol owns; a definition cannot override them. */
const RESERVED_HEADERS = new Set(['user-agent', 'content-type', 'content-length', 'accept', 'host', 'authorization']);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Validate one definition. Every problem is reported, not only the first.
 * @param input Parsed JSON or the raw file text.
 * @returns the normalized definition, or all issues found.
 */
export function parseProviderDefinition(input: unknown): ProviderParse {
  let value = input;
  if (typeof input === 'string') {
    try { value = JSON.parse(input); } catch (error) { return { ok: false, issues: [{ code: 'json', path: '', detail: error instanceof Error ? error.message : String(error) }] }; }
  }
  const issues: ProviderIssue[] = [];
  const issue = (code: ProviderIssueCode, path: string, detail?: string) => { issues.push(detail === undefined ? { code, path } : { code, path, detail }); };
  if (!record(value)) return { ok: false, issues: [{ code: 'shape', path: '' }] };
  const known = new Set(['$schema', 'version', 'id', 'name', 'protocol', 'baseURL', 'headers', 'models', 'credential']);
  for (const key of Object.keys(value)) if (!known.has(key)) issue('unknown-field', key);
  if (value.version !== PROVIDER_DEFINITION_VERSION) issue('version', 'version');
  if (!text(value.id)) issue('required', 'id'); else if (!ROUTE_ID.test(value.id)) issue('id', 'id');
  if (!text(value.name)) issue('required', 'name');
  if (!PROVIDER_PROTOCOLS.includes(value.protocol as ProviderProtocol)) issue('protocol', 'protocol');
  if (!text(value.baseURL)) issue('required', 'baseURL');
  else {
    let url: URL | undefined;
    try { url = new URL(value.baseURL); } catch { /* reported below */ }
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) issue('url', 'baseURL');
  }
  const headers: Record<string, string> = {};
  if (value.headers !== undefined) {
    if (!record(value.headers)) issue('shape', 'headers');
    else for (const [name, header] of Object.entries(value.headers)) {
      if (!HEADER_NAME.test(name) || RESERVED_HEADERS.has(name.toLowerCase()) || typeof header !== 'string' || /[\r\n\0]/.test(header)) issue('header', `headers.${name}`);
      else headers[name] = header;
    }
  }
  const models: ProviderModel[] = [];
  if (!Array.isArray(value.models)) issue('required', 'models');
  else if (value.models.length === 0) issue('models-empty', 'models');
  else {
    const seen = new Set<string>();
    value.models.forEach((raw, index) => {
      const path = `models[${index}]`;
      if (!record(raw)) { issue('shape', path); return; }
      for (const key of Object.keys(raw)) if (!['id', 'name', 'contextWindow', 'maxTokens'].includes(key)) issue('unknown-field', `${path}.${key}`);
      if (!text(raw.id)) { issue('required', `${path}.id`); return; }
      if (seen.has(raw.id)) issue('model-duplicate', `${path}.id`);
      seen.add(raw.id);
      const model: ProviderModel = { id: raw.id };
      if (raw.name !== undefined) { if (text(raw.name)) model.name = raw.name; else issue('required', `${path}.name`); }
      for (const key of ['contextWindow', 'maxTokens'] as const) {
        if (raw[key] === undefined) continue;
        if (Number.isSafeInteger(raw[key]) && (raw[key] as number) > 0) model[key] = raw[key] as number; else issue('number', `${path}.${key}`);
      }
      models.push(model);
    });
  }
  const credential = parseCredential(value.credential, issue);
  if (issues.length) return { ok: false, issues };
  const raw = value as Record<string, string>;
  return { ok: true, definition: {
    version: 1, id: raw.id!, name: raw.name!.trim(), protocol: raw.protocol as ProviderProtocol, baseURL: raw.baseURL!.replace(/\/+$/, ''),
    ...(Object.keys(headers).length ? { headers } : {}), models, credential: credential!,
  } };
}

const ENV_REF = /^[A-Za-z_][A-Za-z0-9_]*$/;
const httpsOrLoopback = (raw: unknown) => {
  if (!text(raw)) return false;
  try { const url = new URL(raw); return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)); } catch { return false; }
};

/** Validate the `credential` object; reports issues and returns the normalized value when valid. */
function parseCredential(raw: unknown, issue: (code: ProviderIssueCode, path: string, detail?: string) => void): ProviderCredential | undefined {
  if (!record(raw) || !CREDENTIAL_KINDS_ALL.includes(raw.kind as CredentialKind)) { issue('credential-kind', 'credential.kind'); return undefined; }
  const allowed: Record<CredentialKind, string[]> = {
    none: [], credential: ['ref', 'header', 'scheme'], command: ['command', 'timeoutMs', 'header', 'scheme'],
    oauth: ['authorizeURL', 'tokenURL', 'clientId', 'scopes', 'redirectPort', 'redirectPath', 'authorizeParams', 'claimHeaders', 'header', 'scheme', 'tokenFormat'],
  };
  const kind = raw.kind as CredentialKind;
  const before = { count: 0 };
  const report = (code: ProviderIssueCode, path: string) => { before.count++; issue(code, path); };
  for (const key of Object.keys(raw)) if (key !== 'kind' && !allowed[kind].includes(key)) report('unknown-field', `credential.${key}`);
  if (raw.header !== undefined && (!text(raw.header) || !HEADER_NAME.test(raw.header) || ['content-type', 'content-length', 'host', 'user-agent', 'accept'].includes(raw.header.toLowerCase()))) report('credential-field', 'credential.header');
  if (raw.scheme !== undefined && (typeof raw.scheme !== 'string' || /[\r\n\0]/.test(raw.scheme))) report('credential-field', 'credential.scheme');
  const auth = { ...(raw.header === undefined ? {} : { header: raw.header as string }), ...(raw.scheme === undefined ? {} : { scheme: raw.scheme as string }) };
  if (kind === 'none') return before.count ? undefined : { kind };
  if (kind === 'credential') {
    if (!text(raw.ref) || !ENV_REF.test(raw.ref)) report('credential-field', 'credential.ref');
    return before.count ? undefined : { kind, ref: raw.ref as string, ...auth };
  }
  if (kind === 'command') {
    if (!Array.isArray(raw.command) || raw.command.length === 0 || !raw.command.every(text)) report('credential-field', 'credential.command');
    if (raw.timeoutMs !== undefined && (!Number.isSafeInteger(raw.timeoutMs) || (raw.timeoutMs as number) < 100 || (raw.timeoutMs as number) > 120_000)) report('number', 'credential.timeoutMs');
    return before.count ? undefined : { kind, command: [...raw.command as string[]], ...(raw.timeoutMs === undefined ? {} : { timeoutMs: raw.timeoutMs as number }), ...auth };
  }
  for (const key of ['authorizeURL', 'tokenURL'] as const) if (!httpsOrLoopback(raw[key])) report('url', `credential.${key}`);
  if (!text(raw.clientId)) report('required', 'credential.clientId');
  if (raw.scopes !== undefined && (!Array.isArray(raw.scopes) || !raw.scopes.every(text))) report('credential-field', 'credential.scopes');
  if (!Number.isSafeInteger(raw.redirectPort) || (raw.redirectPort !== 0 && (raw.redirectPort as number) < 1024) || (raw.redirectPort as number) > 65535) report('number', 'credential.redirectPort');
  if (raw.redirectPath !== undefined && (typeof raw.redirectPath !== 'string' || !/^\/[A-Za-z0-9/_.-]*$/.test(raw.redirectPath))) report('credential-field', 'credential.redirectPath');
  const reserved = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method'];
  if (raw.authorizeParams !== undefined && (!record(raw.authorizeParams) || Object.entries(raw.authorizeParams).some(([key, param]) => reserved.includes(key) || typeof param !== 'string'))) report('credential-field', 'credential.authorizeParams');
  if (raw.claimHeaders !== undefined && (!record(raw.claimHeaders) || Object.entries(raw.claimHeaders).some(([name, path]) => !HEADER_NAME.test(name) || RESERVED_HEADERS.has(name.toLowerCase()) || !Array.isArray(path) || path.length === 0 || !path.every(text)))) report('credential-field', 'credential.claimHeaders');
  if (raw.tokenFormat !== undefined && raw.tokenFormat !== 'form' && raw.tokenFormat !== 'json') report('credential-field', 'credential.tokenFormat');
  if (before.count) return undefined;
  return { ...(raw.tokenFormat === undefined ? {} : { tokenFormat: raw.tokenFormat as 'form' | 'json' }), kind, authorizeURL: raw.authorizeURL as string, tokenURL: raw.tokenURL as string, clientId: raw.clientId as string, redirectPort: raw.redirectPort as number,
    ...(raw.scopes === undefined ? {} : { scopes: [...raw.scopes as string[]] }), ...(raw.redirectPath === undefined ? {} : { redirectPath: raw.redirectPath as string }),
    ...(raw.authorizeParams === undefined ? {} : { authorizeParams: { ...raw.authorizeParams as Record<string, string> } }),
    ...(raw.claimHeaders === undefined ? {} : { claimHeaders: structuredClone(raw.claimHeaders) as Record<string, string[]> }), ...auth };
}

/** Endpoint the protocol sends requests to. */
export function protocolEndpoint(definition: Pick<ProviderDefinition, 'protocol' | 'baseURL'>): string {
  return `${definition.baseURL}${definition.protocol === 'openai-responses' ? '/responses' : definition.protocol === 'anthropic-messages' ? '/messages' : '/chat/completions'}`;
}

/** What the Client sees about one definition file. */
export type ProviderEntry =
  | { file: string; status: 'registered'; definition: ProviderDefinition }
  | { file: string; status: 'invalid'; issues: ProviderIssue[] }
  | { file: string; status: 'conflict'; definition: ProviderDefinition; detail: string };
export interface ProviderAccount { id: string; label: string; email?: string; plan?: string; expiresAt?: number; isDefault: boolean }
export interface UsageWindow { id: string; usedPercent: number; resetAt?: number }
export type ProviderUsage = { status: 'ready'; checkedAt: number; plan?: string; windows: UsageWindow[] } | { status: 'unsupported' | 'unavailable'; checkedAt: number };
export interface ProviderList { directory: string; entries: ProviderEntry[]; auth: Record<string, ProviderAuthState>; accounts?: Record<string, ProviderAccount[]> }
/** What the page shows about a route's credential; never the value. */
export type ProviderAuthState =
  | { kind: 'none' }
  | { kind: 'credential'; configured: boolean; writable: boolean; source?: string }
  | { kind: 'command' }
  | { kind: 'oauth'; signedIn: boolean; expiresAt?: number; pending?: { url: string } };
