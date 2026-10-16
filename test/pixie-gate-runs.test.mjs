import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { GateRunsPanel } from '../src/pixie-gate-runs.tsx';
import { PixieTab } from '../src/pixie-tab.tsx';
import { studioStyles } from '../src/ui-styles.ts';
import { followPixieStream, pixieDescriptors, mountPixie } from '../src/pixie-client.tsx';
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const run = (id, extra = {}) => ({ id, gateId: id, gateName: `Gate ${id}`, point: 'input', sessionId: 's', startedAt: 1, original: `original ${id}`, finalText: '', applied: 'none', status: 'done', usage: { inputTokens: 98765 }, ...extra });
const pending = () => run('pending', { applied: 'rejected', rejection: { original: 'retained original', reason: 'failure reason', suggestion: 'suggested draft', status: 'pending' }, hooksInput: 'unverified' });
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
async function setup(runs = [], extra = {}, Component = GateRunsPanel, locale = 'en') {
  let listener; let reads = 0; let stops = 0; const calls = [];
  const actions = {
    gateRuns: async () => { reads++; return { sessionId: 's', runs }; },
    followGates: callback => { listener = callback; return () => { stops++; }; },
    resolveGateRejection: async (...args) => { calls.push(args); },
    fillDraft: text => calls.push(['draft', text]), ...extra,
  };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(Component, { actions, locale })));
  return { host, calls, emit: async frame => act(async () => listener(frame)), reads: () => reads, stops: () => stops, close: async () => act(async () => root.unmount()) };
}
test('gate tab opens empty list without a configured model', async () => {
  const f = await setup([], { view: async () => ({ record: { threads: [] }, settings: {}, frames: [] }), follow: () => () => {} }, PixieTab);
  await act(async () => button(f.host, 'Gates').click());
  assert.match(f.host.textContent, /No gate runs yet/); await f.close();
});
test('cards map every applied action and no-action lifecycle without inferring verdict', async () => {
  const labels = { pass: 'Passed', replaced: 'Replaced', appended: 'Appended', rejected: 'Rejected', steered: 'Steered', blocked: 'Blocked', denied: 'Blocked', none: 'None' };
  const f = await setup([...Object.keys(labels).map(applied => run(applied, { applied })), ...['running', 'error', 'cancelled'].map(status => run(status, { status }))]);
  const cards = [...f.host.querySelectorAll('.studio-pixie-thread')];
  for (const [id, label] of Object.entries({ ...labels, running: 'Running', error: 'Error', cancelled: 'Cancelled' })) assert.match(cards.find(c => c.textContent.includes(`Gate ${id}`)).querySelector('.studio-badge').textContent, new RegExp(label));
  // Usage stays out of the compact list; the detail shows it next to the applied action.
  assert.doesNotMatch(f.host.querySelector('.studio-pixie-list').textContent, /98765/);
  assert.match(f.host.querySelector('.studio-gate-facts').textContent, /Tokens in 98765 · out 0/); await f.close();
});
test('pending sorts first, fills suggestion without resolving, and explicitly marks sent', async () => {
  const f = await setup([run('newer', { startedAt: 100 }), pending()]);
  assert.match(f.host.querySelector('.studio-pixie-thread').textContent, /Gate pending.*Pending rejection/);
  assert.match(f.host.textContent, /Hook input unverified/);
  assert.match(f.host.querySelector('.studio-pixie-detail').textContent, /retained original.*failure reason.*suggested draft/);
  await act(async () => button(f.host, 'Edit and send').click());
  assert.deepEqual(f.calls, [['draft', 'suggested draft']]);
  assert.match(f.host.textContent, /does not send/);
  await act(async () => button(f.host, 'Mark as sent').click());
  assert.deepEqual(f.calls[1], ['pending', 'resent']);
  assert.equal(button(f.host, 'Mark as sent'), undefined); await f.close();
});
test('original fallback, dismiss arguments and failed resolution keep pending actions', async () => {
  const p = pending(); delete p.rejection.suggestion;
  const f = await setup([p]);
  await act(async () => button(f.host, 'Edit and send').click());
  await act(async () => button(f.host, 'Dismiss').click());
  assert.deepEqual(f.calls, [['draft', 'retained original'], ['pending', 'dismissed']]); await f.close();
  const failed = await setup([pending()], { resolveGateRejection: async () => { throw Error('offline'); }, fillDraft: () => { throw Error('missing'); } });
  await act(async () => button(failed.host, 'Dismiss').click());
  assert.match(failed.host.querySelector('[role=alert]').textContent, /offline/);
  await act(async () => button(failed.host, 'Edit and send').click());
  assert.match(failed.host.textContent, /Session composer unavailable/);
  assert.ok(button(failed.host, 'Mark as sent')); await failed.close();
});
test('sync rereads, run upserts, detail fields and narrow navigation reuse container CSS', async () => {
  const f = await setup([run('turn', { point: 'turn-end', turn: 4, steerCount: 2, reason: 'cap reached', applied: 'steered', output: { verdict: 'stop', reason: 'redo it' } })]);
  assert.match(f.host.querySelector('.studio-gate-facts').textContent, /AppliedSteeredVerdictStoppedReasonredo itNot applied becausecap reachedTurn4 · Steer count: 2/);
  await f.emit({ type: 'sync' }); assert.equal(f.reads(), 2);
  await f.emit({ type: 'run', run: run('tool', { point: 'tool-before', startedAt: 2, tool: { name: 'bash', callId: 'call-42' } }) });
  const cards = f.host.querySelectorAll('.studio-pixie-thread'); assert.equal(cards.length, 2);
  await act(async () => cards[0].click());
  assert.equal(f.host.querySelector('[data-open]').dataset.open, 'true');
  assert.match(f.host.querySelector('.studio-pixie-detail').textContent, /Toolbash Call ID: call-42/);
  await act(async () => button(f.host, 'All gate runs').click());
  assert.equal(f.host.querySelector('[data-open]').dataset.open, 'false');
  assert.match(studioStyles, /@container studio-pixie \(max-width: 560px\)/);
  await f.close(); assert.equal(f.stops(), 1);
});
test('run frames win over in-flight snapshot and shared result details render', async () => {
  let finish;
  const f = await setup([], { gateRuns: () => new Promise(resolve => { finish = resolve; }) });
  const result = { original: 'raw', subject: 'final subject', verdict: 'pass', notes: [], stages: {}, records: [], hooks: {}, forward: { kind: 'original', text: 'forwarded' } };
  await f.emit({ type: 'run', run: run('race', { result, applied: 'replaced' }) });
  await act(async () => finish({ runs: [run('race')] }));
  assert.match(f.host.textContent, /Replaced/); assert.match(f.host.textContent, /final subject/); await f.close();
});
test('shared follow reconnects to sync and disposes on unmount', async () => {
  let connects = 0; let disposed = 0; let end;
  const frames = [];
  const stop = followPixieStream(() => {
    connects++;
    const connection = connects;
    return { dispose() { disposed++; end?.(); }, async *[Symbol.asyncIterator]() { yield { type: 'sync' }; if (connection === 1) throw Error('lost'); await new Promise(resolve => { end = resolve; }); } };
  }, frame => frames.push(frame));
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(connects, 2); assert.equal(frames.length, 2); stop();
  await new Promise(resolve => setTimeout(resolve, 0)); assert.ok(disposed >= 2);
});
test('Remote descriptors and session-bound composer use public scopes without auto-send', async () => {
  const descriptors = pixieDescriptors();
  for (const name of ['gateRuns', 'followGates', 'resolveGateRejection', 'sessionGates', 'setSessionGate']) assert.equal(descriptors.filter(d => d.method === name).length, 1);
  assert.deepEqual(descriptors.find(d => d.method === 'setSessionGate').parameters.map(p => p.name ?? p), ['sessionId', 'gateId', 'enabled']);
  assert.equal(descriptors.find(d => d.method === 'followGates').mode, 'stream');
  let Body; const calls = []; const input = { setDraft: text => calls.push(['draft', text]), focus: () => calls.push(['focus']) };
  const actx = { get: name => name === 'conversation' ? { input: { for: scope => { assert.equal(scope, actx); return input; } } } : undefined };
  const remote = { gateDefinitions: async () => ({ ok: true, value: [] }), view: async () => ({ ok: true, value: { record: { threads: [] }, settings: {}, frames: [] } }), gateRuns: async () => ({ ok: true, value: { runs: [pending()] } }), follow: () => stream(), followGates: () => stream(), resolveGateRejection: async (...args) => { calls.push(args); return { ok: true, value: true }; }, sessionGates: async () => ({ ok: true, value: { gates: [] } }), setSessionGate: async () => ({ ok: true, value: [] }) };
  function stream() { let done; return { dispose: () => done?.(), async *[Symbol.asyncIterator]() { yield { type: 'sync' }; await new Promise(r => { done = r; }); } }; }
  const registered = [];
  const slots = { inject: (_name, callback) => callback(), register: (definition, component) => { registered.push(definition); if (definition.name === 'sidebar.right.pane.tab') Body = component; } };
  const ctx = { get: name => name === 'sessions' ? { scope: id => { assert.equal(id, 's'); return actx; } } : remote, slots, locale: { getLocale: () => ({ active: 'en' }), subscribe: () => () => {} }, inject: (_names, callback) => callback(scope) };
  const definitions = [];
  const scope = { slots, sidebarRightTabs: { register: () => () => {} }, sidebarRight: {}, effect: fn => fn(), uiConversation: { events: { register: d => { definitions.push(d.kind); return () => {}; } } }, inject: (_names, callback) => callback(scope) };
  mountPixie(ctx);
  assert.deepEqual(registered.filter(d => d.name === 'conversation.chat.turnTail'), [{ name: 'conversation.chat.turnTail', id: 'studio-pixie-gate-tail' }]);
  assert.deepEqual(registered.filter(d => d.name === 'conversation.chat.node'), [{ name: 'conversation.chat.node', key: 'studio-pixie-gate-result' }]);
  assert.deepEqual(definitions, ['studio-pixie-gate-result']);
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(React.createElement(Body, { sessionId: 's' })));
  await act(async () => button(host, 'Gates').click());
  await act(async () => button(host, 'Edit and send').click());
  assert.deepEqual(calls, [['draft', 'suggested draft'], ['focus']]);
  await act(async () => button(host, 'Dismiss').click()); assert.deepEqual(calls[2], ['s', 'pending', 'dismissed']);
  await act(async () => root.unmount());
});

