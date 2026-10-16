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
const NO_GATES = { read: async () => ({ entries: [], invalid: [] }), save: async v => v, presets: async () => [], trial: () => ({ result: new Promise(() => {}), cancel() {} }),
  scripts: async () => ({ directory: '', defaultDirectory: '', custom: false, supported: true, scripts: [] }), saveScriptDirectory: async () => ({ directory: '', defaultDirectory: '', custom: false, supported: true, scripts: [] }) };
const catalog = async () => ({ groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }, { id: 'j', name: 'J' }] }] });
const openJudge = async host => click([...host.querySelectorAll('nav button, [role="navigation"] button, button')].find(b => b.textContent === 'Decision engine'));
const visible = host => [...host.querySelectorAll('section:not([hidden])')].pop();
test('decision engine page edits LLM judge fields and keeps them across other edits', async t => {
  const saves = [];
  const stored = { contextMode: 'fresh', systemPrompt: 'original', allowThreadModel: true, judgeModel: { provider: 'p', model: 'j' }, judgeSystemPrompt: 'Custom' };
  const host = await render(t, PixieSettingsPage, { gateActions: NO_GATES, actions: { read: async () => stored, models: catalog, save: async value => { saves.push(value); return value; } } });
  await change(host.querySelector('select'), 'p\u0000m');
  await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Save'));
  assert.deepEqual(saves[0].judgeModel, { provider: 'p', model: 'j' }); assert.equal(saves[0].judgeSystemPrompt, 'Custom');
  await openJudge(host);
  assert.equal(input(host, 'Judge model').value, 'p\u0000j');
  assert.equal(input(host, 'Judge system prompt').value, 'Custom');
  assert.match(host.textContent, /When not set, the value entered in the Pixie model settings is used\./);
  await change(input(host, 'Judge model'), '');
  await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Save'));
  assert.equal(saves[1].judgeModel, undefined);
});

test('Jev engine shows the model field and a key row that never displays the value', async t => {
  const saves = [], keyCalls = [];
  let status = { available: true, configured: false, writable: true };
  const jevKey = { status: async () => status, save: async value => { keyCalls.push(['save', value]); status = { available: true, configured: true, writable: true, source: 'store' }; return status; }, remove: async () => { keyCalls.push(['remove']); status = { available: true, configured: false, writable: true }; return status; } };
  const host = await render(t, PixieSettingsPage, { gateActions: NO_GATES, actions: { read: async () => ({ contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }), models: catalog, save: async value => { saves.push(value); return value; }, jevKey } });
  await openJudge(host);
  await click(button(host, 'Jev'));
  await change(input(host, 'Jev model'), 'jev-1.13.0');
  await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Save'));
  assert.equal(saves[0].judgeEngine, 'jev'); assert.equal(saves[0].jevModel, 'jev-1.13.0');
  assert.match(host.textContent, /Not set/);
  const key = input(host, 'TypeSafe API key');
  assert.equal(key.type, 'password');
  await change(key, 'ts-secret');
  await click(button(host, 'Save key'));
  assert.deepEqual(keyCalls, [['save', 'ts-secret']]);
  assert.equal(input(host, 'TypeSafe API key').value, '');
  assert.match(host.textContent, /Set · Source: store/); assert.doesNotMatch(host.textContent, /ts-secret/);
  // Overwriting keeps the status line, so the row confirms each result itself.
  assert.match(host.textContent, /Key saved\./);
  await change(input(host, 'TypeSafe API key'), 'next');
  assert.doesNotMatch(host.textContent, /Key saved\./);
  await click(button(host, 'Remove key'));
  assert.deepEqual(keyCalls[1], ['remove']);
  assert.match(host.textContent, /Key removed\./);
});

test('the key row shows progress while saving and no confirmation on failure', async t => {
  let release;
  const jevKey = { status: async () => ({ available: true, configured: false, writable: true }), save: () => new Promise((_, reject) => { release = () => reject(new Error('disk full')); }), remove: async () => assert.fail() };
  const host = await render(t, PixieSettingsPage, { gateActions: NO_GATES, actions: { read: async () => ({ contextMode: 'fresh', systemPrompt: '', allowThreadModel: true, judgeEngine: 'jev' }), models: catalog, save: async v => v, jevKey } });
  await openJudge(host);
  await change(input(host, 'TypeSafe API key'), 'k');
  await click(button(host, 'Save key'));
  assert.ok(button(host, 'Saving…')?.disabled);
  await act(async () => release());
  assert.match(host.textContent, /Could not update the key\. \(disk full\)/); assert.doesNotMatch(host.textContent, /Key saved/);
  assert.equal(input(host, 'TypeSafe API key').value, 'k');
});

test('a read-only key source hides the input; no credentials service explains why', async t => {
  const read = async () => ({ contextMode: 'fresh', systemPrompt: '', allowThreadModel: true, judgeEngine: 'jev' });
  const shadowed = await render(t, PixieSettingsPage, { gateActions: NO_GATES, actions: { read, models: catalog, save: async v => v, jevKey: { status: async () => ({ available: true, configured: true, writable: false, source: 'env' }), save: async () => assert.fail(), remove: async () => assert.fail() } } });
  await openJudge(shadowed);
  assert.match(shadowed.textContent, /read-only source \(env\)/); assert.equal(input(shadowed, 'TypeSafe API key'), null);
  const missing = await render(t, PixieSettingsPage, { gateActions: NO_GATES, actions: { read, models: catalog, save: async v => v, jevKey: { status: async () => ({ available: false, configured: false, writable: false }), save: async () => assert.fail(), remove: async () => assert.fail() } } });
  await openJudge(missing);
  assert.match(missing.textContent, /credentials service is not available/); assert.equal(input(missing, 'TypeSafe API key'), null);
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

test('a coded credentials-file failure shows the fix and the original DSH message', async t => {
  const jevKey = { status: async () => ({ available: true, configured: false, writable: true }), save: async () => { throw new Error('[pixie/credentials-refs] Expected YAML collection at refs. Remaining path: TYPESAFE_API_KEY'); }, remove: async () => assert.fail() };
  for (const [locale, fix, keyLabel, saveLabel] of [
    ['en', /Could not update the key\. The DSH credentials file \(\.credentials\.yaml in the DSH home\) has an empty refs: line\. Change it to refs: \{\} and save again\. \(Expected YAML collection at refs\. Remaining path: TYPESAFE_API_KEY\)/, 'TypeSafe API key', 'Save key'],
    // Korean copy is tuned by locale review; pin the parts the user needs: the file, the fix, and the original DSH message.
    ['ko', /키를 바꾸지 못했습니다\. .*\.credentials\.yaml.*refs: \{\}.*\(Expected YAML collection at refs/, 'TypeSafe API 키', '키 저장'],
  ]) {
    const host = await render(t, PixieSettingsPage, { locale, gateActions: NO_GATES, actions: { read: async () => ({ contextMode: 'fresh', systemPrompt: '', allowThreadModel: true, judgeEngine: 'jev' }), models: catalog, save: async v => v, jevKey } });
    await click([...host.querySelectorAll('button')].find(b => b.textContent === (locale === 'ko' ? '결정 엔진' : 'Decision engine')));
    await change(input(host, keyLabel), 'k');
    await click(button(host, saveLabel));
    assert.match(host.textContent, fix);
    assert.doesNotMatch(host.textContent, /\[pixie\//);
  }
});
