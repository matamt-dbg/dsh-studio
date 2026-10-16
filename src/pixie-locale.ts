/** Pixie copy in ko, en, and zh. */
const en = {
  mdCopy: 'Copy', mdCopied: 'Copied', mdFootnotes: 'Footnotes',
  pageJudge: 'Decision engine', pageJudgeDescription: 'The engine behind \'pixie judge\' in gate hook scripts. Judgments run only when a script asks for one.',
  judgeEngine: 'Engine', judgeEngineLlm: 'LLM', judgeEngineJev: 'Jev', judgeEngineLlmHint: 'A conversation model answers in the Jev format.', judgeEngineJevHint: 'TypeSafe Jev answers through its API. Gate input is sent to TypeSafe.',
  judgeModel: 'Judge model', judgeModelHint: 'When not set, the value entered in the Pixie model settings is used.', judgeModelPixie: 'Pixie model',
  judgePrompt: 'Judge system prompt', judgePromptHint: 'Leave empty for the built-in prompt.',
  jevModel: 'Jev model', jevModelHint: 'A model ID or alias such as jev-latest. Pin a version once you tune thresholds.',
  jevKey: 'TypeSafe API key', jevKeyHint: 'Stored in DSH credentials as TYPESAFE_API_KEY. It is never shown again.', jevKeySet: 'Set', jevKeyFrom: 'Source: {source}', jevKeyMissing: 'Not set',
  jevKeyReadOnly: 'Set by a read-only source ({source}). Change it there.', jevKeyUnavailable: 'The DSH credentials service is not available, so the key cannot be stored here.',
  jevKeyPlaceholder: 'Paste the key', jevKeySave: 'Save key', jevKeyDelete: 'Remove key', jevKeyFailed: 'Could not update the key.', errCredentialsRefs: 'The DSH credentials file (.credentials.yaml in the DSH home) has an empty refs: line. Change it to refs: {} and save again.', jevKeySaving: 'Saving…', jevKeyRemoving: 'Removing…', jevKeySaved: 'Key saved.', jevKeyRemoved: 'Key removed.',
  title: 'Pixie', chat: 'Threads', judge: 'Judge', threads: 'Pixie threads', newThread: 'New thread', fresh: 'New', fork: 'Continue',
  mode: 'Context mode', model: 'Model',
  allThreads: 'All threads', turnCount: 'questions', activeBadge: '/pixie sends here', makeTarget: 'Send /pixie here', freshMeta: 'Empty start', forkMeta: 'Copied session text', noTurns: 'No questions yet',
  streaming: 'Answering', cancelled: 'Cancelled', error: 'Failed', cancel: 'Cancel', ask: 'Ask', retry: 'Retry', loading: 'Loading…',
  question: 'Question for Pixie', placeholder: 'Ask Pixie… (⌘/Ctrl+Enter)',
  isolation: 'Pixie answers stay here. Nothing is added to the conversation or the agent’s context.',
  noModel: 'No Pixie model is set. Choose one in DSH Studio → Pixie.',
  judgeNote: 'Try a judgment with the Pixie model: give a state and questions, and get a choice, a score, or a yes probability for each.',
  judgeState: 'State (text or JSON)', judgeQuestions: 'Questions (JSON by id)', runJudge: 'Run judge', judgeQuestionsJson: 'Questions must be JSON.',
  confidence: 'confidence', yesProbability: 'P(yes)',
  settingsTitle: 'Pixie',
  settingsModel: 'Default model', settingsModelHint: 'The default model for /pixie and threads.', settingsNoModel: 'Not set', settingsEffort: 'Reasoning effort', settingsEffortDefault: 'Model default',
  settingsMaxTokens: 'Max output tokens', settingsMaxTokensHint: 'Leave empty for the model default.', settingsMode: 'Default context for new threads',
  settingsModeFresh: 'New threads start empty.', settingsModeFork: 'New threads copy this conversation’s text once (user and assistant text only).',
  settingsPrompt: 'Pixie system prompt', settingsAllowThreadModel: 'Allow a model per thread', settingsThreadModelOn: 'Allow a different model', settingsThreadModelOnHint: 'A new thread can pick its own model.', settingsThreadModelOff: 'Always the default model', settingsThreadModelOffHint: 'Every thread uses the default model.', save: 'Save', saving: 'Saving…', savedButton: 'Saved', saveFailed: 'Could not save Pixie settings. Your edits remain on this screen.', dismiss: 'Dismiss', settingsNavigation: 'Pixie menu', settingsGroup: 'Settings', pageModel: 'Model', pageModelDescription: 'Set the model Pixie uses. It never joins the conversation or the agent’s context.', pageThreads: 'Threads', pageThreadsDescription: 'How new Pixie threads start and whether each can pick a model.', pagePrompt: 'System prompt', pagePromptDescription: 'Instructions every Pixie request starts with.',
  catalogFailed: 'Some providers could not list models:',
  rowAsked: 'Asked Pixie — the answer is in the Pixie tab', openTab: 'Open Pixie', deleteThread: 'Delete thread', create: 'Create', noThreads: 'No threads yet', rowWaiting: 'Pixie is answering…',
  truncated: 'Cut at the token limit', errNoModel: 'No Pixie model is set. Choose one in DSH Studio → Pixie.', errBusy: 'Pixie is still answering in this session.', errEmpty: 'Type a question after /pixie.',
} as const;
export type PixieTextKey = keyof typeof en;
const ko: Record<PixieTextKey, string> = {
  mdCopy: '복사', mdCopied: '복사됨', mdFootnotes: '각주',
  pageJudge: '결정 엔진', pageJudgeDescription: '게이트 훅 스크립트에서 \'pixie judge\'가 사용하는 엔진입니다. 스크립트가 요청할 때만 판정합니다.',
  judgeEngine: '엔진', judgeEngineLlm: 'LLM', judgeEngineJev: 'Jev', judgeEngineLlmHint: '대화 모델이 Jev 형식으로 답을 생성합니다.', judgeEngineJevHint: 'TypeSafe Jev API가 답합니다. 게이트 입력이 TypeSafe로 전송됩니다.',
  judgeModel: '판정 모델', judgeModelHint: '정하지 않으면 Pixie 모델 설정에서 입력한 값을 사용합니다.', judgeModelPixie: 'Pixie 모델',
  judgePrompt: '판정 시스템 프롬프트', judgePromptHint: '비우면 기본 프롬프트를 씁니다.',
  jevModel: 'Jev 모델', jevModelHint: 'jev-latest 같은 모델 ID나 별칭을 넣습니다. 기준값을 조정한 뒤에는 버전을 고정하세요.',
  jevKey: 'TypeSafe API 키', jevKeyHint: 'DSH 자격 증명에 TYPESAFE_API_KEY로 저장되며, 저장한 키는 다시 표시되지 않습니다.', jevKeySet: '설정됨', jevKeyFrom: '출처: {source}', jevKeyMissing: '설정 안 됨',
  jevKeyReadOnly: '읽기 전용 출처({source})에서 설정한 값입니다. 그곳에서 바꾸세요.', jevKeyUnavailable: 'DSH 자격 증명 서비스를 사용할 수 없어 여기에 키를 저장할 수 없습니다.',
  jevKeyPlaceholder: '키 붙여 넣기', jevKeySave: '키 저장', jevKeyDelete: '키 삭제', jevKeyFailed: '키를 바꾸지 못했습니다.', errCredentialsRefs: 'DSH 자격 증명 파일(DSH 홈의 .credentials.yaml)에서 refs: 줄이 비어 있습니다. refs: {}로 고친 뒤 다시 저장하세요.', jevKeySaving: '저장 중…', jevKeyRemoving: '삭제 중…', jevKeySaved: '키를 저장했습니다.', jevKeyRemoved: '키를 삭제했습니다.',
  title: 'Pixie', chat: '스레드', judge: '판정', threads: 'Pixie 스레드', newThread: '새 스레드', fresh: '새 대화', fork: '이어쓰기',
  mode: '컨텍스트 모드', model: '모델',
  allThreads: '전체 스레드', turnCount: '개 질문', activeBadge: '여기로 /pixie 보내기', makeTarget: '/pixie를 이 스레드로 보내기', freshMeta: '빈 상태로 시작', forkMeta: '세션 텍스트를 복사함', noTurns: '아직 질문이 없습니다',
  streaming: '답변 중', cancelled: '취소됨', error: '실패', cancel: '취소', ask: '묻기', retry: '다시 시도', loading: '불러오는 중…',
  question: 'Pixie에게 질문', placeholder: 'Pixie에게 묻기… (⌘/Ctrl+Enter)',
  isolation: 'Pixie 답변은 여기에만 남습니다. 대화와 에이전트 컨텍스트에는 아무것도 추가되지 않습니다.',
  noModel: 'Pixie 모델이 설정되지 않았습니다. DSH Studio → Pixie에서 선택하세요.',
  judgeNote: 'Pixie 모델로 판정을 시험해 보세요. 상태와 질문을 넣으면 질문마다 선택지, 점수, 예 확률을 돌려줍니다.',
  judgeState: '상태 (텍스트 또는 JSON)', judgeQuestions: '질문 (ID별 JSON)', runJudge: '판정 실행', judgeQuestionsJson: '질문은 JSON이어야 합니다.',
  confidence: '확신도', yesProbability: '예 확률',
  settingsTitle: 'Pixie',
  settingsModel: '기본 모델', settingsModelHint: '/pixie 명령과 스레드에서 기본으로 쓰는 모델입니다.', settingsNoModel: '설정 안 함', settingsEffort: '추론 강도', settingsEffortDefault: '모델 기본값',
  settingsMaxTokens: '최대 출력 토큰', settingsMaxTokensHint: '비우면 모델 기본값을 씁니다.', settingsMode: '새 스레드의 기본 컨텍스트',
  settingsModeFresh: '새 스레드는 빈 상태로 시작합니다.', settingsModeFork: '새 스레드를 만들 때 이 대화의 사용자·어시스턴트 텍스트를 한 번 복사해 옵니다.',
  settingsPrompt: 'Pixie 시스템 프롬프트', settingsAllowThreadModel: '스레드별 모델 허용', settingsThreadModelOn: '다른 모델 허용', settingsThreadModelOnHint: '새 스레드에서 모델을 따로 고를 수 있습니다.', settingsThreadModelOff: '항상 기본 모델', settingsThreadModelOffHint: '모든 스레드가 기본 모델을 씁니다.', save: '저장', saving: '저장 중…', savedButton: '저장됨', saveFailed: 'Pixie 설정을 저장하지 못했습니다. 편집한 내용은 화면에 그대로 있습니다.', dismiss: '닫기', settingsNavigation: 'Pixie 메뉴', settingsGroup: '설정', pageModel: '모델', pageModelDescription: 'Pixie가 쓸 모델을 정합니다. Pixie 답변은 대화나 에이전트 컨텍스트에 들어가지 않습니다.', pageThreads: '스레드', pageThreadsDescription: '새 Pixie 스레드의 시작 방식과 스레드별 모델 선택 여부를 정합니다.', pagePrompt: '시스템 프롬프트', pagePromptDescription: '모든 Pixie 요청 앞에 붙는 지시문입니다.',
  catalogFailed: '모델 목록을 가져오지 못한 제공자:',
  rowAsked: 'Pixie에게 물어봄 · 답변은 Pixie 탭에 있습니다', openTab: 'Pixie 열기', deleteThread: '스레드 삭제', create: '만들기', noThreads: '아직 스레드가 없습니다', rowWaiting: 'Pixie가 답변하는 중…',
  truncated: '토큰 한도에서 잘렸습니다', errNoModel: 'Pixie 모델이 설정되지 않았습니다. DSH Studio → Pixie에서 선택하세요.', errBusy: '이 세션에서 Pixie가 아직 답변 중입니다.', errEmpty: '/pixie 뒤에 질문을 입력하세요.',
};
const zh: Record<PixieTextKey, string> = {
  mdCopy: '复制', mdCopied: '已复制', mdFootnotes: '脚注',
  pageJudge: '决策引擎', pageJudgeDescription: '门控钩子脚本中 \'pixie judge\' 使用的引擎，仅在脚本请求时判定。',
  judgeEngine: '引擎', judgeEngineLlm: 'LLM', judgeEngineJev: 'Jev', judgeEngineLlmHint: '由对话模型按 Jev 格式回答。', judgeEngineJevHint: '由 TypeSafe Jev API 回答，门控输入会发送给 TypeSafe。',
  judgeModel: '判定模型', judgeModelHint: '未设置时使用 Pixie 模型设置中填写的值。', judgeModelPixie: 'Pixie 模型',
  judgePrompt: '判定系统提示词', judgePromptHint: '留空则使用内置提示词。',
  jevModel: 'Jev 模型', jevModelHint: '模型 ID 或别名，如 jev-latest。调好阈值后请固定版本。',
  jevKey: 'TypeSafe API 密钥', jevKeyHint: '以 TYPESAFE_API_KEY 存入 DSH 凭据，保存后不再显示。', jevKeySet: '已设置', jevKeyFrom: '来源：{source}', jevKeyMissing: '未设置',
  jevKeyReadOnly: '由只读来源（{source}）设置，请在该处修改。', jevKeyUnavailable: 'DSH 凭据服务不可用，无法在此保存密钥。',
  jevKeyPlaceholder: '粘贴密钥', jevKeySave: '保存密钥', jevKeyDelete: '删除密钥', jevKeyFailed: '无法更新密钥。', errCredentialsRefs: 'DSH 凭据文件（DSH 主目录中的 .credentials.yaml）的 refs: 行为空。请改为 refs: {} 后重新保存', jevKeySaving: '保存中…', jevKeyRemoving: '删除中…', jevKeySaved: '已保存密钥', jevKeyRemoved: '已删除密钥',
  title: 'Pixie', chat: '线程', judge: '判定', threads: 'Pixie 线程', newThread: '新线程', fresh: '新对话', fork: '接续',
  mode: '上下文模式', model: '模型',
  allThreads: '全部线程', turnCount: '个问题', activeBadge: '/pixie 发送到这里', makeTarget: '让 /pixie 发送到这里', freshMeta: '从空开始', forkMeta: '复制了会话文本', noTurns: '还没有问题',
  streaming: '回答中', cancelled: '已取消', error: '失败', cancel: '取消', ask: '提问', retry: '重试', loading: '加载中…',
  question: '向 Pixie 提问', placeholder: '向 Pixie 提问…（⌘/Ctrl+Enter）',
  isolation: 'Pixie 的回答只保留在这里，不会加入对话或智能体上下文。',
  noModel: '尚未设置 Pixie 模型。请在 DSH Studio → Pixie 中选择。',
  judgeNote: '使用 Pixie 模型试用判定：提供状态和问题，每个问题返回选择、分数或为是的概率。',
  judgeState: '状态（文本或 JSON）', judgeQuestions: '问题（按 ID 的 JSON）', runJudge: '运行判定', judgeQuestionsJson: '问题必须是 JSON。',
  confidence: '置信度', yesProbability: '为是的概率',
  settingsTitle: 'Pixie',
  settingsModel: '默认模型', settingsModelHint: '/pixie 命令和线程的默认模型。', settingsNoModel: '未设置', settingsEffort: '推理强度', settingsEffortDefault: '模型默认',
  settingsMaxTokens: '最大输出 token', settingsMaxTokensHint: '留空则使用模型默认值。', settingsMode: '新线程的默认上下文',
  settingsModeFresh: '新线程从空开始。', settingsModeFork: '新线程复制一次当前对话文本（仅用户与助手文本）。',
  settingsPrompt: 'Pixie 系统提示词', settingsAllowThreadModel: '允许线程单独选模型', settingsThreadModelOn: '允许不同模型', settingsThreadModelOnHint: '新线程可以单独选择模型。', settingsThreadModelOff: '始终使用默认模型', settingsThreadModelOffHint: '所有线程都使用默认模型。', save: '保存', saving: '保存中…', savedButton: '已保存', saveFailed: '无法保存 Pixie 设置，编辑内容仍保留在此页面', dismiss: '关闭', settingsNavigation: 'Pixie 菜单', settingsGroup: '设置', pageModel: '模型', pageModelDescription: '设置 Pixie 使用的模型，不会进入对话或智能体上下文。', pageThreads: '线程', pageThreadsDescription: '设置新 Pixie 线程的起始方式，以及是否可单独选择模型。', pagePrompt: '系统提示词', pagePromptDescription: '每个 Pixie 请求开头的指令。',
  catalogFailed: '以下提供方无法列出模型：',
  rowAsked: '已询问 Pixie — 回答在 Pixie 标签页中', openTab: '打开 Pixie', deleteThread: '删除线程', create: '创建', noThreads: '还没有线程', rowWaiting: 'Pixie 正在回答…',
  truncated: '已在 token 上限处截断', errNoModel: '尚未设置 Pixie 模型。请在 DSH Studio → Pixie 中选择。', errBusy: 'Pixie 仍在此会话中回答。', errEmpty: '请在 /pixie 后输入问题。',
};
const tables = { en, ko, zh } as const;

