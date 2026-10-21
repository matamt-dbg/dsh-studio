<p align="center">
  <img src="docs/images/icon.png" width="96" height="96" alt="DSH Studio icon">
</p>

<h1 align="center">DSH Studio</h1>

<p align="center"><b>See it, tune it, ship it — agent presets for DeepSeek Harness, without editing YAML.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@matamt-dbg/dsh-studio"><img src="https://img.shields.io/npm/v/@matamt-dbg/dsh-studio" alt="npm version"></a>
  <img src="https://img.shields.io/badge/DSH-0.2.0--rc.2%20%7C%200.2.1--alpha.2%20%7C%200.2.1--rc.1%20%7C%200.2.1--rc.2-4f6bff" alt="Supported DSH versions">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license">
</p>

DSH Studio is a plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that turns preset building into a visual workflow in the web GUI.

## Why

DeepSeek Harness exposes a lot to configure — which tools an agent gets, how each tool is described to the model, the system prompt sections, plugin settings, and how work is delegated to subagents. But all of it only takes effect through an **agent preset**, and building one by hand means editing composition files without seeing what the model will actually receive.

Studio closes that loop:

- **Make the configuration visible.** Pick tools, edit instructions and tool descriptions, and override plugin settings on one screen.
- **Check before you run.** Preview the exact system prompt and tool schemas a preset produces, without starting an agent.
- **Apply in one click.** Register the preset with DSH and choose it for a new session.

## Direction: less noise, better use of DSH

Studio also ships **Optimized**, a starting preset built on a simple idea: an agent works better when it sees fewer, clearer tools and knows how DSH expects them to be used.

Compared with the stock setup, Optimized

- **keeps a fixed starting tool set**: 27 tools, so installing another plugin never enlarges the preset's selection. It is not a runtime block: tools DSH or other plugins add to a running session stay usable. It drops goal/todo tracking, plugin management and environment/media tools that rarely help a coding task (you can still select them from Studio Master when your profile provides them);
- **folds delegation into one tool**, `subagent_role`, instead of several generic subagent tools, and ships a **Worker** role that inherits the same instructions but cannot delegate, ask questions or use the orchestration tools (`judge`, `pixie_loop`);
- **adds working instructions and tunes tool descriptions** so the model reads whole files at once, batches reads (`read_batch`) and edits to one file (`edit_batch`), lets long commands continue as background jobs and collects them, and keeps checks proportional before reporting.

In our early internal benchmarks, this preset performed noticeably better than DSH's stock `standard` preset.

While you leave it unedited, Optimized follows the installed Studio version and DSH's `standard` preset: on startup Studio realigns it and keeps every `standard` feature such as compaction and AGENTS.md instructions. You can edit it directly and **Restore defaults** at any time; an edited Optimized and your copies are never changed by Studio.

