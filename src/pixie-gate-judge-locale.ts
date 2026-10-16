const messages = {
  validation_questions: ['질문을 하나 이상 추가하세요', 'Add at least one question', '请至少添加一个问题'],
  validation_questionId: ['질문 ID를 확인하세요', 'Check question ID', '请检查问题 ID'],
  validation_options: ['옵션 문구가 있는 선택지를 두 개 이상 입력하세요', 'Choice needs at least two options with descriptions', '请输入至少两个非空选项描述'],
  validation_levels: ['점수 단계를 2–10개 입력하세요', 'Score needs 2–10 levels', '请输入 2–10 个评分等级'],
  validation_question: ['질문 내용을 입력하세요', 'Enter question text', '请输入问题内容'],
  validation_criteria: ['참·거짓 기준을 확인하세요', 'Check criteria', '请检查真假标准'],
  validation_questionType: ['질문 유형을 확인하세요', 'Check question type', '请检查问题类型'],
  validation_conditions: ['통과 조건을 하나 이상 설정하세요', 'Set nonempty conditions and all/any mode', '请设置至少一个通过条件及模式'],
  validation_unknownQuestion: ['조건이 참조하는 질문을 확인하세요', 'Condition references unknown question', '请检查条件引用的问题'],
  validation_conditionType: ['조건과 질문의 유형이 같아야 합니다', 'Condition type must match question', '条件与问题类型必须一致'],
  validation_allowed: ['허용 옵션을 현재 선택지에서 선택하세요', 'Condition needs known allowed choices', '请从现有选项中选择允许的选项'],
  validation_range: ['기준값이 허용 범위를 벗어났습니다', 'Condition threshold out of range', '阈值超出允许范围'],

  judge: ['판정', 'Judge', '判定'],
  fixedRole: ['판정 단계는 통과/실패만 결정합니다', 'Judge stages only decide pass or fail.', '判定阶段仅决定通过或失败'],
  defaultModel: ['판정 기본 모델', 'Default judge model', '默认判定模型'],
  questions: ['질문', 'Questions', '问题'], addQuestion: ['질문 추가', 'Add question', '添加问题'], questionId: ['질문 ID', 'Question ID', '问题 ID'], type: ['질문 유형', 'Question type', '问题类型'],
  choice: ['선택', 'Choice', '选择'], score: ['점수', 'Score', '评分'], noul: ['참 확률', 'Noul', '为真概率'],
  optionId: ['옵션 ID', 'Option ID', '选项 ID'], label: ['옵션 문구', 'Option label', '选项描述'], addOption: ['옵션 추가', 'Add option', '添加选项'],
  level: ['단계 문구', 'Level label', '等级描述'], addLevel: ['점수 단계 추가', 'Add score level', '添加评分等级'],
  question: ['질문 내용', 'Question text', '问题内容'], true: ['참 기준', 'True criterion', '为真标准'], false: ['거짓 기준', 'False criterion', '为假标准'],
  pass: ['통과 규칙', 'Pass rules', '通过规则'], mode: ['조건 모드', 'Condition mode', '条件模式'], all: ['모두 만족', 'All conditions', '满足全部'], any: ['하나라도 만족', 'Any condition', '满足任一'],
  addCondition: ['조건 추가', 'Add condition', '添加条件'], condition: ['조건', 'Condition', '条件'], selectQuestion: ['질문 선택', 'Select question', '选择问题'], threshold: ['기준값 (0–1)', 'Threshold (0–1)', '阈值（0–1）'], min: ['최소 점수 단계', 'Minimum score level', '最低评分等级'], allowed: ['허용 옵션', 'Allowed options', '允许的选项'],
  invalid: ['설정을 확인하세요', 'Check this setting', '请检查此设置'], duplicate: ['ID가 겹치면 안 됩니다', 'IDs must be unique', 'ID 必须唯一'],
  settingsDescription: ['판정 기본값을 설정합니다. Pixie의 수동 판정 탭도 이 설정을 사용합니다.', 'Set judge defaults. The manual Judge tab in Pixie also uses these settings.', '设置判定默认值。Pixie 的手动判定标签页也使用这些设置'],
  model: ['판정 모델', 'Judge model', '判定模型'], modelHint: ['비우면 Pixie 기본 모델을 사용합니다.', 'Leave empty to use the Pixie default model.', '留空使用 Pixie 默认模型'],
  prompt: ['판정 시스템 프롬프트', 'Judge system prompt', '判定系统提示'], promptHint: ['비우면 기본 Jev JSON 지시문을 사용합니다.', 'Leave empty to use the default Jev JSON instructions.', '留空使用默认 Jev JSON 指令'], reset: ['기본값으로 되돌리기', 'Restore default', '恢复默认'],
  failedNoul: ['질문 "{question}": 예 확률 {actual} < 기준 {threshold}', 'Question "{question}": yes probability {actual} < threshold {threshold}', '问题“{question}”：是的概率 {actual} < 阈值 {threshold}'],
  failedScore: ['질문 "{question}": 점수 {actual} < 최소 {min}', 'Question "{question}": score {actual} < minimum {min}', '问题“{question}”：评分 {actual} < 最低 {min}'],
  failedChoice: ['질문 "{question}": 허용 옵션이 아닌 선택값 {actual}', 'Question "{question}": selection {actual} is not allowed', '问题“{question}”：选择 {actual} 不在允许选项中'],
  answers: ['판정 답변', 'Judge answers', '判定回答'], probability: ['확률', 'Probability', '概率'], confidence: ['신뢰도', 'Confidence', '置信度'],
} as const;
export type JudgeTextKey = keyof typeof messages;
export function judgeText(locale: string, key: JudgeTextKey): string { return messages[key][locale.startsWith('ko') ? 0 : locale.startsWith('zh') ? 2 : 1]; }

export function judgeValidationText(locale: string, code: string): string {
  const key = `validation_${code}`;
  return judgeText(locale, key in messages ? key as JudgeTextKey : 'invalid');
}
