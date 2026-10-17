/** Pixie tab › Loops: run list, detail, item attempts, interruption, and the store's heartbeat rule. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoopRunsPanel } from '../src/pixie-loop-runs.tsx';
import { PixieTab } from '../src/pixie-tab.tsx';
import { pixieDescriptors } from '../src/pixie-client.tsx';
import { PixieLoopStore, STALE_MS, throttledWriter } from '../src/host/pixie-loop-store.ts';
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const usage = { pixie: { inputTokens: 120, outputTokens: 40 }, judge: { inputTokens: 30, outputTokens: 6 } };
const loopRun = (extra = {}) => ({ id: 'r1', sessionId: 's', status: 'done', startedAt: 1_700_000_000_000, instruction: 'Translate UI strings to Korean.', total: 2, usage,
  checks: { questions: { ok: { type: 'noul', instructions: 'Is `output` faithful?' } }, pass: { ok: { min: 0.7 } } }, compiledBy: 'pixie', outputPath: 'work/done.jsonl',
  items: [
    { id: 'k1', status: 'passed', output: '저장', attempts: [{ output: '저장', codeFailures: [], answers: { ok: { type: 'noul', noul: 0.93 } }, passed: true }] },
    { id: 'k2', status: 'escalated', attempts: [
      { output: 'Close', codeFailures: [{ check: 'regex', message: 'output does not match /[가-힣]/' }], passed: false, feedback: 'Write it in **Korean**.' },
      { output: '클로즈', codeFailures: [], answers: { ok: { type: 'noul', noul: 0.31 } }, passed: false, feedback: 'Use 닫기.' }] },
  ], ...extra });
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text) || b.getAttribute('aria-label') === text);

async function mount(element) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(element));
  return { host, close: async () => act(async () => root.unmount()) };
}

test('loop runs show status, counts, checks, and per-item attempts with feedback marked as a guess', async () => {
  const { host, close } = await mount(React.createElement(LoopRunsPanel, { actions: { loopRuns: async () => ({ version: 1, runs: [loopRun()] }) }, locale: 'en' }));
  const text = host.textContent;
  assert.match(text, /Translate UI strings to Korean\./); assert.match(text, /Done/);
  assert.match(text, /2\/2 items/); assert.match(text, /passed 1 · escalated 1 · errors 0/);
  assert.match(text, /compiled by Pixie from the criteria/); assert.match(text, /Passes when: ≥ 0.7/);
  assert.match(text, /work\/done.jsonl/); assert.match(text, /Pixie 120\/40 · judge 30\/6 tokens/);
  await act(async () => button(host, 'k2').click());
  assert.match(host.textContent, /2 attempt\(s\)/); assert.match(host.textContent, /Attempt 2/); assert.match(host.textContent, /Did not pass/); assert.match(host.textContent, /regex: output does not match/);
  assert.match(host.textContent, /ok 0.31/); assert.match(host.textContent, /Pixie feedback \(a guess, not the verdict\)/);
  await close();
});

test('empty state, Korean copy, and the Pixie tab shows Loops only when the Remote exists', async () => {
  const empty = await mount(React.createElement(LoopRunsPanel, { actions: { loopRuns: async () => ({ version: 1, runs: [] }) }, locale: 'ko' }));
  assert.match(empty.host.textContent, /루프 실행 기록이 없습니다/);
  await empty.close();
  const base = { view: async () => ({ record: { threads: [] }, settings: {}, frames: [] }), follow: () => () => {}, gateRuns: async () => ({ sessionId: 's', runs: [] }), followGates: () => () => {}, resolveGateRejection: async () => {}, fillDraft() {} };
  const without = await mount(React.createElement(PixieTab, { actions: base, locale: 'en' }));
  assert.equal(button(without.host, 'Loops'), undefined);
  await without.close();
  const withLoops = await mount(React.createElement(PixieTab, { actions: { ...base, loopRuns: async () => ({ version: 1, runs: [loopRun({ status: 'running' })] }) }, locale: 'en' }));
  await act(async () => button(withLoops.host, 'Loops').click());
  assert.match(withLoops.host.textContent, /Running/);
  await withLoops.close();
  assert.ok(pixieDescriptors().some(item => item.method === 'loopRuns'));
});

test('act observations, selections, groups, and episode steps are shown', async () => {
  const run = loopRun({ mode: 'episode', total: 1, items: [{ id: 'g', status: 'passed', bucket: 'bug', attempts: [
    { output: 'heal', observation: '{"hp":3}', selection: { choice: 'heal', confidence: 0.81, probabilities: { heal: 0.81, wait: 0.19 } }, codeFailures: [], passed: false },
    { output: 'heal', observation: '{"hp":4}', codeFailures: [], passed: true }] }] });
  const { host, close } = await mount(React.createElement(LoopRunsPanel, { actions: { loopRuns: async () => ({ version: 1, runs: [run] }) }, locale: 'en' }));
  assert.match(host.textContent, /Groupsbug 1/); assert.match(host.textContent, /Episode/);
  await act(async () => host.querySelector('[data-loop-item="g"] button').click());
  assert.match(host.textContent, /Step 1/); assert.match(host.textContent, /Picked/); assert.match(host.textContent, /confidence 0.81/);
  assert.match(host.textContent, /Observation\{"hp":3\}/);
  await close();
});

test('store: put replaces by id, keeps retention, and marks silent active runs interrupted', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loop-store-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PixieLoopStore(dir);
  await store.put(loopRun({ status: 'running', items: [] }));
  await store.put(loopRun({ status: 'running' }));
  const live = await store.view('s');
  assert.equal(live.runs.length, 1); assert.equal(live.runs[0].status, 'running');
  const stale = await store.view('s', Date.now() + STALE_MS + 1);
  assert.equal(stale.runs[0].status, 'cancelled'); assert.match(stale.runs[0].reason, /Interrupted/);
  for (let index = 0; index < 55; index++) await store.put(loopRun({ id: `x${index}` }));
  assert.equal((await store.read('s')).runs.length, 50);
  assert.deepEqual(await store.prune(async () => [{ sessionId: 'other' }]), ['s']);
});

test('the throttled writer coalesces updates and flushes the last one', async () => {
  const writes = [];
  const writer = throttledWriter(async run => { writes.push(run.status); }, 20, () => {}, 1_000_000);
  writer.update({ status: 'compiling' }); writer.update({ status: 'running' });
  await writer.flush();
  assert.deepEqual(writes, ['running']);
});
