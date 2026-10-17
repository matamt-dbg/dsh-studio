import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    'auto.badge': 'EXP',
    'auto.confirm.acknowledge': '이 위험을 이해했으며 계속하겠습니다',
    'auto.confirm.description': '자동 검토는 샌드박스 없이 실행됩니다. 모든 네이티브 도구 호출과 PTC 내부 호출 전에 현재 에이전트와 같은 모델이 허용 여부를 검토하며, 거부된 각 호출은 사용자가 승인하거나 거부합니다. 이 기능은 실험적이어서 작업을 잘못 허용하거나 거부할 수 있고 추가 토큰을 사용합니다.',
    'auto.confirm.enable': '자동 검토 활성화',
    'auto.confirm.title': '자동 검토를 활성화하시겠습니까? (실험적)',
    'auto.label': '자동 검토',
    close: '닫기',
    'confirm.acknowledge': '위험을 이해했으며 계속하겠습니다',
    'confirm.cancel': '취소',
    'confirm.description': '전체 접근은 확인 단계를 줄이고 에이전트가 민감한 작업, 파일 변경, 외부 명령을 포함한 더 많은 작업을 직접 수행하도록 합니다. 현재 작업을 신뢰하는 경우에만 사용하십시오.',
    'confirm.enable': '전체 접근 활성화',
    'confirm.title': '전체 접근을 활성화하시겠습니까?',
    mode: '접근 모드, 현재: {name}',
    'preset.fullAccess': '전체 접근',
    'preset.readOnly': '읽기 전용',
    'preset.workspaceWrite': '워크스페이스 쓰기',
  },
  fallback: ['auto.description'],
} satisfies DshKoNamespace;
