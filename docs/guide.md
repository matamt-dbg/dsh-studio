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
- [Tools that depend on your profile](#tools-that-depend-on-your-profile)
- [Where data is stored](#where-data-is-stored)
- [Troubleshooting](#troubleshooting)
- [Appendix: Check a preset in a live session](appendix/preset-check.md)

## Install and open Studio

Studio requires DSH `0.2.0-rc.2` or `0.2.1-alpha.2`.

Install Studio into the DSH profile you use. `web` is the profile of `dsh web`; `desktop` is the profile of the DeepSeek Harness desktop app.

```sh
dsh plugin --profile web add @matamt-dbg/dsh-studio       # dsh web
dsh plugin --profile desktop add @matamt-dbg/dsh-studio   # desktop app: quit the app first
```

Restart the web GUI or the app, then select **DSH Studio** in the sidebar. Each profile keeps its own presets and its own set of tools, so install Studio in every profile where you want to use it.

### Update Studio

The installed version (for example `v0.2.7`) is shown at the bottom of the Studio menu. When a newer release that supports your DSH version is on the npm registry your profile uses, an update icon appears beside **DSH Studio** in the sidebar and beside the version. Select the icon next to the version to install that exact release into this profile, then restart the web GUI or the app to load it. Hover the icon for details. Studio installed from a local file or by another tool shows only the version; reinstall it with `dsh plugin add`.

## Preset list

![Preset list](images/en/preset-list.png)

The list shows every preset Studio manages:

| Preset | What it is |
|---|---|
| **Studio Master** | Read-only reference that contains every tool available in this profile. Use it to see what you can select. |
| **Optimized** | Built-in starting point for coding agents: a fixed list of 22 everyday tools, tuned tool descriptions and execution defaults, and short working instructions. It is locked: copy it to make changes. See [Adapt Optimized to your work](#adapt-optimized-to-your-work). |
| Your presets | Anything you create or copy. |

Each card shows its status — **Applied**, **Needs reapply** (saved changes not yet in DSH), or **Not applied** — and the number of tools and subagent roles. The card buttons:

- **Edit** opens the preset in the editor. Built-in presets cannot be edited.
- **Create copy** opens a new, unsaved preset prefilled from this one. Copies can be copied again.
- **Delete** removes the preset from Studio and from DSH. Existing conversations are kept.
- **Apply to DSH / Reapply to DSH** registers the saved preset with DSH. The arrow next to it offers **Unapply from DSH**.

If several presets share a warning, it is shown once above the cards instead of on every card.

Optimized follows the installed Studio version. Each time Studio starts, it resets Optimized to that version's tool list and defaults. If Optimized was applied, Studio reapplies it; if you unapplied it, it stays unapplied. Your copies are never changed.

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

**Preview prompt** assembles the system prompt exactly as DSH would for this preset, without starting an agent or calling a model. The left side lists every section in order; the right side lists the tools the model receives. Expand a tool to see its description and parameters (name, type, required, description) as an indented list. If you change settings while the preview is open, it tells you to run it again.

### Execution settings

![Execution settings](images/en/execution-settings.png)

Override plugin configuration for this preset only — for example, how much tool output is shown inline before it is saved to a file (`spill-policy`). Check a plugin to override it, then **Edit** to change fields. Only fields you change are saved; unchecking a plugin resets it. Plugins whose settings cannot be read are shown disabled, and so are the `tool-subagent` Configs, which `subagent_role` replaces.

### Subagent settings

![Subagents](images/en/subagents.png)

Studio replaces DSH's generic subagent tools (`subagent`, `subagent_fork`, `list_subagent_models`) with a single **`subagent_role`** tool, which keeps the initial prompt smaller. `send_message`, `interrupt_agent` and `list_agents` stay available for following up on, stopping and listing started subagents. You can review or edit the `subagent_role` description in the tool list.

Add **roles** to give the agent named specialists to delegate to:

![Role editor](images/en/role-editor.png)

| Field | Meaning |
|---|---|
| Name | Display name of the role. |
| Role ID | Identifier the agent uses when calling `subagent_role`. Must be unique. |
| Model | **Inherit parent model**, or a specific model from your configured providers. **Refresh models** reloads the list. |
| Reasoning | Reasoning effort supported by the chosen model, or the parent/model default. |
| Spawn mode | **New conversation (Fresh)** starts with only the task; **Continue parent (Fork)** also receives the conversation so far. |
| Role instructions (persona) | Replaces the persona for this role. Leave empty to keep the preset persona, shown as dimmed placeholder text. |
| Subagent Tool Filter | **Use preset default**, **Add to preset default**, or **This role only (ignore default)**. See [Subagent Tool Filter](#subagent-tool-filter). |

The agent writes the actual task each time it calls `subagent_role`. With **no roles**, `subagent_role` starts a fresh subagent with the parent's model, reasoning and preset instructions.

Models are checked when you apply the preset and again before each call, so an unavailable model fails early with a clear message.

#### Subagent Tool Filter

Tools in the **Subagent Tool Filter** are removed from every subagent of this preset. Remove tools a subagent does not need from its system prompt to keep its context light.

- It applies to both **New conversation (Fresh)** and **Continue parent (Fork)**, and to the subagent `subagent_role` starts when no roles are defined. The parent agent keeps every tool.
- A filtered tool disappears from the subagent's tool list together with its description, and calls to it are rejected. Its **Tool usage instructions** are removed from the subagent's system prompt as well; the parent's prompt and your edits on the Prompts & tools tab are unchanged.
- Only tools selected on the **Prompts & tools** tab can be filtered. If you deselect a tool there, it leaves the filter too. The filter is available once `subagent_role` is selected.
- **Per role:** in a role's editor, choose how that role uses the filter:

  | Option | Tools filtered for this role | When you change the preset default |
  |---|---|---|
  | **Use preset default** | The preset default | Follows it |
  | **Add to preset default** | The preset default plus the tools you pick. Default tools are shown locked. | Follows it |
  | **This role only (ignore default)** | Only the tools you pick, starting from an empty list | Not affected |

  Each role card shows its choice, for example `Tool Filter: default + 2`.

##### What each subagent receives

Take a preset that selects `read`, `write`, `edit`, `bash`, `ask_user_question` and `subagent_role`, with the default Tool Filter `ask_user_question`, and two roles: **worker** uses the preset default, **reviewer** adds `write`, `edit` and `bash`. Each agent's system prompt and tool list then look like this:

```text
                      Parent             worker (Fork)        reviewer (Fresh)
                      ─────────────────  ───────────────────  ───────────────────
System prompt
  Persona             ✓                  ✓                    ✓ (role persona if set)
  tool:bash guidance  ✓                  ✓                    ✗ removed
  tool:write guidance ✓                  ✓                    ✗ removed
  tool:edit guidance  ✓                  ✓                    ✗ removed
  Additional Studio
  instructions        ✓                  ✓ unchanged          ✓ unchanged

Tool list
  read                ✓                  ✓                    ✓
  write               ✓                  ✓                    ✗ filtered
  edit                ✓                  ✓                    ✗ filtered
  bash                ✓                  ✓                    ✗ filtered
  ask_user_question   ✓                  ✗ filtered           ✗ filtered
  subagent_role       ✓                  ✓                    ✓
                      ─────────────────  ───────────────────  ───────────────────
                      6 tools            5 tools              2 tools
```

- **✗ filtered**: the tool, its description and its parameter descriptions are gone from the subagent's tool list, and a call to it is rejected.
- **✗ removed**: usage instructions that only filtered tools use are dropped from that subagent's system prompt. Instructions shared with a tool the subagent keeps stay; for example `tool:jobs` stays until `job_list`, `job_output` and `job_kill` are all filtered.
- The parent is never affected, and neither are your edits on the Prompts & tools tab. **Preview prompt** shows the parent.
- Additional Studio instructions reach every subagent unchanged, including sentences that mention a filtered tool.

To confirm this in a running session, see [Appendix: Check a preset in a live session](appendix/preset-check.md).
- Sentences you write in **Additional Studio instructions** are still included. If they contain guidance a subagent does not need, you can move it to the role instructions (persona) or to a tool description.

#### Tips for subagent tools

A subagent sees every tool its parent has unless you filter it. Each tool's description is part of the subagent's prompt, so filtering tools it does not need keeps its context smaller and its choices clearer.

- **Filter tools that talk to the user.** A subagent works on a delegated task and reports back to its parent; it should not interrupt the user. `ask_user_question`, `present` and `exit_plan_mode` are good candidates.
- **Filter tools whose results belong to the parent.** If the parent tracks the plan or decides what to show the user, filter `todo_write` and the goal tools.
- **Give reviewers a read-only toolset.** Choose **Add to preset default** on a reviewer role and add `write`, `edit` and `bash`: it can read and report but not change files, and still loses the default tools.
- **Keep delegation where you want it.** With `send_message`, `interrupt_agent` and `list_agents` filtered, a subagent cannot steer other agents.
- **Check the effect.** The filter applies to subagents only, so **Preview prompt** still shows the parent's tools. Start a session and delegate a task to confirm what the subagent receives.

#### Settings that stay in DSH

The maximum recursion depth and the subagent parallelism limit follow **Built-in plugins → Subagent** in DSH settings. For model selection, the role settings of the Studio preset take precedence. The `tool-subagent` Configs in **Execution settings** are merged into `subagent_role` and cannot be turned on.

The DSH `tool-subagent` Config in **Execution settings** has its own `toolFilter`, but Studio replaces that plugin with `subagent_role`, so set the filter here instead.

## Adapt Optimized to your work

Optimized is tuned for **coding-agent work**: reading and editing code, running commands, and checking results. For anything else, treat it as a starting point. Select **Create copy** on Optimized and adjust the copy with the same screens described above — everything in the copy can be changed.

| If you want to… | Change this |
|---|---|
| Track long, multi-step objectives | Turn on the goal and todo tools (`create_goal`, `get_goal`, `update_goal`, `todo_write`) in **Prompts & tools**. |
| Develop or inspect DSH plugins | Turn on `cordis_inspect_list`, `cordis_inspect_query` and `plugin_manager`. |
| Work with Office files or data using the app's bundled Python and Node | Turn on `load_workspace_dependencies` (desktop app profile only; see [Tools that depend on your profile](#tools-that-depend-on-your-profile)). |
| Search X, or generate images and videos | Turn on `x_search`, `image_generate` or `video_generate` (only when a plugin in your profile provides them). |
| Do research, writing or operations instead of coding | Rewrite **Additional Studio instructions** for that work, and drop tools it does not need. |
| Change how much tool output stays inline | Adjust `spill-policy` in **Execution settings**. |
| Tune any other plugin behavior | Turn on that plugin in **Execution settings** and edit only the fields you need. |
| Steer how the model uses a tool | Edit its description, usage instructions or parameter text in the tool's **Details**. |
| Delegate to specialists | Add roles in **Subagent settings** with their own model, reasoning effort and persona. |
| Keep subagents focused | Add tools such as `ask_user_question` to the **Subagent Tool Filter**, or give a role its own list. See [Subagent Tool Filter](#subagent-tool-filter). |

Use **Preview prompt** after each change to confirm what the model will receive, then save and apply the copy. Optimized itself stays available as a reference, and you can keep several presets for different kinds of work.

## Apply a preset to DSH

1. Save the preset.
2. In **Preset list**, select **Apply to DSH** (or **Reapply to DSH** after changes).
3. Start a new session and choose the preset in DSH's preset picker.

An applied preset also appears under **CUSTOM** in DSH **Settings → Agent presets**. Select its card to make it the default for new tasks; it then shows **New task default**.

If applying fails, the previously applied version stays in effect and the list explains why. **Unapply from DSH** removes the preset from DSH but keeps it in Studio.

## Tool providers

**Tool providers** registers tools from other installed plugins in the Studio tool list, so presets can select them. Enter a JSON array of entries with `id`, `name` (the installed package) and `config`, then select **Validate and update master**. Registering runs the plugin's code, so add only plugins you trust. Studio does not install packages; install them first.

## Tools that depend on your profile

Studio Master lists only the tools that the plugins in **this profile** register. Some tools come from plugins that only certain environments load. For example, the desktop app adds `load_workspace_dependencies`, `x_search`, `image_generate` and `video_generate`, but a `dsh web` profile or a headless runtime may not have them. Optimized never selects these tools, so it works in every profile.

A preset can use only the tools it lists. If any selected tool is missing from the profile, Studio does not drop it silently:

- In the editor, the tool is marked **Not available in this profile**.
- Applying the preset fails, and the previously applied version stays in effect.
- Starting or resuming a session with an already applied preset fails with `Studio policy selected tools unavailable: <tool>`.

To use such a tool, install the plugin that provides it in that profile, or turn it on in the Studio tool list with **Tool providers**. If you work in several profiles, keep a separate copy for each profile and turn on only the tools that profile provides.

## Where data is stored

Presets are saved per DSH profile in `<profile>/studio-data/`. Applying a preset registers a Studio-owned DSH agent preset; Studio never edits DSH's own presets or your profile's package list.

## Troubleshooting

**"@matamt-dbg/dsh-studio: failed" after installing.** An earlier local build of Studio (`@local/dsh-studio`) is still installed in the same profile, and both try to register the same page. Remove the old one and restart:

```sh
dsh plugin --profile web remove @local/dsh-studio
```

Your saved presets are kept and migrated automatically.

**A preset shows "Needs reapply".** It was saved after it was last applied. Apply it again to update DSH.

**Applying or starting fails with "does not supply tools" or "selected tools unavailable".** The preset selects a tool that this profile does not provide, such as `load_workspace_dependencies` outside the desktop app. Install the plugin that provides it, or turn the tool off in your copy and apply again. See [Tools that depend on your profile](#tools-that-depend-on-your-profile).

**Optimized has different tools after an update.** This is expected: Optimized follows the installed Studio version. Your copies keep their own tools.
