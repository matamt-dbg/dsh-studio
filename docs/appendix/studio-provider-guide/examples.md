# Provider definition examples

Each block is a complete definition file. Studio's tests parse every block here, so they stay valid against the current format. Replace model IDs with ones the user's account or server actually serves.

## Local OpenAI-compatible server (no key)

Ollama, LM Studio, llama.cpp server, or vLLM on this machine.

```json
{
  "version": 1,
  "id": "local-llm",
  "name": "Local LLM",
  "protocol": "openai-chat",
  "baseURL": "http://127.0.0.1:11434/v1",
  "models": [{ "id": "qwen3:8b", "name": "Qwen3 8B", "contextWindow": 32768 }],
  "credential": { "kind": "none" }
}
```

## API key (OpenAI-compatible gateway)

The key is pasted on the Providers page and stored in DSH credentials as `OPENROUTER_API_KEY`.

```json
{
  "version": 1,
  "id": "openrouter",
  "name": "OpenRouter",
  "protocol": "openai-chat",
  "baseURL": "https://openrouter.ai/api/v1",
  "models": [{ "id": "openai/gpt-5.5", "name": "GPT-5.5" }],
  "credential": { "kind": "credential", "ref": "OPENROUTER_API_KEY" }
}
```

## ChatGPT subscription (OAuth sign-in)

Signs in with the user's ChatGPT account and sends requests to ChatGPT's Codex backend. These values are the public parameters the Codex CLI and other open-source clients use; OpenAI does not document this backend for third-party apps, it may change without notice, and using it outside OpenAI's apps may be against OpenAI's terms. The user decides and is responsible. The redirect port 1455 is the one the Codex CLI also uses: quit a running Codex sign-in first.

```json
{
  "version": 1,
  "id": "chatgpt",
  "name": "ChatGPT (subscription)",
  "protocol": "openai-responses",
  "baseURL": "https://chatgpt.com/backend-api/codex",
  "headers": { "OpenAI-Beta": "responses=experimental" },
  "models": [
    { "id": "gpt-5.5", "name": "GPT-5.5", "contextWindow": 272000, "maxTokens": 128000 }
  ],
  "credential": {
    "kind": "oauth",
    "authorizeURL": "https://auth.openai.com/oauth/authorize",
    "tokenURL": "https://auth.openai.com/oauth/token",
    "clientId": "app_EMoamEEZ73f0CkXaXp7hrann",
    "scopes": ["openid", "profile", "email", "offline_access"],
    "redirectPort": 1455,
    "redirectPath": "/auth/callback",
    "authorizeParams": { "id_token_add_organizations": "true", "codex_cli_simplified_flow": "true" },
    "claimHeaders": { "chatgpt-account-id": ["https://api.openai.com/auth", "chatgpt_account_id"] }
  }
}
```

## Token from another tool (command)

`token.mjs` prints `{ "token": "...", "expiresAt": 1792300000000 }`. Studio runs it without a shell, caches the token until `expiresAt`, and runs it again after HTTP 401.

```json
{
  "version": 1,
  "id": "team-gateway",
  "name": "Team gateway",
  "protocol": "openai-chat",
  "baseURL": "https://llm.example.internal/v1",
  "models": [{ "id": "team-large" }],
  "credential": { "kind": "command", "command": ["node", "/opt/tools/token.mjs"], "timeoutMs": 10000 }
}
```
