import type { DshKoNamespace } from '../dsh-ko-locale.ts';

export default {
  ko: {
    'action.reload': '새로 고침',
    'command.description': '이 대화에 사용할 모델을 선택하십시오.',
    'command.label': '모델',
    'effort.providerDefault': '기본값',
    'empty.efforts': '이 모델은 추론 강도 수준을 제공하지 않습니다.',
    'empty.models': '사용할 수 있는 모델이 없습니다.',
    'error.action': '모델 작업에 실패했습니다: {message}',
    'error.sessionInUse': '이 세션은 이미 사용 중입니다. 실행 중인 다른 DSH 인스턴스(dsh web 또는 데스크톱 앱 등)일 수 있습니다. 다른 DSH 인스턴스를 종료하고 다시 시도하십시오.',
    'menu.aria': '모델 및 추론 강도',
    'menu.effort': '강도',
    'menu.model': '모델',
    'option.loadError': '카탈로그를 불러오지 못했습니다: {message}',
    'provider.account': 'DeepSeek 계정',
    'search.clear': '검색 지우기',
    'search.empty': '일치하는 모델이 없습니다.',
    'search.placeholder': '모델 검색…',
    'status.loading': '모델 목록을 새로 고치고 있습니다…',
    'trigger.aria': '모델 선택 (현재 {model})',
    'trigger.ariaEffort': '모델 선택, 현재 {model}, 추론 강도 {effort}',
    'trigger.fallback': '모델 선택',
    'trigger.loading': '모델을 불러오고 있습니다…',
    'trigger.selectAria': '모델 선택',
    'warning.groupLoad': '{name} 불러오기에 실패했습니다: {message}',
  },
} satisfies DshKoNamespace;
