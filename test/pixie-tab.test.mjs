/** Pixie tab: thread overview, open thread, streaming answer, cancel, and the judge trial, rendered with fake actions. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { PixieTab } from '../src/pixie-tab.tsx';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const model = { provider: 'p', model: 'm' };
const settings = { model, contextMode: 'fresh', systemPrompt: '', allowThreadModel: true };
const thread = (id, title, turns = []) => ({ id, title, mode: 'fresh', model, forked: [], turns, createdAt: 1 });
const done = { id: 't1', question: 'what?', answer: 'that.', status: 'done', model, startedAt: 1, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, reasoningTokens: 5 } };

function fakeActions(view) {
  const calls = [];
  let push;
  return {
    calls,
    emit: frame => push?.(frame),
    actions: {
      view: async () => structuredClone(view),
      follow: listener => { push = listener; return () => { push = undefined; }; },
      ask: async (question, threadId) => { calls.push(['ask', question, threadId]); return { threadId, turnId: 'new' }; },
      cancel: async () => { calls.push(['cancel']); return true; },
      createThread: async options => { calls.push(['createThread', options]); return thread('t9', 'Thread 9'); },
      activate: async id => { calls.push(['activate', id]); return true; },
      deleteThread: async id => { calls.push(['deleteThread', id]); return true; },
      models: async () => ({ groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }] }] }),
      judge: async request => { calls.push(['judge', request]); return { ok: true, answers: { clear: { type: 'noul', noul: 0.7 } } }; },
    },
  };
}
async function render(element) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { host, root };
}
const button = (host, name) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === name || b.getAttribute('aria-label') === name);
const type = async (el, value) => {
  const { Simulate } = await import('react-dom/test-utils');
  await act(async () => { el.value = value; Simulate.change(el); });
};

test('shows every thread at a glance with the open conversation and no usage text', async () => {
  const view = { record: { sessionId: 's1', activeThreadId: 'a', threads: [thread('a', 'Thread 1', [done]), thread('b', 'Thread 2')] }, total: { requests: 1, inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0, reasoningTokens: 5 }, running: false, frames: [], settings, contextWindow: 1000 };
  const { host } = await render(React.createElement(PixieTab, { locale: 'en', actions: fakeActions(view).actions }));
  const cards = [...host.querySelectorAll('.studio-pixie-thread')];
  // Newest first; each card shows its last question or an empty state, and the /pixie target.
  assert.deepEqual(cards.map(card => card.querySelector('strong').textContent), ['Thread 2', 'Thread 1']);
  assert.match(cards[1].textContent, /what\?/);
  // The /pixie target is a pin icon on the card, not a text badge; the context origin is meta text.
  assert.equal(cards[1].querySelector('[role=img]').getAttribute('aria-label'), '/pixie sends here');
  assert.equal(cards[0].querySelector('[role=img]'), null);
  assert.match(cards[1].textContent, /Empty start/);
  assert.equal(host.querySelector('.studio-pixie-detail-head [aria-pressed=true]').getAttribute('aria-label'), '/pixie sends here');
  assert.match(cards[0].textContent, /No questions yet/);
  assert.equal(cards[1].getAttribute('aria-current'), 'true');
  assert.match(host.querySelector('.studio-pixie-detail').textContent, /that\./);
  assert.doesNotMatch(host.textContent, /In 100|Out 20|Session total|Context|1,000/);
  assert.equal(host.querySelector('.studio-pixie-total'), null);
});

test('asking streams the answer and the running request can be cancelled', async () => {
  const view = { record: { sessionId: 's1', activeThreadId: 'a', threads: [thread('a', 'Thread 1')] }, total: { requests: 0, inputTokens: 0, outputTokens: 0 }, running: false, frames: [], settings };
  const fake = fakeActions(view);
  const { host } = await render(React.createElement(PixieTab, { locale: 'en', actions: fake.actions }));
  await type(host.querySelector('textarea'), 'explain');
  await act(async () => { button(host, 'Ask').click(); });
  assert.deepEqual(fake.calls[0], ['ask', 'explain', 'a']);
  await act(async () => { fake.emit({ type: 'start', threadId: 'a', turnId: 'new', question: 'explain' }); fake.emit({ type: 'text', text: 'stream' }); fake.emit({ type: 'text', text: 'ing' }); });
  assert.match(host.textContent, /explain/);
  assert.match(host.textContent, /streaming/);
  assert.match(host.textContent, /Answering/);
  await act(async () => { button(host, 'Cancel').click(); });
  assert.deepEqual(fake.calls.at(-1), ['cancel']);
});

test('opening, targeting, creating, and deleting threads call the service', async () => {
  const view = { record: { sessionId: 's1', activeThreadId: 'a', threads: [thread('a', 'Thread 1'), thread('b', 'Thread 2')] }, total: { requests: 0, inputTokens: 0, outputTokens: 0 }, running: false, frames: [], settings };
  const fake = fakeActions(view);
  const { host } = await render(React.createElement(PixieTab, { locale: 'en', actions: fake.actions }));
  const card = name => [...host.querySelectorAll('.studio-pixie-thread')].find(item => item.querySelector('strong').textContent === name);
  // Opening a thread only shows it; it does not change the /pixie target.
  await act(async () => { card('Thread 2').click(); });
  assert.equal(card('Thread 2').getAttribute('aria-current'), 'true');
  assert.equal(host.querySelector('.studio-pixie-threads').dataset.open, 'true');
  assert.equal(fake.calls.length, 0);
  await type(host.querySelector('textarea'), 'here');
  await act(async () => { button(host, 'Ask').click(); });
  assert.deepEqual(fake.calls.at(-1), ['ask', 'here', 'b']);
  await act(async () => { button(host, 'Send /pixie here').click(); });
  assert.deepEqual(fake.calls.at(-1), ['activate', 'b']);
  // The pressed pin of the current target does nothing.
  const callsBefore = fake.calls.length;
  await act(async () => { card('Thread 1').click(); });
  await act(async () => { button(host, '/pixie sends here').click(); });
  assert.equal(fake.calls.length, callsBefore);
  await act(async () => { card('Thread 2').click(); });
  await act(async () => { button(host, 'New thread').click(); });
  const fork = [...host.querySelectorAll('[role=radio]')].find(item => item.textContent === 'Continue');
  await act(async () => { fork.click(); });
  await act(async () => { button(host, 'Create').click(); });
  assert.deepEqual(fake.calls.find(call => call[0] === 'createThread'), ['createThread', { mode: 'fork' }]);
  await act(async () => { card('Thread 1').click(); });
  await act(async () => { button(host, 'Delete thread').click(); });
  assert.deepEqual(fake.calls.at(-1), ['deleteThread', 'a']);
});

test('without a configured model the tab says so and offers no ask', async () => {
  const view = { record: { sessionId: 's1', threads: [] }, total: { requests: 0, inputTokens: 0, outputTokens: 0 }, running: false, frames: [], settings: { ...settings, model: undefined } };
  const { host } = await render(React.createElement(PixieTab, { locale: 'en', actions: fakeActions(view).actions }));
  assert.match(host.textContent, /Studio/);
  assert.equal(button(host, 'Ask'), undefined);
});

test('the Pixie tab has threads and gate runs, with no judge tab', async () => {
  const view = { record: { sessionId: 's1', threads: [] }, total: { requests: 0, inputTokens: 0, outputTokens: 0 }, running: false, frames: [], settings };
  const fake = fakeActions(view);
  const { host } = await render(React.createElement(PixieTab, { locale: 'en', actions: fake.actions }));
  assert.deepEqual([...host.querySelectorAll('[role=tab]')].map(tab => tab.textContent), ['Threads', 'Gates']);
  assert.equal(button(host, 'Judge'), undefined);
});

test('settings page saves the chosen model, effort, and mode', async () => {
  const { PixieSettingsPage } = await import('../src/pixie-settings.tsx');
  const saved = [];
  const actions = {
    read: async () => ({ contextMode: 'fresh', systemPrompt: 'S', allowThreadModel: true }),
    save: async value => { saved.push(value); return value; },
    models: async () => ({ groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] }], failures: [] }),
  };
  const { host } = await render(React.createElement(PixieSettingsPage, { actions, locale: 'en', navFooter: React.createElement('span', { className: 'footer' }, 'v1') }));
  const { Simulate } = await import('react-dom/test-utils');
  // Same frame as the preset service: grouped left menu, pages, and the shared footer; no service title.
  assert.deepEqual([...host.querySelectorAll('nav.studio-nav .studio-nav-item')].map(item => item.textContent), ['Model', 'Threads', 'System prompt']);
  assert.ok(host.querySelector('nav.studio-nav .footer'));
  assert.equal(host.querySelector('.studio-nav-title'), null);
  const saveButton = () => [...host.querySelectorAll('section:not([hidden]) button.studio-primary')][0];
  // Nothing to save until something changes.
  assert.equal(saveButton().disabled, true);
  const [modelSelect] = host.querySelectorAll('select');
  await act(async () => { modelSelect.value = 'p\u0000m'; Simulate.change(modelSelect); });
  assert.equal(saveButton().disabled, false);
  assert.doesNotMatch(host.textContent, /unsaved changes/);
  const effort = host.querySelectorAll('select')[1];
  await act(async () => { effort.value = 'high'; Simulate.change(effort); });
  await act(async () => { [...host.querySelectorAll('nav.studio-nav .studio-nav-item')][1].click(); });
  const fork = [...host.querySelectorAll('[role=radio]')].find(item => item.textContent === 'Continue');
  await act(async () => { fork.click(); });
  assert.equal(fork.getAttribute('aria-checked'), 'true');
  const toggle = host.querySelector('[role=switch]');
  await act(async () => { toggle.click(); });
  await act(async () => { toggle.click(); });
  await act(async () => { [...host.querySelectorAll('section:not([hidden]) button')].find(b => b.textContent === 'Save').click(); });
  assert.deepEqual(saved[0], { contextMode: 'fork', systemPrompt: 'S', allowThreadModel: true, model: { provider: 'p', model: 'm', reasoningEffort: 'high' } });
  // The button itself confirms the save; no extra notice line.
  assert.doesNotMatch(host.textContent, /unsaved changes|New Pixie requests/);
  assert.equal(saveButton().textContent, 'Saved');
  assert.equal(saveButton().disabled, true);
});

test('a failed settings save keeps the edits and says so', async () => {
  const { PixieSettingsPage } = await import('../src/pixie-settings.tsx');
  const actions = {
    read: async () => ({ contextMode: 'fresh', systemPrompt: 'S', allowThreadModel: true }),
    save: async () => { throw new Error('disk full'); },
    models: async () => ({ groups: [], failures: [] }),
  };
  const { host } = await render(React.createElement(PixieSettingsPage, { actions, locale: 'en' }));
  await act(async () => { [...host.querySelectorAll('nav.studio-nav .studio-nav-item')][2].click(); });
  await type(host.querySelector('textarea'), 'New prompt');
  await act(async () => { [...host.querySelectorAll('section:not([hidden]) button.studio-primary')][0].click(); });
  assert.match(host.textContent, /Could not save Pixie settings\. Your edits remain on this screen\. \(disk full\)/);
  assert.equal(host.querySelector('textarea').value, 'New prompt');
  assert.equal([...host.querySelectorAll('section:not([hidden]) button.studio-primary')][0].disabled, false);
});

test('the /pixie row streams its own answer, ignores other requests, and opens the tab', async () => {
  const { PixieCommandRow } = await import('../src/pixie-tab.tsx');
  let opened = 0;
  let push;
  // The command returns after its turn is written, so the row first sees a streaming turn.
  let recorded = { ...done, id: 't', question: 'why?', answer: '', status: 'streaming', usage: undefined, commandId: 'c1' };
  const actions = { commandId: 'c1', commandTurn: async () => recorded, follow: listener => { push = listener; return () => {}; } };
  const { host } = await render(React.createElement(PixieCommandRow, { question: 'why?', outcome: { kind: 'success', text: 'Asked Pixie · Thread 1' }, locale: 'en', onOpen: () => { opened++; }, actions }));
  assert.match(host.textContent, /why\?/);
  assert.match(host.textContent, /answering/);
  await act(async () => { push({ type: 'start', threadId: 'a', turnId: 'o', question: 'other', commandId: 'c2' }); push({ type: 'text', text: 'NOT MINE' }); push({ type: 'end', status: 'done' }); });
  assert.doesNotMatch(host.textContent, /NOT MINE/);
  await act(async () => { push({ type: 'start', threadId: 'a', turnId: 't', question: 'why?', commandId: 'c1' }); push({ type: 'text', text: 'because' }); });
  assert.match(host.textContent, /because/);
  recorded = { ...done, id: 't', question: 'why?', answer: 'because.', commandId: 'c1' };
  await act(async () => { push({ type: 'end', status: 'done' }); await new Promise(r => setTimeout(r, 0)); });
  assert.match(host.textContent, /because\./);
  assert.doesNotMatch(host.textContent, /In 100|Out 20|Not in the agent/);
  await act(async () => { button(host, 'Open Pixie').click(); });
  assert.equal(opened, 1);
});

test('a /pixie row mounted after start reloads its completed answer without navigation', async () => {
  const { PixieCommandRow } = await import('../src/pixie-tab.tsx');
  let push;
  let recorded = { ...done, commandId: 'late', answer: '', status: 'streaming', usage: undefined };
  const actions = { commandId: 'late', commandTurn: async () => structuredClone(recorded), follow: listener => { push = listener; return () => {}; } };
  const { host, root } = await render(React.createElement(PixieCommandRow, { question: 'what?', outcome: { kind: 'success' }, locale: 'en', onOpen: () => {}, actions }));
  assert.match(host.textContent, /answering/);
  // Host follow does not replay start frames emitted before subscription.
  await act(async () => {
    push({ type: 'text', text: 'that.' });
    recorded = { ...done, commandId: 'late' };
    push({ type: 'end', status: 'done' });
  });
  assert.match(host.textContent, /that\./);
  assert.doesNotMatch(host.textContent, /answering/);
  await act(async () => root.unmount());
});

test('a /pixie row resets replay text and recovers completion on reconnect', async () => {
  const { PixieCommandRow } = await import('../src/pixie-tab.tsx');
  let push;
  let recorded = { ...done, commandId: 'c', status: 'streaming', answer: '' };
  const actions = { commandId: 'c', commandTurn: async () => structuredClone(recorded), follow: listener => { push = listener; return () => {}; } };
  const { host, root } = await render(React.createElement(PixieCommandRow, { question: 'what?', outcome: { kind: 'success' }, locale: 'en', onOpen: () => {}, actions }));
  const replay = () => { push({ type: 'sync' }); push({ type: 'start', threadId: 'a', turnId: 't1', commandId: 'c', question: 'what?' }); push({ type: 'text', text: 'partial' }); };
  await act(async () => replay());
  await act(async () => replay());
  assert.equal(host.querySelector('.studio-pixie-answer').textContent, 'partial');
  recorded = { ...done, commandId: 'c', answer: 'finished offline' };
  await act(async () => push({ type: 'sync' }));
  assert.match(host.textContent, /finished offline/);
  assert.doesNotMatch(host.textContent, /partial|answering/);
  await act(async () => root.unmount());
});

test('a request started by /pixie streams under its own question, and coded Host errors are localized', async () => {
  const view = { record: { sessionId: 's1', activeThreadId: 'a', threads: [thread('a', 'Thread 1', [{ ...done, id: 'x', status: 'error', answer: '', error: '[pixie/no-model] No Pixie model is configured' }])] }, total: { requests: 0, inputTokens: 0, outputTokens: 0 }, running: false, frames: [], settings };
  const fake = fakeActions(view);
  const { host } = await render(React.createElement(PixieTab, { locale: 'ko', actions: fake.actions }));
  assert.match(host.textContent, /Pixie 모델이 설정되지 않았습니다/);
  assert.doesNotMatch(host.textContent, /\[pixie\//);
  await act(async () => { fake.emit({ type: 'start', threadId: 'a', turnId: 'cmd', question: 'from the command' }); fake.emit({ type: 'text', text: 'ok' }); });
  assert.match(host.textContent, /from the command/);
});

test('a truncated answer is labeled', async () => {
  const view = { record: { sessionId: 's1', activeThreadId: 'a', threads: [thread('a', 'Thread 1', [{ ...done, truncated: true }])] }, total: { requests: 0, inputTokens: 0, outputTokens: 0 }, running: false, frames: [], settings };
  const { host } = await render(React.createElement(PixieTab, { locale: 'en', actions: fakeActions(view).actions }));
  assert.match(host.textContent, /token limit/);
});

test('a /pixie row with no linked answer points to the tab instead of waiting', async () => {
  const { PixieCommandRow } = await import('../src/pixie-tab.tsx');
  const actions = { commandId: 'old', commandTurn: async () => null, follow: () => () => {} };
  const { host } = await render(React.createElement(PixieCommandRow, { question: 'old', outcome: { kind: 'success' }, locale: 'en', onOpen: () => {}, actions }));
  assert.match(host.textContent, /answer is in the Pixie tab/);
  assert.doesNotMatch(host.textContent, /answering/);
});

test('with a Markdown renderer, answers render through it and stream while a request is live', async () => {
  const { MarkdownProvider } = await import('../src/ui.tsx');
  const seen = [];
  const Render = ({ text, streaming }) => { seen.push([text, streaming]); return React.createElement('em', null, text); };
  const view = { record: { sessionId: 's1', activeThreadId: 'a', threads: [thread('a', 'Thread 1', [done])] }, total: { requests: 1, inputTokens: 0, outputTokens: 0 }, running: false, frames: [], settings };
  const fake = fakeActions(view);
  const { host } = await render(React.createElement(MarkdownProvider, { value: Render }, React.createElement(PixieTab, { locale: 'en', actions: fake.actions })));
  assert.ok(seen.some(([text, streaming]) => text === 'that.' && streaming === false));
  assert.equal(host.querySelector('.studio-pixie-question').tagName, 'P');
  await type(host.querySelector('textarea'), 'explain');
  await act(async () => { button(host, 'Ask').click(); });
  await act(async () => { fake.emit({ type: 'start', threadId: 'a', turnId: 'new', question: 'explain' }); fake.emit({ type: 'text', text: '**bo' }); });
  assert.deepEqual(seen.at(-1), ['**bo', true]);
});
