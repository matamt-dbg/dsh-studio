# Changelog

## 0.1.2 — 2026-10-24

- Adds DSH `0.2.1-rc.3` to the supported runtime versions, fixing the compatibility block after updating DSH. Existing supported versions and provider settings are retained.
- Verified GUI installation and activation on unmodified DSH `0.2.1-rc.3`, followed by `web_fetch` through a local Contents fixture endpoint. No real Exa API request was made for this release.

## 0.1.1 — 2026-10-21

Requires DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1` or `0.2.1-rc.2`.

- **Install from the Plugins page.** The package is now a DSH bundle, so **Plugins → Add plugin** accepts it (0.1.0 was refused with "declares no dsh.bundle"). Installing adds the provider row by itself; there is no separate registration step. `web_fetch` keeps its current provider until you choose `exa-contents`.
- The README explains that `npm i` does not install a DSH plugin and lists the app, `dsh plugin add`, key and provider steps.

Upgrade from 0.1.0: uninstall 0.1.0, then install 0.1.1. A `web-fetch-exa` row you added for 0.1.0 (for example with DSH Studio's **Register in profile**) uses the same id as the row 0.1.1 adds, so it stays as one row and keeps its settings.

## 0.1.0 — 2026-10-21

Requires DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1` or `0.2.1-rc.2`.

- First release. Registers the fetch provider `exa-contents`, which reads pages through the Exa Contents API (`POST /contents`) as extracted text. Select it with `fetchProvider: exa-contents` on the web service; DSH Studio 0.6.4 or later lists it under **Profile settings → Web search and fetch**.
- Uses `EXA_API_KEY` unless `apiKey` is set. Text is capped at `maxCharacters` (default 100,000) and reported as truncated when cut. A missing page resolves with its HTTP status; other crawl failures and Exa API errors fail with `WEB_PROVIDER_ERROR` without echoing the key. Requests to Exa refuse redirects.
