/** Display titles and one-line purposes for known DSH and Studio plugins (ko/en/zh). Unknown packages show their name. */
type Text = { ko: string; en: string; zh: string };
type Label = { title: Text; purpose: Text };
const L = (ko: string, en: string, zh: string, pko: string, pen: string, pzh: string): Label => ({ title: { ko, en, zh }, purpose: { ko: pko, en: pen, zh: pzh } });

const labels: Record<string, Label> = {
  '@deepseek-ai/dsh-persona': L('페르소나', 'Persona', '人设', '시스템 프롬프트 맨 앞의 역할 문장', 'Role sentence at the top of the system prompt', '系统提示词开头的角色说明'),
  '@deepseek-ai/dsh-agent-instructions': L('AGENTS.md 지침', 'AGENTS.md instructions', 'AGENTS.md 指令', '작업 폴더의 지침 파일을 턴 시작에 넣음', 'Adds instruction files from the work folder at turn start', '在每轮开始时加入工作目录的指令文件'),
  '@deepseek-ai/dsh-time-context': L('현재 시각 안내', 'Current time notice', '当前时间提示', '턴 시작에 현재 시각을 알려 줌', 'Tells the model the current time at turn start', '在每轮开始时告知当前时间'),
  '@deepseek-ai/dsh-tool-bash': L('셸 (bash)', 'Shell (bash)', 'Shell (bash)', 'bash 도구', 'bash tool', 'bash 工具'),
  '@deepseek-ai/dsh-tool-pwsh': L('셸 (PowerShell)', 'Shell (PowerShell)', 'Shell (PowerShell)', 'pwsh 도구', 'pwsh tool', 'pwsh 工具'),
  '@deepseek-ai/dsh-tool-fs': L('파일 읽기·쓰기', 'File read & write', '文件读写', 'read · write · edit · read_image 도구', 'read, write, edit, read_image tools', 'read、write、edit、read_image 工具'),
  '@deepseek-ai/dsh-tool-fs-search': L('파일 검색', 'File search', '文件搜索', 'glob · grep 도구', 'glob and grep tools', 'glob、grep 工具'),
  '@deepseek-ai/dsh-tool-jobs': L('백그라운드 작업', 'Background jobs', '后台任务', 'job_output · job_list · job_kill 도구', 'job_output, job_list, job_kill tools', 'job_output、job_list、job_kill 工具'),
  '@deepseek-ai/dsh-tool-schedule': L('예약 작업', 'Schedules', '定时任务', 'schedule_* 도구', 'schedule_* tools', 'schedule_* 工具'),
  '@deepseek-ai/dsh-skill-filesystem': L('스킬 목록', 'Skill catalog', '技能目录', '설치된 스킬 폴더를 읽어 목록 제공', 'Reads installed skill folders', '读取已安装的技能目录'),
  '@deepseek-ai/dsh-tool-skill': L('스킬 도구', 'Skill tool', '技能工具', 'skill 도구와 턴 시작 스킬 목록', 'skill tool and turn-start skill list', 'skill 工具及每轮开始的技能列表'),
  '@deepseek-ai/dsh-command-goal': L('목표 명령', 'Goal command', '目标命令', '/goal 명령', '/goal command', '/goal 命令'),
  '@deepseek-ai/dsh-tool-goal': L('목표 도구', 'Goal tools', '目标工具', 'create_goal · get_goal · update_goal 도구', 'create_goal, get_goal, update_goal tools', 'create_goal、get_goal、update_goal 工具'),
  '@deepseek-ai/dsh-plan-mode': L('계획 모드', 'Plan mode', '计划模式', '계획 모드 안내와 exit_plan_mode 도구', 'Plan mode guidance and exit_plan_mode tool', '计划模式说明与 exit_plan_mode 工具'),
  '@deepseek-ai/dsh-compaction-basic': L('자동 대화 압축', 'Automatic compaction', '自动压缩', '한도에 가까워지면 앞 대화를 요약', 'Summarizes earlier turns near the limit', '接近上限时总结之前的对话'),
  '@deepseek-ai/dsh-command-compact': L('수동 압축 (/compact)', 'Manual compaction (/compact)', '手动压缩 (/compact)', '사용자가 /compact로 압축 실행', 'Users run compaction with /compact', '用户通过 /compact 执行压缩'),
  '@deepseek-ai/dsh-compaction-tool-result-pruner': L('긴 도구 결과 줄이기', 'Trim long tool results', '精简过长的工具结果', '긴 결과의 앞·뒤만 남김', 'Keeps the head and tail of long results', '保留长结果的开头和结尾'),
  '@deepseek-ai/dsh-tool-subagent-control': L('서브에이전트 제어', 'Subagent control', '子代理控制', 'send_message · interrupt_agent 도구', 'send_message and interrupt_agent tools', 'send_message、interrupt_agent 工具'),
  '@deepseek-ai/dsh-tool-subagent-control/list-agents': L('서브에이전트 목록', 'Subagent list', '子代理列表', 'list_agents 도구', 'list_agents tool', 'list_agents 工具'),
  '@deepseek-ai/dsh-workflow-ptc': L('워크플로 실행 엔진', 'Workflow engine', '工作流引擎', 'workflow 도구가 쓰는 실행 환경', 'Runtime used by the workflow tool', 'workflow 工具使用的运行环境'),
  '@deepseek-ai/dsh-tool-workflow': L('워크플로 도구', 'Workflow tool', '工作流工具', 'workflow 도구', 'workflow tool', 'workflow 工具'),
  '@deepseek-ai/dsh-tool-ask-user': L('사용자에게 질문', 'Ask the user', '询问用户', 'ask_user_question 도구', 'ask_user_question tool', 'ask_user_question 工具'),
  '@deepseek-ai/dsh-tool-todo': L('할 일 목록', 'Todo list', '待办列表', 'todo_write 도구', 'todo_write tool', 'todo_write 工具'),
  '@deepseek-ai/dsh-tool-web': L('웹 검색·가져오기', 'Web search & fetch', '网页搜索与获取', 'web_search · web_fetch 도구', 'web_search and web_fetch tools', 'web_search、web_fetch 工具'),
  '@deepseek-ai/dsh-tool-present': L('결과 파일 표시', 'Present files', '展示文件', 'present 도구', 'present tool', 'present 工具'),
  '@deepseek-ai/dsh-spill-policy': L('긴 결과 파일로 넘기기', 'Spill long results', '长结果转存', '토큰 예산을 넘는 결과를 파일로 저장', 'Stores results over the token budget in files', '将超出 token 预算的结果存为文件'),
  '@deepseek-ai/dsh-tool-cordis': L('플러그인 개발 조회', 'Plugin inspection', '插件开发查询', 'cordis_inspect_* 도구', 'cordis_inspect_* tools', 'cordis_inspect_* 工具'),
  '@deepseek-ai/dsh-plugin-manager/tools': L('플러그인 관리 도구', 'Plugin manager tool', '插件管理工具', 'plugin_manager 도구', 'plugin_manager tool', 'plugin_manager 工具'),
  '@matamt-dbg/dsh-studio/batch': L('여러 파일 한 번에 읽기', 'Batch reads', '批量读取', 'read_batch 도구 (Studio)', 'read_batch tool (Studio)', 'read_batch 工具 (Studio)'),
  '@matamt-dbg/dsh-studio/roles': L('서브에이전트 역할', 'Subagent roles', '子代理角色', 'subagent_role 도구 (Studio)', 'subagent_role tool (Studio)', 'subagent_role 工具 (Studio)'),
};
const lang = (locale: string) => locale.startsWith('ko') ? 'ko' : locale.startsWith('zh') ? 'zh' : 'en';
/** Title for a package, or the package name itself when unknown. */
export function pluginTitle(name: string, locale: string): string { return labels[name]?.title[lang(locale)] ?? name; }
/** One-line purpose, or empty when unknown. */
export function pluginPurpose(name: string, locale: string): string { return labels[name]?.purpose[lang(locale)] ?? ''; }
