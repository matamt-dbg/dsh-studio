# dsh-web-fetch-exa

Exa [`/contents`](https://docs.exa.ai/reference/get-contents) fetch provider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It registers the fetch provider `exa-contents` into the shared web service (`ctx.web`), so `web_fetch` can read pages through Exa instead of a direct HTTP request.

Requires DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1` or `0.2.1-rc.2`.

## Install

Install the package into the profile, then register it in the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: web-fetch-exa
      name: '@matamt-dbg/dsh-web-fetch-exa'
```

With DSH Studio, **Plugins → Installed plugins → Register in profile** does the same. Then choose the provider: **Profile settings → Web search and fetch → Fetch provider → `exa-contents`**. Without Studio, set `fetchProvider: exa-contents` on the `@deepseek-ai/dsh-web` row, or set `DSH_WEB_FETCH_PROVIDER=exa-contents`.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKey` | `$EXA_API_KEY` | Exa API key. Without a key the provider is unavailable. |
| `baseURL` | `https://api.exa.ai` | API base; `/contents` is appended. |
| `maxCharacters` | `100000` | Page text limit, sent to Exa and enforced on the result (`truncated`). |
| `timeoutMs` | `30000` | Whole-request deadline (`WEB_FETCH_TIMEOUT`). |
| `maxAgeHours` | Exa default | Cache age in hours: `0` always crawls live, `-1` always uses the cache. |
| `livecrawlTimeoutMs` | Exa default | Live crawl timeout, up to 90000. |

## Behavior

- The body is always extracted text (`kind: text`). Exa does the crawling, so the page's own redirects and HTML are not visible.
- When Exa reports the target page's HTTP status as a crawl error (for example `CRAWL_NOT_FOUND`, 404), the fetch resolves with that status and an empty body. A crawl error without a status (timeout, unsupported URL) fails with `WEB_PROVIDER_ERROR`.
- Only `http(s)` URLs without embedded credentials are sent (`WEB_INVALID_URL` otherwise).
- Requests to Exa carry the API key and refuse redirects, so the key is never forwarded to another origin.
- Cost: Exa bills Contents per page (about $1 per 1,000 pages for text at the time of writing; see [Exa pricing](https://exa.ai/pricing)).

## License

MIT
