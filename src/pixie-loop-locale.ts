/** Copy for the Pixie tab › Loops view (#31). */
const en = {
  recipes: 'Loop recipes', recipesDescription: 'Saved pixie_loop specs without items. Saving compiles the criteria and checks them against the calibration examples once; gates, hook scripts (pixie loop) and the pixie_loop tool (recipe) reuse them.', noRecipes: 'No recipes yet.', invalidRecipe: 'Entry {index} is invalid', kindReview: 'Review', kindAct: 'Runs commands', kindSelect: 'Selection', recipeChecks: '{count} checks', recipeNoChecks: 'pick only', deleteRecipe: 'Delete {name}', addRecipe: 'Add a recipe', recipeName: 'Name', recipeNameHint: 'Lowercase letters, digits and -. Saving under an existing name replaces it.', recipeDescription: 'Description', recipeSpec: 'Spec (JSON)', recipeSpecHint: 'A pixie_loop spec without items and output. See the Pixie Loop guide.', specJson: 'The spec must be JSON.', saveRecipe: 'Compile and save', recipeSaving: 'Compiling and calibrating…', cancelSave: 'Cancel', recipeSaved: 'Saved {name}.',
  loops: 'Loops', allLoops: 'All loop runs', emptyLoops: 'No loop runs yet. Agents start one with the pixie_loop tool.', refresh: 'Refresh',
  compiling: 'Preparing checks', running: 'Running', done: 'Done', stopped: 'Stopped early', error: 'Failed to start', cancelled: 'Cancelled',
  passed: 'Passed', escalated: 'Escalated', itemError: 'Error', itemCancelled: 'Cancelled', skipped: 'Skipped',
  progress: '{done}/{total} items', counts: 'passed {passed} · escalated {escalated} · errors {errors}', reason: 'Reason', checks: 'Checks',
  compiledPixie: 'compiled by Pixie from the criteria', compiledSpec: 'given in the spec', passRule: 'Passes when', min: '≥ {value}', accept: 'one of {value}',
  items: 'Items', attempt: 'Attempt {n}', attempts: '{n} attempt(s)', attemptFailed: 'Did not pass', output: 'Output', codeFailures: 'Exact checks failed', answers: 'Decision engine', feedback: 'Pixie feedback (a guess, not the verdict)',
  usage: 'Pixie {pixieIn}/{pixieOut} · judge {judgeIn}/{judgeOut} tokens', results: 'Results file', back: 'All loop runs',
  observation: 'Observation', selection: 'Picked', confidence: 'confidence {value}', groups: 'Groups', episode: 'Episode', step: 'Step {n}', recipe: 'Recipe', sourceGate: 'Gate', sourceHook: 'Hook script',
} as const;
export type LoopTextKey = keyof typeof en;
const ko: Record<LoopTextKey, string> = {
  recipes: 'Loop 레시피', recipesDescription: '항목을 뺀 pixie_loop 명세를 저장합니다. 저장할 때 기준을 질문으로 바꾸고 calibration 예시로 한 번 확인합니다. 게이트, 훅 스크립트(pixie loop), pixie_loop 도구(recipe)가 이 결과를 다시 씁니다.', noRecipes: '저장된 레시피가 없습니다.', invalidRecipe: '{index}번째 항목이 잘못되었습니다', kindReview: '검토', kindAct: '명령 실행', kindSelect: '선택', recipeChecks: '검사 {count}개', recipeNoChecks: '고르기만', deleteRecipe: '{name} 삭제', addRecipe: '레시피 추가', recipeName: '이름', recipeNameHint: '영어 소문자, 숫자, -만 씁니다. 같은 이름으로 저장하면 바꿉니다.', recipeDescription: '설명', recipeSpec: '명세 (JSON)', recipeSpecHint: 'items와 output을 뺀 pixie_loop 명세입니다. Pixie Loop 가이드를 참고하세요.', specJson: '명세는 JSON이어야 합니다.', saveRecipe: '확인하고 저장', recipeSaving: '질문으로 바꾸고 확인하는 중…', cancelSave: '취소', recipeSaved: '{name}을(를) 저장했습니다.',
  loops: '루프', allLoops: '모든 루프 실행', emptyLoops: '루프 실행 기록이 없습니다. 에이전트가 pixie_loop 도구로 시작합니다.', refresh: '새로고침',
  compiling: '검사 준비 중', running: '진행 중', done: '완료', stopped: '중간에 멈춤', error: '시작하지 못함', cancelled: '취소됨',
  passed: '통과', escalated: '넘김', itemError: '오류', itemCancelled: '취소됨', skipped: '건너뜀',
  progress: '{done}/{total}개 항목', counts: '통과 {passed} · 넘김 {escalated} · 오류 {errors}', reason: '이유', checks: '검사',
  compiledPixie: '기준을 Pixie가 질문으로 바꿈', compiledSpec: '명세에 직접 지정', passRule: '통과 조건', min: '{value} 이상', accept: '{value} 중 하나',
  items: '항목', attempt: '{n}번째 시도', attempts: '시도 {n}회', attemptFailed: '통과 못 함', output: '출력', codeFailures: '실패한 코드 검사', answers: '결정 엔진', feedback: 'Pixie 피드백 (판정이 아닌 추정)',
  usage: 'Pixie {pixieIn}/{pixieOut} · 판정 {judgeIn}/{judgeOut} 토큰', results: '결과 파일', back: '모든 루프 실행',
  observation: '실행 결과', selection: '고른 것', confidence: '확신도 {value}', groups: '분류', episode: '연속 실행', step: '{n}단계', recipe: '레시피', sourceGate: '게이트', sourceHook: '훅 스크립트',
};
const zh: Record<LoopTextKey, string> = {
  recipes: 'Loop 配方', recipesDescription: '保存不含项目的 pixie_loop 规格。保存时把标准转为问题，并用校准示例检查一次；门控、钩子脚本（pixie loop）和 pixie_loop 工具（recipe）会复用结果。', noRecipes: '还没有配方。', invalidRecipe: '第 {index} 项无效', kindReview: '审查', kindAct: '运行命令', kindSelect: '选择', recipeChecks: '{count} 项检查', recipeNoChecks: '仅选择', deleteRecipe: '删除 {name}', addRecipe: '添加配方', recipeName: '名称', recipeNameHint: '仅限小写字母、数字和 -。同名保存会替换。', recipeDescription: '说明', recipeSpec: '规格（JSON）', recipeSpecHint: '不含 items 和 output 的 pixie_loop 规格。请参阅 Pixie Loop 指南。', specJson: '规格必须是 JSON。', saveRecipe: '检查并保存', recipeSaving: '正在转换并校准…', cancelSave: '取消', recipeSaved: '已保存 {name}。',
  loops: '循环', allLoops: '全部循环运行', emptyLoops: '还没有循环运行。代理通过 pixie_loop 工具启动。', refresh: '刷新',
  compiling: '准备检查', running: '运行中', done: '完成', stopped: '提前停止', error: '未能开始', cancelled: '已取消',
  passed: '通过', escalated: '移交', itemError: '错误', itemCancelled: '已取消', skipped: '已跳过',
  progress: '{done}/{total} 项', counts: '通过 {passed} · 移交 {escalated} · 错误 {errors}', reason: '原因', checks: '检查',
  compiledPixie: '由 Pixie 将标准转为问题', compiledSpec: '在规格中直接给出', passRule: '通过条件', min: '≥ {value}', accept: '{value} 之一',
  items: '项目', attempt: '第 {n} 次尝试', attempts: '尝试 {n} 次', attemptFailed: '未通过', output: '输出', codeFailures: '未通过的代码检查', answers: '决策引擎', feedback: 'Pixie 反馈（推测，不是判定）',
  usage: 'Pixie {pixieIn}/{pixieOut} · 判定 {judgeIn}/{judgeOut} 词元', results: '结果文件', back: '全部循环运行',
  observation: '执行结果', selection: '选择', confidence: '置信度 {value}', groups: '分组', episode: '连续执行', step: '第 {n} 步', recipe: '配方', sourceGate: '门控', sourceHook: '钩子脚本',
};

export function loopText(locale: string, key: LoopTextKey, values: Record<string, string | number> = {}): string {
  const template = (locale.startsWith('ko') ? ko : locale.startsWith('zh') ? zh : en)[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}
