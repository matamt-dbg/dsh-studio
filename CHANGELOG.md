# Changelog

Release notes for `@matamt-dbg/dsh-studio`. Each version lists English notes first, then Korean.

## 0.6.3 — 2026-10-20

Requires DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1` or `0.2.1-rc.2`.

### Highlights

- **A new Plugins tab finds the plugins you install.** Studio → **Plugins** → **Installed plugins** lists the plugin packages in your profile and where they run. **Agent features** run per preset: **Set up and include** takes initial settings, checks activation, and adds the plugin to Studio Master so it appears in each preset's tools and Config. **Profile-wide** plugins register into a service every session shares, such as a web search provider, and cannot go into a preset. **Needs check** marks plugins whose scope Studio could not confirm.
- **Register profile-wide plugins in one click.** **Register in profile › Register** adds the plugin to the profile patch file and applies it without a restart. If it fails to activate, the file is restored. The patch lines stay available under **Register manually**.
- **Profile settings groups shared Host settings by workflow.** Studio → **Plugins** → **Profile settings** shows the plugins the Host runs once for every session, in categories: Web search and fetch, Delegation providers, Loop guards, Goal continuation, Context management (shared), MCP servers, and Model retry and metering. Built-in providers are listed next to the ones you install. Saving applies to every running session.
- **Pick web search and fetch providers from a list.** The Web search and fetch card chooses the **Search provider** and **Fetch provider** from the providers that are running, for example Exa for search and the DeepSeek API for fetch. **Use default** removes the override. **Enter manually** takes any provider ID; saving it empty uses the default. Only providers that follow DSH plugin naming conventions are listed automatically.

### Changes

- Adding a plugin to a preset now happens in the Plugins tab. **Execution settings** no longer adds packages by name; it lists the plugins Studio added so you can remove them.
- Profile-wide plugins can no longer be added to Studio Master. Adding one used to make applying presets fail with "a web provider with id … is already registered".
- Secrets such as API keys are never shown or returned, at any depth of a plugin's settings. Choose **Keep**, **Replace**, or **Delete**. Plugins that use the DSH credential store show only the key name and whether it is set.
- Both Plugins pages have a search box.
- Rows with nothing to edit, such as `token-meter` and `llm-retry`, show **No settings** instead of opening an empty dialog.

### Upgrade notes

- If an earlier version added a profile-wide plugin to Studio Master (for example `@deepseek-ai/dsh-web-search-exa`), the Installed plugins page shows **Plugins to move out of the base composition**. **Move** backs up its settings and per-preset overrides to `studio-data/migrated-extensions.json` and removes it from Studio Master. Reapply or unapply presets that still run it before registering it in the profile; the page shows them.
- Settings saved in Profile settings are written to the profile's `cordis.patch.yml` through DSH's configuration editor and apply to every session. Secrets saved there are stored in plain text, as with any value in that file.

### Verification

- Built and installed into isolated profiles of unmodified DSH `0.2.1-rc.2` with a scripted test model and a local fake Exa endpoint. The original failure was reproduced first, then checked fixed: adding Exa to Studio Master is refused, and Optimized stays applied. Registering Exa from Studio, saving its key and `searchProvider: exa`, and running `web_search` reached the fake endpoint with the saved key, also after a restart. Manual provider entry and returning to the default were checked in the patch file.
- Concurrent moves of the same plugin, a stale temporary file, and nested or short secrets in errors were checked after the release review.
- The release package was installed fresh and as an upgrade from 0.6.2 into isolated profiles of unmodified DSH `0.2.1-rc.2`. On upgrade, the Exa row added under 0.6.2 was listed for moving with its key masked; moving it kept the key in a 0600 backup, and Optimized applied again.
- The Plugins tab was checked in light, dark and 480 px views. Not checked: including a real third-party agent-feature package end to end, and an actual registration that fails to activate (covered by unit tests). Other DSH versions were not tested for these changes.

### 한국어

DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1` 또는 `0.2.1-rc.2`가 필요합니다.

#### 주요 변경

