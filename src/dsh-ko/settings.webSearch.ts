import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    apiKey: 'API 키',
    apiKeyHint: '설정 파일 외부에 저장됩니다. 현재 키를 유지하려면 비워 두십시오.',
    apiKeySet: '키가 설정되어 있습니다.',
    apiKeyUnset: '설정된 키가 없습니다. 기본 엔드포인트를 통해서는 DeepSeek 계정 모델을 사용하는 대화만 검색할 수 있습니다.',
    baseUrl: '엔드포인트',
    baseUrlHint: '비워 두면 프로바이더 기본값을 사용합니다.',
    description: 'DeepSeek 검색 프로바이더를 설정합니다.',
    invalidNumber: '숫자를 입력하십시오. 기본값을 사용하려면 비워 두십시오.',
    maxUses: '요청당 최대 검색 수',
    maxUsesHint: '한 요청에서 답변 전에 검색할 수 있는 최대 횟수입니다.',
    overridden: '재정의됨',
    readOnly: '이 배포는 설정을 읽기 전용으로 저장합니다.',
    reset: '기본값으로 재설정',
    save: '저장',
    saveFailed: '배포 환경이 이 값을 받아들이지 않았습니다. 고칠 수 있도록 입력값을 그대로 두었습니다.',
    saving: '저장하고 있습니다…',
    title: '웹 검색',
    unavailable: '이 플러그인이 로드되어 있지 않아 지금은 설정할 수 없습니다.',
  },
} satisfies DshKoNamespace;
