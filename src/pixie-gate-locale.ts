import type { GatePoint } from './pixie-gate-contracts.ts';
/** Gate result copy shared by trials and execution details. */
const en = {
  gates: 'Gates', emptyRuns: 'No gate runs yet', applied: 'Applied', replaced: 'Replaced', appended: 'Appended', rejected: 'Rejected', steered: 'Steered', blocked: 'Blocked', denied: 'Blocked', running: 'Running', pending: 'Pending rejection', unverified: 'Hook input unverified', suggestion: 'Suggestion', editSend: 'Edit and send', resent: 'Mark as sent', dismissed: 'Dismiss', draftNote: 'Replaces the composer draft with the suggestion (or original). Review and send it yourself. Mark as sent only records your confirmation; it does not send.', composerUnavailable: 'Session composer unavailable', turn: 'Turn', steerCount: 'Steer count', tool: 'Tool', callId: 'Call ID', allRuns: 'All gate runs',
  verdict: 'Verdict', forward: 'Forward', forwardError: 'Forward error', original: 'Original', subject: 'Final text',
  stages: 'Stages', start: 'Start hook', end: 'End hook', reason: 'Reason', error: 'Error', elapsed: 'Elapsed', skipped: 'Skipped',
  pass: 'Passed', fail: 'Rejected', revise: 'Revised', note: 'Note', skip: 'Skipped', cancelled: 'Cancelled',
  none: 'None', replace: 'Replace', append: 'Append',
  skippedForward: 'The forwarded result cannot be calculated because command stages were skipped in this trial.',
  skippedCommand: 'Command was not executed in this trial.',
  skippedCount: 'Includes {count} skipped stages', milliseconds: '{value} ms', seconds: '{value} s',
  output: 'Pixie output', notes: 'Notes', helperCalls: 'Helper calls', helperNoul: 'Yes probability {noul} · threshold {threshold}', tokens: 'Tokens', applyNote: 'Not applied because', originalSame: 'Original (unchanged)', sentAlong: 'Sent along', usage: 'Tokens in {input} · out {output}', stop: 'Stopped',
} as const;
export type GateTextKey = keyof typeof en;
const ko: Record<GateTextKey, string> = {
  gates: '게이트', emptyRuns: '게이트 실행 기록이 없습니다', applied: '적용', replaced: '교체', appended: '덧붙임', rejected: '거부', steered: '교정', blocked: '차단', denied: '차단', running: '진행 중', pending: '거부 처리 대기', unverified: '훅 입력 미확인', suggestion: '제안', editSend: '수정 후 보내기', resent: '보냈음 표시', dismissed: '무시', draftNote: '입력창 초안을 제안(없으면 원문)으로 바꿉니다. 전송은 직접 하세요. ‘보냈음 표시’는 기록만 남기고 전송하지 않습니다.', composerUnavailable: '세션 입력창을 사용할 수 없습니다', turn: '턴', steerCount: '교정 횟수', tool: '도구', callId: '호출 ID', allRuns: '모든 게이트 실행',
  verdict: '판정', forward: '전달', forwardError: '전달 오류', original: '원문', subject: '최종 텍스트',
  stages: '단계', start: '시작 훅', end: '종료 훅', reason: '이유', error: '오류', elapsed: '소요 시간', skipped: '건너뜀',
  pass: '통과', fail: '거부', revise: '수정', note: '메모', skip: '건너뜀', cancelled: '취소',
  none: '없음', replace: '교체', append: '덧붙임',
  skippedForward: '시험 실행에서 명령 단계를 건너뛰어 전달 결과를 계산할 수 없음',
  skippedCommand: '시험 실행에서 명령을 실행하지 않았습니다.',
  skippedCount: '건너뛴 단계 {count}개 포함', milliseconds: '{value} ms', seconds: '{value}초',
  output: 'Pixie 출력', notes: '메모', helperCalls: '헬퍼 호출', helperNoul: '예 확률 {noul} · 기준 {threshold}', tokens: '토큰', applyNote: '미적용 이유', originalSame: '원문 (변경 없음)', sentAlong: '함께 전달한 내용', usage: '토큰 입력 {input} · 출력 {output}', stop: '막음',
};
const zh: Record<GateTextKey, string> = {
  gates: '门控', emptyRuns: '暂无门控运行记录', applied: '应用', replaced: '已替换', appended: '已追加', rejected: '已拒绝', steered: '已纠正', blocked: '已阻止', denied: '已阻止', running: '运行中', pending: '拒绝待处理', unverified: '钩子输入未验证', suggestion: '建议', editSend: '修改后发送', resent: '标记已发送', dismissed: '忽略', draftNote: '用建议（或原文）替换输入框草稿。请自行检查并发送。标记已发送仅记录确认，不会实际发送。', composerUnavailable: '会话输入框不可用', turn: '轮次', steerCount: '纠正次数', tool: '工具', callId: '调用 ID', allRuns: '所有门控运行',
  verdict: '判定', forward: '传递', forwardError: '传递错误', original: '原文', subject: '最终文本',
  stages: '阶段', start: '开始钩子', end: '结束钩子', reason: '原因', error: '错误', elapsed: '耗时', skipped: '已跳过',
  pass: '通过', fail: '拒绝', revise: '修改', note: '备注', skip: '已跳过', cancelled: '已取消',
  none: '无', replace: '替换', append: '追加',
  skippedForward: '本次试运行跳过了命令阶段，无法计算传递结果。',
  skippedCommand: '本次试运行未执行命令。',
  skippedCount: '包含 {count} 个已跳过阶段', milliseconds: '{value} ms', seconds: '{value} 秒',
  output: 'Pixie 输出', notes: '备注', helperCalls: '辅助调用', helperNoul: '“是”的概率 {noul} · 阈值 {threshold}', tokens: '令牌', applyNote: '未应用原因', originalSame: '原文（未更改）', sentAlong: '一并传递的内容', usage: '令牌 输入 {input} · 输出 {output}', stop: '已拦下',
};
export function gateText(locale: string, key: GateTextKey): string {
  return (locale.startsWith('ko') ? ko : locale.startsWith('zh') ? zh : en)[key];
}

/** Point names shared by the editor, run cards and run details. */
export function gatePointText(locale: string, point: GatePoint): string {
  const names = {
    input: ['입력', 'Input', '输入'], 'turn-end': ['턴 종료', 'Turn end', '轮次结束'],
    'tool-before': ['도구 실행 전', 'Before tool', '工具执行前'], 'tool-after': ['도구 실행 후', 'After tool', '工具执行后'],
  };
  return names[point][locale.startsWith('ko') ? 0 : locale.startsWith('zh') ? 2 : 1]!;
}
