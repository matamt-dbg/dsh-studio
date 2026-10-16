---
name: dsh-studio-pixie-gate
description: Assemble DSH Studio Pixie Gate definitions and Pixie hook scripts for a user — choose the point, write the task, write and install a script, and explain how to save and verify it. Use when the user asks to build, write, debug, or explain a Pixie Gate or a script using `pixie ask`/`pixie judge`.
---

# DSH Studio Pixie Gate

Help the user build a Pixie Gate: a task the Pixie model runs at one point of an agent's work. The full contract is in the Pixie Gate guide (`../pixie-gate.md`, next to this folder). Read it before writing a gate or a script.

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
3. For a strict yes/no threshold, write a hook script that calls `pixie judge` and exits 10 or prints the outcome; gates have no judge option.
4. Use a hook script only when the two fields cannot express the flow: conditions (only some tools), loops, or external measurement. Prefer no script.

## Write a script

- Bash only (macOS and Linux). Save it as an executable file in the script folder (`chmod +x`): `<profile>/studio-data/pixie-gate/commands/` unless the user set another under Gates → Scope (`<profile>/studio-data/pixie-gate/settings.json`, `scriptDirectory`). Use letters, digits, `_`, `.`, `-`; no subfolders, no `..`.
- Read the target from stdin. Print what the task needs to stdout (256 KB max); print a JSON object to fill `{{hooks.<name>.data}}`. `<name>` is the file name without its last extension.
- Exit 0 to continue, 10 to skip the gate, anything else is an error.
- Use `pixie ask "<instruction>" [--input]` and `pixie judge --question "…" [--threshold 0.5] [--input]`. With `--input` the helper reads stdin; otherwise it uses the gate target. `judge` exits 0 on pass, 1 below threshold, 2 on errors. At most 20 helper calls per run.
- The script runs in the session working directory under the session sandbox. Do not write files unless the session can write; never try to escape the sandbox.
- In the task, reference only `{{hooks.<name>.text}}` and `{{hooks.<name>.data}}` of the chosen script.

Test a script by hand before relying on it: `printf 'sample' | PIXIE_POINT=tool-after PIXIE_TOOL_NAME=grep ./script.sh; echo $?`. The helper only works inside a real gate run.

## Hand over

Do not edit `definitions.json` unless the user asks you to; prefer guiding them through **Studio → Pixie → Gates**. When you do write it, it is a JSON array of objects:

```json
{ "id": "<uuid>", "name": "…", "enabled": true, "when": "user-message", "instruction": "…",
  "advanced": { "confirmReplace": false, "onError": "pass", "agents": "root", "timeoutMs": 60000, "maxSteers": 1, "script": "optional.sh" },
  "presetIds": ["<preset id>"], "disabledPresetIds": ["<attached preset where it is off>"] }
```

`enabled` switches the gate everywhere; `disabledPresetIds` (optional) switches it off for listed attached presets only. Only one gate per preset and `when` may be on for that preset. Studio validates the file on save and on read; invalid entries are ignored at runtime.

Tell the user how to verify: run **Try it** in the editor (it skips scripts), then send a real message in a session using the chosen preset and open the gate record in the Pixie tab. Report what the record shows, not what should happen.
