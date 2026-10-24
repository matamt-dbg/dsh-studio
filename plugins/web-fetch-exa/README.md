# dsh-web-fetch-exa

Exa [`/contents`](https://docs.exa.ai/reference/get-contents) fetch provider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It adds the fetch provider `exa-contents` to the shared web service, so `web_fetch` can read pages through Exa instead of a direct HTTP request.

Requires DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1`, `0.2.1-rc.2` or `0.2.1-rc.3`.

## Install

> **Do not use `npm i` / `npm install`.** The install command npm shows on this page puts the package in the current folder, where DSH never loads it. Install it into a DSH profile with one of the methods below.

**DeepSeek Harness app or `dsh web`:** open **Plugins → Add plugin**, enter `@matamt-dbg/dsh-web-fetch-exa`, and select **Install**.

**Terminal:** install into the profile you use. Quit the desktop app first.

```sh
dsh plugin --profile desktop add @matamt-dbg/dsh-web-fetch-exa   # desktop app
dsh plugin --profile web add @matamt-dbg/dsh-web-fetch-exa       # dsh web
```

Installing adds the provider but does not switch to it; `web_fetch` keeps using its current provider until you choose `exa-contents`.

## Use it

1. **Key:** set `EXA_API_KEY` in the environment DSH starts with, or put the key in this plugin's `apiKey` setting. A key saved only in the Exa web search plugin's settings is not shared; enter it here too.
2. **Choose the provider:** set `fetchProvider: exa-contents` on the `@deepseek-ai/dsh-web` row.
   - With [DSH Studio](https://www.npmjs.com/package/@matamt-dbg/dsh-studio) 0.6.4 or later: **Studio → Plugins → Profile settings → Web search and fetch → Fetch provider → `exa-contents`**. The same page edits the `apiKey` above (shown masked).
   - Without Studio: add to the profile's `cordis.patch.yml`
     ```yaml
     - id: web
       name: '@deepseek-ai/dsh-web'
       config:
         searchProvider: deepseek-official
         fetchProvider: exa-contents
     ```
     or start DSH with `DSH_WEB_FETCH_PROVIDER=exa-contents`.

Without a key, `web_fetch` through `exa-contents` fails with `configured web provider "exa-contents" is registered but unavailable`.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKey` | `$EXA_API_KEY` | Exa API key. Without a key the provider is unavailable. |
| `baseURL` | `https://api.exa.ai` | API base; `/contents` is appended. |
| `maxCharacters` | `100000` | Page text limit, enforced on the result (`truncated` when cut). |
| `timeoutMs` | `30000` | Whole-request deadline (`WEB_FETCH_TIMEOUT`). |
| `maxAgeHours` | Exa default | Cache age in hours: `0` always crawls live, `-1` always uses the cache. |
| `livecrawlTimeoutMs` | Exa default | Live crawl timeout, up to 90000. |

## Behavior

- The body is always extracted text (`kind: text`). Exa does the crawling, so the page's own redirects and HTML are not visible.
- When Exa reports the target page's HTTP status as a crawl error (for example 404), the fetch resolves with that status and an empty body. A crawl error without a status (timeout, unsupported URL) fails with `WEB_PROVIDER_ERROR`.
- Only `http(s)` URLs without embedded credentials are sent (`WEB_INVALID_URL` otherwise).
- Requests to Exa carry the API key and refuse redirects. Error messages never include the key.
- Cost: Exa bills Contents per page (about $1 per 1,000 pages for text at the time of writing; see [Exa pricing](https://exa.ai/pricing)).

## Remove

Choose another fetch provider first (Studio: **Use default**); otherwise `web_fetch` reports the configured provider as missing. Then uninstall from the **Plugins** page, or run `dsh plugin --profile <profile> remove @matamt-dbg/dsh-web-fetch-exa`.

## License

MIT
