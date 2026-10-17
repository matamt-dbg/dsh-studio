# Pixie Loop guide

English | [한국어](pixie-loop.ko.md)

Pixie Loop repeats **work → judge → fix and retry** outside the main agent's conversation when many items are judged by the same criteria. The agent passes one loop spec to the `pixie_loop` tool and gets back counts, a results file, and only the items that never passed. The attempts and judgments per item stay out of the conversation; see them in **Pixie tab → Loops**.

- [When to use it](#when-to-use-it)
- [Setup](#setup)
- [How it works](#how-it-works)
- [Spec fields](#spec-fields)
- [Writing criteria](#writing-criteria)
- [Calibration examples](#calibration-examples)
- [Code checks](#code-checks)
- [Limits and results](#limits-and-results)
- [Example specs](#example-specs)
- [Run and judge (act)](#run-and-judge-act)
- [Episodes and selection](#episodes-and-selection)
- [Grouping results (route)](#grouping-results-route)
- [Recipes](#recipes)
- [Viewing runs](#viewing-runs)
- [What it cannot do](#what-it-cannot-do)
- [Agent skill](#agent-skill)

## When to use it

| Situation | Use |
| --- | --- |
| Many independent items, all judged by the same criteria (translation review, copy edits, per-file audits) | `pixie_loop` |
| One judgment is enough | the `judge` tool |
| The work needs finding and reading files and several steps of judgment | `subagent_role` |
| Branching flows or many agents working together | the DSH `workflow` tool |
| Automatic checks at a set moment of the agent's work | [Pixie Gate](pixie-gate.md) |

## Setup

- Set the Pixie model in **Studio → Pixie → Settings**. It does the work, compiles criteria, and writes feedback.
- Choose the decision engine (LLM or TypeSafe Jev) in **Studio → Pixie → Gates → Decision engine**. Jev needs an API key.
- The preset needs the `pixie_loop` tool. Studio Master includes it.

Item contents are sent to the Pixie model provider and to the decision engine (TypeSafe, when Jev is chosen).

## How it works

1. **Prepare checks (once):** Pixie turns `criteria` into decision-engine questions and pass rules. Giving `checks` skips this step.
2. **Calibrate (once):** every pass example must pass and every fail example must fail. Otherwise the loop does not start and returns an error. When calibration passes, the loop starts without asking.
3. **Per item:**
   - Pixie produces an output from `work.instruction` and `shared`.
   - Code checks (`codeChecks`) run first. If any fails, the decision engine is not called.
   - The decision engine judges with the fixed questions; pass rules decide.
   - On failure Pixie writes what to change, and the same item is tried again.
4. **End:** the results file is written and the summary returned.

Context rules:

- Items never see each other or the main conversation.
- An item's retries accumulate that item's previous outputs and feedback.
- Compiling checks and writing feedback each start from a fresh conversation.

Only code checks and the decision engine decide pass or fail. Pixie's feedback guides the next attempt and never changes a verdict. The decision engine gives no reasons, so the reasons in the feedback are Pixie's guess.

## Spec fields

| Field | Required | Description |
| --- | --- | --- |
| `items` | yes | `{ "inline": [{ "id", "input" }] }` or `{ "path": "work/items.jsonl" }` with one `{"id","input"}` per line. Ids are unique. Up to 2000 items, 32,000 characters per input |
| `work.instruction` | yes, without recipe | What to do with one item. The worker has no tools |
| `shared` | | Fixed material every item sees (glossary, style guide). Up to 64,000 characters |
| `criteria` | one of | Review criteria in plain words. Only a plain pick-once `select` may omit both |
| `checks` | one of | Questions and pass rules given directly; see [below](#giving-checks-directly) |
| `codeChecks` | | Exact checks run before the decision engine; see [Code checks](#code-checks) |
| `calibration` | yes, with criteria or checks | `{ "pass": [{ "input", "output", "observation"? }], "fail": [...] }`, 1–10 each |
| `mode` | | `retry` (default) or `episode`; see [episodes](#episodes-and-selection) |
| `act` | | Run each output and judge what it printed; see [act](#run-and-judge-act) |
| `extract` | | Shorten observations before judging |
| `select` | | The decision engine picks one listed option |
| `route` | | Group results by a choice answer; see [route](#grouping-results-route) |
| `maxAttempts` | | Tries per item (at most 10) or steps per episode (at most 100). Default 3 |
| `concurrency` | | Items in flight. Default 4, at most 8 |
| `limits` | yes, without recipe | `{ "tokens", "timeMs" }`. Reaching either stops the run; remaining items are reported as skipped |
| `output` | | Results JSONL path |
| `recipe` | | A saved [recipe](#recipes) name; with it give only `items`, `output`, and `run_in_background` |
| `run_in_background` | | `true` returns a job id at once. Collect the summary with `job_output`; stop with `job_kill` |

## Writing criteria

The decision engine judges a state holding `input` (the item) and `output` (the worker's result).

- **One thing per sentence.** Split "keeps the meaning, is polite, follows the glossary" into three sentences; Pixie makes one question from each.
- **Name failure types.** "If there is a problem, say whether it is a mistranslation, terminology, tone, or omission" yields a choice question and sharper feedback.
- **Keep exact checks out of criteria.** Placeholder preservation, JSON shape, and required characters belong in [code checks](#code-checks). The decision engine returns probabilities and is a poor fit for them.
- The decision engine is most accurate with English questions; English criteria are more stable.

### Giving checks directly

```json
{
  "questions": {
    "faithful": { "type": "noul", "instructions": "Does `output` keep the full meaning of `input`?" },
    "issue": { "type": "choice", "instructions": "What is the main problem in `output`?",
      "criteria": { "ok": "no problem", "mistranslation": "meaning changed", "terminology": "glossary not followed", "tone": "not polite 해요체" } },
    "natural": { "type": "score", "instructions": "How natural is `output` as Korean UI text?", "criteria": ["awkward", "understandable", "natural"] }
  },
  "pass": { "faithful": { "min": 0.7 }, "issue": { "accept": ["ok"] }, "natural": { "min": 1.5 } }
}
```

- `noul`: probability of yes. Passes at `min` (above 0, at most 1) or more. Phrase it so yes is the good answer.
- `choice`: passes when the choice is in `accept`. At least one option must fail.
- `score`: level index from 0. Passes at `min` or more.
- 1–10 questions. Question ids do not reach the engine, so `instructions` must carry the whole meaning.

## Calibration examples

Calibration checks that the criteria actually separate good from bad outputs before hundreds of items run on a wrong standard.

- **pass:** outputs you would accept. One common form and one borderline-but-fine case work well.
- **fail:** realistic mistakes, one per criterion (changed meaning, wrong register, missing placeholder).
- Only obvious examples (empty strings, another language) make the check weak.

When the start is refused, the error names each example judged the wrong way and its values. Reword that question or give `checks` directly and run again.

## Code checks

| Check | Options | Fails when |
| --- | --- | --- |
| `{"type":"placeholders"}` | | Placeholders, tags, inline code spans, and Markdown link targets in the input (`{name}`, `{{count}}`, `%s`/`%1$d`, `<b>`/`</b>`) are not all in the output the same number of times, or new ones appear |
| `{"type":"regex","pattern":"[가-힣]","expect":"match"}` | `flags`: `i` `m` `s` `u` | `match`: the output does not match; `no-match`: it does |
| `{"type":"json","keys":["title"]}` | `keys` optional | The output is not JSON, or the object lacks a listed key |

A failed code check is passed to the next attempt as is.

## Limits and results

- `limits.tokens` counts Pixie and decision-engine input and output tokens. Estimate roughly `items × attempts × (input + output + shared)` and leave headroom.
- A stopped run has status `stopped` and the remaining items `skipped`. Rerun with only the ids missing from the results file to continue.
- Each results line: `{"id","status","output"?,"attempts","error"?}` with `status` `passed`, `escalated`, `error`, or `cancelled`.
- The agent's summary: passed count, `escalated` (items that used every attempt without passing: id, attempts, failed checks, last feedback), `errors` (engine failures and the like), skipped count, results file, usage. Passed outputs are not in the summary.
- The main agent fixes `escalated` items itself or asks you.
- A decision-engine failure is never turned into a fail; the item is marked `error`.

## Example specs

### Translation review

```json
{
  "items": { "path": "work/ko-pending.jsonl" },
  "shared": "Glossary: session → 세션, preset → 프리셋, tool → 도구. UI copy uses polite 해요체 and no trailing period on buttons.",
  "work": { "instruction": "Translate the English UI string to natural Korean. Keep placeholders and tags exactly." },
  "criteria": "The Korean keeps the full meaning of the English. It follows the glossary in shared context. It uses polite 해요체. If there is a problem, say whether it is a mistranslation, terminology, tone, or omission.",
  "codeChecks": [{ "type": "placeholders" }, { "type": "regex", "pattern": "[가-힣]", "expect": "match" }],
  "calibration": {
    "pass": [{ "input": "Save {name}", "output": "{name} 저장" }, { "input": "Open the session", "output": "세션 열기" }],
    "fail": [{ "input": "Do not retry on 4xx", "output": "4xx에서도 재시도" }, { "input": "Open the session", "output": "세션을 열어라" }]
  },
  "maxAttempts": 3, "concurrency": 4,
  "limits": { "tokens": 2000000, "timeMs": 3600000 },
  "output": "work/ko-done.jsonl",
  "run_in_background": true
}
```

### Copy edit

```json
{
  "items": { "inline": [{ "id": "intro", "input": "Studio let you build preset and apply it to session." }] },
  "work": { "instruction": "Fix grammar and clarity. Keep the meaning, terms, and Markdown. Reply with the corrected paragraph only." },
  "criteria": "The output keeps the meaning of the input. The output has no grammar errors. The output does not add new claims.",
  "calibration": {
    "pass": [{ "input": "It work fine.", "output": "It works fine." }],
    "fail": [{ "input": "It work fine.", "output": "It works perfectly and is the fastest option." }]
  },
  "limits": { "tokens": 200000, "timeMs": 600000 }
}
```

### Per-file audit (item = file content)

The agent reads the files into `items` or a JSONL file first; the worker cannot read files.

```json
{
  "items": { "path": "work/handlers.jsonl" },
  "work": { "instruction": "List every place in this source file where user input reaches a shell command or SQL string without escaping. Reply with JSON: {\"findings\": [{\"line\": number, \"why\": string}]}. Use an empty list when there are none." },
  "criteria": "Every finding in output points to real unescaped user input in input. No real case in input is missing from output.",
  "codeChecks": [{ "type": "json", "keys": ["findings"] }],
  "calibration": {
    "pass": [{ "input": "exec(`ls ${req.query.dir}`)", "output": "{\"findings\":[{\"line\":1,\"why\":\"query param in shell command\"}]}" }],
    "fail": [{ "input": "exec(`ls ${req.query.dir}`)", "output": "{\"findings\":[]}" }]
  },
  "maxAttempts": 2,
  "limits": { "tokens": 1500000, "timeMs": 1800000 },
  "output": "work/audit.jsonl"
}
```

## Run and judge (act)

When an output only proves itself by running it (CSS selectors, regular expressions, command options, config snippets), use `act`. The loop runs one command per output with the session's `bash` tool, and the decision engine judges what it printed (`observation`). The worker (Pixie) still has no tools.

```json
{
  "items": { "inline": [{ "id": "save-button", "input": "Find a CSS selector for the Save button in page.html" }] },
  "work": { "instruction": "Reply with one CSS selector only." },
  "criteria": "The observation shows exactly one element matched and its text is Save.",
  "act": { "tool": "bash", "command": "node probe.mjs page.html {{output}}", "safeToRepeat": true, "isolated": true, "timeoutMs": 30000 },
  "extract": { "instruction": "Keep the match count and the matched element's text." },
  "calibration": {
    "pass": [{ "input": "Find the Save button", "output": "#save", "observation": "matches: 1\ntext: Save" }],
    "fail": [{ "input": "Find the Save button", "output": "button", "observation": "matches: 4\ntext: Save, Cancel, Help, Close" }]
  },
  "maxAttempts": 4,
  "limits": { "tokens": 300000, "timeMs": 900000 }
}
```

- `{{output}}`, `{{input}}`, `{{id}}` in `command` become one single-quoted word each. Quotes or `;` in an output cannot break the command or run another one. So write them as separate words, never inside quotes or glued to other text (`"{{output}}"` and `x{{output}}` are refused).
- A command that runs past its time limit is stopped and judged as a `[timed out …]` observation; it never overlaps the next act.
- `safeToRepeat: true` is required: retries and episodes run the command again. Never use it for anything that must not happen twice (deleting, sending, paying).
- `isolated` (default `false`): set `true` when each item uses its own state (a new page, a temp folder) so acts may run at the same time. With `false` acts run one at a time.
- The command follows the session's file policy and sandbox. Commands that need approval are refused. A non-zero exit does not stop the loop; the observation is judged with `[command failed]` in front.
- Calibration examples give their `observation` directly; the start check never runs the command.
- Observations are cut at `maxObservationChars` (default 8,000). With `extract`, Pixie shortens them as instructed before judging.
- On a retry the worker sees the previous observation and the feedback.

`probe.mjs` in the example is a small script you write. For instance, with Playwright it opens the file and prints how many elements match and their text:

```js
// probe.mjs — usage: node probe.mjs <page.html> <selector>
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const [file, selector] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(file).href);
try {
  const found = page.locator(selector);
  console.log(`matches: ${await found.count()}`);
  console.log(`text: ${(await found.allInnerTexts()).join(', ')}`);
} catch (error) { console.log(`invalid selector: ${error.message.split('\n')[0]}`); process.exitCode = 1; }
await browser.close();
```

When writing such a script:

- Print only what the judgment needs, as short text. Screenshots cannot be judged.
- Start each item from a new page or temporary state, so `isolated: true` is safe.
- Report failures as output (`invalid selector: …`); the engine sees the cause and Pixie writes feedback.

## Episodes and selection

`mode: "episode"` treats each output as **one step**. `act` runs every step, and the next step sees the new observation. The episode ends when the checks pass (goal reached), or is escalated after `maxAttempts` steps.

With `select`, the worker writes nothing: **the decision engine picks one listed option.** Options come only from JSON `{"options": [name | {"name", "description"}]}` in the item input (`optionsFrom: "input"`) or, in episodes, the latest observation (`optionsFrom: "observation"`). Pixie never writes the options, so an action that is not allowed cannot come out.

- A `select` without criteria (pick once) returns the pick as the result and needs no calibration.
- Below `minConfidence` the item is escalated instead of acting on a guess.
- At most 255 options; group or filter them in the command first.

### Example: choose actions in a running game

Say a command `game-cli` prints the game state and allowed actions as JSON.

```json
{
  "items": { "inline": [{ "id": "run-1", "input": "Reach the exit without losing all hp." }] },
  "work": { "instruction": "Play one turn per step." },
  "mode": "episode",
  "act": { "tool": "bash", "command": "game-cli step {{output}}", "safeToRepeat": true },
  "select": { "instructions": "Given `state`, which action best moves toward the exit while keeping hp above 0?", "optionsFrom": "observation", "minConfidence": 0.4 },
  "criteria": "The observation shows the player reached the exit.",
  "calibration": {
    "pass": [{ "input": "Reach the exit", "output": "move-east", "observation": "{\"state\":\"at exit\",\"hp\":3,\"options\":[]}" }],
    "fail": [{ "input": "Reach the exit", "output": "move-east", "observation": "{\"state\":\"corridor\",\"hp\":3,\"options\":[\"move-east\",\"wait\"]}" }]
  },
  "maxAttempts": 30,
  "limits": { "tokens": 500000, "timeMs": 1800000 }
}
```

- The first step runs the command once with an empty output to get the starting state and options; make `game-cli step ''` print the current state only.
- The engine sees only the current state. When lookahead matters, put predicted outcomes in option descriptions (`{"name":"attack","description":"enemy hp -3, counterattack likely"}`).
- Suited to turn-based work with decisions seconds apart, not real-time control.

## Grouping results (route)

Give `route.question` the id of a choice question; each item's final answer to it becomes its group. The summary counts each group, and each results line gets `bucket`. With `criteria`, include a sentence for that question; Pixie creates it under the same id.

```json
{
  "items": { "path": "work/reports.jsonl" },
  "work": { "instruction": "Restate the report as one clear sentence." },
  "checks": {
    "questions": { "kind": { "type": "choice", "instructions": "What kind of report is `input`?", "criteria": { "bug": "a defect", "feature": "a request for new behavior", "unclear": "cannot tell" } } },
    "pass": { "kind": { "accept": ["bug", "feature"] } }
  },
  "route": { "question": "kind" },
  "calibration": {
    "pass": [{ "input": "Saving crashes the app", "output": "Saving crashes the app." }],
    "fail": [{ "input": "hmm", "output": "hmm" }]
  },
  "maxAttempts": 1,
  "limits": { "tokens": 200000, "timeMs": 600000 }
}
```

## Recipes

Save specs you reuse under a name in **Studio → Pixie → Gates → Loop recipes**. A recipe is a spec without `items` and `output`. Saving compiles the criteria and checks them against the calibration examples once; a failed check saves nothing. Runs reuse the saved questions without compiling or calibrating again.

| Where | How |
| --- | --- |
| `pixie_loop` tool | `{ "recipe": "ko-review", "items": {...}, "output"?: "...", "run_in_background"?: true }`; no other fields with it |
| Pixie Gate | In the gate's advanced options pick the recipe under **Pixie Loop recipe** and **Check** or **Repair**. See the [Pixie Gate guide](pixie-gate.md#advanced-options) |
| Hook scripts | `pixie loop --recipe ko-review [--mode check|repair] [--input]`. See [the pixie helper](pixie-gate.md#the-pixie-helper) |

- Gates and hook scripts run one item (the gate target or `--input`). **Check** judges the target as the output without changing it; **repair** lets the worker rework the target until it passes.
- Gates and hook scripts cannot run recipes that run commands (`act`), episodes, or selections; use those only with the `pixie_loop` tool.
- Gate and hook runs are also recorded in the session's **Pixie tab → Loops** with the recipe name.

### Example: check translations whenever a file is written

Save a `ko-review` recipe and attach this hook script to a `Tool after` gate.

```sh
#!/bin/bash
# Check what the write tool wrote with the recipe.
[ "$PIXIE_TOOL_NAME" = write ] || exit 10
content=$(printf '%s' "$PIXIE_TOOL_ARGS" | jq -r .content)
if result=$(printf '%s' "$content" | pixie loop --recipe ko-review --input --json); then exit 10; fi
jq -n --arg reason "$(printf '%s' "$result" | jq -r .reason)" '{verdict:"stop", reason:$reason}'
exit 11
```

## Viewing runs

Open **Pixie tab → Loops** in the session's right sidebar. Selecting a run shows:

- status and progress (`3/10 items`), passed, escalated, and error counts, tokens used, the results file
- checks: questions, pass conditions, and whether Pixie compiled them from criteria or the spec gave them
- per item, each attempt's output, failed code checks, decision-engine values, and Pixie's feedback

Active runs refresh every 2 seconds. A run in progress when DSH restarts does not resume; it shows as `Cancelled` shortly after.

## What it cannot do

- Let the worker use tools or read files. Put the material in `items` or `shared`; when something must run, `act` runs one fixed command for it.
- Let items reference each other or grow the glossary during a run. Run one more consistency check over the results afterwards.
- Change criteria or items during a run. Stop and start again.
- Use different models per stage. Every stage uses the default Pixie model.
- Judge images or react in real time.
- Exact checks beyond the three code checks, unless an `act` command prints them for judging.
- Use `act` for a command that must not run twice.
- Resume after DSH restarts.
- With the LLM engine on the same model as Pixie, the producer grades itself. Prefer Jev or a different model.

## Agent skill

On start Studio installs a skill with this guide into `<DSH home>/skills/studio-pixie-loop-guide/`. Ask an agent something like "review these strings' translations with pixie_loop" and it reads the skill and writes the spec. Files you edit are not overwritten by updates; delete one and restart DSH to get Studio's version back.
