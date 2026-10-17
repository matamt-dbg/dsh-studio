import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    failed: 'PDF를 표시하지 못했습니다: {message}',
    loading: '문서를 렌더링하고 있습니다...',
    pageImage: 'PDF 페이지 {page}',
    password: '이 PDF에는 암호가 필요합니다. 암호로 보호된 미리 보기는 지원되지 않습니다.',
    rendering: '페이지를 렌더링하고 있습니다…',
    retry: '다시 시도',
    title: 'PDF',
    unsupported: 'PDF 미리보기에는 전체 파일 내용이 필요합니다.',
    workerFailed: 'PDF 렌더링 프로세스를 계속할 수 없습니다. 다시 시도해 주십시오.',
    zoomControls: '확대/축소 컨트롤',
    zoomFitWidth: '너비에 맞춤',
    zoomIn: '확대',
    zoomMenu: '배율 선택',
    zoomOut: '축소',
    zoomValue: '{percent}%',
  },
} satisfies DshKoNamespace;
