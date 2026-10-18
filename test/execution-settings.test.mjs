import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { OptimizationPrototype } from '../src/optimization-prototype.tsx';
import { selectedExecution, executionOverrideCount } from '../src/execution-defaults.ts';

test('selectedExecution keeps only overrides of selected tools and drops empty results', () => {
  const value = { defaults: { bash: { timeoutMs: 600000 }, job_output: { timeout_ms: 120000 }, gone: {} }, batch: { tool: 'read_batch', parameter: 'calls', maxItems: 4 } };
  assert.deepEqual(selectedExecution(value, ['bash', 'read_batch']), { defaults: { bash: { timeoutMs: 600000 } }, batch: { tool: 'read_batch', parameter: 'calls', maxItems: 4 } });
  assert.deepEqual(selectedExecution(value, ['job_output']), { defaults: { job_output: { timeout_ms: 120000 } } });
  assert.equal(selectedExecution(value, ['read']), undefined);
  assert.equal(selectedExecution({ defaults: {} }, ['bash']), undefined);
  assert.equal(selectedExecution(undefined, ['bash']), undefined);
  assert.equal(executionOverrideCount(value), 3);
  assert.equal(executionOverrideCount(undefined), 0);
});

const waitTool = (name, parameter) => ({ name, description: name, parameters: { type: 'object', properties: { [parameter]: { type: 'number', description: 'wait' } } } });
const catalog = {
  presets: [{ id: 'studio-master', tools: [], sections: [], promptProviders: [] }],
  tools: [waitTool('bash', 'timeoutMs'), waitTool('job_output', 'timeout_ms'), { name: 'read_batch', description: 'batch', parameters: { type: 'object', properties: { calls: { type: 'array', maxItems: 8 } } } }],
  execution: { waits: [{ tool: 'bash', parameter: 'timeoutMs', supported: true }, { tool: 'job_output', parameter: 'timeout_ms', supported: true }], batch: { tool: 'read_batch', parameter: 'calls', maxItems: 8 }, spill: { supported: false, reason: 'x' } },
};

async function mount(preset) {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { createRoot } = await import('react-dom/client');
  const { Simulate } = await import('react-dom/test-utils');
  const root = createRoot(document.getElementById('root'));
  const state = { saved: undefined };
  const api = { list: async () => [preset], save: async payload => { state.saved = JSON.parse(payload); return { ...state.saved, status: 'draft' }; }, apply: async () => preset, delete: async () => {} };
  await act(async () => root.render(React.createElement(OptimizationPrototype, { locale: 'en', presetActions: api, catalog })));
  const section = () => document.querySelector('section[aria-label="Execution defaults"]');
  const click = async text => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === text).click());
  const row = title => [...section().querySelectorAll('.studio-picker-row')].find(e => e.querySelector('.studio-picker-title')?.textContent.startsWith(title));
  const toggle = async title => act(async () => row(title).querySelector('[role=switch]').click());
  const open = async tool => act(async () => section().querySelector(`button[aria-label="Edit: ${tool}"]`).click());
  const dialog = () => [...document.querySelectorAll('dialog')].find(d => d.open);
  const input = () => dialog().querySelector('input');
  const edit = async value => act(async () => Simulate.change(input(), { target: { value } }));
  const done = async () => act(async () => [...dialog().querySelectorAll('button')].find(b => b.textContent === 'Done').click());
  return { state, click, row, toggle, open, dialog, input, edit, done, close: async () => { await act(async () => root.unmount()); dom.window.close(); } };
}

