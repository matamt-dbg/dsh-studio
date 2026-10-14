---
name: dsh-studio-preset-check
description: Verify that a DSH Studio preset reached a live session as configured, including tools, tool descriptions, execution defaults, instructions, and subagent roles with their Tool Filter. Use when the user asks to check, verify, or test a Studio preset or its subagent settings.
---

# DSH Studio preset check

Check that the Studio preset running this session, and the subagents it starts, received what the preset file configures. Report what the session actually received, never what it should have received.

The check is read-only. Do not change files, presets, profiles, or Studio settings. Subagent tasks must be read-only too.

## Inputs

- **Profile**: the DSH profile running this session. Default `desktop`; for `dsh web` it is usually `web`. Ask only if the user named neither and the default fails.
- **Roles to exercise** (optional): role IDs the user wants started, for example `worker` and `reviewer`. If the user names none, check the parent only and say so in the report.
- **Script**: `check-preset.mjs` in the same directory as this file. Find this file's path from the skill catalog entry. If the script is not next to this file, stop and report where you looked.

## 1. Confirm the setup

1. Note the tools you can call now. This is the parent tool list.
2. If roles were requested and `subagent_role` is available, call it with `action: list` and confirm each requested role exists. If a role is missing, or `subagent_role` is not available, report that and check the parent only.
3. Find this session's ID. If you cannot see it, run step 3 with the most recent session (newest `session-*` under `~/.dsh/sessions/*/`) and record that you did.

## 2. Start the requested subagents

Call `subagent_role` once per requested role with `action: call`. Requests are independent; start them together. Use this task text unchanged:

```text
Report exactly which tools you can call, without calling any tool except as stated.
1. List every tool name available to you, sorted, one per line.
2. Quote any sentence in your system prompt that tells you how to use bash, background jobs, or workflow. Write "none" if there is none.
3. Call the read tool once on README.md in the working directory (first 5 lines) and say whether it succeeded. Skip this if read is not in your list.
Do not modify anything.
```

Wait for every subagent to report before step 3. Record each report. If a subagent ends with an error, record the full error text.

Do not ask a subagent to call `ask_user_question`, `present`, or any tool that writes. Whether it has those tools is decided from the session log, not by calling them.

## 3. Run the check

From any directory:

```sh
node <skill-directory>/check-preset.mjs <session-id> --profile <profile>
```

Add `--json` for machine-readable output. The exit code is 1 if any check fails.

The script reads the stored preset (`<dsh-home>/profiles/<profile>/studio-data/presets.json`) as the source of truth and compares it with the session logs of this session and every subagent it started. Each line is `PASS`, `FAIL`, or `UNKNOWN` with a reason:

| Group | What it compares |
|---|---|
| `build` | The Studio version installed in the profile, and whether this session could have run it. A session runs the build its app loaded at start. |
| `preset` | Whether the preset is applied, and whether it changed after the session started. |
| `parent` | Tools, edited tool and parameter descriptions, execution defaults, additional instructions, persona, and edited usage instructions. |
| `subagent …` | For each child: its role, spawn mode, model, the Tool Filter DSH recorded against the one the role's mode implies, its tools (parent minus Tool Filter), and that usage instructions belonging only to filtered tools are gone. |

## 4. Judge

- Use the script result as the verdict. Subagent self-reports are evidence only; if a self-report disagrees with the script, report both.
- A `build` result other than PASS means the session may have run another Studio build. Keep the other results, but say they apply to that build and tell the user to restart the app and check in a new session.
- An `UNKNOWN` is not a pass. Report its reason.
- A filtered tool that never reached a subagent cannot be called, so no "Tool excluded" error is expected. Absence from the subagent's tools is the proof.
- Studio's additional instructions reach subagents unchanged by design. Text there that mentions a filtered tool is not a failure; mention it as a note.

## Report

Write the report in the user's language, using this structure:

```markdown
## Studio preset check

- Session: <id> (<found directly / most recent session>)
- Preset: <name> (<id>), profile <profile>, Studio <version>
- Result: <n> pass, <n> fail, <n> unknown

| Scope | Check | Result | Detail |
|---|---|---|---|
| … | … | PASS/FAIL/UNKNOWN | … |

### Subagent self-reports
- <role>: <tool count>; differences from the log: <none / list>

### Failures and unknowns
- <each FAIL and UNKNOWN with its detail and what the user can do>

### Not run
- <skipped steps and why>
```

List every check line from the script, including passes. Do not round an UNKNOWN up to PASS.
