import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { OptimizationPrototype } from '../src/optimization-prototype.tsx';

test('preset creation keeps tab drafts together and list applies/deletes owned presets', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { createRoot } = await import('react-dom/client');
  const { Simulate } = await import('react-dom/test-utils');
  const root = createRoot(document.getElementById('root'));
  let saved, applied, removed;
  let rows = [];
  const api = { list: async () => rows, save: async payload => { saved = { ...JSON.parse(payload), id: 'studio-user-test', status: 'draft' }; rows = [saved]; return saved; }, apply: async id => { applied = id; return saved; }, delete: async id => { removed = id; rows = []; } };
  const click = async text => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === text).click());
  try {
    await act(async () => root.render(React.createElement(OptimizationPrototype, { locale: 'en', presetActions: api, catalog: { presets: [{ id: 'minimal', tools: [], sections: [], promptProviders: [] }], tools: [] } })));
    assert.deepEqual([...document.querySelectorAll('nav button')].map(b => b.textContent), ['Preset list', 'Create preset', 'Tool providers']);
    assert.deepEqual([...document.querySelectorAll('[role=tab]')].map(b => b.textContent), ['Prompts & tools', 'Execution settings', 'Subagent settings']);
    await click('Create preset');
    const name = [...document.querySelectorAll('label')].find(e => e.textContent === 'Preset name').querySelector('input');
    await act(async () => Simulate.change(name, { target: { value: 'My preset' } }));
    const prompt = [...document.querySelectorAll('textarea')].find(e => e.value.includes('Report evidence'));
    await act(async () => Simulate.change(prompt, { target: { value: 'My instructions' } }));
    await click('Execution settings'); await click('Subagent settings'); await click('Prompts & tools');
    assert.equal(prompt.value, 'My instructions');
    await click('Save preset');
    assert.equal(saved.request.prompt, 'My instructions');
    assert.ok(saved.conveniences); assert.equal(saved.agents.length, 2);
    assert.match(document.querySelector('.studio-tool-cards').textContent, /My preset/);
    await click('Apply to DSH'); assert.equal(applied, saved.id);
    await click('Delete'); assert.ok(document.querySelector('dialog[open]'));
    await click('Confirm delete'); assert.equal(removed, saved.id); assert.equal(rows.length, 0);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
