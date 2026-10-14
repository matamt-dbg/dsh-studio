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

test('the subagent tab hides selected tools from subagents and round-trips through save', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const preset = { id: 'studio-user-a', name: 'A', description: '', status: 'draft', agents: [], conveniences: {},
    request: { preset: 'studio-master', providers: [], tools: ['read', 'ask_user_question', 'subagent_role'], prompt: '', model: 'testLLM', subagentToolFilter: { deny: ['present'] } } };
  let saved;
  const api = { list: async () => [preset], save: async payload => { saved = JSON.parse(payload); return { ...saved, status: 'draft' }; }, apply: async () => preset, delete: async () => {} };
  const tool = name => ({ name, description: name, parameters: { type: 'object', properties: {} } });
  const catalog = { presets: [{ id: 'studio-master', tools: [], sections: [], promptProviders: [] }], tools: ['read', 'ask_user_question', 'present', 'subagent_role'].map(tool) };
  const click = async text => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === text).click());
  try {
    await act(async () => root.render(React.createElement(OptimizationPrototype, { locale: 'en', presetActions: api, catalog })));
    await click('Edit');
    await click('Subagent settings');
    const list = document.querySelector('ul[aria-label="Subagent Tool Filter"]');
    assert.ok(list);
    // Only tools the preset selects are offered and subagent_role is never listed; a saved entry for an
    // unselected tool (present) is dropped instead of failing on apply.
    assert.deepEqual([...list.querySelectorAll('button[role=switch]')].map(b => b.getAttribute('aria-label')), ['read', 'ask_user_question']);
    await act(async () => list.querySelector('button[aria-label="ask_user_question"]').click());
    await click('Save preset');
    assert.deepEqual(saved.request.subagentToolFilter, { deny: ['ask_user_question'] });
    assert.deepEqual(saved.request.tools, ['read', 'ask_user_question', 'subagent_role']);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('a role can add to or replace the preset Tool Filter, and the filter waits for subagent_role', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { createRoot } = await import('react-dom/client');
  const { Simulate } = await import('react-dom/test-utils');
  const plain = { model: 'inherit', reasoning: 'inherit', persona: '' };
  const make = tools => ({ id: 'studio-user-b', name: 'B', description: '', status: 'draft', conveniences: {},
    agents: [{ ...plain, name: 'Worker', role: 'worker', spawn: 'fork' }, { ...plain, name: 'Reviewer', role: 'reviewer', spawn: 'fresh' }],
    request: { preset: 'studio-master', providers: [], tools, prompt: '', model: 'testLLM', subagentToolFilter: { deny: ['ask_user_question'] } } });
  let preset = make(['read', 'bash', 'write', 'ask_user_question', 'subagent_role']); let saved;
  const api = { list: async () => [preset], save: async payload => { saved = JSON.parse(payload); return { ...saved, status: 'draft' }; }, apply: async () => preset, delete: async () => {} };
  const tool = name => ({ name, description: name, parameters: { type: 'object', properties: {} } });
  const catalog = { presets: [{ id: 'studio-master', tools: [], sections: [], promptProviders: [] }], tools: ['read', 'bash', 'write', 'ask_user_question', 'subagent_role'].map(tool) };
  const click = async text => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === text).click());
  const editRole = async index => act(async () => document.querySelectorAll('.studio-role-card button')[index].click());
  const mode = () => document.querySelector('dialog[open] select[aria-label="Tool Filter for this role"]');
  const own = () => document.querySelector('dialog[open] ul[aria-label="Tool Filter for this role"]');
  const switchOf = name => own().querySelector(`button[aria-label="${name}"]`);
  let root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(OptimizationPrototype, { locale: 'en', presetActions: api, catalog })));
    await click('Edit'); await click('Subagent settings');
    assert.match([...document.querySelectorAll('.studio-role-card')].map(c => c.textContent).join('|'), /Tool Filter: default.*Tool Filter: default/s);

    // Extend: the default is shown on and locked; the role adds bash.
    await editRole(1);
    assert.equal(mode().value, 'default'); assert.match(mode().textContent, /Use preset default \(1\)/);
    await act(async () => Simulate.change(mode(), { target: { value: 'extend' } }));
    assert.equal(switchOf('ask_user_question').getAttribute('aria-checked'), 'true');
    assert.equal(switchOf('ask_user_question').disabled, true);
    assert.match(switchOf('ask_user_question').textContent, /Preset default/);
    await act(async () => switchOf('bash').click());
    await click('Done');

    // Replace: starts empty and ignores the default.
    await editRole(0);
    await act(async () => Simulate.change(mode(), { target: { value: 'replace' } }));
    assert.equal(switchOf('ask_user_question').getAttribute('aria-checked'), 'false');
    assert.match(document.querySelector('dialog[open]').textContent, /does not apply to this role/);
    await act(async () => switchOf('write').click());
    await click('Done');
    assert.match([...document.querySelectorAll('.studio-role-card')].map(c => c.textContent).join('|'), /Tool Filter: own 1.*Tool Filter: default \+ 1/s);

    await click('Save preset');
    assert.deepEqual(saved.agents.map(role => role.toolFilter), [{ mode: 'replace', deny: ['write'] }, { mode: 'extend', deny: ['bash'] }]);
    assert.deepEqual(saved.request.subagentToolFilter, { deny: ['ask_user_question'] });
    await act(async () => root.unmount());

    // Without subagent_role the Tool Filter is explained, not offered.
    preset = make(['read', 'bash']);
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(OptimizationPrototype, { locale: 'en', presetActions: api, catalog })));
    await click('Edit'); await click('Subagent settings');
    assert.equal(document.querySelector('ul[aria-label="Subagent Tool Filter"]'), null);
    assert.match(document.body.textContent, /Select subagent_role on the Prompts & tools tab/);
    await act(async () => root.unmount());
  } finally { dom.window.close(); }
});