test('run points localize in cards and details in all supported locales', async () => {
  for (const [locale, labels] of [['ko', ['입력', '턴 종료', '도구 실행 전', '도구 실행 후']], ['en', ['Input', 'Turn end', 'Before tool', 'After tool']], ['zh', ['输入', '轮次结束', '工具执行前', '工具执行后']]]) {
    for (const [i, point] of ['input', 'turn-end', 'tool-before', 'tool-after'].entries()) {
      const f = await setup([run('point', { point })], {}, GateRunsPanel, locale);
      assert.ok(f.host.querySelector('.studio-pixie-thread .studio-card-meta').textContent.startsWith(labels[i]));
      assert.ok(f.host.querySelector('.studio-pixie-detail > .studio-card-meta').textContent.startsWith(labels[i]));
      await f.close();
    }
  }
});
test('missing, zero and invalid timestamps use dash, pending has one status badge', async () => {
  for (const startedAt of [undefined, 0, -1, NaN, Infinity, 9e20]) {
    const f = await setup([{ ...pending(), startedAt }]);
    const card = f.host.querySelector('.studio-pixie-thread');
    assert.equal(card.querySelector('.studio-card-meta').textContent, 'Input · —');
    assert.equal(card.querySelectorAll('.studio-badge').length, 1);
    assert.equal(card.querySelector('.studio-badge').textContent, 'Pending rejection');
    assert.equal(f.host.querySelector('.studio-pixie-detail-head').querySelectorAll('.studio-badge').length, 1);
    for (const title of ['Original', 'Reason', 'Suggestion']) assert.ok([...f.host.querySelectorAll('h3')].some(h => h.textContent === title));
    await f.close();
  }
});