- **설치한 플러그인을 찾아볼 수 있는 플러그인 탭을 추가했습니다.** Studio → **플러그인** → **설치한 플러그인**에서 프로필에 설치된 플러그인 패키지와 실행 범위를 보여 줍니다. **에이전트 기능**은 프리셋별로 따로 동작합니다. **설정하고 포함**으로 초기 설정을 추가하면 활성화 여부를 확인한 뒤 Studio Master에 추가되어 각 프리셋의 도구와 Config에 표시됩니다. **프로필 공용** 플러그인은 웹 검색 공급자처럼 모든 세션이 공유하는 서비스에 등록되므로 프리셋에 포함할 수 없습니다. **확인 필요**는 Studio에서 실행 범위를 확인하지 못한 플러그인입니다.
- **프로필 공용 플러그인을 한 번에 등록합니다.** **프로필에 등록하기 › 등록**을 누르면 프로필 설정 파일에 플러그인을 추가하고, 재시작 없이 적용합니다. 활성화에 실패하면 파일을 원래대로 되돌립니다. 붙여넣을 내용은 **직접 등록하기**에서 계속 볼 수 있습니다.
- **프로필 설정에서 공용 Host 설정을 워크플로우별로 묶어 표시합니다.** Studio → **플러그인** → **프로필 설정**에서 Host에서 한 번 실행되어 모든 세션이 공유하는 플러그인을 카테고리별로 보여 줍니다. 카테고리에는 웹 검색·가져오기, 위임 공급자, 루프 가드, 목표 자동 진행, 컨텍스트 관리(공용), MCP 서버, 모델 재시도·측정이 있습니다. 기본 내장 공급자도 직접 설치한 공급자와 함께 표시됩니다. 저장하면 실행 중인 모든 세션에 적용됩니다.
- **웹 검색·가져오기 공급자를 목록에서 선택합니다.** 웹 검색·가져오기 카드에서 실행 중인 공급자 중 **검색 공급자**와 **가져오기 공급자**를 고릅니다. 예를 들어 검색에는 Exa, 가져오기에는 DeepSeek API를 사용할 수 있습니다. **기본값 사용**을 선택하면 덮어쓰기를 지웁니다. **직접 입력**을 선택해 공급자 ID를 입력할 수 있으며, 비워 둔 채 저장하면 기본값이 사용됩니다. DSH가 제공하는 플러그인의 명명 규칙을 따르는 공급자만 목록에 자동으로 표시됩니다.

#### 변경 사항

- 프리셋에 플러그인을 추가하는 작업은 이제 플러그인 탭에서 합니다. **실행 설정**에서는 더 이상 패키지 이름으로 추가하지 않으며, Studio가 추가한 플러그인을 확인한 뒤 제거만 할 수 있습니다.
- 프로필 공용 플러그인은 Studio Master에 추가할 수 없습니다. 이전에는 이러한 플러그인을 추가한 뒤 프리셋을 반영하면 "a web provider with id … is already registered" 오류가 발생해 실패했습니다.
- API 키 같은 비밀 값은 플러그인 설정 어디에 있든 화면과 응답에 나타나지 않습니다. **유지**, **교체**, **삭제** 중에서 고릅니다. DSH 자격 증명 저장소를 사용하는 플러그인은 키 이름과 설정 여부만 표시합니다.
- 플러그인 탭의 두 페이지에 검색 칸을 추가했습니다.
- `token-meter`, `llm-retry`처럼 바꿀 설정이 없는 행은 빈 설정 창을 여는 대신 **설정 항목 없음**으로 표시합니다.

#### 업그레이드 참고

- 이전 버전에서 프로필 공용 플러그인(예: `@deepseek-ai/dsh-web-search-exa`)을 Studio Master에 추가했다면, 설치한 플러그인 페이지에 **기준 구성에서 옮겨야 하는 플러그인**이 표시됩니다. **옮기기**를 누르면 그 설정과 프리셋별 덮어쓰기를 `studio-data/migrated-extensions.json`에 백업하고 Studio Master에서 뺍니다. 그 플러그인을 아직 실행하는 프리셋은 다시 반영하거나 반영 해제한 뒤 프로필에 등록하세요. 해당 프리셋은 페이지에 표시됩니다.
- 프로필 설정에서 저장한 값은 DSH 설정 편집기를 통해 프로필의 `cordis.patch.yml`에 기록되며, 모든 세션에 적용됩니다. 여기서 저장한 비밀 값은 이 파일의 다른 값과 마찬가지로 평문으로 저장됩니다.

#### 검증

- 수정하지 않은 DSH `0.2.1-rc.2`의 격리 프로필에 빌드를 설치하고, 각본 테스트 모델과 로컬 가짜 Exa 엔드포인트로 확인했습니다. 먼저 원래 실패를 재현한 뒤 고쳐진 것을 확인했습니다. Exa를 Studio Master에 추가하는 것은 거부되고 Optimized는 반영 상태를 유지했습니다. Studio에서 Exa를 등록하고 키와 `searchProvider: exa`를 저장한 뒤 `web_search`를 실행하자, 재시작한 뒤에도 저장한 키로 가짜 엔드포인트에 도달했습니다. 공급자 직접 입력과 기본값으로 되돌리기는 patch 파일에서 확인했습니다.
- 배포 전 리뷰를 반영한 뒤, 같은 플러그인을 동시에 옮기는 경우와 남아 있던 임시 파일, 오류 메시지에 포함된 중첩·짧은 비밀 값의 처리를 확인했습니다.
- 배포 패키지를 수정하지 않은 DSH `0.2.1-rc.2`의 격리 프로필에 새로 설치한 경우와 0.6.2에서 업그레이드한 경우를 확인했습니다. 업그레이드하면 0.6.2에서 추가한 Exa 행이 키가 가려진 채 옮길 대상으로 표시되었습니다. 옮기면 키는 권한 0600 백업에 보존되었고, Optimized는 다시 반영되었습니다.
- 플러그인 탭은 라이트·다크 모드와 480px 너비에서 확인했습니다. 실제 제3자 에이전트 기능 패키지까지 포함하는 전체 흐름과, 실제로 활성화에 실패하는 등록(단위 테스트로 확인)은 확인하지 않았습니다. 이번 변경은 다른 DSH 버전에서는 시험하지 않았습니다.

