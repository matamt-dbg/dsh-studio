/** Chat placement of gate results at tool calls and input messages. Event shapes follow DSH 0.2.0-rc.2 session events. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { gateResultDefinition, eventAnchor, gateRunHub } from '../src/pixie-gate-chat-node.ts';
import { anchorRuns, GateResults } from '../src/pixie-gate-tail.tsx';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const run = (id, extra = {}) => ({ id, gateId: 'g', gateName: 'Gate', point: 'tool-after', tool: { name: 'read', callId: 'c1' }, turn: 1, sessionId: 's', startedAt: 10, original: '', finalText: '', applied: 'none', status: 'done',
  usage: { inputTokens: 0, outputTokens: 0 }, output: { verdict: 'pass', note: 'summary' }, result: { concludedBy: 'pixie' }, ...extra });

test('only appended tool results and user or agent messages carry an anchor', () => {
  assert.deepEqual(eventAnchor({ type: 'tool/result', seq: 4, surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [] } } }), { kind: 'tool', callId: 'c1' });
  assert.deepEqual(eventAnchor({ type: 'user/message', seq: 2, surfaceOp: 'append', data: { id: 'm1', source: { kind: 'user' } } }), { kind: 'message', messageId: 'm1' });
  assert.deepEqual(eventAnchor({ type: 'user/message', seq: 2, data: { id: 'm2', source: { kind: 'agent-message' } } }), { kind: 'message', messageId: 'm2' });
  for (const event of [{ type: 'tool/result', seq: 4, surfaceOp: 'replace', data: { message: { toolCallId: 'c1' } } },
    { type: 'tool/result', seq: 4, data: { callId: 'c1' } },
    { type: 'user/message', seq: 2, data: { id: 'm3', source: { kind: 'studio-pixie-gate' } } },
    { type: 'tool/call', seq: 3, data: { callId: 'c1' } }]) assert.equal(eventAnchor(event), undefined);
});

test('the Definition uses the function match form the 0.2.0-rc.2 runtime accepts', () => {
  assert.equal(typeof gateResultDefinition.match, 'function');
  assert.equal(gateResultDefinition.match({ type: 'assistant/message', seq: 1, data: {} }), null);
});

test('the Definition places one row right after its subject event and keeps the node identity when unchanged', () => {
  const event = { type: 'tool/result', seq: 7, surfaceOp: 'append', data: { message: { toolCallId: 'c1' } } };
  assert.deepEqual(gateResultDefinition.match(event), { id: 'tool:c1', role: 'start' });
  const location = { kind: 'step' };
  const start = { event, location };
  const state = gateResultDefinition.start({}, start);
  const context = { key: 'k', id: 'tool:c1', start, matches: [start], state, current: new Map() };
  const node = gateResultDefinition.buildViewNode(context);
  assert.equal(node.anchorSeq, 7.2); assert.equal(node.location, location); assert.deepEqual(node.data, { anchor: { kind: 'tool', callId: 'c1' } });
  assert.equal(gateResultDefinition.buildViewNode({ ...context, current: new Map([['chat', node]]) }), node);
  // A message result sits outside the turn so a folded turn does not hide it.
  const message = { type: 'user/message', seq: 3, surfaceOp: 'append', data: { id: 'm1', source: { kind: 'user' } } };
  const mstart = { event: message, location };
  const mnode = gateResultDefinition.buildViewNode({ key: 'm', id: 'message:m1', start: mstart, matches: [mstart], state: gateResultDefinition.start({}, mstart), current: new Map() });
  assert.deepEqual(mnode.location, { kind: 'session' }); assert.equal(mnode.anchorSeq, 3.2);
  assert.equal(gateResultDefinition.buildViewNode({ key: 'm', id: 'message:m1', start: mstart, matches: [mstart], state: gateResultDefinition.start({}, mstart), current: new Map([['chat', mnode]]) }), mnode);
});

test('anchorRuns keeps the last displayed run per point at that anchor, before and after together', () => {
  const runs = [run('before', { point: 'tool-before', startedAt: 1 }), run('after-old', { startedAt: 2 }), run('after', { startedAt: 3 }),
    run('off', { startedAt: 4, showInChat: false }), run('skipped', { startedAt: 4, result: { concludedBy: 'skipped' } }),
    run('other-call', { tool: { name: 'read', callId: 'c2' }, startedAt: 5 }), run('input', { point: 'input', messageId: 'm1', startedAt: 6 })];
  assert.deepEqual(anchorRuns(runs, { kind: 'tool', callId: 'c1' }).map(r => r.id), ['before', 'after']);
  assert.deepEqual(anchorRuns(runs, { kind: 'message', messageId: 'm1' }).map(r => r.id), ['input']);
  assert.deepEqual(anchorRuns(runs, { kind: 'message', messageId: 'none' }), []);
});

test('one hub stream serves every row, follows run frames, and closes with the last row', async () => {
  let connects = 0, fetches = 0, emit, stopped = 0;
  const hub = gateRunHub(async () => { fetches++; return { sessionId: 's', runs: [run('a')] }; }, listener => { connects++; emit = listener; return () => { stopped++; }; });
  const offA = hub.followGates(() => {}), offB = hub.followGates(() => {});
  assert.equal((await hub.gateRuns()).runs.length, 1); await hub.gateRuns();
  emit({ type: 'run', run: run('b') }); emit({ type: 'session', disabledGateIds: ['g'] });
  const record = await hub.gateRuns();
  assert.deepEqual(record.runs.map(r => r.id), ['a', 'b']); assert.deepEqual(record.disabledGateIds, ['g']);
  assert.equal(connects, 1); assert.equal(fetches, 1);
  offA(); assert.equal(stopped, 0); offB(); assert.equal(stopped, 1);
});

test('a tool row renders nothing until a displayed result arrives, then shows it with its point', async () => {
  let listener;
  const actions = { gateRuns: async () => ({ sessionId: 's', runs: [run('off', { showInChat: false })] }), followGates: cb => { listener = cb; return () => {}; }, setSessionGate: async () => [], openTab: () => {} };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(GateResults, { actions, anchor: { kind: 'tool', callId: 'c1' }, locale: 'ko' })));
  assert.equal(host.innerHTML, '');
  await act(async () => listener({ type: 'run', run: run('live', { output: { verdict: 'stop', reason: '위험한 명령' }, point: 'tool-before' }) }));
  const block = host.querySelector('[data-gate-point="tool-before"]');
  assert.equal(block.dataset.tailKind, 'verdict'); assert.match(block.textContent, /도구 실행 전/); assert.match(block.textContent, /위험한 명령/);
  await act(async () => root.unmount()); host.remove();
});

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function pendingHub() {
  const fetches = []; let emit;
  const hub = gateRunHub(() => { const d = deferred(); fetches.push(d); return d.promise; }, listener => { emit = listener; return () => {}; });
  return { hub, fetches, emit: frame => emit(frame) };
}

test('frames that arrive while the first fetch is pending survive its snapshot', async () => {
  const h = pendingHub(); h.hub.followGates(() => {});
  const first = h.hub.gateRuns();
  h.emit({ type: 'run', run: run('live') }); h.emit({ type: 'session', disabledGateIds: ['g'] });
  h.fetches[0].resolve({ sessionId: 's', runs: [run('old', { startedAt: 1 })] });
  const record = await first;
  assert.deepEqual(record.runs.map(r => r.id), ['old', 'live']); assert.deepEqual(record.disabledGateIds, ['g']);
  assert.deepEqual((await h.hub.gateRuns()).runs.map(r => r.id), ['old', 'live']); assert.equal(h.fetches.length, 1);
});

test('a superseded fetch neither publishes nor clears the newer snapshot, and failures stay handled', async () => {
  const unhandled = []; const onUnhandled = reason => unhandled.push(reason); process.on('unhandledRejection', onUnhandled);
  try {
    const h = pendingHub(); h.hub.followGates(() => {});
    const old = h.hub.gateRuns(); old.catch(() => {});
    h.emit({ type: 'run', run: run('live') });
    h.emit({ type: 'sync' });
    h.fetches[1].resolve({ sessionId: 's', runs: [run('fresh')] });
    h.fetches[0].reject(new Error('offline'));
    await assert.rejects(old, /offline/);
    assert.deepEqual((await h.hub.gateRuns()).runs.map(r => r.id), ['fresh']);
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('a failed fetch lets the next read try again; resubscribing drops a pending older fetch', async () => {
  const h = pendingHub(); const off = h.hub.followGates(() => {});
  const failed = h.hub.gateRuns(); h.fetches[0].reject(new Error('offline')); await assert.rejects(failed);
  const retry = h.hub.gateRuns(); assert.equal(h.fetches.length, 2);
  off(); h.hub.followGates(() => {});
  const fresh = h.hub.gateRuns(); assert.equal(h.fetches.length, 3);
  h.fetches[1].resolve({ sessionId: 's', runs: [run('stale')] }); await retry;
  h.fetches[2].resolve({ sessionId: 's', runs: [run('new')] }); await fresh;
  assert.deepEqual((await h.hub.gateRuns()).runs.map(r => r.id), ['new']);
});

test('a row keeps a live result that arrives before its snapshot', async () => {
  let listener; const d = deferred();
  const actions = { gateRuns: () => d.promise, followGates: cb => { listener = cb; return () => {}; }, setSessionGate: async () => [], openTab: () => {} };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(GateResults, { actions, anchor: { kind: 'tool', callId: 'c1' }, locale: 'en' })));
  await act(async () => listener({ type: 'run', run: run('live') }));
  await act(async () => d.resolve({ sessionId: 's', runs: [] }));
  assert.ok(host.querySelector('[data-gate-tail]'), 'the stale snapshot must not erase the live result');
  await act(async () => root.unmount()); host.remove();
});

test('the replay buffer keeps one frame per run and one session frame', async () => {
  const { bufferGateFrame } = await import('../src/pixie-gate-chat-node.ts');
  const frames = [];
  for (let i = 0; i < 50; i++) bufferGateFrame(frames, { type: 'run', run: run('a', { status: i < 49 ? 'running' : 'done' }) });
  bufferGateFrame(frames, { type: 'session', disabledGateIds: ['x'] }); bufferGateFrame(frames, { type: 'run', run: run('b') }); bufferGateFrame(frames, { type: 'session', disabledGateIds: [] });
  assert.deepEqual(frames.map(f => f.type === 'run' ? f.run.id + ':' + f.run.status : 'session:' + f.disabledGateIds.length), ['a:done', 'b:done', 'session:0']);
});
