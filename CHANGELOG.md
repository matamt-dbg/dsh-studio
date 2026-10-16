# Changelog

Release notes for `@matamt-dbg/dsh-studio`. Each version lists English notes first, then Korean.

## 0.5.0 — 2026-10-17

Requires DSH `0.2.0-rc.2` or `0.2.1-alpha.2`.

### Highlights

- **Gate results in the chat at every point.** A gate's result now shows right under what it checked: under your instruction or an agent message, under the tool call, or under the turn's answer. Previously only turn-end script notes appeared. See the [Pixie Gate guide](docs/appendix/pixie-gate.md#chat-notes-and-per-session-switches).
- **A setting decides what shows.** **Advanced → Show the result in the chat** (on by default) controls display for each gate, whether a hook script or Pixie concluded the run. The block shows the note, or the verdict and reason when there is no note.
- **Nothing is added to the session log.** Blocks are drawn from Studio's gate records; the model's context and the session history are unchanged.

### Changes

- Instruction and agent-message results stay visible when a finished turn is folded; tool results fold with the turn's steps.
- Each run keeps the display setting it started with, so changing it later does not alter past blocks.
- Chat blocks show which point produced them.

### Upgrade notes

- Existing gates show their results by default. Turn **Show the result in the chat** off for gates whose results you only want in the Pixie tab.

### 한국어

DSH `0.2.0-rc.2` 또는 `0.2.1-alpha.2`가 필요합니다.

#### 주요 변경

- **모든 지점의 게이트 결과를 대화에 표시.** 게이트 결과가 검사한 대상 바로 아래에 나옵니다. 지시나 에이전트 메시지 아래, 도구 호출 아래, 턴의 답변 아래입니다. 이전에는 답변 끝 스크립트 메모만 보였습니다. [Pixie Gate 가이드](docs/appendix/pixie-gate.ko.md#대화창-메모와-세션별-끄기)를 참고하세요.
- **설정이 표시 여부를 정함.** 게이트마다 **고급 → 결과를 대화에 표시**(기본 켜짐)로 정하며, 훅 스크립트가 결론을 냈든 Pixie가 냈든 같습니다. 메모가 있으면 메모를, 없으면 결론과 이유를 보여 줍니다.
- **세션 기록에는 남지 않음.** 블록은 Studio 게이트 기록에서 그리며, 모델 컨텍스트와 세션 기록은 바뀌지 않습니다.

#### 변경 사항

- 완료된 턴을 접어도 지시·에이전트 메시지 결과는 보입니다. 도구 결과는 턴의 진행 과정과 함께 접힙니다.
- 실행마다 시작할 때의 표시 설정을 따르므로, 나중에 바꿔도 지난 블록은 바뀌지 않습니다.
- 대화 블록에 어느 지점의 결과인지 표시됩니다.

#### 업그레이드 참고

- 기존 게이트도 기본으로 결과를 보여 줍니다. Pixie 탭에서만 보고 싶은 게이트는 **결과를 대화에 표시**를 끄세요.

## 0.4.0 — 2026-10-16

Requires DSH `0.2.0-rc.2` or `0.2.1-alpha.2`.

### Highlights

- **Decision engine for Pixie Gate.** `pixie judge` in hook scripts now answers typed questions: `bool` (yes probability against a threshold), `select` (one of named options), and `score` (2–10 levels), with probabilities and confidence (`--json`). Choose the engine under **Pixie → Gates → Decision engine**: an LLM (the judge model, or the Pixie model when unset) or [TypeSafe Jev](https://docs.typesafe.ai/api). Jev sends gate input to TypeSafe; its key is stored in DSH credentials as `TYPESAFE_API_KEY`.
- **Scripts can conclude without Pixie.** A hook script that exits **11** prints the gate output JSON itself (`verdict`, `reason`, `replace`, `append`, `note`) and Pixie is not called. A gate whose script always concludes may leave its task empty. Run records show who concluded: Pixie, hook script, or skipped by hook.
- **Notes under the answer.** A note that a turn-end script concludes with, for example a Korean translation of an English answer, appears right under that turn's answer in the chat, rendered as Markdown, with a *not verified* badge when the script flags it.
- **Switch gates per session.** **Pixie tab → Gates → Gates in this session** lists the gates that apply to the session's preset with a switch for this session only; the chat block has the same switch. Definitions, presets and other sessions are untouched.
- **`judge` agent tool.** Agents can call the same decision engine with the Jev request shape (`state`, `questions`) to rank, filter or verify text. It is in Studio Master and selectable in presets; the built-in Optimized preset does not include it.
- **Agent skill installed with Studio.** On start, Studio installs `studio-pixie-hook-guide` (the hook rules and the full Pixie Gate guide) into `<DSH home>/skills`, so an agent can write gates and scripts for you. Files you edit are never overwritten.

### Changes

- Pixie answers and gate notes render as Markdown.
- Helper calls in run records show the `pixie judge` type, chosen value, engine and confidence; output is titled *Script output* when a script concluded.
- The decision engine page sits in the Gates menu. Saving or removing the Jev key confirms beside the buttons.
- Saving a key into a credentials file whose `refs:` line is empty now explains how to fix the file (`refs: {}`) and keeps the original DSH message.
- The built-in Optimized preset is described as the minimal coding-agent toolset.
- Copy for the Pixie settings and decision engine pages reviewed in Korean.

### Upgrade notes

- Existing gates and scripts keep working. `pixie judge --question … --threshold …` is unchanged (`--type bool`).
- The decision engine defaults to LLM. To use Jev, choose it on the decision engine page and save a TypeSafe key.
- To use `judge` in your own preset, select it in the preset's tool list and reapply. Optimized does not change.
- The `dsh-studio-pixie-gate` skill in the release docs is now `studio-pixie-hook-guide`.

### 한국어

DSH `0.2.0-rc.2` 또는 `0.2.1-alpha.2`가 필요합니다.

#### 주요 변경

- **Pixie Gate 결정 엔진.** 훅 스크립트의 `pixie judge`가 형식이 정해진 질문에 답합니다. `bool`(기준값과 비교하는 "예" 확률), `select`(이름 붙인 선택지 중 하나), `score`(2–10단계)이고, `--json`으로 확률과 확신도를 받습니다. 엔진은 **Pixie → 게이트 → 결정 엔진**에서 고릅니다. LLM(판정 모델, 비우면 Pixie 모델) 또는 [TypeSafe Jev](https://docs.typesafe.ai/api)입니다. Jev를 쓰면 게이트 입력이 TypeSafe로 전송되고, 키는 DSH 자격 증명에 `TYPESAFE_API_KEY`로 저장됩니다.
- **스크립트가 Pixie 없이 결론을 냅니다.** 훅 스크립트가 **exit 11**로 끝나면 stdout의 게이트 출력 JSON(`verdict`, `reason`, `replace`, `append`, `note`)을 그대로 쓰고 Pixie를 부르지 않습니다. 스크립트가 늘 결론을 내는 게이트는 할 일을 비워 둘 수 있습니다. 실행 기록에 결론을 낸 쪽(Pixie, 훅 스크립트, 훅이 건너뜀)이 표시됩니다.
- **답변 아래 메모.** 답변 끝 스크립트가 남긴 메모(예: 영어 답변의 한국어 번역)가 대화창의 그 턴 답변 바로 아래에 Markdown으로 나타납니다. 스크립트가 확인하지 못했다고 표시하면 *확인 안 됨* 배지가 붙습니다.
- **세션별 게이트 끄기.** **Pixie 탭 → 게이트 → 이 세션의 게이트**에서 세션 프리셋에 적용되는 게이트를 이 세션에서만 끄고 켭니다. 대화창 블록에도 같은 스위치가 있습니다. 게이트 정의, 프리셋, 다른 세션은 바뀌지 않습니다.
- **에이전트 도구 `judge`.** 에이전트가 Jev 요청 형식(`state`, `questions`)으로 같은 결정 엔진을 불러 문구를 채점하고, 거르고, 검증할 수 있습니다. Studio Master에 들어 있고 프리셋에서 고를 수 있습니다. 기본 제공 Optimized 프리셋에는 없습니다.
- **Studio와 함께 설치되는 에이전트 스킬.** Studio가 시작할 때 `studio-pixie-hook-guide`(훅 규칙과 Pixie Gate 가이드 전체)를 `<DSH 홈>/skills`에 설치합니다. 에이전트가 게이트와 스크립트를 대신 만들 수 있습니다. 직접 고친 파일은 덮어쓰지 않습니다.

#### 변경 사항

- Pixie 답변과 게이트 메모가 Markdown으로 표시됩니다.
- 실행 기록의 헬퍼 호출에 `pixie judge`의 형식·고른 값·엔진·확신도가 나옵니다. 스크립트가 결론을 낸 실행은 출력 제목이 *스크립트 출력*입니다.
- 결정 엔진 화면이 게이트 메뉴로 옮겨졌습니다. Jev 키를 저장하거나 지우면 버튼 옆에 결과가 표시됩니다.
- 자격 증명 파일의 `refs:` 줄이 비어 있어 키 저장이 실패하면, 고치는 방법(`refs: {}`)과 원래 DSH 메시지를 함께 보여 줍니다.
- 기본 제공 Optimized 프리셋 설명을 "코딩 에이전트를 위한 최소한의 도구"로 바꿨습니다.
- Pixie 설정과 결정 엔진 화면의 한국어 문구를 다듬었습니다.

#### 업그레이드 참고

- 기존 게이트와 스크립트는 그대로 동작합니다. `pixie judge --question … --threshold …`도 그대로입니다(`--type bool`).
- 결정 엔진의 기본값은 LLM입니다. Jev를 쓰려면 결정 엔진 화면에서 고르고 TypeSafe 키를 저장하세요.
- 직접 만든 프리셋에서 `judge`를 쓰려면 프리셋 도구 목록에서 고른 뒤 다시 반영하세요. Optimized는 바뀌지 않습니다.
- 릴리즈 문서의 `dsh-studio-pixie-gate` 스킬 이름이 `studio-pixie-hook-guide`로 바뀌었습니다.

## 0.3.0 — 2026-10-16

Requires DSH `0.2.0-rc.2` or `0.2.1-alpha.2`.

### Highlights

- **Studio Master follows DSH `standard`.** The base is read from the running DSH, with Studio's own plugins and the ones you add layered on top. Each plugin shows its origin (`standard`, `Studio`, `Added`).
- **Every plugin is included by default.** Execution settings now separate *Included plugins* (leave a plugin out of a preset) from *Config overrides* (change only the fields you edit; turning an override off returns to the default). Dependants follow their requirement: leaving out automatic compaction also removes `/compact`.
- **Presets no longer block tools added at run time.** The tools a preset selects are its starting set. Tools that DSH or other plugins register later, such as schedules attached to each session, stay usable, and an agent-scope tool no longer makes every tool call fail.
- **Prompt preview shows what else reaches the model.** Switch between *System prompt & tools*, *Runtime context* and *Turn start*. Turn start shows example AGENTS.md instructions and the current-time message, with the settings that shape them editable in place.
- **Pixie Gate** checks prompts, tool calls and turn ends against tasks you attach per preset. See the [Pixie Gate guide](docs/appendix/pixie-gate.md).

### Changes

- Compaction, AGENTS.md instructions, the time notice and the skill catalog are kept when a preset edits only the persona. Optimized realigns on startup.
- *Add plugin* replaces the *Tool providers* page: add an installed package by name to Studio Master, checked for activation before it replaces the previous Master.
- Applying is blocked when a selected tool loses the plugin that provides it; the previous applied version stays in effect. A missing tool on restore is reported instead of failing the preset.
- After DSH updates or plugin changes, a notice lists added (`+`), removed (`-`) and changed (`~`) tools and Configs. Saved presets are cleaned only after you confirm; a partial collection never deletes anything.
- Presets that an earlier version applied without some features show *Missing features* with a *Restore* action.
- The Config filter shows *All* and *Modified* only. Plugins have titles and one-line purposes in both lists.
- Korean copy polished across preset and Pixie screens.

### Upgrade notes

- On the first start, Optimized is rebuilt from DSH `standard`. Settings that only the old Studio Master carried (a shorter plan-mode text, subagent tool filters) now follow `standard`.
- Your own presets are not changed automatically. Use *Reapply to DSH*, or *Restore* when a card shows missing features.
- The first restart may show a tool and Config change notice comparing the old Master with `standard`. Review it before confirming.

### 한국어

DSH `0.2.0-rc.2` 또는 `0.2.1-alpha.2`가 필요합니다.

#### 주요 변경

- **Studio Master가 DSH `standard`를 따릅니다.** 실행 중인 DSH의 `standard`를 기준으로, Studio 플러그인과 직접 추가한 플러그인을 얹습니다. 플러그인마다 출처(`standard`, `Studio`, `추가함`)가 표시됩니다.
- **모든 플러그인이 기본으로 포함됩니다.** 실행 설정이 *포함할 플러그인*(프리셋에서 빼기)과 *Config 덮어쓰기*(바꾼 필드만 변경, 끄면 기본값으로 복귀)로 나뉩니다. 의존하는 기능은 함께 빠집니다. 자동 압축을 빼면 `/compact`도 빠집니다.
- **실행 중에 추가되는 도구를 막지 않습니다.** 프리셋에서 고른 도구는 시작 구성입니다. 예약 작업처럼 DSH나 다른 플러그인이 나중에 붙이는 도구도 쓸 수 있고, Agent 범위 도구 때문에 모든 도구 호출이 실패하던 문제를 고쳤습니다.
- **프롬프트 미리보기에서 모델이 받는 다른 내용도 봅니다.** *시스템 프롬프트·도구*, *런타임 컨텍스트*, *턴 시작 내용*을 전환해 봅니다. 턴 시작 내용에서는 AGENTS.md 지침과 현재 시각 안내 예시를 보고, 그 내용을 정하는 설정을 바로 바꿀 수 있습니다.
- **Pixie Gate**가 프리셋마다 연결한 작업으로 프롬프트, 도구 호출, 턴 종료를 검사합니다. [Pixie Gate 가이드](docs/appendix/pixie-gate.ko.md)를 참고하세요.

#### 변경 사항

- persona만 편집한 프리셋에서도 대화 압축, AGENTS.md 지침, 시각 안내, 스킬 목록이 유지됩니다. Optimized는 시작할 때 다시 맞춥니다.
- *도구 제공자* 화면 대신 *플러그인 추가*를 씁니다. 설치된 패키지를 이름으로 Studio Master에 추가하며, 활성화를 검사한 뒤에 바꿉니다.
- 선택한 도구를 제공하는 플러그인을 빼면 반영이 막히고 이전 반영본이 유지됩니다. 재시작 후 도구가 없으면 프리셋을 실패시키지 않고 주의사항으로 알립니다.
- DSH 업데이트나 플러그인 변경 뒤에는 추가(`+`)·제거(`-`)·변경(`~`) 안내가 뜹니다. 확인해야 저장된 프리셋을 정리하며, 일부만 수집된 경우에는 아무것도 지우지 않습니다.
- 이전 버전이 기능을 빠뜨리고 반영한 프리셋에는 *기능 누락*과 *복구*가 표시됩니다.
- Config 필터는 *전체*와 *변경됨*만 보여 줍니다. 두 목록 모두 플러그인 제목과 용도가 표시됩니다.
- 프리셋과 Pixie 화면의 한국어 문구를 다듬었습니다.

#### 업그레이드 참고

- 처음 시작할 때 Optimized를 DSH `standard` 기준으로 다시 만듭니다. 예전 Studio Master에만 있던 설정(짧은 plan-mode 문구, 서브에이전트 도구 필터)은 `standard`를 따릅니다.
- 직접 만든 프리셋은 자동으로 바뀌지 않습니다. *DSH에 다시 반영*을 누르거나, 카드에 기능 누락이 보이면 *복구*를 누르세요.
- 첫 재시작 때 예전 Master와 `standard`의 차이를 알리는 변경 안내가 나올 수 있습니다. 내용을 확인한 뒤 정리하세요.
