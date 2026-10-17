# Pixie Loop 가이드

[English](pixie-loop.md) | 한국어

Pixie Loop는 같은 기준으로 판정할 항목이 많을 때 **작업 → 판정 → 고쳐서 다시 하기**를 메인 에이전트의 대화 밖에서 반복하는 기능입니다. 에이전트는 `pixie_loop` 도구에 루프 명세를 하나 넘기고, 통과 수, 결과 파일, 끝까지 통과하지 못한 항목만 돌려받습니다. 각 항목에서 어떤 시도와 판정이 있었는지는 대화에 남지 않으며, **Pixie 탭 → 루프**에서 확인합니다.

- [언제 쓰나](#언제-쓰나)
- [준비](#준비)
- [동작 방식](#동작-방식)
- [명세 필드](#명세-필드)
- [기준 쓰는 법](#기준-쓰는-법)
- [calibration 예시](#calibration-예시)
- [코드 검사](#코드-검사)
- [상한과 결과](#상한과-결과)
- [예시 명세](#예시-명세)
- [실행해서 판정하기 (act)](#실행해서-판정하기-act)
- [연속 실행과 선택](#연속-실행과-선택)
- [결과 분류 (route)](#결과-분류-route)
- [레시피](#레시피)
- [실행 기록 보기](#실행-기록-보기)
- [할 수 없는 일](#할-수-없는-일)
- [에이전트 스킬](#에이전트-스킬)

## 언제 쓰나

| 상황 | 쓸 것 |
| --- | --- |
| 서로 독립인 항목이 많고, 모두 같은 기준으로 판정한다 (번역 검수, 문구 교정, 파일별 감사) | `pixie_loop` |
| 판정 한 번이면 된다 | `judge` 도구 |
| 파일을 찾아 읽고 판단하며 여러 단계로 일해야 한다 | `subagent_role` |
| 조건 분기나 여러 에이전트를 묶은 복잡한 흐름이 필요하다 | DSH `workflow` 도구 |
| 에이전트가 일하는 특정 순간에 자동으로 검사한다 | [Pixie Gate](pixie-gate.ko.md) |

## 준비

- **Studio → Pixie → 설정**에서 Pixie 모델을 지정합니다. 작업, 기준 변환, 피드백은 모두 이 모델이 담당합니다.
- **Studio → Pixie → 게이트 → 결정 엔진**에서 판정 엔진으로 LLM 또는 TypeSafe Jev를 선택합니다. Jev를 사용하려면 API 키가 필요합니다.
- 프리셋에 `pixie_loop` 도구가 있어야 합니다. Studio Master에는 들어 있습니다.

항목 내용은 Pixie 모델 공급자와 결정 엔진(Jev를 고르면 TypeSafe)으로 전송됩니다.

## 동작 방식

1. **기준 준비 (한 번):** `criteria`를 Pixie가 결정 엔진 질문과 통과 규칙으로 바꿉니다. `checks`를 직접 주면 이 단계를 건너뜁니다.
2. **calibration (한 번):** 통과해야 할 예시는 모두 통과하고, 떨어져야 할 예시는 모두 떨어져야 합니다. 그렇지 않으면 루프를 시작하지 않고 오류를 돌려줍니다. 통과하면 확인 없이 바로 시작합니다.
3. **항목마다:**
   - Pixie가 `work.instruction`과 `shared`를 보고 출력을 만듭니다.
   - 코드 검사(`codeChecks`)를 먼저 실행합니다. 하나라도 실패하면 결정 엔진은 호출하지 않습니다.
   - 결정 엔진이 고정된 질문으로 판정하고, 통과 규칙으로 통과 여부를 정합니다.
   - 실패하면 Pixie가 무엇을 고칠지 짧게 적고, 같은 항목을 다시 시도합니다.
4. **끝:** 결과 파일을 작성하고 요약을 반환합니다.

컨텍스트 규칙:

- 항목끼리는 서로를 보지 못합니다. 메인 대화도 들어가지 않습니다.
- 같은 항목을 재시도하면 해당 항목의 이전 출력과 피드백이 누적됩니다.
- 기준 준비와 피드백 작성은 매번 새 대화로 진행합니다.

통과 여부는 코드 검사와 결정 엔진의 결과만으로 정합니다. Pixie의 피드백은 다음 시도에 참고하는 용도일 뿐이며 판정을 바꾸지 않습니다. 결정 엔진은 이유를 알려주지 않으므로, 피드백에 적힌 이유는 Pixie의 추정입니다.

## 명세 필드

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `items` | 예 | `{ "inline": [{ "id", "input" }] }` 또는 `{ "path": "work/items.jsonl" }`. 파일은 한 줄에 `{"id","input"}` 하나. id는 겹치면 안 됩니다. 최대 2000개, 입력 하나 32,000자 |
| `work.instruction` | 레시피가 없으면 예 | 항목 하나에 할 작업. 작업자는 도구를 쓸 수 없습니다 |
| `shared` | | 모든 항목이 똑같이 보는 고정 자료(용어집, 스타일 가이드). 최대 64,000자 |
| `criteria` | 둘 중 하나 | 판정 기준을 평문으로. 기준 없는 한 번 고르기(`select`)만 생략 가능 |
| `checks` | 둘 중 하나 | 질문과 통과 규칙을 직접. [아래](#checks를-직접-줄-때) 참고 |
| `codeChecks` | | 결정 엔진 전에 돌리는 정확한 검사. [코드 검사](#코드-검사) |
| `calibration` | 기준이 있으면 예 | `{ "pass": [{ "input", "output", "observation"? }], "fail": [...] }`. 각각 1–10개 |
| `mode` | | `retry`(기본) 또는 `episode`. [연속 실행](#연속-실행과-선택) |
| `act` | | 출력을 실행해서 판정. [act](#실행해서-판정하기-act) |
| `extract` | | 실행 결과를 판정 전에 줄임 |
| `select` | | 결정 엔진이 보기 중 하나를 고름 |
| `route` | | choice 질문 답으로 결과 분류. [route](#결과-분류-route) |
| `maxAttempts` | | 항목당 시도 횟수(최대 10) 또는 연속 실행 단계 수(최대 100). 기본 3 |
| `concurrency` | | 동시에 처리할 항목 수. 기본 4, 최대 8 |
| `limits` | 레시피가 없으면 예 | `{ "tokens", "timeMs" }`. 둘 중 하나에 닿으면 멈추고 남은 항목은 건너뜀으로 보고합니다 |
| `output` | | 결과 JSONL 경로 |
| `recipe` | | 저장된 [레시피](#레시피) 이름. 주면 `items`, `output`, `run_in_background`만 함께 줍니다 |
| `run_in_background` | | `true`면 job id를 바로 돌려줍니다. `job_output`으로 요약을 받고 `job_kill`로 멈춥니다 |

## 기준 쓰는 법

결정 엔진은 `input`(항목 입력)과 `output`(작업자 출력)이 든 상태를 판정합니다.

- **한 문장에 한 가지만.** "의미가 같고 존댓말이며 용어집을 지킨다"보다 세 문장으로 나눕니다. Pixie가 질문을 하나씩 만들기 쉽습니다.
- **실패 유형에 이름을 붙입니다.** "문제가 있으면 오역·용어·어조·누락 중 무엇인지"라고 쓰면 choice 질문이 생기고, 피드백이 구체적이 됩니다.
- **정확히 맞아야 하는 검사는 기준에 넣지 않습니다.** 자리표시자 보존, JSON 형식, 특정 문자 포함 여부는 [코드 검사](#코드-검사)로 처리합니다. 결정 엔진은 확률을 산출하므로 이런 검사에는 적합하지 않습니다.
- 결정 엔진은 영어로 된 질문에서 가장 정확합니다. 기준을 영어로 작성하면 더 안정적입니다.

### checks를 직접 줄 때

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

- `noul`: 예일 확률. `min`(0 초과 1 이하) 이상이면 통과. "예"가 좋은 쪽이 되게 씁니다.
- `choice`: `accept`에 든 선택지면 통과. 실패하는 선택지가 하나 이상 남아야 합니다.
- `score`: 단계 번호(0부터). `min` 이상이면 통과.
- 질문은 1–10개. 질문 id는 엔진에 전달되지 않으므로 `instructions`만으로 뜻이 통해야 합니다.

## calibration 예시

calibration은 기준이 실제로 좋은 출력과 나쁜 출력을 구분하는지 미리 확인합니다. 잘못된 기준으로 수백 개 항목을 돌리는 일을 막습니다.

- **pass:** 실제로 받아들일 출력. 가장 흔한 형태 하나와 애매하지만 괜찮은 것 하나가 좋습니다.
- **fail:** 실제로 나올 법한 실수. 기준마다 하나씩 걸리는 예를 넣습니다(뜻이 바뀐 번역, 반말, 자리표시자 빠짐).
- 너무 뻔한 예(빈 문자열, 다른 언어)만 넣으면 확인 효과가 약합니다.

시작이 거부되면 오류 메시지에 어느 예시가 어떤 값으로 반대로 판정됐는지 나옵니다. 그 질문의 문장을 고치거나 `checks`로 직접 주고 다시 실행합니다.

## 코드 검사

| 검사 | 옵션 | 실패 조건 |
| --- | --- | --- |
| `{"type":"placeholders"}` | | 입력의 `{name}`, `{{count}}`, `%s`·`%1$d`, `<b>`·`</b>` 같은 자리표시자와 태그, 인라인 코드(백틱 안 글), Markdown 링크 주소 중 출력에서 빠지거나 개수가 줄어든 것이 있거나, 입력에 없던 것이 생김 |
| `{"type":"regex","pattern":"[가-힣]","expect":"match"}` | `flags`: `i` `m` `s` `u` | `match`는 출력이 패턴과 맞지 않을 때, `no-match`는 맞을 때 실패 |
| `{"type":"json","keys":["title"]}` | `keys` 선택 | 출력이 JSON이 아니거나, 객체에 지정한 키가 없음 |

코드 검사가 실패하면 그 실패 내용이 다음 시도에 그대로 전달됩니다.

## 상한과 결과

- `limits.tokens`는 Pixie와 결정 엔진의 입력 및 출력 토큰을 합한 값입니다. 대략 `항목 수 × 시도 횟수 × (입력+출력 길이 + 공통 자료)`로 계산하고 여유를 둡니다.
- 중단되면 상태는 `stopped`가 되고, 남은 항목은 `skipped`가 됩니다. 결과 파일에 없는 id만 골라 다시 실행하면 이어서 진행할 수 있습니다.
- 결과 파일의 각 줄: `{"id","status","output"?,"attempts","error"?}`. `status`는 `passed`·`escalated`·`error`·`cancelled`.
- 에이전트가 받는 요약: 통과 개수, `escalated`(시도를 모두 소진하고도 통과하지 못한 항목: id, 시도 횟수, 실패한 검사, 마지막 피드백), `errors`(엔진 오류 등), 건너뛴 항목 수, 결과 파일, 사용량. 통과한 출력은 요약에 포함되지 않습니다.
- `escalated` 항목은 메인 에이전트가 직접 고치거나 사람에게 물어봅니다.
- 결정 엔진 오류는 실패로 바꾸지 않고 `error` 항목으로 남깁니다.

## 예시 명세

### 번역 검수

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

### 문서 교정

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

### 파일별 감사 (항목 = 파일 내용)

에이전트가 파일 내용을 읽어 `items`에 넣거나 JSONL로 만든 뒤 실행합니다. 작업자는 파일을 직접 읽지 못합니다.

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

## 실행해서 판정하기 (act)

출력이 글이 아니라 **실행해 봐야 맞는지 아는 것**(CSS 셀렉터, 정규식, 명령 옵션, 설정 조각)이면 `act`를 씁니다. 루프 엔진이 출력마다 세션의 `bash` 도구로 명령을 한 번 실행하고, 그 출력(`observation`)을 결정 엔진이 판정합니다. 작업자(Pixie)는 여전히 도구가 없습니다.

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

- `command`의 `{{output}}`, `{{input}}`, `{{id}}`는 작은따옴표로 감싼 하나의 단어로 바뀝니다. 출력에 따옴표나 `;`가 포함되어도 명령이 깨지거나 다른 명령이 실행되는 일은 없습니다. 따라서 자리 표시자는 따옴표 안에 넣거나 다른 글자에 붙이지 말고, 독립된 단어로 씁니다(`"{{output}}"`, `x{{output}}`는 거부됩니다).
- 명령이 제한 시간을 초과하면 중단하고 `[timed out …]` 실행 결과로 판정합니다. 다음 실행과 겹치지 않습니다.
- `safeToRepeat: true`는 필수입니다. 재시도하거나 연속 실행하면 명령이 다시 실행됩니다. 파일 삭제·전송·결제처럼 두 번 실행하면 안 되는 작업에는 사용하지 않습니다.
- `isolated`(기본 `false`): 각 항목이 새 페이지나 임시 폴더처럼 별도의 상태를 사용한다면 `true`로 설정해 동시에 실행합니다. `false`인 경우에는 한 번에 하나씩 실행합니다.
- 명령은 세션의 파일 정책과 샌드박스를 그대로 따릅니다. 승인이 필요한 명령은 거부됩니다. 종료 코드가 0이 아니어도 루프는 멈추지 않고, `[command failed]`가 붙은 실행 결과로 판정합니다.
- calibration 예시에는 `observation`을 직접 적습니다. 시작 전 확인에서는 명령을 실행하지 않습니다.
- 실행 결과는 `maxObservationChars`(기본 8,000자)에서 자릅니다. `extract`를 주면 Pixie가 판정 전에 지시대로 줄입니다.
- 재시도할 때 작업자는 직전 실행 결과와 피드백을 봅니다.

예시에 있는 `probe.mjs`는 직접 작성하는 작은 스크립트입니다. 예를 들어 Playwright로 파일을 열고 셀렉터와 일치하는 요소의 개수와 텍스트를 출력합니다.

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

스크립트를 쓸 때:

- 판정에 필요한 내용만 짧은 텍스트로 출력합니다. 화면 이미지로는 판정할 수 없습니다.
- 항목마다 새 페이지나 임시 상태로 시작합니다. 그래야 `isolated: true`로 둘 수 있습니다.
- 실패도 출력으로 알립니다(`invalid selector: …`). 판정 엔진이 원인을 보고 Pixie가 피드백을 씁니다.

## 연속 실행과 선택

`mode: "episode"`는 출력 하나가 **한 단계**인 작업입니다. 단계마다 `act`가 실행되고, 다음 단계는 새 실행 결과를 보고 정합니다. 검사가 통과하면(목표 도달) 끝나고, `maxAttempts` 단계 안에 못 하면 넘깁니다.

`select`를 지정하면 작업자가 출력을 작성하지 않고 **결정 엔진이 보기 중 하나를 고릅니다.** 보기는 JSON `{"options": [이름 | {"name", "description"}]}`에서만 읽습니다. 보기는 항목 입력(`optionsFrom: "input"`)이나 연속 실행의 마지막 실행 결과(`optionsFrom: "observation"`)에서 가져옵니다. Pixie가 보기를 만들지 않으므로 고를 수 없는 행동은 나오지 않습니다.

- 기준이 없는 `select`(한 번 선택)는 선택한 값이 곧 결과이므로 calibration이 필요하지 않습니다.
- `minConfidence`보다 확신도가 낮으면 추측으로 진행하지 않고 넘깁니다.
- 보기는 최대 255개입니다. 넘으면 실행 명령에서 먼저 묶거나 거릅니다.

### 예: 실행 중인 게임에서 행동 고르기

게임의 상태와 가능한 행동을 JSON으로 출력하는 명령(`game-cli`)이 있다고 합니다.

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

- 첫 단계에서는 빈 문자열로 명령을 한 번 실행하여 초기 상태와 보기를 받습니다. `game-cli step ''`이 현재 상태만 출력하도록 합니다.
- 결정 엔진은 지금 상태만 봅니다. 몇 수 앞을 읽어야 하면 명령이 보기 설명에 결과 예측을 넣습니다(`{"name":"attack","description":"enemy hp -3, counterattack likely"}`).
- 결정 주기가 몇 초 이상인 턴제 작업에만 적합합니다. 실시간 조작은 지원하지 않습니다.

## 결과 분류 (route)

`route.question`에 choice 질문 id를 주면 항목마다 그 질문의 마지막 답이 분류가 됩니다. 요약에 분류별 개수가 나오고, 결과 파일 각 줄에 `bucket`이 붙습니다. `criteria`로 기준을 줄 때는 기준에 그 질문을 만들 문장을 넣으면 Pixie가 같은 id로 질문을 만듭니다.

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

## 레시피

자주 쓰는 명세는 **Studio → Pixie → 게이트 → Loop 레시피**에 이름을 붙여 저장합니다. 레시피는 `items`와 `output`을 뺀 명세입니다. 저장할 때 기준을 질문으로 바꾸고 calibration 예시로 한 번 확인하며, 확인에 실패하면 저장하지 않습니다. 이후 실행은 저장된 질문을 그대로 써서 매번 다시 바꾸거나 확인하지 않습니다.

| 쓰는 곳 | 방법 |
| --- | --- |
| `pixie_loop` 도구 | `{ "recipe": "ko-review", "items": {...}, "output"?: "...", "run_in_background"?: true }`. 다른 필드는 함께 줄 수 없습니다 |
| Pixie Gate | 게이트 고급 옵션 **Pixie Loop 레시피**에서 레시피와 **판정**·**고치기**를 고릅니다. [Pixie Gate 가이드](pixie-gate.ko.md#고급-옵션) |
| 훅 스크립트 | `pixie loop --recipe ko-review [--mode check|repair] [--input]`. [pixie 헬퍼](pixie-gate.ko.md#pixie-헬퍼) |

- 게이트와 훅 스크립트에서는 항목 하나(게이트 대상 또는 `--input`)로 실행합니다. **판정**은 대상을 그대로 출력으로 보고 검사만 하고, **고치기**는 작업자가 대상을 고쳐 통과할 때까지 재시도합니다.
- 게이트와 훅 스크립트에서는 명령을 실행하는 레시피(`act`), 연속 실행, 선택 레시피를 사용할 수 없습니다. 이러한 레시피는 `pixie_loop` 도구에서만 사용합니다.
- 게이트·훅 스크립트 실행도 해당 세션의 **Pixie 탭 → 루프**에 레시피 이름과 함께 남습니다.

### 예: 파일을 쓸 때마다 번역 검사하기

`ko-review` 레시피를 저장하고, `도구 실행 후` 게이트에 다음 훅 스크립트를 지정합니다.

```sh
#!/bin/bash
# write 도구가 쓴 내용을 레시피로 검사합니다.
[ "$PIXIE_TOOL_NAME" = write ] || exit 10
content=$(printf '%s' "$PIXIE_TOOL_ARGS" | jq -r .content)
if result=$(printf '%s' "$content" | pixie loop --recipe ko-review --input --json); then exit 10; fi
jq -n --arg reason "$(printf '%s' "$result" | jq -r .reason)" '{verdict:"stop", reason:$reason}'
exit 11
```

## 실행 기록 보기

세션 오른쪽 사이드바의 **Pixie 탭 → 루프**에서 실행 목록을 확인합니다. 실행을 선택하면 다음 항목이 표시됩니다.

- 상태와 진행(`3/10개 항목`), 통과·넘김·오류 수, 사용한 토큰, 결과 파일
- 검사: 질문, 통과 조건, 기준을 Pixie가 바꿨는지 명세에 직접 줬는지
- 항목을 누르면 시도마다 출력, 실패한 코드 검사, 결정 엔진 값, Pixie 피드백

진행 중에는 2초마다 새로 읽습니다. DSH가 다시 시작되면 진행 중이던 실행은 이어지지 않고 잠시 뒤 `취소됨`으로 표시됩니다.

## 할 수 없는 일

- 작업자가 도구를 쓰거나 파일을 읽는 일. 필요한 자료는 `items`나 `shared`에 넣습니다. 실행이 필요하면 `act`가 정해진 명령 하나를 대신 실행합니다.
- 항목끼리 참조하거나 실행 중에 용어집을 늘리는 일. 끝난 뒤 전체 결과로 일관성 검사를 한 번 더 돌립니다.
- 실행 중에 기준이나 항목 바꾸기. 멈추고 다시 시작합니다.
- 단계별로 다른 모델 쓰기. 모두 기본 Pixie 모델입니다.
- 이미지 판정, 실시간 조작.
- 코드 검사 세 종 밖의 정확한 검사는 `act` 명령으로 직접 출력해 판정합니다.
- 두 번 실행하면 안 되는 명령을 `act`로 쓰는 일.
- DSH 재시작 뒤 이어서 실행하기.
- 결정 엔진을 LLM으로 두고 Pixie와 같은 모델을 쓰면 생성한 쪽이 스스로 채점하게 됩니다. 가능하면 Jev나 다른 모델을 씁니다.

## 에이전트 스킬

Studio는 시작할 때 `<DSH 홈>/skills/studio-pixie-loop-guide/`에 이 가이드가 포함된 스킬을 설치합니다. 에이전트에게 "이 문자열들을 pixie_loop로 번역 검수해 줘"라고 요청하면 스킬을 읽고 명세를 작성합니다. 직접 수정한 파일은 업데이트할 때 덮어쓰지 않습니다. Studio 버전으로 되돌리려면 해당 파일을 삭제하고 DSH를 다시 시작합니다.
