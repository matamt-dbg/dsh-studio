import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { missingFeatures } from '../src/host/preset-store.ts';
import { masterComposition } from '../src/host/master-composition.ts';
import { dump } from 'js-yaml';

async function mount(element) {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(element));
  return { root, dom, rerender: next => act(async () => root.render(next)), close: async () => { await act(async () => root.unmount()); dom.window.close(); } };
}
const entries = [
  { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
  { id: 'delegation/studio-master-roles', name: '@matamt-dbg/dsh-studio/roles' },
  { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
  { id: 'compaction/compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', config: {} },
  { id: 'compaction/command-compact', name: '@deepseek-ai/dsh-command-compact' },
];

test('plugin list uses the searchable picker: every Master entry except delegation, states and dependencies', async () => {
  const { FeatureInclusion } = await import('../src/feature-inclusion.tsx');
  let state = { overrides: { 'compaction/compaction-basic': { auto: false } }, excluded: [] };
  const render = () => React.createElement(FeatureInclusion, { locale: 'en', entries, overrides: state.overrides, excluded: state.excluded, onChange: next => { state = next; } });
  const view = await mount(render());
  try {
    const rows = () => [...document.querySelectorAll('ul[aria-label="Included plugins"] .studio-picker-row')].map(row => row.textContent);
    assert.ok(document.querySelector('input[type=search][aria-label="Search plugins"]'));
    assert.deepEqual([...document.querySelectorAll('[role=radiogroup] [role=radio]')].map(b => b.textContent), ['All4', 'Included4']);
    assert.equal(rows().length, 4, 'tool providers are listed too; delegation plugins are not');
    assert.match(rows()[0], /@deepseek-ai\/dsh-tool-fs.*Defaults/);
    assert.match(rows()[1], /Current time notice.*Defaults/);
    assert.match(rows()[2], /Automatic compaction.*Automatic compaction off \(auto: false\).*Override/);
    // auto:false is not exclusion: /compact stays included.
    assert.match(rows()[3], /Manual compaction.*Defaults/);
    const toggle = label => document.querySelector(`button[role=switch][aria-label="${label}"]`);
    await act(async () => toggle('Automatic compaction').click());
    assert.deepEqual(state, { overrides: {}, excluded: ['compaction/compaction-basic'] }, 'exclusion drops the override');
    await view.rerender(render());
    assert.match(rows()[3], /Excluded with dependency · Requires: Automatic compaction/);
    assert.equal(toggle('Manual compaction (/compact)').disabled, true);
    await act(async () => toggle('Automatic compaction').click());
    assert.deepEqual(state, { overrides: {}, excluded: [] }, 'turning it back on returns to defaults');
    // Search narrows the same list.
    const { Simulate } = await import('react-dom/test-utils');
    await act(async () => Simulate.change(document.querySelector('input[type=search]'), { target: { value: 'compact' } }));
    assert.equal(rows().length, 2);
  } finally { await view.close(); }
});

test('execution settings no longer add plugins by name; Studio-added ones can still be removed and show their origin (#38 D3)', async () => {
  const { FeatureInclusion } = await import('../src/feature-inclusion.tsx');
  const calls = [];
  const actions = { remove: async id => { calls.push(['remove', id]); } };
  const view = await mount(React.createElement(FeatureInclusion, { locale: 'en', entries: [...entries, { id: 'studio-added/x', name: 'x-plugin' }], overrides: {}, excluded: [], onChange() {},
    origins: { 'tool-fs': 'standard', 'time-context': 'standard', 'studio-added/x': 'added' }, added: [{ id: 'studio-added/x', name: 'x-plugin' }], actions }));
  try {
    const rows = [...document.querySelectorAll('.studio-picker-row')].map(row => row.textContent);
    assert.match(rows[0], /tool-fs.*standard/); assert.match(rows.at(-1), /x-plugin.*Added/);
    assert.equal([...document.querySelectorAll('button')].some(b => b.textContent === 'Add plugin'), false);
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Plugins added by Studio').click());
    const dialog = document.querySelector('dialog[open]');
    assert.equal(dialog.querySelector('input'), null, 'no add-by-name input');
    assert.match(dialog.textContent, /Studio → Plugins/);
    await act(async () => [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Remove').click());
    assert.deepEqual(calls, [['remove', 'x']]);
  } finally { await view.close(); }
  const empty = await mount(React.createElement(FeatureInclusion, { locale: 'en', entries, overrides: {}, excluded: [], onChange() {}, added: [], actions }));
  try { assert.equal([...document.querySelectorAll('button')].some(b => b.textContent === 'Plugins added by Studio'), false, 'nothing to manage without additions'); }
  finally { await empty.close(); }
});

test('missing features are detected only for applied snapshots that lack a non-excluded feature', () => {
  const full = dump(masterComposition());
  const legacy = dump(masterComposition().filter(row => !['agent-instructions', 'time-context', 'compaction', 'skill-filesystem'].includes(row.id)));
  const request = { preset: 'studio-master', providers: ['@deepseek-ai/dsh-persona'], tools: [], prompt: '', model: 'x' };
  assert.deepEqual(missingFeatures({ request, applied: { name: 'a', description: '', plugins: full } }), []);
  assert.deepEqual(missingFeatures({ request, applied: { name: 'a', description: '', plugins: legacy } }).sort(),
    ['@deepseek-ai/dsh-agent-instructions', '@deepseek-ai/dsh-command-compact', '@deepseek-ai/dsh-compaction-basic', '@deepseek-ai/dsh-compaction-tool-result-pruner', '@deepseek-ai/dsh-skill-filesystem', '@deepseek-ai/dsh-time-context']);
  // An explicit exclusion is intent, not a gap; its dependant follows.
  assert.deepEqual(missingFeatures({ request: { ...request, configExclusions: ['compaction/compaction-basic', 'time-context', 'agent-instructions', 'skill-filesystem', 'compaction/tool-result-pruner'] }, applied: { name: 'a', description: '', plugins: legacy } }), []);
  assert.deepEqual(missingFeatures({ request }), [], 'drafts have nothing applied to compare');
  // Compared against the running Master: a feature that standard does not declare is not missing.
  const withoutTime = masterComposition().filter(row => row.id !== 'time-context');
  assert.deepEqual(missingFeatures({ request, applied: { name: 'a', description: '', plugins: dump(withoutTime) } }, withoutTime), []);
});

test('preset list offers restore for missing features and reapplies only after confirmation', async () => {
  const { PresetList } = await import('../src/preset-manager.tsx');
  const preset = { id: 'studio-user-a', name: 'Creator', description: '', status: 'applied', agents: [], conveniences: {}, missingFeatures: ['@deepseek-ai/dsh-compaction-basic'],
    request: { preset: 'studio-master', providers: [], tools: [], prompt: '', model: 'x' } };
  const applied = [];
  const api = { list: async () => [preset], save: async () => preset, apply: async id => { applied.push(id); return preset; }, delete: async () => {} };
  const view = await mount(React.createElement(PresetList, { locale: 'en', api, revision: 0 }));
  try {
    await act(async () => {});
    assert.match(document.querySelector('.studio-preset-card').textContent, /Missing features.*Automatic compaction/);
    const click = async text => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === text).click());
    await click('Restore');
    assert.deepEqual(applied, [], 'nothing changes before confirmation');
    assert.match(document.querySelector('dialog[open]').textContent, /\+ Automatic compaction/);
    await click('Restore and reapply');
    assert.deepEqual(applied, ['studio-user-a']);
  } finally { await view.close(); }
});

test('catalog change notice lists +/-/~ and the cleanup, and cleans only on confirm', async () => {
  const { CatalogChangeNotice } = await import('../src/master-change-notice.tsx');
  const change = { added: { tools: ['image_generate'], configs: [] }, removed: { tools: ['x_search'], configs: ['extra'] }, changed: { tools: ['bash'] },
    cleanup: [{ id: 'studio-user-a', name: 'Mine', tools: ['x_search'], configs: ['extra'] }] };
  let confirmed = 0, refreshed = 0;
  const actions = { read: async () => change, confirm: async () => { confirmed++; return { cleaned: 1 }; } };
  const view = await mount(React.createElement(CatalogChangeNotice, { actions, locale: 'en', onConfirmed: () => refreshed++ }));
  try {
    await act(async () => {});
    const click = async text => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === text).click());
    await click('Review');
    const text = document.querySelector('dialog[open]').textContent;
    assert.match(text, /\+ image_generate/); assert.match(text, /- x_search/); assert.match(text, /- extra/); assert.match(text, /~ bash/);
    assert.match(text, /Mine.*x_search, extra/);
    await click('Later');
    assert.equal(confirmed, 0); assert.ok(document.querySelector('[role=status]'), 'the notice stays until confirmed');
    await click('Review'); await click('Confirm and clean');
    assert.equal(confirmed, 1); assert.equal(refreshed, 1);
    assert.equal(document.querySelector('[role=status]'), null);
  } finally { await view.close(); }
});
