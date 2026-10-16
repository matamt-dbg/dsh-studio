import React from 'react';
import type { CatalogPreset } from './preset-catalog.ts';
import { SectionHead } from './ui.tsx';

export function PresetDiagnostics({ presets, locale }: { presets: CatalogPreset[]; locale: string }) {
  const t = (ko: string, en: string, zh: string) => locale.startsWith('ko') ? ko : locale.startsWith('zh') ? zh : en;
  const rows = [
    { label: t('프롬프트 전체 교체', 'Full prompt replacement', '完整提示词替换'), provider: 'dsh-persona', reason: t('persona complete + prefix로 가능. 런타임 컨텍스트는 별도이며 PTC 안내도 제거될 수 있습니다.', 'Possible via persona complete + prefix. Runtime context is separate; PTC guidance may also be removed.', '可通过 persona complete + prefix 实现。运行时上下文独立；PTC 指令也可能被删除。') },
    { label: t('도구 추가·제외', 'Tool inclusion/exclusion', '工具添加与排除'), reason: t('조건부: 제공자 등록·구성 변경 필요. restrict는 전역 상속 도구만 제한하며 프리셋 범위 도구는 숨기지 않습니다. PTC 노출은 SDK 방식입니다.', 'Conditional: provider registration/composition changes required. restrict masks inherited global tools, not preset-scoped tools. PTC uses SDK exposure.', '有条件：需要注册提供者或修改组成。restrict 仅限制继承的全局工具，不能隐藏预设作用域工具。PTC 通过 SDK 提供。') },
    { label: t('서브에이전트 설정', 'Subagent settings', '子代理设置'), provider: 'dsh-tool-subagent', reason: t('도구 인스턴스 설정으로 persona·maxDepth 구성 가능. 역할마다 별도 인스턴스와 능력 검사가 필요합니다.', 'persona/maxDepth are tool-instance configuration; distinct roles need separate instances and capability checks.', 'persona/maxDepth 属于工具实例配置；不同角色需要独立实例和能力检查。') },
    { label: t('기본 대기 시간', 'Default waiting time', '默认等待时间'), provider: 'dsh-tool-jobs', reason: t('job_output의 waitTimeoutMs만 해당합니다. 셸·서브에이전트 대기는 별도이며 단일 값으로 통합 적용할 수 없습니다.', 'Only job_output waitTimeoutMs. Shell and subagent waiting are separate; one value cannot configure them all.', '仅对应 job_output waitTimeoutMs。Shell 和子代理等待机制独立，无法统一设置。') },
    { label: t('에이전트별 spill', 'Per-agent spill', '每代理 spill'), reason: t('미검증: 호스트 spill 정책을 에이전트별 값이나 off로 대체하는 공개 계약을 확인하지 못했습니다.', 'Unverified: no confirmed public contract for replacing host spill policy per agent, including off.', '未验证：未确认按代理替换主机 spill 策略（包括关闭）的公开契约。') },
    { label: t('읽기 배치 한도', 'Read batch limit', '读取批处理限制'), reason: t('미검증: 프리셋 전용 배치 설정을 찾지 못했습니다. 별도 도구 구현 필요; PTC Promise.all과 다른 기능입니다.', 'Unverified: no dedicated preset batch setting established. Requires a separate tool; distinct from PTC Promise.all.', '未验证：未确认预设专用批处理设置。需要独立工具，与 PTC Promise.all 不同。') },
  ];
  return <React.Fragment>
    <SectionHead title={t('프리셋별 재정의 진단', 'Preset override diagnostics', '预设覆盖诊断')} description={t('실제 선언과 공개 계약을 바탕으로 새 구성에서 가능한지 본 결과입니다. 실행 검증이나 적용을 마쳤다는 뜻은 아닙니다.', 'Live declarations + public contracts. Feasibility for a new composition, not execution validation or applied changes.', '基于实时声明和公开契约；表示新组成的可行性，不代表运行验证或已应用。')} />
    {presets.filter(p => ['standard', 'ptc', 'minimal', 'cordis', 'creator'].includes(p.id)).map(p => <details key={p.id}>
      <summary>{p.id === 'cordis' ? 'creator (cordis)' : p.id}</summary>
      {rows.map(row => <div className="studio-prompt-section" key={row.label}><h3>{row.label} · {p.error || !p.declaration ? t('미확인', 'Unverified', '未确认') : row.provider ? p.declaration.includes(row.provider) ? t('조건부 · 제공자 확인', 'Conditional · provider found', '有条件 · 已找到提供者') : t('조건부 · 제공자 추가 필요', 'Conditional · provider required', '有条件 · 需要提供者') : t('제약 있음', 'Constrained', '存在限制')}</h3><p>{row.reason}</p></div>)}
    </details>)}
  </React.Fragment>;
}
