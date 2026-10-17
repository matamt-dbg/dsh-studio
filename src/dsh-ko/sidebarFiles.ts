import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    autoRefresh: '자동 새로 고침',
    'autoRefresh.disable': '자동 새로 고침 끄기',
    'autoRefresh.enable': '자동 새로 고침 켜기',
    empty: '빈 디렉터리',
    'entry.other': '파일도 디렉터리도 아니어서 열 수 없습니다.',
    'error.notDirectory': '디렉터리가 아닙니다.',
    'error.notFound': '해당 디렉터리가 없습니다. 이동되었거나 삭제되었을 수 있습니다.',
    'error.outsideWorkspace': '해당 디렉터리가 워크스페이스 밖에 있어 사이드바에서 읽지 않습니다.',
    'error.unavailable': '읽기에 실패했습니다: {message}',
    'guide.description': '이 세션의 워크스페이스에 있는 파일을 살펴봅니다.',
    'guide.title': '워크스페이스 파일',
    loading: '읽고 있습니다…',
    noWorkspace: '이 세션에는 워크스페이스 디렉터리가 없습니다.',
    reload: '새로 고침',
    'shortcut.noSession': '먼저 세션을 선택하십시오.',
    truncated: '항목이 너무 많아 일부만 표시합니다.',
    'type.label': '파일',
  },
} satisfies DshKoNamespace;
