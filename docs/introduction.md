# DSH Studio introduction

English | [한국어](introduction.ko.md)

DSH Studio is a plugin for building and editing DeepSeek Harness (DSH) **agent presets** on screen. Instead of writing YAML, you set the instructions, tools, plugin settings and subagent roles an agent gets in one place, then apply the result to DSH. The [user guide](guide.md) walks through each screen.

## Contents

- [What it solves](#what-it-solves)
- [How a preset is built](#how-a-preset-is-built)
- [What the model actually receives](#what-the-model-actually-receives)
- [Defaults, overrides and exclusions](#defaults-overrides-and-exclusions)
- [Tools are a starting set, not a block list](#tools-are-a-starting-set-not-a-block-list)
- [Optimized](#optimized)
- [What Studio does when things change](#what-studio-does-when-things-change)
- [What Studio does not do](#what-studio-does-not-do)

## What it solves

A DSH preset is a declaration of plugins and their settings. It is powerful, but some things are hard:

- seeing in advance which tools and instructions reach the model;
- changing a stock preset a little while everything else keeps following DSH defaults;
- giving each preset its own tool descriptions and execution defaults;
- splitting delegation across subagent roles.

Studio handles these on screen and registers the result as a Studio-owned DSH preset. It does not touch DSH's own presets or your profile's package list.

## How a preset is built

Every Studio preset is Studio Master plus the differences you choose.

```text
DSH standard preset (as the running DSH declares it)
  + plugins Studio adds        read_batch, spill-policy, tool-cordis, plugin-manager
  + plugins you add            Execution settings → Add plugin
  ───────────────────────────────────────────────
  = Studio Master (read-only base)

Studio Master
  − plugins you leave out      Execution settings → Included plugins
  + Config overrides           changed fields only
  + tool selection and edits   Prompts & tools
  + additional instructions, persona
  + subagent_role and roles    Subagent settings (replaces standard's subagent tools)
  ───────────────────────────────────────────────
  = your preset → Apply to DSH → choose it in a new session
```

Because Studio Master follows DSH `standard`, the base moves with DSH updates. Each plugin on screen carries an origin badge (`standard`, `Studio`, `Added`).

## What the model actually receives

What a session sends the model arrives at different times depending on its kind. **Preview prompt** shows three of them separately.

| Kind | When | Examples | Preview |
|---|---|---|---|
| System prompt | every request | persona, tool usage guidance, additional instructions, plan mode | **System prompt & tools** |
| Tool schemas | every request | read, bash, subagent_role | **System prompt & tools** |
| Runtime context | every request, after the system prompt | permissions and sandbox state, delegation notes | **Runtime context** |
| Turn-start messages | each turn start | AGENTS.md instructions, current time, skill list | **Turn start** (examples and settings) |
| Notes after tool results | after reading or editing files | a subfolder AGENTS.md | not shown |
| Conversation upkeep | near the context limit | compaction summaries, trimmed tool results | not shown |

AGENTS.md instructions and the current time are not part of the system prompt; they enter as conversation messages each turn. Their text comes from files and the clock at run time, so in Studio you change the settings that shape it (`maxBytes`, instruction file candidates, `timeZone` and so on).

## Defaults, overrides and exclusions

Each plugin in Execution settings is in one of three states.

| State | What is saved | Result |
|---|---|---|
| **Defaults** | nothing | the plugin is included with DSH defaults |
| **Override** | changed fields only | included, with only those fields changed; turning the override off returns to the defaults |
| **Excluded** | its ID in the exclusion list | the plugin is left out of this preset |

For example, there are two ways to handle automatic compaction:

- **Override** `auto` to `false` on `compaction-basic`: compaction and `/compact` stay; only the automatic run stops.
- **Exclude** `compaction-basic`: compaction leaves, and `/compact`, which depends on it, leaves too.

Turning an override off means "back to the default", not "off". To leave a feature out, uncheck it in Included plugins.

## Tools are a starting set, not a block list

The tools a preset selects are the session's **starting tool set**.

- Unselected tools are hidden when the session starts.
- Tools another plugin registers under a new name after the session starts follow DSH's normal flow and can be used.
- Tools DSH attaches to each session directly, such as schedules, do not appear in the preset tool list but can be used when enabled.
- Leaving out a plugin that provides a selected tool is blocked at apply time, so tools never disappear silently.

Studio does not change DSH's safety policies such as approvals, file access and subagent limits.

## Optimized

Studio ships **Optimized**, a built-in preset for coding agents.

- It fixes a starting set of 22 everyday tools; installing more plugins never enlarges the selection.
- It folds subagent tools into a single `subagent_role`.
- Its instructions and tool descriptions are tuned so the model batches independent reads, waits on background work instead of polling, and keeps checks proportional to the task.
- `standard` features such as compaction, AGENTS.md instructions and the skill catalog stay included.

Optimized is locked and realigned each time Studio starts. Copy it to customize; see [Adapt Optimized to your work](guide.md#adapt-optimized-to-your-work).

## What Studio does when things change

| Situation | What Studio does |
|---|---|
| A DSH update or a plugin install or removal changes tools or plugins | On the next start, a notice above the list (`+` added, `-` removed, `~` schema changed). Presets do not change until you select **Confirm and clean** |
| You confirm the cleanup | Only the missing items' selections, descriptions and overrides are removed; applied presets are marked **Needs reapply** |
| Part of the collection fails | The previous baseline is kept and nothing is deleted |
| An earlier version applied a preset without some features | The card shows **Missing features**; **Restore** reapplies after you confirm |
| A session is already running | Preset edits are not applied to it; they take effect in new sessions |

## What Studio does not do

- It does not modify DSH itself or other presets.
- It does not install packages; install plugins in the profile first.
- It does not change compaction algorithms or tool behavior; it changes descriptions and settings.
- It does not reconfigure running sessions.
