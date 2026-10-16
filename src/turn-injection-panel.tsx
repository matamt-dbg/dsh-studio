import React from 'react';
import type { TurnInjection } from './prompt-composition.ts';
import { featureLabel, localeOf } from './feature-inclusion.tsx';
import { Badge, Button, SectionHead } from './ui.tsx';

type Overrides = Record<string, Record<string, unknown>>;
type Field = { key: string; type: 'string' | 'number' | 'string[]' };
/** Config fields that shape each per-turn message; the text itself is produced at run time. */
const FIELDS: Record<string, Field[]> = {
  '@deepseek-ai/dsh-time-context': [{ key: 'timeZone', type: 'string' }, { key: 'refreshIntervalMs', type: 'number' }],
  '@deepseek-ai/dsh-agent-instructions': [{ key: 'maxBytes', type: 'number' }, { key: 'instructionFileCandidates', type: 'string[]' }, { key: 'localInstructionFileCandidates', type: 'string[]' }],
  '@deepseek-ai/dsh-skill-filesystem': [{ key: 'customSkillDirs', type: 'string[]' }],
};
const copy = {
  ko: { title: '턴 시작에 들어가는 내용', hint: '시스템 프롬프트가 아니라 실제 세션의 각 턴 시작에 대화 메시지로 들어갑니다. 아래는 지금 Studio가 실행 중인 폴더와 시각으로 만든 예시입니다.',
    example: '예시', readOnly: '본문 편집 불가', reset: '원래대로', overridden: '덮어쓰기', defaults: '기본값', none: '이 프리셋에 포함된 턴 시작 기능이 없습니다.', empty: '이 폴더에서 읽은 지침 파일이 없습니다.',
    skills: '설치된 스킬 목록으로 만들고 세션 작업 폴더에 따라 달라지므로 미리보기에는 표시하지 않습니다.', error: '예시를 만들지 못했습니다: ', list: '쉼표로 구분',
    why: { '@deepseek-ai/dsh-time-context': '실행할 때마다 그 시각으로 새로 만듭니다.', '@deepseek-ai/dsh-agent-instructions': '세션 작업 폴더의 AGENTS.md 등 파일 내용입니다. 파일을 고치세요.', '@deepseek-ai/dsh-skill-filesystem': '설치된 스킬로 만듭니다.' } as Record<string, string> },
  en: { title: 'Added at the start of each turn', hint: 'Not part of the system prompt: these enter a real session as conversation messages at each turn start. Below are examples made with the folder and time the Studio Host runs in now.',
    example: 'Example', readOnly: 'Text not editable', reset: 'Reset', overridden: 'Override', defaults: 'Defaults', none: 'This preset includes no turn-start features.', empty: 'No instruction files were found from this folder.',
    skills: 'Built from installed skills and the session folder, so the preview does not show it.', error: 'Could not build the example: ', list: 'Comma-separated',
    why: { '@deepseek-ai/dsh-time-context': 'Generated from the current time on every turn.', '@deepseek-ai/dsh-agent-instructions': 'Content of AGENTS.md and similar files in the session folder; edit those files.', '@deepseek-ai/dsh-skill-filesystem': 'Generated from installed skills.' } as Record<string, string> },
  zh: { title: '每轮开始时加入的内容', hint: '这些不属于系统提示词，而是在实际会话的每轮开始时作为对话消息加入。以下是使用 Studio Host 当前所在文件夹和时间生成的示例',
    example: '示例', readOnly: '正文不可编辑', reset: '恢复默认', overridden: '覆盖', defaults: '默认值', none: '此预设不包含每轮开始的功能', empty: '未从此文件夹找到指令文件',
    skills: '由已安装技能和会话文件夹生成，预览中不显示', error: '无法生成示例：', list: '以逗号分隔',
    why: { '@deepseek-ai/dsh-time-context': '每轮按当前时间生成', '@deepseek-ai/dsh-agent-instructions': '来自会话文件夹中 AGENTS.md 等文件的内容，请修改文件', '@deepseek-ai/dsh-skill-filesystem': '由已安装技能生成' } as Record<string, string> },
};

/**
 * Per-turn injection previews with editors for the Config fields that shape them. Edits write the
 * same Config overrides the Execution settings tab uses; Reset removes the key (back to defaults).
 */
export function TurnInjectionPanel({ injections, overrides, onChange, locale }: { injections: readonly TurnInjection[]; overrides: Overrides; onChange(next: Overrides): void; locale: string }): React.ReactElement {
  const t = copy[localeOf(locale)];
  const set = (entry: string, key: string, value: unknown) => {
    const fields = { ...(overrides[entry] ?? {}) };
    if (value === undefined) delete fields[key]; else fields[key] = value;
    onChange({ ...overrides, [entry]: fields });
  };
  return <section className="studio-stack" aria-label={t.title}>
    <SectionHead title={t.title} description={t.hint} />
    {!injections.length && <p className="studio-muted">{t.none}</p>}
    {injections.map(item => {
      const fields = FIELDS[item.name] ?? [];
      const own = overrides[item.entry] ?? {};
      return <section key={item.entry} className="studio-component studio-component-flat">
        <div className="studio-inline-actions"><h3 className="studio-panel-title">{featureLabel(item.name, locale)}</h3><span className="studio-card-meta studio-mono">{item.entry}</span><Badge tone="outline">{t.example}</Badge></div>
        {item.text !== undefined ? <pre className="studio-turn-text">{item.text}</pre>
          : <p className="studio-muted">{item.note === 'skills' ? t.skills : item.note === 'empty' ? t.empty : item.note?.startsWith('error:') ? t.error + item.note.slice(6) : ''}</p>}
        <p className="studio-muted studio-hint">{t.readOnly} · {t.why[item.name] ?? ''}</p>
        {fields.map(field => {
          const has = Object.hasOwn(own, field.key);
          const value = own[field.key];
          const label = `${item.entry} · ${field.key}`;
          const text = Array.isArray(value) ? value.join(', ') : value === undefined ? '' : String(value);
          return <label key={field.key} className="studio-field">
            <span className="studio-inline-actions"><span className="studio-mono">{field.key}</span><Badge tone={has ? 'info' : 'outline'}>{has ? t.overridden : t.defaults}</Badge>
              {has && <Button small onClick={event => { event.preventDefault(); set(item.entry, field.key, undefined); }}>{t.reset}</Button>}</span>
            <input aria-label={label} type={field.type === 'number' ? 'number' : 'text'} value={text} placeholder={field.type === 'string[]' ? t.list : t.defaults}
              onChange={event => {
                const raw = event.target.value;
                if (raw === '') { set(item.entry, field.key, undefined); return; }
                if (field.type === 'number') { const number = Number(raw); if (Number.isFinite(number)) set(item.entry, field.key, number); return; }
                set(item.entry, field.key, field.type === 'string[]' ? raw.split(',').map(part => part.trim()).filter(Boolean) : raw);
              }} />
          </label>;
        })}
      </section>;
    })}
  </section>;
}
