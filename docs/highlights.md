# What's new in DSH Studio (next release)

English | [한국어](highlights.ko.md)

Requires DSH `0.2.0-rc.2` or `0.2.1-alpha.2`. Full details are in the [Changelog](../CHANGELOG.md).

This release brings three features: per-session subagent roles, DSH in Korean, and Studio shortcuts.

## Per-session subagent roles

Change a subagent role **for one task only**, without touching the preset. A new **Subagents** tab next to **Chat** and **Trajectory** lists the session's roles.

![Subagents tab of a session](images/en/session-subagents.png)

- **Edit a role's model, reasoning effort and instructions**, or add a role that exists only in this session. The preset and other sessions stay as they are.
- **Your copy is independent.** The first change copies the whole role into the session; later preset edits do not reach it until you choose **Use preset**.
- **Subagents follow their main session.** Subagents started from the session, and the ones they start, use the same roles. A subagent session shows them read-only.

![Editing a role in one session](images/en/session-role-edit.png)

Changes apply from the next delegation. See [Per-session subagent roles](guide.md#per-session-subagent-roles).

## DSH in Korean

Choose **한국어** in DSH **Settings → General → Language**, and DSH's own screens switch to Korean along with Studio: chat, sidebars, settings, plugin manager, Trajectory and more.

![DSH settings shown in Korean](images/ko/dsh-korean-settings.png)

- **2,610 of 2,779** client strings in DSH `0.2.0-rc.2` and `0.2.1-alpha.2` are translated. Translated strings were checked by a decision engine for natural wording, meaning and tone. App names, units and format strings are kept as they are, and strings without a natural translation yet stay in English.
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

Assign keys in DSH's shortcut settings and turn commands on or off on the page. See [Studio shortcuts](guide.md#studio-shortcuts-settingsx).

## Before you upgrade

- Every session shows the **Chat / Subagents** tab bar, also when developer tools (Trajectory) are off.
- The model-visible `subagent_role` tool text changed slightly for every preset.
