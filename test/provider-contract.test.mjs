/** SettingsX provider definitions: invalid files are rejected with every issue, valid ones normalize. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProviderDefinition, protocolEndpoint } from '../src/provider-contract.ts';

const valid = (patch = {}) => ({
  version: 1, id: 'local-llm', name: 'Local LLM', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:11434/v1/',
  models: [{ id: 'qwen3:8b', name: 'Qwen3 8B', contextWindow: 32768, maxTokens: 4096 }], credential: { kind: 'none' }, ...patch,
});
const codes = input => { const result = parseProviderDefinition(input); assert.equal(result.ok, false); return result.issues.map(issue => `${issue.code}@${issue.path}`); };

test('a valid definition normalizes the URL and keeps only declared fields', () => {
  const result = parseProviderDefinition(JSON.stringify(valid({ headers: { 'X-Team': 'studio' } })));
  assert.equal(result.ok, true);
  assert.equal(result.definition.baseURL, 'http://127.0.0.1:11434/v1');
  assert.deepEqual(result.definition.headers, { 'X-Team': 'studio' });
  assert.equal(protocolEndpoint(result.definition), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(protocolEndpoint({ ...result.definition, protocol: 'openai-responses' }), 'http://127.0.0.1:11434/v1/responses');
});

test('every problem in one file is reported, not only the first', () => {
  assert.deepEqual(codes({ version: 2, id: 'Bad Id', protocol: 'grpc', baseURL: 'ftp://x', models: [], credential: { kind: 'magic' }, extra: true }), [
    'unknown-field@extra', 'version@version', 'id@id', 'required@name', 'protocol@protocol', 'url@baseURL', 'models-empty@models', 'credential-kind@credential.kind',
  ]);
});

test('broken JSON, empty models, duplicates, and bad numbers are rejected', () => {
  assert.deepEqual(codes('{ not json'), ['json@']);
  assert.deepEqual(codes(valid({ models: undefined })), ['required@models']);
  assert.deepEqual(codes(valid({ models: [{ id: 'a' }, { id: 'a', contextWindow: 0, maxTokens: 1.5, image: true }] })),
    ['unknown-field@models[1].image', 'model-duplicate@models[1].id', 'number@models[1].contextWindow', 'number@models[1].maxTokens']);
});

test('credential, command, and oauth kinds validate their own fields', () => {
  const key = parseProviderDefinition(valid({ credential: { kind: 'credential', ref: 'OPENAI_API_KEY' } }));
  assert.deepEqual(key.definition.credential, { kind: 'credential', ref: 'OPENAI_API_KEY' });
  const command = parseProviderDefinition(valid({ credential: { kind: 'command', command: ['node', 'token.mjs'], timeoutMs: 5000, header: 'X-Api-Key', scheme: '' } }));
  assert.deepEqual(command.definition.credential, { kind: 'command', command: ['node', 'token.mjs'], timeoutMs: 5000, header: 'X-Api-Key', scheme: '' });
  const oauth = { kind: 'oauth', authorizeURL: 'https://auth.example.com/oauth/authorize', tokenURL: 'https://auth.example.com/oauth/token', clientId: 'app_1',
    scopes: ['openid', 'offline_access'], redirectPort: 1455, redirectPath: '/auth/callback', authorizeParams: { prompt: 'login' }, claimHeaders: { 'chatgpt-account-id': ['https://api.openai.com/auth', 'chatgpt_account_id'] } };
  assert.deepEqual(parseProviderDefinition(valid({ credential: oauth })).definition.credential, oauth);
  assert.deepEqual(codes(valid({ credential: { kind: 'credential', ref: 'bad-ref' } })), ['credential-field@credential.ref']);
  assert.deepEqual(codes(valid({ credential: { kind: 'command', command: [], timeoutMs: 1 } })), ['credential-field@credential.command', 'number@credential.timeoutMs']);
  assert.deepEqual(codes(valid({ credential: { ...oauth, tokenURL: 'http://auth.example.com/token', redirectPort: 80, authorizeParams: { state: 'x' }, claimHeaders: { Authorization: ['a'] }, secret: 'x' } })),
    ['unknown-field@credential.secret', 'url@credential.tokenURL', 'number@credential.redirectPort', 'credential-field@credential.authorizeParams', 'credential-field@credential.claimHeaders']);
  assert.deepEqual(codes(valid({ credential: { kind: 'none', token: 'x' } })), ['unknown-field@credential.token']);
  assert.deepEqual(codes(valid({ credential: { kind: 'magic' } })), ['credential-kind@credential.kind']);
});

test('reserved headers and secrets in URLs cannot be set by a definition', () => {
  assert.deepEqual(codes(valid({ headers: { Authorization: 'Bearer x', 'User-Agent': 'other', 'X-Ok': 'line\nbreak' } })),
    ['header@headers.Authorization', 'header@headers.User-Agent', 'header@headers.X-Ok']);
  assert.deepEqual(codes(valid({ baseURL: 'https://user:pass@example.com/v1' })), ['url@baseURL']);
  assert.deepEqual(codes(valid({ baseURL: 'https://example.com/v1?key=secret' })), ['url@baseURL']);
});

test('every definition in the provider guide examples is valid', async () => {
  const { providerGuideSkill } = await import('../src/host/pixie-hook-skill.ts');
  const { files } = providerGuideSkill();
  const blocks = [...files['examples.md'].matchAll(/```json\n([\s\S]*?)```/g)].map(match => match[1]);
  assert.equal(blocks.length, 4);
  const kinds = blocks.map(block => { const result = parseProviderDefinition(block); assert.equal(result.ok, true, JSON.stringify(result.issues)); return result.definition.credential.kind; });
  assert.deepEqual(kinds, ['none', 'credential', 'oauth', 'command']);
  for (const block of blocks) assert.doesNotMatch(block, /sk-|"token"\s*:/);
  assert.match(files['SKILL.md'], /^---\nname: studio-provider-guide\n/);
});