for (const original of ['', undefined]) test(`rejection detail and draft fall back to run original: ${String(original)}`, async t => {
  const p = pending(); p.rejection.original = original; p.rejection.suggestion = '';
  const f = await setup([p]); t.after(() => f.close());
  const heading = [...f.host.querySelectorAll('h3')].find(h => h.textContent === 'Original');
  assert.ok(heading); assert.match(heading.closest('section').textContent, /original pending/);
  await act(async () => button(f.host, 'Edit and send').click());
  assert.deepEqual(f.calls, [['draft', 'original pending']]);
});
test('rejection detail omits original section when both originals are missing', async t => {
  const p = pending(); delete p.original; delete p.rejection.original; delete p.rejection.suggestion;
  const f = await setup([p]); t.after(() => f.close());
  assert.equal([...f.host.querySelectorAll('h3')].some(h => h.textContent === 'Original'), false);
  await act(async () => button(f.host, 'Edit and send').click());
  assert.deepEqual(f.calls, [['draft', '']]);
});

test('a recorded live run shows Pixie output, usage, notes and helper calls', async () => {
  const { readFileSync } = await import('node:fs');
  const live = JSON.parse(readFileSync(new URL('./fixtures/pixie-gate-run-helper.json', import.meta.url), 'utf8'));
  const f = await setup([live], {}, GateRunsPanel, 'ko');
  const detail = f.host.querySelector('.studio-pixie-detail');
  assert.match(detail.querySelector('.studio-gate-facts').textContent, /적용덧붙임판정통과토큰토큰 입력 653 · 출력 799/);
  assert.match(detail.querySelector('section[aria-label="Pixie 출력"]').textContent, /덧붙임Pixie 요약:.*메모R5 input gate ran/s);
  assert.match(detail.querySelector('section[aria-label="원문"]').textContent, /원문 \(변경 없음\)\[GATE\]/);
  assert.match(detail.querySelector('section[aria-label="전달"]').textContent, /함께 전달한 내용Pixie 요약:/);
  assert.equal(f.host.querySelector('.studio-pixie-thread .studio-pixie-thread-preview'), null);
  const calls = detail.querySelector('section[aria-label="헬퍼 호출"]');
  assert.deepEqual([...calls.querySelectorAll('[data-gate-stage]')].map(el => el.dataset.gateStage), ['pixie-ask-1', 'pixie-judge-2']);
  assert.match(calls.textContent, /Summarize the request in one short English sentence|Read and follow/);
  await f.close();
});
test('run detail names who concluded; older records without it show no row', async () => {
  const result = { verdict: 'fail', original: 'o', subject: 'o', notes: [], stages: {}, records: [], hooks: {}, forward: { kind: 'none' } };
  const f = await setup([run('script', { applied: 'rejected', result: { ...result, concludedBy: 'script' }, output: { verdict: 'stop', reason: 'missing fields' } })]);
  assert.match(f.host.querySelector('.studio-gate-facts').textContent, /Concluded byHook script/); await f.close();
  const appended = await setup([run('appended', { applied: 'appended', result: { ...result, concludedBy: 'script' }, output: { verdict: 'pass', append: '[Jev] bug' } })]);
  assert.ok(appended.host.querySelector('section[aria-label="Pixie output"]'));
  assert.match(appended.host.textContent, /Script output/); assert.doesNotMatch(appended.host.textContent, /Pixie output/); await appended.close();
  const byPixie = await setup([run('pixie', { applied: 'appended', result: { ...result, concludedBy: 'pixie' }, output: { verdict: 'pass', append: 'x' } })]);
  assert.match(byPixie.host.textContent, /Pixie output/); await byPixie.close();
  const old = await setup([run('old', { result })]);
  assert.doesNotMatch(old.host.querySelector('.studio-gate-facts').textContent, /Concluded by/); await old.close();
});