Optimized is tuned for **coding-agent work**. It is a starting point, not a fixed recipe: edit or copy it and adjust the tools, instructions, tool descriptions and plugin Configs to fit your own tasks. See [Adapt Optimized to your work](docs/guide.md#adapt-optimized-to-your-work).

> DSH Studio is a community project. It is not affiliated with, endorsed by, or supported by DeepSeek.

## Install

Requires DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1` or `0.2.1-rc.2`.

```sh
dsh plugin --profile web add @matamt-dbg/dsh-studio       # dsh web
dsh plugin --profile desktop add @matamt-dbg/dsh-studio   # desktop app: quit the app first
```

Restart the web GUI or the app, then open **DSH Studio** from the sidebar. Each profile keeps its own presets and its own set of tools.

### Compatibility

Each supported DSH version was checked on macOS with a fresh install into an isolated profile of the unmodified runtime. What was checked differs by version, and none of it is a full compatibility guarantee:

| DSH | Checked |
|---|---|
| `0.2.1-rc.2` | Install, Web startup and four HTTP checks (Master, Optimized copy, session roles, role save/reapply/restore); Studio loading in the desktop app |
| `0.2.1-rc.1` | The same HTTP checks; Fresh and Fork role subagents keeping their instructions and Tool Filter, also after a restart, with a local test model |
| `0.2.0-rc.2`, `0.2.1-alpha.2` | The same HTTP checks |

Not checked: external model calls in these checks, upgrading data from 0.5.0, and other operating systems. Back up your profile before upgrading. See the [0.6.1 release notes](CHANGELOG.md#061--2026-10-17).

## Features

![Preset list](docs/images/en/preset-list.png)

- **Presets** — a read-only *Studio Master* that follows DSH `standard` plus Studio's own plugins, a built-in *Optimized* preset (27 tools and a Worker role) you can edit and restore to defaults, and your own presets. Edit, copy, delete, apply to DSH, or unapply.
- **Prompts & tools** — edit persona and additional instructions, pick tools (or whole built-in tool sets), and rewrite the descriptions the model sees for each tool and parameter.
- **Prompt preview** — see the system prompt, tool schemas, runtime context and per-turn messages a preset produces, without starting an agent.
- **Execution settings** — every plugin is included by default; leave plugins out of a preset and override plugin configuration for one preset only. Execution defaults show the wait times a preset fills in for `bash` and `job_output`, and turning one off lets DSH's shell setting apply again.
- **Plugins** — see the plugins installed in your profile and where they run: include agent features in Studio Master with initial settings, or register profile-wide plugins (such as web search providers) in one click. **Profile settings** groups shared Host settings by workflow category — web search and fetch (with provider pickers and manual entry), delegation providers, loop guards, goal continuation, context, MCP servers, model retry — with search, masked secrets, and changes applied to every session.
- **Exa web search and fetch** — choose Exa for `web_search` and the separate plugin [`@matamt-dbg/dsh-web-fetch-exa`](https://www.npmjs.com/package/@matamt-dbg/dsh-web-fetch-exa) (`exa-contents`) for `web_fetch` in Profile settings. Install plugins from the DSH Plugins page or `dsh plugin add`, not `npm i`; see [Exa web search and fetch](docs/guide.md#exa-web-search-and-fetch).
- **Subagents** — DSH's generic subagent tools become a single `subagent_role` tool. Define roles with their own model, reasoning effort, fresh or fork start, and persona; with no roles, `subagent_role` starts a child that inherits the parent's settings.
- **Per-session subagent roles** — a **Subagents** tab in each session changes a role's model, reasoning effort and instructions, or adds a role, for that session only.
- **DSH in Korean** — choosing 한국어 in DSH's language setting also translates DSH's own screens.
- **Studio shortcuts** — SettingsX adds keyboard commands DSH lacks: previous/next session, go to session 1–9, copy the working folder, full screen.
- **Pixie and Pixie Gate** — a side model in the right sidebar (`/pixie`) that never enters the conversation, and gates that check prompts, tool calls and finished answers per preset. Hook scripts can judge with a decision engine (an LLM or TypeSafe Jev), conclude without Pixie, and leave notes under the answer, such as a Korean translation. Agents get the same engine as the `judge` tool, and a `studio-pixie-hook-guide` skill to write gates. See the [Pixie Gate guide](docs/appendix/pixie-gate.md).
- **Pixie Loop** — the `pixie_loop` tool runs many independent items through work → exact checks → decision-engine judgment → Pixie feedback → retry outside the agent's context, and returns only counts, a results file and the items that still failed. Outputs can be run and judged by what they print (`act`), worked step by step, or picked from listed options. Saved recipes also judge or repair content in Pixie Gates and hook scripts (`pixie loop`). Runs show in the Pixie tab › Loops; a `studio-pixie-loop-guide` skill writes the specs. See the [Pixie Loop guide](docs/appendix/pixie-loop.md).

| Prompts & tools | Prompt preview | Subagent roles |
|---|---|---|
| ![Tools](docs/images/en/tools.png) | ![Preview](docs/images/en/prompt-preview.png) | ![Roles](docs/images/en/role-editor.png) |

**What's new: [English](docs/highlights.md) · [한국어](docs/highlights.ko.md)** · **Introduction: [English](docs/introduction.md) · [한국어](docs/introduction.ko.md)** · **User guide: [English](docs/guide.md) · [한국어](docs/guide.ko.md)** · **[Changelog](CHANGELOG.md)**

## Quick start

1. Open **DSH Studio** and select **Edit** or **Create copy** on *Optimized*.
2. Adjust instructions, tools, execution settings and subagent roles, then **Save preset**.
3. In **Preset list**, select **Apply to DSH**.
4. Start a new session and choose your preset in DSH's preset picker.

Presets are stored per profile in `studio-data/`. Applying a preset registers a Studio-owned DSH agent preset; it never edits other presets or the profile's packages.

The tools a preset selects are the session's starting tool set. If the profile does not provide one of them (for example `load_workspace_dependencies` outside the desktop app), applying the preset fails instead of silently dropping the tool. Tools that DSH or other plugins add to a running session, such as schedules, stay usable. See [Tools that depend on your profile](docs/guide.md#tools-that-depend-on-your-profile).

## Development

```sh
pnpm install
pnpm test        # typecheck, build, tests
node pack.mjs    # writes dist/matamt-dbg-dsh-studio-<version>.tgz
```

Please report bugs and requests in [Issues](https://github.com/matamt-dbg/dsh-studio/issues).

## License

MIT
