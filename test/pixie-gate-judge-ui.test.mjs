import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { GateResultDetails } from '../src/pixie-gate-result.tsx';
import { PixieSettingsPage } from '../src/pixie-settings.tsx';
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const button = (h, name) => [...h.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent) === name);
const input = (h, label) => h.querySelector(`[aria-label="${label}"]`);
const click = async el => { assert.ok(el); await act(async () => el.click()); };
const change = async (el, value) => { assert.ok(el); await act(async () => { el.value = value; Simulate.change(el); }); };
async function render(t, component, props) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(component, { locale: 'en', ...props })));
  t.after(async () => { await act(async () => root.unmount()); host.remove(); }); return host;
}
test('judge answer summary uses recorded labels, falls back to ids and keeps failure reason', async t => {
  const stage = { questions: { c: { type: 'choice', options: { yes: 'Approved', no: 'Rejected' } }, s: { type: 'score', levels: ['Low', 'High'] }, n: { type: 'noul', question: 'Safe?' } } };
  const result = { verdict: 'fail', original: 'a', subject: 'a', notes: [], records: [], hooks: {}, forward: { kind: 'none' }, stages: { first: { verdict: 'fail', reason: 'n: noul must be >= 0.8', data: { answers: { c: { type: 'choice', choice: 'yes', probabilities: { yes: 0.9, no: 0.1 }, confidence: 0.8 }, s: { type: 'score', score: 1, probabilities: [0, 1], confidence: 1 }, n: { type: 'noul', noul: 0.2 } } } } } };
  result.stages.first.data.questions = stage.questions;
  const host = await render(t, GateResultDetails, { result });
  assert.match(host.textContent, /Approved · Probability: 90% · Confidence: 80%/); assert.match(host.textContent, /High · Confidence: 100%/); assert.match(host.textContent, /Safe\?: 0.2/); assert.match(host.textContent, /n: noul must be >= 0.8/);
  delete result.stages.first.data.questions;
  const fallback = await render(t, GateResultDetails, { result }); assert.match(fallback.textContent, /c: yes/); assert.match(fallback.textContent, /s: 1/);
});
test('settings have no judge page; stored judge fields survive a save unchanged', async t => {
  const saves = [];
  const stored = { contextMode: 'fresh', systemPrompt: 'original', allowThreadModel: true, judgeModel: { provider: 'p', model: 'j' }, judgeSystemPrompt: 'Custom' };
  const host = await render(t, PixieSettingsPage, { actions: { read: async () => stored, models: async () => ({ groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }] }] }), save: async value => { saves.push(value); return value; } }, locale: 'en' });
  assert.equal(button(host, 'Judge'), undefined);
  assert.equal(host.querySelector('section[aria-label="Judge"]'), null);
  const select = host.querySelector('select');
  await change(select, 'p\u0000m');
  await click([...host.querySelectorAll('section:not([hidden]) button')].find(b => b.textContent === 'Save'));
  assert.deepEqual(saves[0].judgeModel, { provider: 'p', model: 'j' }); assert.equal(saves[0].judgeSystemPrompt, 'Custom');
});

test('structured failures localize all types and fall back to ids without definitions', async t => {
  const stage = { questions: { n: { type: 'noul', question: '안전한가?' }, s: { type: 'score', levels: ['미흡', '충분'] }, c: { type: 'choice', options: { no: '거부', yes: '승인' } } } };
  const result = { verdict: 'fail', original: 'a', subject: 'a', notes: [], records: [], hooks: {}, forward: { kind: 'none' }, stages: { first: { verdict: 'fail', reason: 'legacy raw reason', data: { failedConditions: [{ question: 'n', type: 'noul', threshold: 0.5, actual: 0.2 }, { question: 's', type: 'score', min: 1, actual: 0 }, { question: 'c', type: 'choice', allowed: ['yes'], actual: 'no' }] } } } };
  result.stages.first.data.questions = stage.questions;
  const host = await render(t, GateResultDetails, { locale: 'ko', result });
  assert.match(host.textContent, /질문 "안전한가\?": 예 확률 0.2 < 기준 0.5/);
  assert.match(host.textContent, /점수 미흡 < 최소 충분/); assert.match(host.textContent, /허용 옵션이 아닌 선택값 거부/); assert.doesNotMatch(host.textContent, /legacy raw reason/);
  delete result.stages.first.data.questions;
  const fallback = await render(t, GateResultDetails, { result });
  assert.match(fallback.textContent, /Question "n": yes probability 0.2 < threshold 0.5/); assert.match(fallback.textContent, /score 0 < minimum 1/); assert.match(fallback.textContent, /selection no is not allowed/);
  const chinese = await render(t, GateResultDetails, { result, locale: 'zh' }); assert.match(chinese.textContent, /阈值 0.5/);
});
