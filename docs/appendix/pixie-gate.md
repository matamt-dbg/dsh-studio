# Pixie Gate guide

English | [한국어](pixie-gate.ko.md)

Pixie Gate lets the **Pixie model read, judge, and rework content** at a set moment in an agent's work, then sends the result to the agent or to you. Rules and external jobs belong to DSH command hooks (Claude Code and Codex hooks); Pixie Gate is the layer above them for work that needs a model's judgment. It works on the original text alone, without any hook.

- [Create a gate](#create-a-gate)
- [When, and how results apply](#when-and-how-results-apply)
- [Advanced options](#advanced-options)
- [Pixie hook scripts](#pixie-hook-scripts)
- [The pixie helper](#the-pixie-helper)
- [Example scripts](#example-scripts)
- [Run records](#run-records)
- [Limits and troubleshooting](#limits-and-troubleshooting)

## Create a gate

1. In **Studio → Pixie → Settings → Model**, choose the Pixie model. Gates and the helper (`pixie ask`, `pixie judge`) all use it.
2. In **Gates → Gate composition**, press **New gate** and pick a template. Each point has one representative template (instruction format check, agent message protocol, block risky commands, digest long tool results, verify the final answer); the blank gate is last. The switch on each card turns the gate on or off everywhere.
3. Set **When** and **What Pixie does**. Write the task in plain words: whether to pass or stop, what to replace or add, and what note to show only to you.
4. Put a sample in **Try it** and run it. The configured Pixie model really answers; nothing is recorded or sent to a session.
5. Press **Apply**, then **Save** at the top of the page. Only saved gates apply to runs.
6. **Gates → Scope** sets the script folder at the top and then lists the presets made in Studio. Gates not yet added to a Studio preset are collected at the bottom. Use **Add gate** on a preset to attach a gate, and the row switch to turn it on or off **for that preset only**. A gate can be attached to several presets; one preset's switch never affects another. Save to apply. A gate runs only for agents using those presets.

Only one enabled gate per preset and **When** is allowed (the page warns, and saving is refused). Saved definitions live in `<profile>/studio-data/pixie-gate/definitions.json`.

## When, and how results apply

Pixie answers with five fields, all optional. Without a verdict the gate passes.

| Field | Meaning |
| --- | --- |
| Verdict | `pass` or `stop` |
| Reason | Why it stopped; the correction to make |
| Replacement | Text that replaces the target |
| Addition | Text sent along with the target |
| Note | Shown only to you |

Each point applies them in a fixed way. Output a point cannot apply becomes a note, not an error.

| When | Stop + reason | Replacement | Addition | Note |
| --- | --- | --- | --- | --- |
| You send an instruction | Input rejected; the run record keeps a restore card | Message replaced (optional confirmation) | Sent along | Recorded |
| Agents message each other | Input rejected | Message replaced | Sent along | Recorded |
| Before a tool runs | Execution denied (the reason reaches the agent) | As a note | As a note | Recorded |
| A tool result arrives | Result blocked (the reason reaches the agent) | Result replaced (not for structured results carrying a value) | Sent along | Recorded |
| The agent finishes its answer | Asked to redo it with the reason (per-turn limit) | As a note | As a note | Recorded |

When the verdict is stop, the replacement and addition never reach the main model. At message points the replacement becomes the rejection's suggestion and the addition becomes a note. Input or tools another hook already rejected do not run the gate.

## Advanced options

| Option | Default | Description |
| --- | --- | --- |
| Pixie hook script | None | A script run before the task. See [below](#pixie-hook-scripts) |
| Confirm before replacing | Off | Stops a real replacement and shows it as a suggestion (message points) |
| On error | Pass | Pass or stop on model or script errors and timeouts |
| Target agents | Root (child for agent messages) | Root, child, or any |
| Time limit | 60 s | Script, helper, and model calls together |
| Redo limit | 1 | Corrections per turn at the answer-end point |

## Pixie hook scripts

Build flows the two fields cannot express — only certain tools, translate → judge → retranslate loops, external measurements — as a script. Studio does not build features one by one; it gives scripts the means.

- **Location:** the default is `<profile>/studio-data/pixie-gate/commands/`; change it under **Gates → Scope → Script folder** to another absolute or `~/…` path, and use **Open folder** to show it in Finder or Explorer (when DSH runs on your desktop). Leave it empty to restore the default; the folder is not created for you. Only executable files (`chmod +x`) in that folder can be chosen. Subfolders, links pointing outside the folder, and names containing `..` are excluded. Press **Refresh list** after adding a file.
- **Supported environments:** available only when DSH runs with a bash profile (macOS and Linux). Windows is not supported yet; where scripts are unsupported the gate does not run them and applies its error policy.
- **Working directory and sandbox:** scripts run in the session working directory through the DSH shell service, under the session's sandbox policy. A read-only session cannot write files.
- **Trials** do not run the script because no session policy is known. Check it in a real session.

### Input, output, exit codes

| Item | Rule |
| --- | --- |
| stdin | The target text (instruction, message, tool arguments JSON, tool result, final answer) |
| stdout | Use it in the task as `{{hooks.<name>.text}}`; only boundary newlines are removed; up to 256 KB |
| stdout is a JSON object | `{{hooks.<name>.data}}` holds that JSON; otherwise it is empty |
| exit 0 | Continue: Pixie runs the task |
| exit 10 | Skip this gate: the original flow continues, no model call |
| Other, or timeout | Error: the error policy applies |

`<name>` is the file name without its last extension (`measure-subtitle.sh` → `measure-subtitle`). A task using an undefined variable cannot be saved.

### Environment

| Variable | Value |
| --- | --- |
| `PIXIE_POINT` | `user-message`, `agent-message`, `tool-before`, `tool-after`, `turn-end` |
| `PIXIE_TOOL_NAME`, `PIXIE_TOOL_ARGS` | Tool name and arguments JSON at tool points |
| `PIXIE_AGENT` | `root` or `child` |
| `PIXIE_SESSION_ID`, `PIXIE_TURN` | Session ID and turn number |
| `PIXIE_GATE_NAME` | Gate name |
| `PIXIE_URL`, `PIXIE_TOKEN` | For the `pixie` helper; issued per run and revoked when the script ends |

## The pixie helper

Inside a script, the `pixie` command calls the Pixie model. It is first on the script's `PATH` and needs curl.

```sh
pixie ask "<instruction>" [--input]
pixie judge --question "<question>" [--threshold 0.5] [--input]
```

- With `--input` the helper reads its input from stdin; otherwise it uses the gate target.
- `ask` prints the answer and exits 0, using the Pixie model.
- `judge` prints the "yes" probability and exits 0 at or above the threshold, 1 below it, using the Pixie model.
- Usage, token, limit, and model errors exit 2 with a message on stderr. A failed helper call never decides the gate; the script's exit code does.
- Limits: 20 calls and 256 KB per request for each run. Calls follow the gate time limit and cancellation; their usage is added to the gate and listed under **Helper calls** in the run record.
- A token reaches only that run's ask and judge. The helper uses a Studio route on the DSH web server, so it is unavailable without one (for example, headless).

## Example scripts

**Tool filter** (`only-search-tools.sh`, when a tool result arrives): run the gate only for long search results.

```bash
#!/bin/bash
case "$PIXIE_TOOL_NAME" in grep|glob|web_search) ;; *) exit 10 ;; esac
size=$(wc -c)
[ "$size" -gt 4000 ] || exit 10
echo "$size"
```

**Subtitle measurement** (`measure-subtitle.sh`, when you send an instruction): pass the measurement as JSON.

```bash
#!/bin/bash
text=$(cat)
lines=$(printf '%s' "$text" | grep -c -- '-->' || true)
printf '{"cues":%d,"bytes":%d}\n' "$lines" "${#text}"
```

Task: `Measured: {{hooks.measure-subtitle.data}}` …

**Translation loop** (`translate-until-ok.sh`, when the agent finishes its answer): translate, and retranslate up to three times until the judge passes it.

```bash
#!/bin/bash
source=$(cat)
for _ in 1 2 3; do
  draft=$(printf '%s' "$source" | pixie ask "Translate into natural Korean. Output only the translation." --input) || exit 1
  if printf '%s' "$draft" | pixie judge --question "Is this a faithful, natural Korean translation?" --threshold 0.7 --input >/dev/null; then
    printf '%s\n' "$draft"; exit 0
  fi
done
exit 10
```

Task: `Put this translation in the note as is.\n{{hooks.translate-until-ok.text}}`

**Changed files** (`list-changed-files.sh`, when the agent finishes its answer): report git changes in the working directory.

```bash
#!/bin/bash
git status --porcelain 2>/dev/null | head -50
```

## Run records

The gate records in the session's right-side **Pixie** tab list each run. The detail shows the action actually applied (replaced, appended, rejected, blocked, steered, none), Pixie's five output fields, token usage, original and final text, notes, and helper calls. For a rejected input, **Edit and send** puts the suggestion (or the original) into the composer.

## Limits and troubleshooting

- **A gate does not run.** Check that it is on, has a preset, and is saved; that the session runs that preset; and that the target agents (root or child) match. Without a Pixie model the error policy applies.
- **`hook-script-unsupported`** means no bash executor is available.
- **`Session sandbox policy and cwd are required`** means the session policy is unknown.
- **`pixie: helper is not available`** means there is no web server, or the command ran outside a script run.
- **`pixie: HTTP 401`** means the run already ended or the token belongs to another run. **429** is the call limit; **413** is the request size limit.
- Sandboxes that block local network access can make helper calls fail.
- Background tasks (pre-compaction, file pre-indexing) are not supported yet.