test('the gate tab lists this session\'s gates with a session switch that follows other surfaces', async () => {
  const switched = [];
  const f = await setup([], {
    sessionGates: async () => ({ preset: 'p', gates: [{ id: 'tr', name: 'Translate', when: 'turn-end', script: 'translate-check.sh', sessionEnabled: true }, { id: 'in', name: 'Input check', when: 'user-message', sessionEnabled: false }] }),
    setSessionGate: async (id, enabled) => { switched.push([id, enabled]); return enabled ? [] : [id, 'in']; },
  }, GateRunsPanel, 'ko');
  await act(async () => {});
  const list = f.host.querySelector('section[aria-label="이 세션의 게이트"]');
  assert.ok(list);
  const rows = [...list.querySelectorAll('[data-gate-session]')].map(row => row.textContent);
  assert.match(rows[0], /Translate.*턴이 끝났을 때|Translate.*답변/);
  assert.match(rows[0], /translate-check\.sh/); assert.match(rows[1], /이 세션에서 꺼짐/);
  const toggle = list.querySelector('[role="switch"][aria-label="이 세션에서 Translate 실행"]');
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  await act(async () => toggle.click());
  assert.deepEqual(switched, [['tr', false]]);
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  // The chat block turned it back on: the live frame updates the list without a refetch.
  await f.emit({ type: 'session', disabledGateIds: [] });
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  await f.close();
});

test('hosts without session switches show no session list', async () => {
  const f = await setup([]);
  assert.equal(f.host.querySelector('.studio-gate-session'), null);
  await f.close();
});
