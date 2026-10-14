/** UX-02: loading, empty, load failure, and action failure stay distinguishable in the preset list. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { PresetList } from '../src/preset-manager.tsx';

const preset = (id, status = 'draft') => ({ id, name: `Preset ${id}`, description: '', status, request: { tools: [] }, agents: [] });
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };

async function mount(api) {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const render = async (revision = 0) => act(async () => root.render(React.createElement(PresetList, { locale: 'en', api, revision })));
  await render();
  const text = () => document.getElementById('root').textContent;
  const alerts = () => [...document.querySelectorAll('[role=alert]')].map(node => node.textContent);
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
  const click = async label => act(async () => button(label).click());
  const close = async () => { await act(async () => root.unmount()); dom.window.close(); };
  return { render, text, alerts, button, click, close };
}

test('loading shows progress and neither the empty state nor an error', async () => {
  const pending = deferred();
  const view = await mount({ list: () => pending.promise });
  try {
    assert.match(view.text(), /Loading presets…/);
    assert.doesNotMatch(view.text(), /No saved presets/);
    assert.deepEqual(view.alerts(), []);
    await act(async () => pending.resolve([]));
    assert.doesNotMatch(view.text(), /Loading presets/);
    assert.match(view.text(), /No saved presets/);
  } finally { await view.close(); }
});

test('load failure shows a retryable alert without the empty-state prompt', async () => {
  let fail = true;
  const view = await mount({ list: async () => { if (fail) throw new Error('Host API 404'); return [preset('a')]; } });
  try {
    assert.equal(view.alerts().length, 1);
    assert.match(view.alerts()[0], /Could not load presets\. Saved presets were not changed\. \(Host API 404\)/);
    assert.doesNotMatch(view.text(), /No saved presets/);
    fail = false;
    await view.click('Retry');
    assert.deepEqual(view.alerts(), []);
    assert.match(view.text(), /Preset a/);
  } finally { await view.close(); }
});

test('a failed reload keeps the last loaded list visible', async () => {
  let fail = false;
  const view = await mount({ list: async () => { if (fail) throw new Error('offline'); return [preset('a'), preset('b')]; } });
  try {
    fail = true;
    await view.click('Refresh');
    assert.match(view.alerts()[0], /Showing the last loaded list/);
    assert.match(view.text(), /Preset a/); assert.match(view.text(), /Preset b/);
  } finally { await view.close(); }
});

test('a stale list response never overwrites a newer one', async () => {
  const first = deferred(), second = deferred();
  const queue = [first, second];
  const view = await mount({ list: () => queue.shift().promise });
  try {
    await view.render(1);
    await act(async () => second.resolve([preset('new')]));
    await act(async () => first.resolve([preset('old')]));
    assert.match(view.text(), /Preset new/);
    assert.doesNotMatch(view.text(), /Preset old/);
  } finally { await view.close(); }
});

test('apply shows progress, blocks duplicate actions, and reports failure with the kept state', async () => {
  const apply = deferred();
  let calls = 0;
  const view = await mount({ list: async () => [preset('a', 'applied'), preset('b')], apply: () => { calls++; return apply.promise; }, unapply: async () => {}, delete: async () => {} });
  try {
    await view.click('Reapply to DSH');
    assert.ok(view.button('Applying…'));
    assert.ok(view.button('Apply to DSH').disabled, 'other actions are disabled while one runs');
    assert.ok(view.button('Refresh').disabled);
    await act(async () => view.button('Applying…').click());
    assert.equal(calls, 1);
    await act(async () => apply.reject(new Error('NO_ADAPTER')));
    assert.match(view.alerts()[0], /Could not apply Preset a\. A previously applied configuration stays in effect\. \(NO_ADAPTER\)/);
    assert.equal(view.button('Apply to DSH').disabled, false, 'a reported failure does not lock the list');
    await view.click('Dismiss');
    assert.deepEqual(view.alerts(), []);
  } finally { await view.close(); }
});

test('delete failure closes the dialog and states the preset was not deleted', async () => {
  const view = await mount({ list: async () => [preset('a')], apply: async () => {}, delete: async () => { throw new Error('locked'); } });
  try {
    await view.click('Delete');
    assert.ok(document.querySelector('dialog[open]'));
    await view.click('Confirm delete');
    assert.equal(document.querySelector('dialog[open]'), null);
    assert.match(view.alerts()[0], /Could not delete Preset a\. The preset was not deleted\. \(locked\)/);
    assert.match(view.text(), /Preset a/);
  } finally { await view.close(); }
});

test('a shared apply warning appears once above the cards, not inside each card', async () => {
  const warn = 'Settings are saved but not applied yet.';
  const view = await mount({ list: async () => [{ ...preset('a', 'applied'), applyWarning: warn }, { ...preset('b', 'applied'), applyWarning: warn }, preset('c')], apply: async () => {}, delete: async () => {} });
  try {
    const notices = [...document.querySelectorAll('.studio-preset-warnings > li')];
    assert.equal(notices.length, 1);
    assert.match(notices[0].textContent, /Affects: Preset a, Preset b/);
    assert.equal([...document.querySelectorAll('article.studio-preset-card')].filter(card => card.textContent.includes(warn)).length, 0);
  } finally { await view.close(); }
});

test('user presets offer edit, copy and delete so a copy can be copied again', async () => {
  let copied;
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(PresetList, { locale: 'en', revision: 0, api: { list: async () => [preset('copy')], apply: async () => {}, delete: async () => {} }, onEdit: () => {}, onCopy: value => { copied = value; } })));
    const buttons = [...document.querySelectorAll('article button')].filter(button => !button.closest('.studio-split'));
    assert.deepEqual(buttons.map(button => [button.textContent, button.disabled]), [['Edit', false], ['Create copy', false], ['Delete', false]]);
    await act(async () => buttons[1].click());
    assert.equal(copied.id, 'copy');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('a missing Host API is reported instead of an empty list', async () => {
  const view = await mount(undefined);
  try {
    assert.match(view.alerts()[0], /Studio Host API is not connected/);
    assert.doesNotMatch(view.text(), /No saved presets|Loading presets/);
  } finally { await view.close(); }
});

test('save failure keeps the draft and blocks a duplicate save while pending', async () => {
  const { OptimizationPrototype } = await import('../src/optimization-prototype.tsx');
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const { Simulate } = await import('react-dom/test-utils');
  const root = createRoot(document.getElementById('root'));
  const pending = deferred();
  let calls = 0;
  const api = { list: async () => [], save: () => { calls++; return pending.promise; }, apply: async () => {}, delete: async () => {} };
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
  try {
    await act(async () => root.render(React.createElement(OptimizationPrototype, { locale: 'en', presetActions: api, catalog: { presets: [{ id: 'minimal', tools: [], sections: [], promptProviders: [] }], tools: [] } })));
    await act(async () => button('Create preset').click());
    const name = [...document.querySelectorAll('label')].find(node => node.textContent === 'Preset name').querySelector('input');
    await act(async () => Simulate.change(name, { target: { value: 'Kept' } }));
    await act(async () => button('Save preset').click());
    assert.ok(button('Saving…').disabled);
    await act(async () => button('Saving…').click());
    assert.equal(calls, 1);
    await act(async () => pending.reject(new Error('disk full')));
    const alert = [...document.querySelectorAll('[role=alert]')].map(node => node.textContent).join();
    assert.match(alert, /Could not save the preset\. Your edits remain on this screen\. \(disk full\)/);
    assert.equal(name.value, 'Kept');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('apply and unapply share one split control; unapply lives in its menu', async () => {
  let unapplied;
  const view = await mount({ list: async () => [preset('a', 'applied'), preset('b')], apply: async () => {}, unapply: async id => { unapplied = id; }, delete: async () => {} });
  try {
    assert.equal(view.button('Unapply from DSH'), undefined, 'unapply is not a separate card button');
    const carets = [...document.querySelectorAll('button[aria-label="Apply options"]')];
    assert.equal(carets.length, 1, 'only applied presets offer the unapply menu');
    await act(async () => carets[0].click());
    assert.equal(document.querySelector('[role=menu]').textContent, 'Unapply from DSH');
    await act(async () => document.querySelector('[role=menuitem]').click());
    assert.equal(unapplied, 'a');
    assert.equal(document.querySelector('[role=menu]'), null);
  } finally { await view.close(); }
});
