/** Pixie copy in ko, en, and zh. */
const en = {
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
  title: 'Pixie', chat: '스레드', judge: '판정', threads: 'Pixie 스레드', newThread: '새 스레드', fresh: '새 대화', fork: '이어받기',
  mode: '컨텍스트 모드', model: '모델',
  allThreads: '전체 스레드', turnCount: '개 질문', activeBadge: '/pixie가 여기로 보냅니다', makeTarget: '/pixie를 여기로 보내기', freshMeta: '빈 상태로 시작', forkMeta: '세션 대화 복사', noTurns: '아직 질문이 없습니다',
  streaming: '답변 중', cancelled: '취소됨', error: '실패', cancel: '취소', ask: '요청', retry: '다시 시도', loading: '불러오는 중…',
  question: 'Pixie에게 질문', placeholder: 'Pixie에게 묻기… (⌘/Ctrl+Enter)',
  isolation: 'Pixie 답변은 여기에만 남습니다. 대화와 에이전트 컨텍스트에는 아무것도 추가되지 않습니다.',
  noModel: 'Pixie 모델이 설정되지 않았습니다. DSH Studio → Pixie에서 선택하세요.',
  judgeNote: 'Pixie 모델로 판정을 시험합니다. 상태와 질문을 넣으면 질문마다 선택지, 점수, 예 확률을 돌려줍니다.',
  judgeState: '상태 (텍스트 또는 JSON)', judgeQuestions: '질문 (ID별 JSON)', runJudge: '판정 실행', judgeQuestionsJson: '질문은 JSON이어야 합니다.',
  confidence: '확신도', yesProbability: '예 확률',
  settingsTitle: 'Pixie',
  settingsModel: '기본 모델', settingsModelHint: '/pixie 명령과 스레드에서 기본으로 쓰는 모델입니다.', settingsNoModel: '설정 안 함', settingsEffort: '추론 강도', settingsEffortDefault: '모델 기본값',
  settingsMaxTokens: '최대 출력 토큰', settingsMaxTokensHint: '비우면 모델 기본값을 씁니다.', settingsMode: '새 스레드의 기본 컨텍스트',
  settingsModeFresh: '새 스레드는 빈 상태로 시작합니다.', settingsModeFork: '새 스레드를 만들 때 이 대화의 사용자·어시스턴트 텍스트를 한 번 복사해 옵니다.',
  settingsPrompt: 'Pixie 시스템 프롬프트', settingsAllowThreadModel: '스레드별 모델 허용', settingsThreadModelOn: '다른 모델 허용', settingsThreadModelOnHint: '새 스레드에서 모델을 따로 고를 수 있습니다.', settingsThreadModelOff: '항상 기본 모델', settingsThreadModelOffHint: '모든 스레드가 기본 모델을 씁니다.', save: '저장', saving: '저장 중…', savedButton: '저장됨', saveFailed: 'Pixie 설정을 저장하지 못했습니다. 편집한 내용은 화면에 그대로 있습니다.', dismiss: '닫기', settingsNavigation: 'Pixie 메뉴', settingsGroup: '설정', pageModel: '모델', pageModelDescription: 'Pixie가 쓸 모델을 정합니다. Pixie 답변은 대화나 에이전트 컨텍스트에 들어가지 않습니다.', pageThreads: '스레드', pageThreadsDescription: '새 Pixie 스레드의 시작 방식과 스레드별 모델 선택 여부를 정합니다.', pagePrompt: '시스템 프롬프트', pagePromptDescription: '모든 Pixie 요청 앞에 붙는 지시문입니다.',
  catalogFailed: '모델 목록을 가져오지 못한 제공자:',
  rowAsked: 'Pixie에게 물어봄 · 답변은 Pixie 탭에 있습니다', openTab: 'Pixie 열기', deleteThread: '스레드 삭제', create: '만들기', noThreads: '아직 스레드가 없습니다', rowWaiting: 'Pixie가 답변하는 중…',
  truncated: '토큰 한도에 걸려 잘림', errNoModel: 'Pixie 모델이 설정되지 않았습니다. DSH Studio → Pixie에서 선택하세요.', errBusy: '이 세션에서 Pixie가 아직 답변 중입니다.', errEmpty: '/pixie 뒤에 질문을 입력하세요.',
};
const zh: Record<PixieTextKey, string> = {
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

/** Localize a Host failure that starts with a known `[code]`; other text (provider errors) is shown as given. */
export function pixieError(locale: string, message: string): string {
  const match = /^\[(pixie\/[\w-]+)\]\s*/.exec(message);
  const key = match ? PIXIE_ERROR_CODES[match[1] as keyof typeof PIXIE_ERROR_CODES] : undefined;
  return key ? pixieText(locale, key) : message;
}