/** @returns copy for the active locale, falling back to English. */
export function pixieText(locale: string, key: PixieTextKey): string {
  const table = locale.startsWith('ko') ? tables.ko : locale.startsWith('zh') ? tables.zh : tables.en;
  return table[key];
}

/** Stable codes the Host puts in front of user-facing failures, so the Client can show them in the active language. */
export const PIXIE_ERROR_CODES = { 'pixie/no-model': 'errNoModel', 'pixie/busy': 'errBusy', 'pixie/empty': 'errEmpty' } as const satisfies Record<string, PixieTextKey>;

/** Codes whose localized text explains a fix; the original Host text follows it so the cause stays visible. */
export const PIXIE_DETAILED_ERROR_CODES = { 'pixie/credentials-refs': 'errCredentialsRefs' } as const satisfies Record<string, PixieTextKey>;

/** Localize a Host failure that starts with a known `[code]`; other text (provider errors) is shown as given. */
export function pixieError(locale: string, message: string): string {
  const match = /^\[(pixie\/[\w-]+)\]\s*/.exec(message);
  const key = match ? PIXIE_ERROR_CODES[match[1] as keyof typeof PIXIE_ERROR_CODES] : undefined;
  if (key) return pixieText(locale, key);
  const detailed = match ? PIXIE_DETAILED_ERROR_CODES[match[1] as keyof typeof PIXIE_DETAILED_ERROR_CODES] : undefined;
  return detailed ? `${pixieText(locale, detailed)} (${message.slice(match![0].length)})` : message;
}
