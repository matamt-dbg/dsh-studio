import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    'candidate.noCwd': '(작업 디렉터리 없음)',
    'crumb.root': '워크스페이스',
    'section.files': '파일 및 폴더',
    'section.sessions': '세션',
    'section.subagents': '서브에이전트',
    'time.days': '{n}일',
    'time.hours': '{n}시간',
    'time.minutes': '{n}분',
    'time.months': '{n}개월',
    'time.now': '방금',
    'time.years': '{n}년',
    'fileOpen.close': '닫기',
    'fileOpen.failed': '“{path}”을(를) 열 수 없습니다. 다시 시도하거나 이 메시지를 닫으십시오.',
    'fileOpen.retry': '다시 시도',
    'fileOpen.title': '파일을 열 수 없습니다',
  },
} satisfies DshKoNamespace;