test('execution defaults use the Config picker: saved overrides load on, edits round-trip, reset and turn-off remove them', async () => {
  const preset = { id: 'studio-user-a', name: 'Optimized Copy', description: '', status: 'applied', agents: [], conveniences: {},
    request: { preset: 'studio-master', providers: [], tools: ['bash', 'job_output', 'read_batch'], prompt: '', model: 'testLLM',
      execution: { defaults: { bash: { timeoutMs: 600000 }, job_output: { timeout_ms: 120000 } } } } };
  const ui = await mount(preset);
  try {
    await ui.click('Edit');
    await ui.click('Execution settings');
    assert.equal(ui.row('bash command wait').dataset.selected, 'true');
    assert.ok(ui.row('bash command wait').querySelector('[data-studio-modified]'));
    assert.equal(ui.row('read_batch max items').dataset.selected, 'false');
    assert.match(ui.row('bash command wait').textContent, /DSH Settings → Shell/);
    // Unchanged save keeps the inherited overrides instead of dropping them.
    await ui.click('Save preset');
    assert.deepEqual(ui.state.saved.request.execution, preset.request.execution);

    await ui.click('Edit');
    await ui.click('Execution settings');
    await ui.open('bash');
    assert.equal(ui.input().value, '600000');
    assert.match(ui.dialog().textContent, /Override/);
    await act(async () => ui.dialog().querySelector('button[aria-label^="Reset override"]').click());
    assert.equal(ui.input().value, '');
    assert.match(ui.dialog().textContent, /Base value/);
    await ui.done();
    // Reset leaves the row on but unmodified; turning a tool on then editing adds an override.
    assert.equal(ui.row('bash command wait').querySelector('[data-studio-modified]'), null);
    await ui.toggle('read_batch max items');
    await ui.open('read_batch');
    assert.equal(ui.input().placeholder, '8');
    await ui.edit('3');
    await ui.done();
    await ui.click('Save preset');
    assert.deepEqual(ui.state.saved.request.execution, { defaults: { job_output: { timeout_ms: 120000 } }, batch: { tool: 'read_batch', parameter: 'calls', maxItems: 3 } });

    await ui.click('Edit');
    await ui.click('Execution settings');
    await ui.toggle('bash command wait');
    await ui.toggle('Background job result wait');
    await ui.toggle('read_batch max items');
    await ui.click('Save preset');
    assert.equal(Object.hasOwn(ui.state.saved.request, 'execution'), false);
  } finally { await ui.close(); }
});

test('only selected tools are listed and unselected tools never keep an override', async () => {
  const preset = { id: 'studio-user-b', name: 'B', description: '', status: 'draft', agents: [], conveniences: {},
    request: { preset: 'studio-master', providers: [], tools: ['bash'], prompt: '', model: 'testLLM',
      execution: { defaults: { bash: { timeoutMs: 600000 }, job_output: { timeout_ms: 120000 } } } } };
  const ui = await mount(preset);
  try {
    await ui.click('Edit');
    await ui.click('Execution settings');
    assert.equal(ui.row('Background job result wait'), undefined);
    await ui.click('Save preset');
    assert.deepEqual(ui.state.saved.request.execution, { defaults: { bash: { timeoutMs: 600000 } } });
  } finally { await ui.close(); }
});

test('the preset list shows how many execution defaults a preset overrides', async () => {
  const base = { description: '', status: 'applied', agents: [], conveniences: {} };
  const request = (execution) => ({ preset: 'studio-master', providers: [], tools: ['bash', 'job_output'], prompt: '', model: 'testLLM', ...(execution ? { execution } : {}) });
  const rows = [
    { ...base, id: 'studio-optimized', name: 'Optimized', template: true, request: request({ defaults: { bash: { timeoutMs: 600000 }, job_output: { timeout_ms: 120000 } } }) },
    { ...base, id: 'studio-user-c', name: 'Plain', request: request() },
  ];
  const ui = await mount(rows[0]);
  try {
    await act(async () => { /* list loads asynchronously */ });
    const cards = () => [...document.querySelectorAll('.studio-preset-card')];
    assert.match(cards()[0].textContent, /Execution defaults overridden: 2/);
  } finally { await ui.close(); }
  const plain = await mount(rows[1]);
  try {
    await act(async () => {});
    assert.doesNotMatch(document.querySelector('.studio-preset-card').textContent, /Execution defaults overridden/);
  } finally { await plain.close(); }
});
