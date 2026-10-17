/** Opt-in subscription definitions. No credentials are imported from other applications. */
import type { ProviderDefinition } from './provider-contract.ts';

export type ProviderTemplateId = 'chatgpt' | 'claude';
export function providerTemplate(id: string): ProviderDefinition {
  if (id === 'chatgpt') return {
    version: 1, id: 'studio-chatgpt', name: 'ChatGPT (Studio)', protocol: 'openai-responses',
    baseURL: 'https://chatgpt.com/backend-api/codex', headers: { 'OpenAI-Beta': 'responses=experimental' },
    models: [{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 272000, maxTokens: 128000 }],
    credential: { kind: 'oauth', authorizeURL: 'https://auth.openai.com/oauth/authorize', tokenURL: 'https://auth.openai.com/oauth/token',
      clientId: 'app_EMoamEEZ73f0CkXaXp7hrann', scopes: ['openid', 'profile', 'email', 'offline_access'], redirectPort: 1455, redirectPath: '/auth/callback',
      authorizeParams: { id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true' },
      claimHeaders: { 'chatgpt-account-id': ['https://api.openai.com/auth', 'chatgpt_account_id'] } },
  };
  if (id === 'claude') return {
    version: 1, id: 'studio-claude', name: 'Claude (Studio)', protocol: 'anthropic-messages', baseURL: 'https://api.anthropic.com/v1',
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000, maxTokens: 32000 },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 200000, maxTokens: 32000 }],
    credential: { kind: 'oauth', authorizeURL: 'https://claude.ai/oauth/authorize', tokenURL: 'https://claude.ai/v1/oauth/token',
      clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', scopes: ['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code', 'user:mcp_servers', 'user:file_upload'],
      redirectPort: 0, redirectPath: '/callback', tokenFormat: 'json', authorizeParams: { code: 'true' } },
  };
  throw new Error('Unknown provider template');
}

/** Approved exception applies only to the built-in Claude subscription endpoint/client. */
export function claudeSubscriptionHeaders(definition: ProviderDefinition): Record<string, string> {
  if (definition.protocol !== 'anthropic-messages' || definition.baseURL !== 'https://api.anthropic.com/v1'
    || definition.credential.kind !== 'oauth' || definition.credential.clientId !== '9d1c250a-e61b-44d9-88ed-5944d1962f5e') return {};
  return { 'user-agent': 'claude-cli/2.1.283 (external, cli)', 'x-app': 'cli',
    'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14',
    'anthropic-dangerous-direct-browser-access': 'true' };
}
