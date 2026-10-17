import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    description: '각 명령의 실행 시간과 출력 크기를 제한합니다.',
    invalidNumber: '숫자를 입력하거나, 기본값을 사용하려면 비워 두십시오.',
    maxOutputBytes: '스트림당 출력 상한(바이트)',
    maxOutputBytesHint: '이 상한을 넘는 출력은 유실되지 않도록 임시 파일로 저장합니다.',
    overridden: '재정의됨',
    readOnly: '이 배포는 설정을 읽기 전용으로 저장합니다.',
    reset: '기본값으로 재설정',
    save: '저장',
    saveFailed: '배포 환경이 이 값을 받아들이지 않았습니다. 고칠 수 있도록 입력값을 그대로 두었습니다.',
    saving: '저장하고 있습니다…',
    timeoutMs: '명령 제한 시간(ms)',
    timeoutMsHint: '명령이 종료되기까지 실행될 수 있는 최대 시간입니다.',
    title: '셸',
    unavailable: '이 플러그인이 로드되어 있지 않아 지금은 설정할 수 없습니다.',
  },
} satisfies DshKoNamespace;
