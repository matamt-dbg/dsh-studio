import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    busy: 'Office 미리 보기가 사용 중입니다. 잠시 후 다시 시도하십시오.',
    changed: '파일을 읽는 동안 변경되었습니다. 미리보기를 다시 여십시오.',
    closeDetails: '글꼴 세부 정보 닫기',
    failed: 'Office 변환에서 사용 가능한 PDF를 만들지 못했습니다. 파일을 확인하고 다시 시도하십시오.',
    invalid: '이 Office 파일은 미리 볼 수 없습니다. 손상되었거나 암호로 보호되어 있거나 확장자가 잘못되었을 수 있습니다.',
    loading: '문서를 렌더링하고 있습니다...',
    missingFontsCount: '글꼴: {count}',
    missingFontsDescription: '이 글꼴은 이 미리보기에서 사용할 수 없어 본문과 레이아웃이 원본 문서와 다를 수 있습니다.',
    missingFontsTitle: '누락된 글꼴',
    retry: '다시 시도',
    timeout: 'Office 변환이 시간 초과되었습니다. 다시 시도하십시오.',
    title: 'Office 문서',
    tooLarge: 'Office 파일 또는 변환된 PDF가 미리 보기 크기 제한을 초과합니다. 파일 크기를 줄이거나 미리 보기 설정을 조정하십시오.',
    unavailable: 'Office 미리보기를 사용할 수 없습니다. DeepSeek Harness를 실행하는 컴퓨터에서 문서 미리보기 서비스를 활성화해야 합니다.',
    viewMissingFonts: '누락된 글꼴: {count}. 클릭하여 확인.',
  },
} satisfies DshKoNamespace;