## 0.6.2 — 2026-10-18

Requires DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1` or `0.2.1-rc.2`.

### Highlights

- **Optimized is tuned from benchmarks and gains a Worker role.** Optimized adds `edit_batch` (several edits to one file in one atomic write), lifts the `read_batch` line cap and keeps its results out of spilling, waits 120 seconds for `bash` instead of 600, rewrites the `bash` and `read` descriptions and the `read` guidance, and ships shorter common instructions. A default **Worker** subagent role inherits these settings but cannot delegate, ask questions, or use `judge`, `pixie_loop` or `cordis_inspect_*`; the main agent keeps all of them.
- **Optimized can be edited and restored.** Edit Optimized like any preset; it still cannot be deleted. **Restore defaults** replaces it with the current Studio defaults and applies them. An unedited Optimized follows new Studio defaults automatically. An edited one is kept as saved and shows **Edited**, plus **New defaults** when the Studio defaults change after your edit.
- **Execution defaults are visible and resettable.** A preset can fill in a wait time when the model leaves it out (`bash` `timeoutMs`, `job_output` `timeout_ms`) and lower the `read_batch` limit. These values were saved and copied with a preset but had no screen. **Execution settings → Execution defaults** now lists them the same way as Config overrides: overridden entries show **Modified**, **Edit** changes the value, and turning an entry off removes the override. While a value is set, the DSH command timeout in **Settings → Shell** does not apply to that preset's `bash`; turning it off lets it apply again.
- **Preset cards show overridden execution defaults.** A card shows how many execution defaults the preset overrides, so copies of Optimized that still wait 600 seconds for `bash` are easy to spot.

### Changes

- Config entries whose plugin has no schema (`read_batch`, `edit_batch`) cannot be edited. An entry that carries a value stays on and locked, and only restoring the preset defaults changes it.
- Optimized's goal guidance is left out because Optimized offers no goal tools.
- Session role dialogs allow Fresh/Fork selection. Changes affect new children only; continuing an existing child keeps its settings.

### Upgrade notes

- The built-in Optimized is updated on the first start after upgrading, because earlier versions could not edit it. If it was applied, it is reapplied with the new defaults; sessions that are already running keep their settings.
- Copies of Optimized are not updated. They keep `bash` 600000 ms and `job_output` 120000 ms and do not gain `edit_batch` or the Worker role. To follow the DSH shell timeout instead, open the copy, turn off **bash command wait** under **Execution defaults**, then save and apply. To get the new defaults in a copy, copy Optimized again.

### Verification

- The release package was installed into isolated profiles of unmodified DSH `0.2.1-rc.2`, both fresh and as an upgrade from 0.6.1, and checked with a scripted test model. On upgrade, the built-in Optimized moved to the new defaults while an existing copy kept its tools and 600000 ms `bash` wait. The preset list and Config screens were checked in light, dark and 480 px views.
- Optimized tuning, the Worker role and Restore defaults: checked in the same installation. The main agent received the orchestration tools; the Worker did not, a `judge` call from it was rejected and `read` ran; both received the common instructions and the new `read` guidance; saving an edit marked Optimized as edited and Restore defaults brought the defaults back. Real models were not used for this check.
- `edit_batch` was run only on DSH `0.2.1-rc.2`. On `0.2.0-rc.2` it resolves paths against the session folder, as `edit` does there, but this was not run.
- Execution defaults: a build of this change (packaged before the version number was raised to 0.6.2) was installed into an isolated profile of unmodified DSH `0.2.1-rc.2` and checked with a local test model. With the shell timeout set to 1500 ms, an Optimized copy still waited for `sleep 3`; after its `bash` default was turned off, the command moved to a background job after 1500 ms. The editor was checked in light, dark and 480 px views. Other DSH versions were not tested for this change.

### 한국어

DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1` 또는 `0.2.1-rc.2`가 필요합니다.

#### 주요 변경

