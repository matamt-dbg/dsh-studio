import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    'confirm.acknowledge': '위험을 이해했으며 계속하겠습니다',
    'confirm.cancel': '취소',
    'confirm.description': '전체 접근을 허용하면 새 세션에서 확인 단계를 줄이고 민감한 작업, 파일 변경, 외부 명령을 포함한 더 많은 작업을 직접 수행할 수 있습니다. 이후 작업을 신뢰하는 경우에만 사용하십시오.',
    'confirm.enable': '전체 접근 활성화',
    'confirm.title': '전체 접근을 활성화하시겠습니까?',
    description: '새 세션의 기본 권한 모드를 선택하십시오.',
    loading: '불러오는 중',
    'preset.fullAccess': '전체 접근',
    'preset.readOnly': '읽기 전용',
    'preset.workspaceWrite': '워크스페이스 쓰기',
    title: '권한',
    unavailable: '사용할 수 없음',
  },
} satisfies DshKoNamespace;
