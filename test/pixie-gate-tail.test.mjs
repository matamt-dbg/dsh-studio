/** Chat turn tail: a script-concluded turn-end note under the answer of the same turn. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { GateTail, splitNote, tailRun } from '../src/pixie-gate-tail.tsx';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const run = (id, extra = {}) => ({ id, gateId: 'tr', gateName: '#27 영어 답변 번역', point: 'turn-end', turn: 4, sessionId: 's', startedAt: 10, original: 'Git rebase …', finalText: '', applied: 'none', status: 'done',
  usage: { inputTokens: 1, outputTokens: 1 }, output: { verdict: 'pass', note: '[한국어 번역]\nGit rebase는 **커밋**을 다시 적용합니다.' }, result: { concludedBy: 'script' }, ...extra });
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text);

async function setup(runs, { turn = 4, disabledGateIds, setSessionGate } = {}) {
  let listener; const calls = [];
  const actions = {
    gateRuns: async () => ({ sessionId: 's', runs, ...(disabledGateIds ? { disabledGateIds } : {}) }),
    followGates: callback => { listener = callback; return () => {}; },
    setSessionGate: setSessionGate ?? (async (id, enabled) => { calls.push([id, enabled]); return enabled ? [] : [id]; }),
    openTab: () => calls.push(['open']),
  };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const Surface = ({ children }) => React.createElement('div', { 'data-surface': 'yes' }, children);
  await act(async () => root.render(React.createElement(GateTail, { actions, turn, locale: 'ko', Surface })));
  return { host, calls, emit: async frame => act(async () => listener(frame)), close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test('tailRun picks the last finished script note of that turn and ignores everything else', () => {
  const runs = [run('a', { startedAt: 1 }), run('b', { startedAt: 5, output: { verdict: 'pass', note: '[한국어 번역]\nlater' } }),
    run('skip', { result: { concludedBy: 'skipped' }, startedAt: 9 }), run('pixie', { result: { concludedBy: 'pixie' }, startedAt: 9 }),
    run('running', { status: 'running', startedAt: 9 }), run('other-turn', { turn: 3, startedAt: 9 }), run('input', { point: 'input', startedAt: 9 }),
    run('empty', { output: { verdict: 'pass', note: '  ' }, startedAt: 9 }), run('no-note', { output: { verdict: 'pass' }, startedAt: 9 })];
  assert.equal(tailRun(runs, 4).id, 'b');
  assert.equal(tailRun(runs, 2), undefined);
});

test('splitNote turns a leading [label] line into the title', () => {
  assert.deepEqual(splitNote('[한국어 번역]\n본문'), { label: '한국어 번역', body: '본문' });
  assert.deepEqual(splitNote('[한국어 번역 — 충실도 미확인]\n본문'), { label: '한국어 번역 — 충실도 미확인', body: '본문' });
  assert.deepEqual(splitNote('본문만'), { body: '본문만' });
});

test('a turn with a translation shows it under the answer; hide, open the tab, and turn the gate off for the session', async () => {
  const f = await setup([run('a')]);
  const block = f.host.querySelector('[data-gate-tail="tr"]');
  assert.ok(block); assert.ok(f.host.querySelector('[data-surface]'));
  assert.match(block.textContent, /^한국어 번역/);
  assert.match(block.textContent, /Pixie · #27 영어 답변 번역/);
  assert.match(block.textContent, /Git rebase는 \*\*커밋\*\*을 다시 적용합니다/); // plain fallback without a Markdown renderer
  assert.doesNotMatch(block.textContent, /\[한국어 번역\]/);
  await act(async () => button(f.host, '접기').click());
  assert.doesNotMatch(f.host.textContent, /다시 적용합니다/);
  await act(async () => button(f.host, '펼치기').click());
  await act(async () => button(f.host, 'Pixie 탭에서 보기').click());
  await act(async () => button(f.host, '이 세션에서 끄기').click());
  assert.deepEqual(f.calls, [['open'], ['tr', false]]);
  assert.match(f.host.querySelector('[role="status"]').textContent, /이 세션에서 껐습니다/);
  assert.equal(button(f.host, '이 세션에서 끄기'), undefined);
  // Turning it back on elsewhere (the Pixie tab) brings the button back without a refetch.
  await f.emit({ type: 'session', disabledGateIds: [] });
  assert.ok(button(f.host, '이 세션에서 끄기'));
  await f.close();
});

test('an unverified translation is flagged; a failed switch reports without hiding the block', async () => {
  const f = await setup([run('a', { output: { verdict: 'pass', note: '[한국어 번역 — 충실도 미확인]\n번역' } })], { setSessionGate: async () => { throw new Error('disk'); } });
  assert.equal(f.host.querySelector('[data-gate-tail]').dataset.unverified, 'true');
  assert.match(f.host.textContent, /확인 안 됨/);
  await act(async () => button(f.host, '이 세션에서 끄기').click());
  assert.match(f.host.textContent, /이 세션의 게이트를 바꾸지 못했습니다\. \(disk\)/);
  assert.ok(f.host.querySelector('[data-gate-tail]'));
  await f.close();
});

test('nothing mounts for a turn without a note, and a note arriving live appears', async () => {
  const f = await setup([run('skip', { result: { concludedBy: 'skipped' } })]);
  assert.equal(f.host.innerHTML, '');
  await f.emit({ type: 'run', run: run('late', { startedAt: 20 }) });
  assert.ok(f.host.querySelector('[data-gate-tail="tr"]'));
  await f.close();
});

test('an already switched-off gate shows its note without the off button', async () => {
  const f = await setup([run('a')], { disabledGateIds: ['tr'] });
  await act(async () => {});
  assert.equal(button(f.host, '이 세션에서 끄기'), undefined);
  assert.match(f.host.textContent, /이 세션에서 껐습니다/);
  await f.close();
});
