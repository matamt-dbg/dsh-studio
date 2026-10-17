import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    'member.empty': '빈 멤버 이름',
    'member.open': '{name} 열기',
    'phase.empty': '빈 단계 이름',
    'phase.unassigned': '단계 없음',
    'run.empty': '시작된 멤버가 없습니다',
    'run.members.one': '멤버 {count}개',
    'run.members.other': '멤버 {count}개',
    'run.title': '{name}',
    'status.cancelled': '취소됨',
    'status.completed': '완료됨',
    'status.failed': '실패함',
    'status.interrupted': '중단됨',
    'status.running': '실행 중',
    'statusCount.cancelled': '취소됨 {count}',
    'statusCount.completed': '완료됨 {count}',
    'statusCount.failed': '실패함 {count}',
    'statusCount.interrupted': '중단됨 {count}',
    'statusCount.running': '실행 중 {count}개',
  },
} satisfies DshKoNamespace;
