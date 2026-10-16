---
name: studio-pixie-hook-guide
description: Assemble DSH Studio Pixie Gate definitions and Pixie hook scripts for a user — choose the point, write the task, write and install a script, and explain how to save and verify it. Use when the user asks to build, write, debug, or explain a Pixie Gate or a script using `pixie ask`/`pixie judge`.
---

# DSH Studio Pixie Gate

Help the user build a Pixie Gate: a task the Pixie model runs at one point of an agent's work. The full contract — output fields, per-point rules, exit codes, environment, helper, decision engine, and worked example scripts — is in `guide.md` next to this file. Read it before writing a gate or a script.

## Decide the gate

1. Ask what should happen and when, if the user has not said. Map "when" to exactly one point:

   | Point (`when`) | Target text (stdin and what Pixie reads) |
   | --- | --- |
   | `user-message` | The user's instruction |
   | `agent-message` | A message between agents |
   | `tool-before` | Tool arguments JSON (`PIXIE_TOOL_NAME` holds the tool) |
   | `tool-after` | The tool result text |
   | `turn-end` | The agent's final answer |

2. Write the task (`instruction`) in plain words. Say which of the five output fields to use: verdict (`pass`/`stop`), reason, replacement, addition, note. Check the guide's application table: at `tool-before` and `turn-end` replacement and addition become notes; at `turn-end` stop asks the agent to redo with the reason.
3. For a judgment (yes/no threshold, picking one of fixed options, a graded score), write a hook script that calls `pixie judge` and decides the outcome itself: exit 10 to pass untouched, exit 11 to print the gate output, exit 0 only when Pixie should interpret the result. Gates have no judge option; the engine (LLM or TypeSafe Jev) is set in Studio → Pixie → Gates → Decision engine.
4. Use a hook script only when the two fields cannot express the flow: conditions (only some tools), loops, or external measurement. Prefer no script.

## Write a script

- Bash only (macOS and Linux). Save it as an executable file in the script folder (`chmod +x`): `<profile>/studio-data/pixie-gate/commands/` unless the user set another under Gates → Scope (`<profile>/studio-data/pixie-gate/settings.json`, `scriptDirectory`). Use letters, digits, `_`, `.`, `-`; no subfolders, no `..`.
- Read the target from stdin. Print what the task needs to stdout (256 KB max); print a JSON object to fill `{{hooks.<name>.data}}`. `<name>` is the file name without its last extension.
- Exit 0 to run the Pixie task, 10 to skip the gate, 11 to apply stdout as the gate output (a JSON object with optional `verdict`, `reason`, `replace`, `append`, `note`; no Pixie call). Anything else is an error. A gate whose script always exits 10 or 11 may have an empty task; exit 0 then fails.
- Use `pixie ask "<instruction>" [--input]` and `pixie judge [--type bool|select|score] --question "…" [--json] [--input]`. bool takes `--threshold` (default 0.5) and optional `--true`/`--false` meanings, prints the yes probability, exits 0 at or above the threshold and 1 below; select takes two or more `--option name="description"` and prints the chosen name; score takes 2–10 `--level "description"` (lowest first) and prints the score. `--json` prints `{"type","label","answer","engine"}`. Errors exit 2 and never become a "no". With `--input` the helper reads stdin; otherwise it uses the gate target. At most 20 helper calls per run.
- Write the whole judgment in `--question`: question IDs never reach the model. For several inputs (source and translation, answer and evidence), pipe a JSON object built with `jq` and name its fields in backticks in the question.
- The script runs in the session working directory under the session sandbox. Do not write files unless the session can write; never try to escape the sandbox.
- In the task, reference only `{{hooks.<name>.text}}` and `{{hooks.<name>.data}}` of the chosen script.
- At `turn-end`, a note concluded with exit 11 shows under that turn's answer in the chat. Start it with a bracketed label line (e.g. `[한국어 번역]`) to title the block; a label containing `not verified`/`미확인` gets a warning badge.

Test a script by hand before relying on it: `printf 'sample' | PIXIE_POINT=tool-after PIXIE_TOOL_NAME=grep ./script.sh; echo $?`. The helper only works inside a real gate run.

## Hand over

Do not edit `definitions.json` unless the user asks you to; prefer guiding them through **Studio → Pixie → Gates**. When you do write it, it is a JSON array of objects:

```json
{ "id": "<uuid>", "name": "…", "enabled": true, "when": "user-message", "instruction": "…",
  "advanced": { "confirmReplace": false, "onError": "pass", "agents": "root", "timeoutMs": 60000, "maxSteers": 1, "script": "optional.sh" },
  "presetIds": ["<preset id>"], "disabledPresetIds": ["<attached preset where it is off>"] }
```

`enabled` switches the gate everywhere; `disabledPresetIds` (optional) switches it off for listed attached presets only. Only one gate per preset and `when` may be on for that preset. Studio validates the file on save and on read; invalid entries are ignored at runtime.

If a gate never runs in one session, check **Pixie tab → Gates → Gates in this session**: users can switch gates off per session.

Tell the user how to verify: run **Try it** in the editor (it skips scripts), then send a real message in a session using the chosen preset and open the gate record in the Pixie tab. Report what the record shows, not what should happen.
