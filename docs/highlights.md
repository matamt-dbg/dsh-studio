# What's new in DSH Studio 0.6.1

English | [한국어](highlights.ko.md)

Requires DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1` or `0.2.1-rc.2`. Full details are in the [Changelog](../CHANGELOG.md).

0.6.0 was released on GitHub but not on npm. 0.6.1 includes the 0.6.0 changes, plus support for newer DSH releases and a few fixes:

- **Pixie Loop**: repeat work → check → judge → retry over many items, outside the agent's context.
- **Per-session subagent roles**: change a role for one task without touching the preset.
- **DSH in Korean**: DSH's own screens in Korean along with Studio.
- **Studio shortcuts**: keyboard commands DSH does not have.
- **Newer DSH**: supports DSH `0.2.1-rc.1` and `0.2.1-rc.2`. Studio now applies role subagents' instructions and Tool Filter itself.

## Pixie Loop

When many items must be handled by the same rules, such as translating UI strings, polishing release notes or auditing files one by one, the agent hands the whole batch to the new `pixie_loop` tool. For each item the loop runs **work → exact checks → decision-engine judgment → Pixie feedback → retry**, outside the agent's conversation. The agent gets back only the counts, a results file and the items that never passed.

![A Pixie Loop run: the checks, and an item that passed on the second attempt after Pixie's feedback](images/en/pixie-loop-run.png)

### Example: translate UI strings

The run above came from one request to the agent:

> Translate the five strings in `items.jsonl` into Korean UI text with `pixie_loop`. Keep placeholders. Use 해요체 for sentences.

The agent wrote this spec and passed it to `pixie_loop`:

```json
{
  "items": { "path": "items.jsonl" },
  "work": { "instruction": "Translate the English UI string to natural Korean UI text. Keep placeholders exactly." },
  "shared": "Glossary: session → 세션. Use polite 해요체 for sentences.",
  "criteria": "The Korean keeps the full meaning of the English. It is natural Korean UI text. If there is a problem, say whether it is a mistranslation, omission, or unnatural wording.",
  "codeChecks": [{ "type": "placeholders" }, { "type": "regex", "pattern": "[가-힣]", "expect": "match" }],
  "calibration": {
    "pass": [{ "input": "Save {name}", "output": "{name} 저장" }],
    "fail": [{ "input": "Do not retry on 4xx", "output": "4xx에서도 재시도" }]
  },
  "limits": { "tokens": 300000, "timeMs": 600000 },
  "output": "loop-done.jsonl"
}
```

1. **Before the run**, Pixie turns the criteria into fixed questions, and the decision engine must tell the pass example from the fail example. If it cannot, the run does not start.
2. **Each item** is translated, checked for placeholders and Korean text, then judged. `Open the session` first came back as `세션을 열어요`. The decision engine scored it below the bar for natural UI text, Pixie suggested a noun form, and the next attempt, `세션 열기`, passed.
3. **The agent** receives `5 passed, 0 escalated` and the results file. The attempts and scores stay in **Pixie tab → Loops**, not in the conversation.

`act` runs each output with the session's `bash` tool and judges what it printed (for example testing CSS selectors against a page). `mode: "episode"` works step by step toward a goal, and `select` lets the decision engine pick one listed option. See the [Pixie Loop guide](appendix/pixie-loop.md).

### Loop recipes

Save a spec you use often as a **recipe** in **DSH Studio → Pixie → Gates → Loop recipes**. Its checks are calibrated once when saved. Agents run it with `pixie_loop` (`recipe`), gates can judge with it, and hook scripts call `pixie loop --recipe <name>`. **Insert example** fills in a working spec to start from, invalid names are flagged as you type, and the page tells you before a save replaces an existing recipe.

![Loop recipes page with a saved recipe and the editor](images/en/pixie-loop-recipes.png)

Item contents are sent to the Pixie model provider and the decision engine.

## Per-session subagent roles

Change a subagent role **for one task only**, without touching the preset. A new **Subagents** tab next to **Chat** and **Trajectory** lists the session's roles.

![Subagents tab of a session](images/en/session-subagents.png)

- **Edit a role's model, reasoning effort and instructions**, or add a role that exists only in this session. The preset and other sessions stay as they are.
- **Your copy is independent.** The first change copies the whole role into the session; later preset edits do not reach it until you choose **Use preset**.
- **Subagents follow their main session.** Subagents started from the session, and the ones they start, use the same roles. A subagent session shows them read-only.

![Editing a role in one session](images/en/session-role-edit.png)

Saved instructions replace the preset role's instructions for new subagents in this session. Subagents already created keep theirs. See [Per-session subagent roles](guide.md#per-session-subagent-roles).

## DSH in Korean

Choose **한국어** in DSH **Settings → General → Language**, and DSH's own screens switch to Korean along with Studio: chat, sidebars, settings, plugin manager, Trajectory and more.

![DSH settings shown in Korean](images/ko/dsh-korean-settings.png)

- **2,610 of 2,779** client strings in DSH `0.2.0-rc.2` and `0.2.1-alpha.2` are translated. Translated strings were checked by a decision engine for natural wording, meaning and tone. App names, units and format strings are kept as they are, and strings without a natural translation yet stay in English.
- **DSH `0.2.1-rc.1` and `0.2.1-rc.2` are covered too.** On DSH `0.2.1-rc.2`, 2,710 of its 2,910 client strings are translated, including the plugin market, web search settings and the newer model settings. 74 strings without a natural translation yet stay in English. Three plugin-manager messages follow `0.2.1-rc.1` and later, so on `0.2.0-rc.2` and `0.2.1-alpha.2` they show a placeholder such as `{reason}` as text.
- Text a plugin cannot reach stays in English: desktop app menus and dialogs, and text the DSH Host sends, such as tool descriptions and error messages.
- If DSH later ships Korean for a screen, that screen uses DSH's translation.

See [Show DSH in Korean](guide.md#show-dsh-in-korean).

## Studio shortcuts (SettingsX)

**DSH Studio → SettingsX → Shortcuts** adds keyboard commands DSH does not have:

![SettingsX Shortcuts page](images/en/settingsx-shortcuts.png)

| Command | Default key |
|---|---|
| Previous / next session, in sidebar order | ⌘⇧[ / ⌘⇧] (macOS desktop app) |
| Go to session 1–9 | none |
| Copy the session's working folder | none |
| Toggle full screen | none |

Assign keys in DSH's shortcut settings and turn commands on or off on the page. If another plugin already uses a default key, that command is added without a key and the other commands still work. See [Studio shortcuts](guide.md#studio-shortcuts-settingsx).

## Newer DSH releases

- **DSH `0.2.1-rc.1` and `0.2.1-rc.2` are supported.** These releases no longer apply a role's instructions and Tool Filter when a subagent starts. Studio now saves each role subagent's instructions and Tool Filter when it is created and applies them before it runs, for both Fresh and Fork subagents.
- Running role subagents with these instructions and Tool Filter was tested on `0.2.1-rc.1`; on `0.2.1-rc.2`, which made no change to the APIs Studio uses for this, only saving and reapplying roles was tested.
- They are saved under `<profile>/studio-data/child-policies/` and used again when a finished subagent is continued. **Keep this folder when backing up or moving a profile**; a subagent whose file is missing or damaged will not run.

## Before you upgrade

- Every session shows the **Chat / Subagents** tab bar, also when developer tools (Trajectory) are off.
- The model-visible `subagent_role` tool text changed slightly for every preset.
- Back up your profile first. The [Changelog](../CHANGELOG.md) lists what was tested on each DSH version.
