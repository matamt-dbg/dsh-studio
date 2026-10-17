---
name: studio-pixie-loop-guide
description: Write DSH Studio `pixie_loop` specs — many independent items judged by the same criteria (translation review, copy edits, per-file audits), experiments judged by running each output (selectors, regexes), step-by-step episodes, and picking one listed option per item or step (e.g. game actions), all outside your context with the Pixie model and the decision engine. Use when the user asks to batch, review, translate, try, or choose over many items with Pixie or Jev, or to write or debug a pixie_loop spec.
---

# DSH Studio Pixie Loop

`pixie_loop` runs work → code checks → decision-engine judgment → Pixie feedback → retry for each item, outside your context, and returns only counts, a results file, and the items that never passed. The full contract and worked examples are in `guide.md` next to this file. Read it before writing a spec.

## Decide whether it fits

Use `pixie_loop` only when all hold:

- There are several independent items (usually 5 or more).
- One fixed set of criteria judges every item.
- The worker needs no tools: everything it needs fits in the item input and `shared`. If an output must be run to be judged, one fixed `act` command can run it.
- The result can be judged from text (an act command's output counts).

Otherwise: one judgment → `judge`; multi-step work with files or tools → `subagent_role`; branching or many cooperating agents → `workflow` (only when the user asks for one); a check at a set moment of the agent's work → Pixie Gate (`studio-pixie-hook-guide`). Tell the user which and why.

## Write the spec

1. **Items.** Give each a stable unique `id` (a key, a file path). Under ~20 short items use `items.inline`; otherwise write a JSONL file with one `{"id","input"}` per line and pass `items.path`. Inputs up to 32,000 characters; a file item must fit on one line under the read tool's line limit. For file audits, read the files yourself and put their contents in the inputs.
2. **work.instruction.** What to do with one input, and the output format. Say "Reply with the output only."
3. **shared.** Glossary, style rules, and examples every item needs. Never put other items here.
4. **Criteria.** Plain English sentences, one property each, about `input` and `output`. Name failure types ("say whether it is a mistranslation, terminology, tone, or omission"). Give `checks` instead when the user already has exact questions; each question needs a pass rule (`noul` → `{min}`, `choice` → `{accept}` leaving a failing option, `score` → `{min}` level).
5. **codeChecks.** Put every exact requirement here, not in criteria: `placeholders` when inputs contain `{x}`, `{{x}}`, `%s`, or tags; `regex` with `expect` `match`/`no-match` for required or forbidden text; `json` with `keys` when the output must be JSON.
6. **Calibration.** At least one realistic pass example and one realistic fail example per criterion. Use real inputs. The run refuses to start if the checks do not separate them; then reword the failing question or switch to `checks`.
7. **Limits.** `limits.tokens` ≈ items × attempts × (input + output + shared tokens) × 3 for checks and feedback, plus headroom; `limits.timeMs` generous. Defaults: `maxAttempts` 3, `concurrency` 4.
8. **Act (optional).** When an output only proves itself by running it, add `act: { tool: "bash", command: "… {{output}} …", safeToRepeat: true }`. Values are quoted for you: write placeholders as separate words, never inside quotes or glued to text. Only use commands that are safe to run again; set `isolated: true` only when each item uses its own state. Write a small probe script that prints just what the judgment needs, and give each calibration example an `observation`. Add `extract` when observations are long.
9. **Episodes and selection (optional).** `mode: "episode"` makes each output one step that act runs, until the checks say the goal is reached. `select` lets the decision engine pick one option from JSON `{"options": [...]}` in the input or (episodes) the observation; the worker writes nothing. Never invent options yourself; they must come from the source. Set `minConfidence` when a wrong pick is costly.
10. **Route (optional).** `route: { question: "<choice id>" }` groups results by that answer.
11. **output** path for the results JSONL. Use `run_in_background: true` for long runs; keep working and collect with `job_output`.

## Recipes

If the user has a saved recipe for the job (Studio → Pixie → Gates → Loop recipes), prefer `{ "recipe": "<name>", "items": ..., "output": ... }`; its checks were calibrated when saved. Recipes are also what gates (Check/Repair) and hook scripts (`pixie loop --recipe`) run; for gate and hook work see `studio-pixie-hook-guide`. Recipes with `act`, episodes, or selection run only through the tool.

## After the run

- Report the counts and the results file. Do not re-run passed items.
- Handle each `escalated` item yourself (fix it, or ask the user), using its failed checks and feedback. Feedback is Pixie's guess, not the verdict.
- `errors` are engine or model failures, not fails. Rerun only those ids if the cause is transient.
- `stopped` means a limit was reached: rerun with only the ids missing from the results file.
- If the start was refused (`Calibration failed`, `could not compile`), fix the spec; do not loosen the criteria until bad examples pass.
- Merge results into the target files yourself; `pixie_loop` writes only the results file.

The user can inspect every attempt in **Pixie tab → Loops**. Item contents go to the Pixie model provider and the decision engine; tell the user before sending sensitive material.
