# Appendix: Check a preset in a live session

English | [한국어](preset-check.ko.md)

Studio applies a preset by registering it with DSH, but what a session finally receives also depends on the installed Studio build, the plugins in your profile, and how DSH composes subagents. This appendix provides an agent skill that checks the result in a running session: an agent starts the subagents you name, then a read-only script compares the stored preset with what each session received.

## What it checks

The stored preset (`<profile>/studio-data/presets.json`) is the source of truth. The script compares it with the session logs of the current session and every subagent it started.

| Group | Checks |
|---|---|
| Build | The Studio version installed in the profile, and whether the session could have run it |
| Preset | Applied, and not changed after the session started |
| Parent session | Tools, edited tool and parameter descriptions, execution defaults, additional instructions, persona, edited usage instructions |
| Each subagent | Role, spawn mode (Fork / Fresh), model, the Tool Filter that DSH applied against the one the role's mode implies, its tools (parent minus Tool Filter), and that usage instructions of filtered tools are gone |

Each check is PASS, FAIL or UNKNOWN with a reason. The script never writes anything.

> The session log is DSH's internal storage format, not a public interface. A future DSH release may change it; the script then reports UNKNOWN instead of guessing.

## Install the skill

The skill is the [preset-check](preset-check/) folder: `SKILL.md` (instructions for the agent) and `check-preset.mjs` (the script). Copy the folder into a skill directory DSH scans:

```sh
# from a clone of this repository
mkdir -p ~/.dsh/skills
cp -R docs/appendix/preset-check ~/.dsh/skills/dsh-studio-preset-check
```

DSH picks up new skills without a restart. Other locations also work: `<project>/.dsh/skills/` for one project, or `~/.agents/skills/`.

Requirements: Node.js 22.15 or later (or the `zstd` command), and read access to your DSH home (`~/.dsh` by default).

## Use it

1. In Studio, give the preset the roles you want to test, for example:

   | Role ID | Spawn mode | Subagent Tool Filter |
   |---|---|---|
   | `worker` | Continue parent (Fork) | Use preset default |
   | `reviewer` | New conversation (Fresh) | Add to preset default: `write`, `edit`, `bash` |

2. Save and apply the preset, then start a **new** session with it. A session runs the Studio build its app loaded at start; after installing a new Studio build, restart the app first.
3. Ask the agent, for example: *"Use the dsh-studio-preset-check skill. Start the worker and reviewer roles and report the result."*

The agent starts each role with a fixed read-only task, waits for the reports, runs the script and answers with a table of every check.

You can also run the script yourself:

```sh
node ~/.dsh/skills/dsh-studio-preset-check/check-preset.mjs <session-id> --profile desktop
```

Use `--profile web` for `dsh web`, and `--json` for machine-readable output. The exit code is 1 when a check fails.

## Reading the result

| Result | Meaning | What to do |
|---|---|---|
| `build` UNKNOWN or FAIL | The session may have run another Studio build | Restart the app and check in a new session |
| `preset` UNKNOWN: re-applied after the session started | Expectations follow the current preset, not the one the session used | Check in a new session |
| `Tool Filter` FAIL | DSH applied another list than the role's mode implies | Open the role in Studio and check its Tool Filter choice, then save and apply |
| `tools` FAIL with `extra …` | A tool reached the session that the preset does not select or filters | Check the profile's plugins and the preset's tool selection |
| `… instructions removed` FAIL | Usage instructions of a filtered tool are still in the subagent's prompt | Report it as a bug with the script output |

Text in **Additional Studio instructions** reaches subagents unchanged by design, even when it mentions a filtered tool.
