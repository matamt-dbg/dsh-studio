# DSH plugins

Separate DeepSeek Harness plugins published next to DSH Studio. Each one is its own npm package with its own version and changelog; installing Studio does not install them.

| Package | Version | What it does |
| --- | --- | --- |
| [`@matamt-dbg/dsh-web-fetch-exa`](web-fetch-exa/README.md) | see [CHANGELOG](web-fetch-exa/CHANGELOG.md) | Fetch provider `exa-contents`: `web_fetch` reads pages through the Exa Contents API. |

Install a plugin into the profile that uses it, then register it (DSH Studio: **Plugins → Installed plugins → Register in profile**):

```sh
dsh plugin --profile <profile> add @matamt-dbg/dsh-web-fetch-exa
```

Each plugin keeps its source in `src/`, tests in `test/`, and a `tsconfig.json` that type-checks against the same DSH packages as Studio.