- **Optimized를 벤치 결과에 맞춰 조정하고 Worker 역할을 추가했습니다.** Optimized에 `edit_batch`(한 파일의 여러 수정 사항을 한 번에 기록하는 도구)를 추가했습니다. `read_batch`의 줄 수 제한을 없애 결과가 spill로 잘리지 않도록 했고, `bash`의 기본 대기 시간을 600초에서 120초로 줄였습니다. `bash`·`read` 설명과 `read` 지침을 수정하고, 공통 지침은 짧게 바꿨습니다. 기본 **Worker** 서브에이전트 역할은 이 설정을 그대로 상속받되, 위임·질문·`judge`·`pixie_loop`·`cordis_inspect_*`는 사용하지 않습니다. 메인 에이전트는 이 도구들을 모두 사용합니다.
- **Optimized를 편집하고 기본값으로 복구할 수 있습니다.** 다른 프리셋처럼 편집할 수 있고, 삭제는 계속 막습니다. **기본값으로 복구**는 현재 Studio 기본값으로 바꾼 뒤 반영합니다. 편집하지 않은 Optimized는 새 기본값을 자동으로 따릅니다. 편집한 Optimized는 저장한 그대로 두고 **직접 편집함**을 표시하며, 그 뒤 Studio 기본값이 바뀌면 **새 기본값**도 함께 표시합니다.
- **실행 기본값을 확인하고 되돌릴 수 있습니다.** 프리셋은 모델이 대기 시간을 생략할 때 넣을 값(`bash`의 `timeoutMs`, `job_output`의 `timeout_ms`)과 `read_batch` 최대 개수를 정할 수 있습니다. 이 값은 프리셋과 함께 저장되고 복사되었지만 볼 수 있는 화면이 없었습니다. 이제 **실행 설정 → 실행 기본값**에서 Config 덮어쓰기와 같은 방식으로 표시됩니다. 덮어쓴 항목에는 **변경됨**이 붙고, **설정**에서 값을 바꾸며, 항목을 끄면 덮어쓰기가 지워집니다. 값이 있는 동안에는 DSH **설정 → 셸**의 명령 타임아웃이 그 프리셋의 `bash`에 적용되지 않습니다. 항목을 끄면 다시 적용됩니다.
- **프리셋 카드에 덮어쓴 실행 기본값 수가 표시됩니다.** `bash` 명령을 600초까지 기다리는 Optimized 복사본을 쉽게 찾을 수 있습니다.

#### 변경 사항

- 스키마가 없는 플러그인의 Config 항목(`read_batch`, `edit_batch`)은 편집할 수 없습니다. 값이 있는 항목은 켜진 상태로 잠기며, 프리셋을 기본값으로 복구할 때만 바뀝니다.
- Optimized는 goal 도구를 사용하지 않으므로 goal 지침을 포함하지 않습니다.
- 세션 역할 추가·편집 창에서 Fresh/Fork를 선택할 수 있습니다. 변경 사항은 새 자식에게만 적용되며, 기존 자식을 이어서 실행할 때는 기존 설정을 유지합니다.

#### 업그레이드 참고

- 이전 버전에서는 Optimized를 편집할 수 없었으므로, 업그레이드 후 처음 시작할 때 기본 제공 Optimized가 새 기본값으로 바뀝니다. 반영되어 있었다면 새 기본값으로 다시 반영합니다. 이미 실행 중인 세션의 설정은 바뀌지 않습니다.
- Optimized 복사본은 바뀌지 않습니다. `bash`는 600000ms, `job_output`은 120000ms로 그대로 남고 `edit_batch`와 Worker 역할도 생기지 않습니다. DSH 셸 타임아웃을 따르게 하려면 복사본을 열고 **실행 기본값**에서 **bash 명령 대기 시간**을 끈 뒤 저장해 반영하세요. 복사본에 새 기본값을 사용하려면 Optimized를 다시 복사하세요.

#### 검증

