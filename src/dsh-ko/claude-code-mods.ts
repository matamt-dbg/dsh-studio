import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    'press.failed': '버튼 조작에 실패했습니다: {message}',
    pressing: '처리 중…',
  },
  fallback: ['band', 'press.stale'],
} satisfies DshKoNamespace;
