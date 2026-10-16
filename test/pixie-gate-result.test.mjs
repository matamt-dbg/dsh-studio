import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { GateResultDetails } from '../src/pixie-gate-result.tsx';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test('recorded judge labels ignore edited definitions and legacy runs use ids', async () => {
  const questions = { c: { type: 'choice', options: { yes: 'Recorded option' } }, s: { type: 'score', levels: ['Recorded low', 'Recorded high'] }, n: { type: 'noul', question: 'Rendered sample question' } };
  const definition = { stages: [{ id: 'judge', kind: 'judge', questions: { c: { type: 'choice', options: { yes: 'Changed option' } }, s: { type: 'score', levels: ['Changed low', 'Changed high'] }, n: { type: 'noul', question: '{{subject}}' } } }] };
  const data = { questions, answers: { c: { type: 'choice', choice: 'yes', probabilities: { yes: 1 }, confidence: 1 }, s: { type: 'score', score: 0, confidence: 1 }, n: { type: 'noul', noul: 0.2 } }, failedConditions: [{ question: 'n', type: 'noul', actual: 0.2, threshold: 0.5 }, { question: 's', type: 'score', actual: 0, min: 1 }] };
  const result = { ...base(), stages: { judge: { verdict: 'fail', data } } };
  await render({ result, definition }, host => {
    for (const label of ['Recorded option', 'Recorded low', 'Recorded high', 'Rendered sample question']) assert.ok(host.textContent.includes(label), label);
    assert.doesNotMatch(host.textContent, /Changed|\{\{subject\}\}/);
  });
  delete data.questions;
  await render({ result, definition }, host => {
    assert.doesNotMatch(host.textContent, /Recorded|Changed|\{\{subject\}\}/);
    assert.match(host.textContent, /c: yes/);
    assert.match(host.textContent, /s: 0/);
  });
});

const base = () => ({ verdict: 'pass', original: '<script>original</script>', subject: 'final', notes: [], stages: {}, records: [], forward: { kind: 'original', text: 'forwarded' }, hooks: {} });
async function render(props, check) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(GateResultDetails, { locale: 'en', ...props })));
    check(host);
  } finally { await act(async () => root.unmount()); host.remove(); }
}

test('trial distinguishes skipped pass from executed pass and explains missing forward', async () => {
  const result = base();
  result.stages.command = { verdict: 'pass', reason: 'skipped: 시험 실행에서 명령 미실행', data: { skipped: true } };
  result.forward = { kind: 'none' };
  result.forwardError = { verdict: 'error', error: 'Missing stage text' };
  await render({ result, durations: { command: 0 }, locale: 'ko' }, host => {
    const stage = host.querySelector('[data-gate-stage=command]');
    assert.doesNotMatch(stage.textContent, /통과/);
    assert.match(stage.textContent, /건너뜀/);
    assert.match(stage.textContent, /<1 ms/);
    assert.match(host.textContent, /건너뛴 단계 1개 포함/);
    assert.match(host.textContent, /시험 실행에서 명령 단계를 건너뛰어 전달 결과를 계산할 수 없음/);
    assert.match(host.textContent, /Missing stage text/);
    assert.equal(host.querySelector('script'), null);
  });
});

test('shows stage text, reason, errors, hook results and append contexts without usage', async () => {
  const result = base();
  result.stages.check = { verdict: 'error', text: 'stage text', reason: 'stage reason', error: 'timeout', usage: { inputTokens: 123456 } };
  result.hooks = { start: { verdict: 'pass' }, end: { verdict: 'note', text: 'hook output' } };
  result.forward = { kind: 'append', text: 'forwarded', contexts: ['context one', 'context two'], source: 'studio-pixie-gate' };
  await render({ result }, host => {
    for (const text of ['stage text', 'stage reason', 'timeout', 'hook output', 'context one', 'context two', 'Start hook', 'End hook']) assert.ok(host.textContent.includes(text));
    assert.doesNotMatch(host.textContent, /123456|tokens|usage/i);
    assert.doesNotMatch(host.textContent, /cannot be calculated/);
  });
});