- 배포 패키지를 수정하지 않은 DSH `0.2.1-rc.2`의 격리 프로필에 새로 설치한 경우와 0.6.1에서 업그레이드한 경우 모두 각본 테스트 모델로 확인했습니다. 업그레이드하면 기본 제공 Optimized는 새 기본값으로 바뀌었고, 기존 복사본은 도구와 `bash` 600000ms 대기를 그대로 유지했습니다. 프리셋 목록과 Config 화면은 라이트·다크 모드와 480px 너비에서 확인했습니다.
- Optimized 조정, Worker 역할, 기본값으로 복구: 같은 설치본에서 확인했습니다. 메인 에이전트는 오케스트레이션 도구를 받았고 Worker는 받지 않았으며, Worker의 `judge` 호출은 거부되고 `read`는 실행되었습니다. 두 에이전트 모두 공통 지침과 새 `read` 지침을 받았습니다. 편집을 저장하면 Optimized가 편집됨으로 표시되었고, 기본값으로 복구하면 기본값으로 돌아왔습니다. 이 확인에는 실제 모델을 쓰지 않았습니다.
- `edit_batch`는 DSH `0.2.1-rc.2`에서만 실행해 확인했습니다. `0.2.0-rc.2`에서는 그 버전의 `edit`처럼 세션 폴더 기준으로 경로를 찾지만, 실행해 보지는 않았습니다.
- 실행 기본값: 이번 변경을 담은 빌드(버전 번호를 0.6.2로 올리기 전에 패키징)를 수정하지 않은 DSH `0.2.1-rc.2`의 격리 프로필에 설치하고 로컬 테스트 모델로 확인했습니다. 셸 타임아웃을 1500ms로 둔 상태에서 Optimized 복사본은 `sleep 3`이 끝날 때까지 기다렸고, `bash` 기본값을 끈 뒤에는 1500ms가 지나자 백그라운드 작업으로 넘어갔습니다. 편집 화면은 라이트·다크 모드와 480px 너비에서 확인했습니다. 이번 변경 사항은 다른 DSH 버전에서 확인하지 않았습니다.

## 0.6.1 — 2026-10-17

