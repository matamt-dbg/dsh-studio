# DSH Studio user guide

English | [한국어](guide.ko.md)

DSH Studio is a page inside the DeepSeek Harness web GUI for building **agent presets**: which tools an agent sees, what instructions it starts with, how its plugins are configured, and which specialist subagents it can delegate to. A preset you apply appears in DSH's preset picker for new sessions.

- [Install and open Studio](#install-and-open-studio)
- [Preset list](#preset-list)
- [Edit a preset](#edit-a-preset)
  - [Prompts & tools](#prompts--tools)
  - [Prompt preview](#prompt-preview)
  - [Execution settings](#execution-settings)
  - [Subagent settings](#subagent-settings)
- [Adapt Optimized to your work](#adapt-optimized-to-your-work)
- [Apply a preset to DSH](#apply-a-preset-to-dsh)
- [Tool providers](#tool-providers)
- [Where data is stored](#where-data-is-stored)
- [Troubleshooting](#troubleshooting)

## Install and open Studio

Studio requires DSH `0.2.0-rc.2` or `0.2.1-alpha.2`.

```sh
dsh plugin --profile web add @matamt-dbg/dsh-studio
```

Restart the web GUI and select **DSH Studio** in the sidebar.

## Preset list

![Preset list](images/en/preset-list.png)

The list shows every preset Studio manages:

| Preset | What it is |
|---|---|
| **Studio Master** | Read-only reference that contains every tool Studio can offer. Use it to see what is available. |
| **Optimized** | Built-in starting point for coding agents: 22 everyday tools, tuned tool descriptions and execution defaults, and short working instructions. You can edit it, but not delete it. See [Adapt Optimized to your work](#adapt-optimized-to-your-work). |
| Your presets | Anything you create or copy. |

Each card shows its status — **Applied**, **Needs reapply** (saved changes not yet in DSH), or **Not applied** — and the number of tools and subagent roles. The card buttons:

- **Edit** opens the preset in the editor.
- **Create copy** opens a new, unsaved preset prefilled from this one. Copies can be copied again.
- **Delete** removes the preset from Studio and from DSH. Existing conversations are kept.
- **Apply to DSH / Reapply to DSH** registers the saved preset with DSH. The arrow next to it offers **Unapply from DSH**.

If several presets share a warning, it is shown once above the cards instead of on every card.

## Edit a preset

Choose **Create preset** in the left menu, or **Edit** / **Create copy** on a card. Give the preset a name and an optional one-line description, work through the three tabs, then select **Save preset**. Saving does not change DSH until you apply the preset from the list.

### Prompts & tools

![Prompt composition](images/en/prompts.png)

**Prompt composition** controls the instructions the agent starts with:

- **Persona instructions** — the opening identity of the system prompt. `{{model}}` is replaced with the session's model name. **Use original** restores the default.
- **Persona suffix** — text appended at the end of the persona.
- **Additional Studio instructions** — your own working rules, added as the last section of the system prompt.

![Tool selection](images/en/tools.png)

**Provided tools** decides which tools the agent can call:

- Check a row to include the tool. Rows stay in place when you toggle them.
- **Include a built-in preset tool set** adds or removes the tools of DSH's `standard`, `ptc`, `minimal` or `creator (cordis)` presets in one click. A set shows as pressed when all of its tools are selected.
- Search by name, description or parameter, and filter by **All**, **Selected** or **Modified**.

![Tool details](images/en/tool-details.png)

**Details** on a selected tool edits what the model reads about it — never what the tool does:

- **Tool description** — the overall description sent to the model.
- **Tool usage instructions** — the tool's section in the system prompt. Tools that share a section share these instructions.
- **Parameter descriptions** — description text only; names, types and required flags stay unchanged.

Edited tools are marked **Modified**. Changes apply to this preset only.

### Prompt preview

![Prompt preview](images/en/prompt-preview.png)

**Preview prompt** assembles the system prompt exactly as DSH would for this preset, without starting an agent or calling a model. The left side lists every section in order; the right side lists the tool schemas the model receives. If you change settings while the preview is open, it tells you to run it again.

### Execution settings

![Execution settings](images/en/execution-settings.png)

Override plugin configuration for this preset only — for example, how much tool output is shown inline before it is saved to a file (`spill-policy`). Check a plugin to override it, then **Edit** to change fields. Only fields you change are saved; unchecking a plugin resets it. Plugins whose settings cannot be read are shown disabled.

### Subagent settings

![Subagents](images/en/subagents.png)

Studio replaces DSH's generic subagent tools (`subagent`, `subagent_fork`, `list_subagent_models`) with a single **`subagent_role`** tool, which keeps the initial prompt smaller. `send_message`, `interrupt_agent` and `list_agents` stay available for following up on, stopping and listing started subagents. You can review or edit the `subagent_role` description in the tool list.

Add **roles** to give the agent named specialists to delegate to:

![Role editor](images/en/role-editor.png)

| Field | Meaning |
|---|---|
| Name | Display name of the role. |
| Role | Identifier the agent uses when calling `subagent_role`. Must be unique. |
| Model | **Inherit parent model**, or a specific model from your configured providers. **Refresh models** reloads the list. |
| Reasoning | Reasoning effort supported by the chosen model, or the parent/model default. |
| Spawn mode | **New conversation (Fresh)** starts with only the task; **Continue parent (Fork)** also receives the conversation so far. |
| User instructions (persona) | Replaces the persona for this role. Leave empty to keep the preset persona, shown as dimmed placeholder text. |

The agent writes the actual task each time it calls `subagent_role`. With **no roles**, `subagent_role` starts a fresh subagent with the parent's model, reasoning and preset instructions.

Models are checked when you apply the preset and again before each call, so an unavailable model fails early with a clear message.

## Adapt Optimized to your work

Optimized is tuned for **coding-agent work**: reading and editing code, running commands, and checking results. For anything else, treat it as a starting point. Select **Create copy** on Optimized and adjust the copy with the same screens described above — nothing in Optimized is fixed.

| If you want to… | Change this |
|---|---|
| Track long, multi-step objectives | Turn on the goal and todo tools (`create_goal`, `get_goal`, `update_goal`, `todo_write`) in **Prompts & tools**. |
| Develop or inspect DSH plugins | Turn on `cordis_inspect_list`, `cordis_inspect_query` and `plugin_manager`. |
| Do research, writing or operations instead of coding | Rewrite **Additional Studio instructions** for that work, and drop tools it does not need. |
| Change how much tool output stays inline | Adjust `spill-policy` in **Execution settings**. |
| Tune any other plugin behavior | Turn on that plugin in **Execution settings** and edit only the fields you need. |
| Steer how the model uses a tool | Edit its description, usage instructions or parameter text in the tool's **Details**. |
| Delegate to specialists | Add roles in **Subagent settings** with their own model, reasoning effort and persona. |

Use **Preview prompt** after each change to confirm what the model will receive, then save and apply the copy. Optimized itself stays available as a reference, and you can keep several presets for different kinds of work.

## Apply a preset to DSH

1. Save the preset.
2. In **Preset list**, select **Apply to DSH** (or **Reapply to DSH** after changes).
3. Start a new session and choose the preset in DSH's preset picker.

If applying fails, the previously applied version stays in effect and the list explains why. **Unapply from DSH** removes the preset from DSH but keeps it in Studio.

## Tool providers

**Tool providers** registers tools from other installed plugins in the Studio tool list, so presets can select them. Enter a JSON array of entries with `id`, `name` (the installed package) and `config`, then select **Validate and update master**. Registering runs the plugin's code, so add only plugins you trust. Studio does not install packages; install them first.

## Where data is stored

Presets are saved per DSH profile in `<profile>/studio-data/`. Applying a preset registers a Studio-owned DSH agent preset; Studio never edits DSH's own presets or your profile's package list.

## Troubleshooting

**"@matamt-dbg/dsh-studio: failed" after installing.** An earlier local build of Studio (`@local/dsh-studio`) is still installed in the same profile, and both try to register the same page. Remove the old one and restart:

```sh
dsh plugin --profile web remove @local/dsh-studio
```

Your saved presets are kept and migrated automatically.

**A preset shows "Needs reapply".** It was saved after it was last applied. Apply it again to update DSH.