test('supports explicit skipped ids and Chinese copy without changing verdict', async () => {
  const result = base(); result.stages.command = { verdict: 'pass' };
  await render({ result, locale: 'zh-CN', skipped: ['command'] }, host => {
    assert.match(host.querySelector('[data-gate-stage=command]').textContent, /已跳过/);
  });
});

test('durations round milliseconds and localize seconds at the boundary', async () => {
  for (const [ms, expected] of [[0.004458000010345131, '<1 ms'], [1, '1 ms'], [12.6, '13 ms'], [999, '999 ms'], [1000, '1.0 s'], [1456, '1.5 s']]) {
    const result = base(); result.stages.check = { verdict: 'pass' };
    await render({ result, durations: { check: ms } }, host => assert.ok(host.textContent.includes(expected)));
  }
  for (const [locale, expected] of [['ko', '1.0초'], ['zh', '1.0 秒']]) {
    const result = base(); result.stages.check = { verdict: 'pass' };
    await render({ result, locale, durations: { check: 1000 } }, host => assert.ok(host.textContent.includes(expected)));
  }
});

test('skipped summary deduplicates ids and preserves passed verdict', async () => {
  const result = base(); result.stages.command = { verdict: 'pass', data: { skipped: true } };
  await render({ result, skipped: ['command', 'hooks.start'] }, host => {
    assert.match(host.firstElementChild.textContent, /PassedIncludes 1 skipped stages/);
  });
});

test('a real forward error does not claim commands were skipped', async () => {
  const result = base(); result.forwardError = { verdict: 'error', error: 'missing text' };
  await render({ result }, host => {
    assert.match(host.textContent, /Forward error/);
    assert.doesNotMatch(host.textContent, /command stages were skipped/);
  });
});

test('skipped-only response renders a localized reason and one badge per missing stage', async () => {
  for (const [locale, label, reason] of [['ko', '건너뜀', '시험 실행에서 명령을 실행하지 않았습니다.'], ['en', 'Skipped', 'Command was not executed in this trial.'], ['zh', '已跳过', '本次试运行未执行命令。']]) {
    await render({ result: base(), skipped: ['first', 'second'], locale }, host => {
      for (const id of ['first', 'second']) {
        const row = host.querySelector(`[data-gate-stage="${id}"]`);
        assert.equal(row.querySelectorAll('.studio-badge').length, 1);
        assert.equal(row.querySelector('.studio-badge').textContent, label);
        assert.ok(row.textContent.includes(reason));
      }
    });
  }
});

test('task runs show notes and pixie helper calls instead of an empty stage list', async () => {
  const result = { ...base(), notes: ['skipped by hook'], records: [
    { id: 'pixie-ask-1', result: { verdict: 'note', text: 'SUM', reason: 'summarize' }, subjectBytes: 5, textBytes: 3 },
    { id: 'pixie-judge-2', result: { verdict: 'fail', reason: 'ok?', data: { noul: 0.2, threshold: 0.5 } }, subjectBytes: 5, textBytes: 0 },
  ] };
  await render({ result }, host => {
    assert.equal(host.querySelector('[data-gate-stage]') && [...host.querySelectorAll('h3, h4, strong, span')].some(el => el.textContent === 'Stages'), false);
    assert.match(host.querySelector('section[aria-label="Notes"]').textContent, /skipped by hook/);
    const calls = host.querySelector('section[aria-label="Helper calls"]');
    assert.deepEqual([...calls.querySelectorAll('[data-gate-stage]')].map(el => el.dataset.gateStage), ['pixie-ask-1', 'pixie-judge-2']);
    assert.match(calls.textContent, /SUM.*Reason: summarize.*Rejected.*Reason: ok\?.*Yes probability 0.2 · threshold 0.5/s);
  });
});
