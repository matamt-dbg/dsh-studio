import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { PromptToolsPrototype, defaultProvidedTools } from '../src/prompt-tools-prototype.tsx';
import { promptProviders, selectPromptProviders } from '../src/prompt-composition.ts';

test('run_code cannot be selected directly or via presets; legacy selections can only be removed', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const tools = ['read', 'run_code'].map(name => ({ name, description: name }));
  const catalog = { tools, presets: [
    { id: 'studio-master', tools, sections: [] },
    { id: 'standard', tools, sections: [] },
    { id: 'ptc', tools: [tools[1]], sections: [] },
  ] };
  let selected;
  function Harness({ initial = [] }) {
    const [provided, onProvidedChange] = React.useState(initial); selected = provided;
    return React.createElement(PromptToolsPrototype, { catalog, locale: 'en', prompt: '', onPromptChange() {}, provided, onProvidedChange });
  }
  const toggle = () => document.querySelector('button[role="switch"][aria-label="run_code"]');
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal(toggle().disabled, true);
    assert.match(toggle().textContent, /does not currently support run_code/);
    assert.match(toggle().textContent, /start a new session with DSH’s PTC preset/);
    await act(async () => toggle().click()); assert.deepEqual(selected, []);
    const preset = name => [...document.querySelectorAll('button')].find(button => button.textContent === name);
    assert.equal(preset('ptc').disabled, true);
    await act(async () => preset('standard').click()); assert.deepEqual(selected, ['read']);
    await act(async () => root.render(React.createElement(Harness, { key: 'legacy', initial: ['run_code'] })));
    assert.equal(toggle().disabled, false);
    assert.equal(document.querySelector('button[aria-label="Details: run_code"]'), null);
    await act(async () => toggle().click()); assert.deepEqual(selected, []);
    assert.equal(toggle().disabled, true);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('prompt providers are explicitly classified and nested dependencies preserved', () => {
  const rows = [{ name: 'cordis:group', group: true, config: [{ name: '@deepseek-ai/dsh-persona', config: { prefix: 'Hello' } }, { name: 'tool-provider' }] }];
  assert.equal(promptProviders(rows)[0].name, '@deepseek-ai/dsh-persona');
  assert.deepEqual(selectPromptProviders(rows, [])[0].config, [{ name: 'tool-provider' }]);
  assert.throws(() => selectPromptProviders(rows, ['unknown']));
  assert.equal(rows[0].config.length, 2);
});

test('two-column selection keeps prompt on top and uses authoritative assembly order', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const tools = ['read', 'grep', 'glob', 'read_batch'].map(name => ({ name, description: `${name}: full model-facing description\nincluding usage constraints` }));
  tools[3].parameters = { type: 'object', required: ['options'], properties: { options: { type: 'object', description: 'Options', required: ['limit'], properties: { limit: { type: 'number', description: 'Maximum results' } } } } };
  tools[3].promptSections = [{ name: 'tool:jobs', text: 'Original jobs guidance' }];
  const catalog = { tools, presets: [{ id: 'studio-master', sections: [], tools, promptProviders: [{ name: '@deepseek-ai/dsh-persona', description: 'Base persona instructions', fields: [{ key: 'prefix', type: 'string', value: 'Original persona' }, { key: 'suffix', type: 'string', value: '' }, { key: 'includeRuntimeContext', type: 'boolean', value: false }, { key: 'limit', type: 'number', value: 10, minimum: 1 }, { key: 'files', type: 'string[]', value: ['AGENTS.md'] }] }] }] };
  let request;
  function Harness() {
    const [provided, onProvidedChange] = React.useState(defaultProvidedTools);
    return React.createElement(PromptToolsPrototype, { catalog, locale: 'en', prompt: 'Studio text', onPromptChange() {}, provided, onProvidedChange, onPreview: async input => {
      request = input;
      return { prompt: 'Assembled exactly', sections: [{ name: 'z-first', text: 'First' }, { name: 'a-second', text: 'Second' }], context: 'Runtime', tools: [{ name: 'read', description: input.toolOverrides?.read_batch?.description ?? 'Reads files', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'A file path', minLength: 1 } } } }] };
    } });
  }
  const click = async text => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === text).click());
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.deepEqual(defaultProvidedTools, []);
    assert.equal(document.body.textContent.includes('Export preset'), false);
    assert.equal(document.querySelectorAll('textarea').length, 3);
    const transfers = document.querySelectorAll('.studio-picker');
    assert.equal(transfers.length, 1);
    assert.equal(document.body.textContent.includes('includeRuntimeContext'), false);
    assert.equal(document.querySelectorAll('input[type=checkbox]').length, 0);
    const transfer = transfers[0];
    assert.equal(transfer.querySelector('button[aria-label="Details: read_batch"]'), null, 'details appear only for selected tools');
    const rowIndex = () => [...transfer.querySelectorAll('li')].indexOf(transfer.querySelector('button[aria-label="read_batch"]').closest('li'));
    const before = rowIndex();
    await act(async () => transfer.querySelector('button[aria-label="read_batch"]').click());
    assert.equal(rowIndex(), before, 'adding a tool keeps it in place');
    assert.equal(transfer.querySelector('button[aria-label="read_batch"]').getAttribute('aria-checked'), 'true');
    await act(async () => transfer.querySelector('button[aria-label="Details: read_batch"]').click());
    const detailText = document.querySelector('.studio-selection-detail').textContent;
    assert.ok(detailText.indexOf('Tool description') < detailText.indexOf('Tool usage instructions'));
    assert.ok(detailText.indexOf('Tool usage instructions') < detailText.indexOf('Parameter descriptions'));
    assert.ok(document.querySelector('.studio-selection-detail').closest('dialog').open, 'details open in a dialog');
    await click('Close');
    assert.equal(document.querySelector('dialog[open]'), null);
    await act(async () => [...transfer.querySelectorAll('[role=radio]')].find(b => b.textContent.startsWith('Selected')).click());
    assert.deepEqual([...transfer.querySelectorAll('li')].map(li => li.querySelector('[role=switch]').getAttribute('aria-label')), ['read_batch'], 'the Selected filter shows where the tool went');
    await act(async () => [...transfer.querySelectorAll('[role=radio]')].find(b => b.textContent.startsWith('All')).click());
    assert.equal(transfer.textContent.includes(tools[3].description), true);
    await click('Preview prompt');
    assert.ok(document.querySelector('.studio-prompt-document').closest('dialog').open);
    await click('Close preview');
    assert.equal(document.querySelector('.studio-prompt-document').closest('dialog').open, false);
    assert.deepEqual(request.providers, ['@deepseek-ai/dsh-persona']);
    assert.equal(request.tools.includes('read_batch'), true);
    assert.equal(request.prompt, 'Studio text');
    const previewButton = [...document.querySelectorAll('button')].find(b => b.textContent === 'Preview prompt');
    assert.ok(previewButton.compareDocumentPosition(transfer) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(transfer.compareDocumentPosition(document.querySelector('.studio-prompt-document')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.deepEqual([...document.querySelectorAll('.studio-prompt-document h3')].map(e => e.textContent), ['1z-first', '2a-second']);
    assert.match(document.querySelector('.studio-prompt-tools h3').textContent, /^Model-facing tool schemas/);
    assert.equal(document.body.textContent.includes('Assembled exactly'), false);
    assert.equal(document.body.textContent.includes('Runtime'), false);
    assert.equal(document.querySelectorAll('.studio-prompt-stages').length, 0);
    assert.equal(document.querySelectorAll('.studio-prompt-document pre').length, 0);
    assert.match(document.querySelector('.studio-schema-tool').textContent, /minLength/);
    assert.equal(document.querySelector('.studio-schema-tool').open, false);
    assert.equal(request.preset, 'studio-master');
    assert.equal(Object.hasOwn(request, 'persona'), false);
    const { Simulate } = await import('react-dom/test-utils');
    assert.equal(request.model, 'testLLM');
    await act(async () => transfer.querySelector('button[aria-label="Details: read_batch"]').click());
    let toolDetail = document.querySelector('.studio-selection-detail');
    await act(async () => Simulate.change(toolDetail.querySelector('textarea'), { target: { value: 'Edited tool description' } }));
    await act(async () => Simulate.change(toolDetail.querySelector('textarea[aria-label="options.limit"]'), { target: { value: 'Edited nested description' } }));
    assert.match(toolDetail.textContent, /number · required/);
    const search = document.querySelector('input[aria-label="Search tools"]');
    await act(async () => Simulate.change(search, { target: { value: 'no-such-tool' } }));
    assert.match(transfer.textContent, /No matching results/);
    assert.equal(toolDetail.querySelector('textarea[aria-label="options.limit"]').value, 'Edited nested description');
    await act(async () => Simulate.change(search, { target: { value: '' } }));
    await act(async () => Simulate.change(toolDetail.querySelector(':scope > section textarea'), { target: { value: 'Edited jobs guidance' } }));
    await click('Close');
    const persona = document.querySelector('textarea');
    assert.equal(persona.value, 'Original persona');
    await act(async () => Simulate.change(persona, { target: { value: 'Edited persona' } }));
    await act(async () => Simulate.change(document.querySelectorAll('textarea')[1], { target: { value: 'Edited suffix' } }));
    await click('Preview prompt');
    assert.ok(document.querySelector('.studio-prompt-document').closest('dialog').open);
    await click('Close preview');
    assert.equal(document.querySelector('.studio-prompt-document').closest('dialog').open, false);
    assert.equal(Object.hasOwn(request, 'persona'), false);
    assert.deepEqual(request.providerConfigs['@deepseek-ai/dsh-persona'], { prefix: 'Edited persona', suffix: 'Edited suffix' });
    assert.deepEqual(request.toolOverrides.read_batch, { description: 'Edited tool description', parameters: { 'options.limit': 'Edited nested description' } });
    assert.equal(transfer.querySelector('button[aria-label="read_batch"]').closest('li').querySelector('[data-studio-modified]').textContent, 'Modified');
    assert.deepEqual(request.sections, { 'tool:jobs': 'Edited jobs guidance' });
    assert.match(document.querySelector('.studio-schema-tool').textContent, /Edited tool description/);
    // Tool deselection excludes tool edits while Persona remains active.
    await act(async () => transfers[0].querySelector('button[aria-label="read_batch"]').click());
    await click('Preview prompt');
    assert.ok(document.querySelector('.studio-prompt-document').closest('dialog').open);
    await click('Close preview');
    assert.equal(document.querySelector('.studio-prompt-document').closest('dialog').open, false);
    assert.equal(request.providerConfigs['@deepseek-ai/dsh-persona'].prefix, 'Edited persona');
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Use original').click());
    await click('Preview prompt');
    assert.ok(document.querySelector('.studio-prompt-document').closest('dialog').open);
    await click('Close preview');
    assert.equal(document.querySelector('.studio-prompt-document').closest('dialog').open, false);
    assert.equal(request.providerConfigs['@deepseek-ai/dsh-persona'].prefix, undefined);
    await click('Close');
    assert.equal(document.querySelector('dialog[open]'), null);
    assert.deepEqual(request.toolOverrides, {});
    assert.deepEqual(request.sections, {});
    assert.equal(document.querySelectorAll('input[type=checkbox]').length, 0);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('built-in tool set buttons toggle against tools already selected by a copied preset', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const tool = name => ({ name, description: name });
  const catalog = { tools: ['bash', 'read', 'grep', 'run_code'].map(tool), presets: [
    { id: 'studio-master', sections: [], tools: [], promptProviders: [] },
    { id: 'standard', sections: [], tools: [tool('read'), tool('grep')] },
  ] };
  let current;
  function Harness() {
    const [provided, onProvidedChange] = React.useState(['bash', 'read', 'grep']);
    current = provided;
    return React.createElement(PromptToolsPrototype, { catalog, locale: 'en', prompt: '', onPromptChange() {}, provided, onProvidedChange, initialRequest: { tools: provided } });
  }
  const standard = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'standard');
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal(standard().getAttribute('aria-pressed'), 'true', 'a copied preset already containing the set shows it as included');
    await act(async () => standard().click());
    assert.deepEqual(current, ['bash']);
    assert.equal(standard().getAttribute('aria-pressed'), 'false');
    await act(async () => standard().click());
    assert.deepEqual(current, ['bash', 'read', 'grep']);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
