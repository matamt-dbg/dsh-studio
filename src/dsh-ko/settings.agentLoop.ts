import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    description: '에이전트가 도구 호출을 보내는 방식을 제어합니다.',
    invalidNumber: '숫자를 입력하거나, 기본값을 사용하려면 비워 두십시오.',
    maxParallel: '병렬 도구 호출',
    maxParallelHint: '한 단계에서 동시에 실행되는 병렬 호출의 최대 개수입니다.',
    overridden: '재정의됨',
    readOnly: '이 배포는 설정을 읽기 전용으로 저장합니다.',
    reset: '기본값으로 재설정',
    save: '저장',
    saveFailed: '배포 환경이 이 값을 받아들이지 않았습니다. 고칠 수 있도록 입력값을 그대로 두었습니다.',
    saving: '저장하고 있습니다…',
    title: '에이전트 루프',
    unavailable: '이 플러그인이 로드되어 있지 않아 지금은 설정할 수 없습니다.',
  },
} satisfies DshKoNamespace;