Requires DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1` or `0.2.1-rc.2`.

0.6.0 was released on GitHub but not on npm. 0.6.1 includes the changes listed under [0.6.0](#060--2026-10-17). See [What's new in 0.6.1](docs/highlights.md) for a walkthrough with screenshots, including a Pixie Loop example.

### Highlights

- **DSH `0.2.1-rc.1` and `0.2.1-rc.2` support.** These releases no longer apply a role's instructions and Tool Filter when a subagent starts. Studio now saves each role subagent's instructions and Tool Filter when it is created and applies them before it runs, for both Fresh and Fork subagents. Running role subagents with these instructions and Tool Filter was tested on `0.2.1-rc.1`; on `0.2.1-rc.2`, which made no change to the APIs Studio uses for this, only saving and reapplying roles was tested. They are stored under `<profile>/studio-data/child-policies/` and reused when a finished subagent is continued.
- **Loop recipe editor.** **Insert example** fills in a working spec, invalid names are flagged while you type, and the page tells you before a save replaces an existing recipe.

### Changes

- Role and session-role editors explain which instructions apply: session instructions replace the preset role's instructions for new subagents, and subagents already created keep theirs.
- SettingsX registers each shortcut separately. If another plugin already uses a default key, that command is added without a key; other commands are unaffected.

### Verification

- The 0.6.1 package was installed into a new isolated profile of unmodified DSH `0.2.1-rc.2`; Web startup and four HTTP checks passed (Master, Optimized copy, session roles, role save/reapply/restore).
- DSH `0.2.1-rc.1` (an earlier 0.6 build; the role-subagent code has not changed since): installed into a new isolated profile of the unmodified runtime. Fresh and Fork role subagents kept their instructions and Tool Filter, also after a restart, using a local test model instead of an external one. A missing policy file stopped the subagent before any model call.
- DSH `0.2.1-rc.2` desktop app (an earlier 0.6 build): Studio loaded and showed existing presets. Running role subagents was not tested on this version.
- DSH `0.2.0-rc.2` and `0.2.1-alpha.2`: the same four HTTP checks passed on a fresh install of 0.6.0. Running role subagents and the desktop app were not tested on these versions.
- Not tested on any version: external model calls in these checks, upgrading data from 0.5.0, and operating systems other than macOS. Back up your profile before upgrading.

### Upgrade notes

- Keep `<profile>/studio-data/child-policies/` when backing up or moving a profile. A role subagent whose file is missing or damaged will not run.
- On DSH `0.2.1-rc.2`, 2,710 of its 2,910 client strings are translated, including the plugin market, web search settings and the newer model settings. 74 strings without a natural translation yet stay in English. Three plugin-manager messages follow `0.2.1-rc.1` and later, so on `0.2.0-rc.2` and `0.2.1-alpha.2` they show a placeholder such as `{reason}` as text.

### 한국어

DSH `0.2.0-rc.2`, `0.2.1-alpha.2`, `0.2.1-rc.1` 또는 `0.2.1-rc.2`가 필요합니다.

0.6.0은 GitHub에만 공개했고, npm에는 올리지 않았습니다. 0.6.1에는 [0.6.0](#060--2026-10-17)에 적힌 변경 사항이 포함됩니다. 화면과 Pixie Loop 사용 예시는 [0.6.1 새 기능](docs/highlights.ko.md)을 참고하세요.

#### 주요 변경

- **DSH `0.2.1-rc.1`, `0.2.1-rc.2` 지원.** 이 버전부터는 DSH가 서브에이전트를 시작할 때 역할 지침과 Tool Filter를 적용하지 않습니다. 따라서 Studio는 역할 서브에이전트를 만들 때 지침과 Tool Filter를 저장해 두고, 실행 전에 직접 적용합니다. Fresh와 Fork 모두 마찬가지입니다. 이 지침과 Tool Filter로 역할 서브에이전트를 실제로 실행하는 것은 `0.2.1-rc.1`에서 확인했습니다. `0.2.1-rc.2`의 경우 Studio가 여기에서 사용하는 API에 변경이 없으며, 역할 저장·재적용까지만 확인했습니다. 이 값은 `<프로필>/studio-data/child-policies/`에 저장되며, 종료된 서브에이전트를 이어서 실행할 때도 다시 사용됩니다.
- **Loop 레시피 편집기.** **예시 넣기**로 바로 사용할 수 있는 명세를 채우고, 잘못된 이름은 입력하는 즉시 알려 주며, 저장 시 기존 레시피가 변경될 경우에도 미리 알려 줍니다.

#### 변경 사항

- 역할 편집기와 세션 역할 편집기에서 어떤 지침이 적용되는지 안내합니다. 세션 지침은 새로 만드는 서브에이전트에 프리셋 역할 지침 대신 적용되며, 이미 만든 서브에이전트의 지침은 바뀌지 않습니다.
- SettingsX는 단축키를 하나씩 개별 등록합니다. 다른 플러그인이 같은 기본 키를 이미 사용 중이면 해당 명령만 키 없이 추가되고, 다른 명령은 영향을 받지 않습니다.

#### 검증

- 0.6.1 패키지를 수정하지 않은 DSH `0.2.1-rc.2`의 새 격리 프로필에 설치했고, Web 기동과 HTTP 검사 4개(Master, Optimized 복사, 세션 역할, 역할 저장·재적용·복원)가 통과했습니다.
- DSH `0.2.1-rc.1`(이전 0.6 빌드, 이후 역할 서브에이전트 코드 변경 없음): 수정하지 않은 런타임의 새 격리 프로필에 설치했습니다. 외부 모델 대신 로컬 테스트 모델로 Fresh·Fork 역할 서브에이전트가 지침과 Tool Filter를 유지하는 것을 재시작 후까지 확인했습니다. 정책 파일이 없으면 모델을 호출하기 전에 실행을 멈췄습니다.
- DSH `0.2.1-rc.2` 데스크톱 앱(이전 0.6 빌드)에서 Studio가 로드되고 기존 프리셋이 표시되는 것을 확인했습니다. 이 버전에서는 역할 서브에이전트 실행을 확인하지 않았습니다.
- DSH `0.2.0-rc.2`, `0.2.1-alpha.2`: 0.6.0을 새로 설치한 뒤 동일한 HTTP 검사 4개가 통과했습니다. 이 버전들에서는 역할 서브에이전트 실행과 데스크톱 앱을 확인하지 않았습니다.
- 모든 버전 공통으로 이 검사들의 외부 모델 호출, 0.5.0 데이터 업그레이드, macOS 이외 OS는 확인하지 않았습니다. 업데이트 전에 프로필을 백업하세요.

#### 업그레이드 참고

- 프로필을 백업하거나 옮길 때에는 `<프로필>/studio-data/child-policies/`도 함께 보존하세요. 이 파일이 없거나 손상되면 해당 역할 서브에이전트는 실행되지 않습니다.
- DSH `0.2.1-rc.2`에서는 클라이언트 문구 2,910개 중 2,710개를 번역했습니다. 플러그인 마켓, 웹 검색 설정, 새 모델 설정이 포함됩니다. 자연스러운 번역을 찾지 못한 74개는 영어로 둡니다. 플러그인 관리의 안내 문구 3개는 `0.2.1-rc.1` 이후 기준이라, `0.2.0-rc.2`·`0.2.1-alpha.2`에서는 `{reason}` 같은 자리표시자가 글자 그대로 보입니다.

## 0.6.0 — 2026-10-17

Requires DSH `0.2.0-rc.2` or `0.2.1-alpha.2`.

### Highlights

- **Pixie Loop.** The new `pixie_loop` tool runs many independent items through work → exact checks → decision-engine judgment → Pixie feedback → retry, outside the agent's context. Criteria are compiled once into fixed questions and must separate pass and fail examples before the run starts. The agent gets back only counts, a results file and the items that still failed; every attempt is in **Pixie tab → Loops**. See the [Pixie Loop guide](docs/appendix/pixie-loop.md).
- **Run, step and choose.** `act` runs each output with the session's `bash` tool and judges what it printed (for example trying CSS selectors in a page). `mode: "episode"` works step by step until a goal is reached, and `select` lets the decision engine pick one listed option per item or step. `route` groups results by a choice answer.
- **Loop recipes in gates and hook scripts.** Save a spec as a recipe in **Studio → Pixie → Gates → Loop recipes**; its checks are calibrated once when saved. A gate can judge with a recipe (**Check** stops with Pixie's feedback, **Repair** replaces the content once it passes), and hook scripts can call `pixie loop --recipe <name>`.
- **Per-session subagent roles.** A new **Subagents** tab next to Chat and Trajectory changes a role's model, reasoning effort and instructions for one session only, and adds roles that exist only in that session. The preset and other sessions are unchanged. See [Per-session subagent roles](docs/guide.md#per-session-subagent-roles).
- **Independent of later preset changes.** The first change copies the whole role into the session; later preset edits do not reach the copy until you choose **Use preset**.
- **Subagents follow their main session.** Subagents started from the session, and the subagents they start, use its roles. A subagent session's tab shows them read-only.
- **Studio shortcuts.** **DSH Studio → SettingsX → Shortcuts** adds keyboard commands DSH does not have: previous/next session in sidebar order, go to session 1–9, copy the working folder, and full screen. Assign keys in DSH's shortcut settings. See [Studio shortcuts](docs/guide.md#studio-shortcuts-settingsx).
- **DSH in Korean.** Choosing **한국어** in DSH **Settings → General → Language** now also translates DSH's own screens: 2,610 of the 2,779 client strings in DSH `0.2.0-rc.2` and `0.2.1-alpha.2` are translated, and 111 app names, units and format strings stay as they are. See [Show DSH in Korean](docs/guide.md#show-dsh-in-korean).

### Changes

- Studio Master includes the `pixie_loop` tool; Optimized does not. Studio installs a new `studio-pixie-loop-guide` skill into `<DSH home>/skills/`.
- Loop runs are stored in `<profile>/studio-data/pixie/loops/` per session (latest 50) and removed with deleted sessions. Recipes are stored in `<profile>/studio-data/pixie-loop/recipes.json`.
- `act` accepts only `bash`, requires `safeToRepeat: true`, quotes `{{output}}`, `{{input}}`, `{{id}}` as single shell words, and runs one at a time unless `isolated: true`.
- Item contents are sent to the Pixie model provider and the decision engine.
- Session role changes apply from the next delegation; subagents already running keep their settings.
- Models are checked when a session role is saved and again before each call.
- A session role added to a preset without roles is used instead of the parent-matching child.
- Session roles are stored in `<profile>/studio-data/session-roles/`, kept for archived sessions and removed with deleted sessions.
- Korean dictionaries are registered per DSH namespace. A namespace where DSH already ships Korean keeps DSH's dictionary, and Studio logs a warning for it; the other namespaces still register.
- Strings without a natural Korean translation (58) and text from the DSH Host or desktop app stay in English.

### Upgrade notes

- A gate can use either a hook script or a loop recipe, not both; call `pixie loop` from the script to combine them.
- Every session now shows the Chat / Subagents tab bar, also when developer tools (Trajectory) are off.
- The model-visible `subagent_role` tool description no longer depends on whether the preset defines roles. It now tells the agent to use `action=list` and explains the parent-matching fallback, so existing presets see slightly different tool text.

### 한국어

DSH `0.2.0-rc.2` 또는 `0.2.1-alpha.2`가 필요합니다.

#### 주요 변경

- **Pixie Loop.** 새 `pixie_loop` 도구가 서로 독립인 항목 여러 개를 작업 → 정확한 검사 → 결정 엔진 판정 → Pixie 피드백 → 재시도로 처리합니다. 이 과정은 에이전트의 대화 밖에서 돕니다. 기준은 한 번만 질문으로 바뀌어 고정되고, 시작하기 전에 통과 예시와 실패 예시를 가를 수 있어야 합니다. 에이전트는 통과 수, 결과 파일, 끝내 통과하지 못한 항목만 돌려받고, 모든 시도는 **Pixie 탭 → 루프**에서 봅니다. [Pixie Loop 가이드](docs/appendix/pixie-loop.ko.md)를 참고하세요.
- **실행, 단계별 진행, 선택.** `act`는 각 출력에 대해 세션의 `bash` 도구로 명령을 실행하고 그 결과로 판정합니다(예: 페이지의 CSS 셀렉터 테스트). `mode: "episode"`는 목표에 도달할 때까지 한 단계씩 진행하고, `select`는 각 항목이나 단계에서 결정 엔진이 보기 중 하나를 선택하도록 합니다. `route`는 choice 질문의 답에 따라 결과를 분기합니다.
- **게이트와 훅 스크립트에서 쓰는 Loop 레시피.** **Studio → Pixie → 게이트 → Loop 레시피**에서 명세를 레시피로 저장합니다. 저장할 때 검사를 한 번 수행합니다. 게이트는 레시피로 판정할 수 있고(**판정**은 Pixie 피드백과 함께 차단하고, **고치기**는 통과하면 고친 내용으로 바꿉니다), 훅 스크립트는 `pixie loop --recipe <이름>`을 호출합니다.
- **세션별 서브에이전트 역할.** Chat, Trajectory 옆에 있는 새 **Subagents** 탭에서 역할의 모델·추론 수준·지침을 해당 세션에서만 바꾸고, 그 세션에서만 사용할 역할을 추가합니다. 프리셋과 다른 세션은 변경되지 않습니다. [세션별 서브에이전트 역할](docs/guide.ko.md#세션별-서브에이전트-역할)을 참고하세요.
- **이후 프리셋 변경과 무관.** 처음 바꿀 때 역할 전체가 세션에 복사됩니다. 이후 프리셋을 고쳐도 **프리셋 값 사용**을 누르기 전까지 복사본은 바뀌지 않습니다.
- **서브에이전트는 메인 세션을 따릅니다.** 세션에서 시작된 서브에이전트와 그 서브에이전트가 다시 시작한 서브에이전트도 해당 세션의 역할을 사용합니다. 서브에이전트 세션의 탭은 읽기 전용입니다.
- **Studio 단축키.** **DSH Studio → SettingsX → 단축키**에서 DSH에 없는 키보드 명령을 더합니다. 사이드바 순서로 이전·다음 세션, 세션 1–9로 이동, 작업 폴더 복사, 전체 화면입니다. 키는 DSH 단축키 설정에서 지정합니다. [Studio 단축키](docs/guide.ko.md#studio-단축키-settingsx)를 참고하세요.
- **DSH 화면 한국어.** DSH **Settings → General → Language**(한국어 화면에서는 **설정 → 일반 → 언어**)에서 **한국어**를 고르면 DSH 자체 화면도 한국어로 바뀝니다. DSH `0.2.0-rc.2`·`0.2.1-alpha.2`의 클라이언트 문구 2,779개 중 2,610개를 번역했고, 앱 이름·단위·형식 문자열 111개는 그대로 둡니다. [DSH 화면을 한국어로 보기](docs/guide.ko.md#dsh-화면을-한국어로-보기)를 참고하세요.

#### 변경 사항

- Studio Master에는 `pixie_loop` 도구가 포함되고, Optimized에는 포함되지 않습니다. 새 스킬 `studio-pixie-loop-guide`는 `<DSH 홈>/skills/`에 자동으로 설치됩니다.
- 루프 실행 기록은 세션별로 `<프로필>/studio-data/pixie/loops/`에 저장되며(최근 50개), 세션을 삭제하면 해당 세션의 기록도 함께 삭제됩니다. 레시피는 `<프로필>/studio-data/pixie-loop/recipes.json`에 저장됩니다.
- `act`는 `bash`만 받고 `safeToRepeat: true`가 필요합니다. `{{output}}`, `{{input}}`, `{{id}}`는 셸 단어 하나로 감싸며, `isolated: true`가 아니면 한 번에 하나씩 실행합니다.
- 항목의 내용은 Pixie 모델 제공자와 결정 엔진으로 전송됩니다.
- 세션 역할 변경 사항은 다음 위임부터 적용되며, 이미 실행 중인 서브에이전트는 그대로입니다.
- 세션 역할의 모델은 저장할 때와 매 호출 전에 확인합니다.
- 역할이 없는 프리셋에 세션 역할을 추가하면 부모와 같은 설정 대신 그 역할로 위임합니다.
- 세션 역할은 `<프로필>/studio-data/session-roles/`에 저장되며, 보관한 세션은 유지하고 삭제한 세션은 함께 지웁니다.
- 한국어 사전은 DSH 네임스페이스별로 따로 등록합니다. DSH가 이미 한국어를 추가한 네임스페이스에서는 DSH 사전을 사용하고 경고만 남기며, 나머지 네임스페이스는 그대로 등록합니다.
- 자연스러운 번역을 찾지 못한 문구 58개와 DSH Host·데스크톱 앱이 보내는 문구는 영어로 남습니다.

#### 업그레이드 참고

- 게이트는 훅 스크립트와 Loop 레시피 중 하나만 사용할 수 있습니다. 함께 사용하려면 스크립트 안에서 `pixie loop`를 호출하세요.
- 개발자 도구(Trajectory)를 꺼 둬도 모든 세션에 Chat / Subagents 탭 줄이 표시됩니다.
- 모델이 보는 `subagent_role` 도구 설명이 프리셋의 역할 유무와 상관없는 한 가지 문구로 바뀌었습니다. `action=list`로 역할을 확인하라는 안내와 역할이 없을 때 부모와 같은 설정으로 위임한다는 설명이 포함되어 있어, 기존 프리셋에서도 도구 문구가 조금 달라집니다.

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
