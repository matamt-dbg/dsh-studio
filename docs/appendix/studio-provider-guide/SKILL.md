---
name: studio-provider-guide
description: Write, check, and install a DSH Studio SettingsX provider definition file so a model endpoint — API key, subscription (OAuth), token command, or keyless local server — appears in DSH model selection, Pixie, and roles. Use when the user asks to add a provider, subscription, model server, or endpoint to DSH through Studio, or asks why a definition shows as invalid or cannot sign in.
---

# DSH Studio provider definitions

A SettingsX provider is one JSON file. Studio reads every `*.json` in the definition folder, validates it, and registers valid files as DSH model routes. The folder path is shown on **DSH Studio → SettingsX → Providers**; it is `<profile>/studio-data/providers`. After adding or changing a file, the user presses **Reload** on that page. Worked definitions are in `examples.md` next to this file.

## File format (version 1)

| Field | Rule |
| --- | --- |
| `version` | Always `1`. |
| `id` | Route key in DSH. Lowercase letter first, then lowercase letters, digits, hyphens; at most 63 characters. Must not equal another provider's route (for example `deepseek`). |
| `name` | Display name. |
| `protocol` | `openai-chat` (POST `<baseURL>/chat/completions`) or `openai-responses` (POST `<baseURL>/responses`, sent with `store: false` and the full history each call). Both stream SSE. |
| `baseURL` | `http` or `https`, without user name, password, query, or fragment. A trailing `/` is removed. |
| `headers` | Optional fixed request headers. `Authorization`, `User-Agent`, `Content-Type`, `Content-Length`, `Accept`, and `Host` cannot be set. Stored in plain text: never put secrets here. |
| `models` | At least one entry. Only listed models can be chosen in the DSH GUI. `contextWindow` and `maxTokens` are optional positive integers; `maxTokens` is the default output cap. |
| `credential` | How requests authenticate; see below. |

Unknown fields are rejected. Studio sends text only: image attachments are replaced by text handles before the request.

## Credentials

Every kind except `none` sends `Authorization: Bearer <token>`. Set `header` to use another header (for example `x-api-key`) and `scheme` to change or, with `""`, drop the `Bearer` prefix.

| Kind | Fields | Where the secret lives |
| --- | --- | --- |
| `none` | — | No secret. For keyless local servers. |
| `credential` | `ref`: an environment-variable-style name such as `OPENROUTER_API_KEY` | DSH credentials. The user pastes the key on the Providers page, or it comes from the environment or `.env`. Read on every request. |
| `command` | `command`: program and arguments (run without a shell); `timeoutMs` 100–120000, default 15000 | Not stored by Studio. The program prints `{ "token": "...", "expiresAt": <epoch ms>?, "headers": { ... }? }` on stdout. Studio caches it in memory until `expiresAt` (or until reload when absent) and re-runs it once after HTTP 401. Use this when another tool already holds a token. |
| `oauth` | `authorizeURL`, `tokenURL` (https, or http on localhost), `clientId`, `redirectPort` (1024–65535), optional `redirectPath` (default `/callback`), `scopes`, `authorizeParams` (extra authorize query parameters), `claimHeaders` (header name → JSON path into the token's claims) | A DSH credential record `studio-providers/<id>`. The user presses **Sign in** on the Providers page; Studio opens the browser, receives the redirect on `http://localhost:<redirectPort><redirectPath>`, and exchanges the code with PKCE. Tokens refresh with the refresh token when they expire, and once more after HTTP 401. **Sign out** deletes the record. |

For OAuth, the provider must accept the exact redirect `http://localhost:<redirectPort><redirectPath>` for that `clientId`; Studio cannot register clients. If another program holds the port, sign-in reports it and the user closes that program first. The DSH Host must run on the same machine as the browser, because the redirect goes to `localhost`.

## Procedure

1. Ask which endpoint and protocol the service speaks, which model IDs it serves, and how the user is allowed to authenticate (API key, their own subscription sign-in, an existing tool's token, or nothing). If the server lists models (for example `GET <baseURL>/models`), use those IDs.
2. Pick the credential kind from the table. Prefer `credential` for API keys and `oauth` when the service documents an OAuth client the user may use. Use `command` only for a token another tool the user already runs maintains.
3. Write the file as `<id>.json` in the definition folder. For `command`, also write the script, make it executable, and test it prints valid JSON.
4. Check every rule above. Tell the user to press **Reload** and confirm the row shows **Registered**; for `credential` paste the key, for `oauth` press **Sign in**. An **Invalid** row lists each problem with its field path; fix them all and reload.
5. Tell the user the models now appear under the provider name in DSH model selection, Pixie, and role model lists.

## Do not

- Do not write API keys, tokens, refresh tokens, or cookies into a definition or `headers`.
- Do not imitate another product's client (forged user agents or session IDs, placeholder tools, IP rotation) to get around a provider's access limits or client restrictions.
- Using a subscription or free tier outside its own app may break that provider's terms. Say so, and leave the decision to the user; they are responsible for each provider's terms of use.
