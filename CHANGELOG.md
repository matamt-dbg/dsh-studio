# Changelog

Release notes for `@matamt-dbg/dsh-studio`. Each version lists English notes first, then Korean.

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
