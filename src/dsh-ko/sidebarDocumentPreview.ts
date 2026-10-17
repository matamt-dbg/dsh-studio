import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    autoRefresh: '자동 새로 고침',
    'autoRefresh.disable': '자동 새로 고침을 끕니다',
    'autoRefresh.enable': '자동 새로 고침을 켭니다',
    changed: '파일이 변경되어 이전 내용을 표시합니다.',
    'error.notFound': '파일을 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다.',
    'error.notRegularFile': '일반 파일이 아니라 표시할 내용이 없습니다.',
    'error.notText': '이 파일 형식은 아직 미리 보기를 지원하지 않습니다.',
    'error.unavailable': '읽기에 실패했습니다: {message}',
    loadMore: '더 보기',
    loading: '문서를 렌더링하고 있습니다...',
    openWith: '다음으로 열기',
    reload: '파일을 다시 불러옵니다',
    reloadNow: '새로 고침',
    rendererUnavailable: '{name} 미리보기를 사용할 수 없습니다.',
    resourceUnavailable: '파일 리소스 서비스를 사용할 수 없습니다.',
    retry: '다시 시도하십시오',
    unsupportedFile: '이 파일 형식은 아직 미리 보기를 지원하지 않습니다.',
    'viewer.text': '일반 텍스트',
    'wrap.aria': '줄바꿈',
    'wrap.disable': '줄바꿈 해제',
    'wrap.enable': '줄바꿈 사용',
  },
  fallback: ['error.tooLarge'],
} satisfies DshKoNamespace;
