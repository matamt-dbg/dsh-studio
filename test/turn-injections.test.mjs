import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { turnInjections } from '../src/host/turn-injections.ts';

const loader = (module, seen = []) => ({ import: async name => { seen.push(name); return module; }, unwrapExports: value => value });
const entries = [
  { id: 'persona', name: '@deepseek-ai/dsh-persona' },
  { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 100, instructionFileCandidates: ['RULES.md'] } },
  { id: 'time-context', name: '@deepseek-ai/dsh-time-context', config: { timeZone: 'Asia/Seoul' } },
  { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
];

test('injections are built from the effective Config through the public package export, only for included plugins', async () => {
  let options;
  const seen = [];
  const result = await turnInjections(entries, loader({ loadBaselineInstructions: async value => { options = value; return { text: 'Instructions from: RULES.md' }; } }, seen), { cwd: '/work', now: new Date('2026-10-16T09:00:00Z') });
  assert.deepEqual(result.map(item => item.entry), ['agent-instructions', 'time-context', 'skill-filesystem']);
  assert.deepEqual(seen, ['@deepseek-ai/dsh-agent-instructions']);
  assert.deepEqual(options, { maxBytes: 100, instructionFileCandidates: ['RULES.md'], cwd: '/work' });
  assert.equal(result[0].text, 'Instructions from: RULES.md');
  assert.equal(result[1].text, 'Time sampled while preparing turn 1, step 1: 2026-10-16T18:00:00+09:00[Asia/Seoul]\nElapsed since the preceding model-visible message: unavailable.');
  assert.equal(result[2].note, 'skills');
  // Excluded plugins are absent from the entries and produce nothing.
  assert.deepEqual(await turnInjections(entries.slice(0, 1), loader({}), { cwd: '/work' }), []);
});

test('missing exports, empty results, and bad zones become notes, never errors', async () => {
  const [missing] = await turnInjections([entries[1]], loader({}), { cwd: '/work' });
  assert.match(missing.note, /^error:loadBaselineInstructions is not exported/);
  const [empty] = await turnInjections([entries[1]], loader({ loadBaselineInstructions: async () => undefined }), { cwd: '/work' });
  assert.equal(empty.note, 'empty');
  const [zone] = await turnInjections([{ ...entries[2], config: { timeZone: 'Nowhere/Zone' } }], undefined, { cwd: '/work' });
  assert.match(zone.note, /^error:/);
});

test('panel edits write the same Config overrides and Reset removes the key', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const { Simulate } = await import('react-dom/test-utils');
  const { TurnInjectionPanel } = await import('../src/turn-injection-panel.tsx');
  const root = createRoot(document.getElementById('root'));
  let overrides = { 'time-context': { timeZone: 'UTC' } };
  const render = () => act(async () => root.render(React.createElement(TurnInjectionPanel, { locale: 'en', overrides, onChange: next => { overrides = next; },
    injections: [{ entry: 'time-context', name: '@deepseek-ai/dsh-time-context', text: 'Time sampled…' }, { entry: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', note: 'empty' }] })));
  try {
    await render();
    const text = document.body.textContent;
    assert.match(text, /Current time notice.*Example/); assert.match(text, /Time sampled…/); assert.match(text, /Text not editable/);
    assert.match(text, /No instruction files were found/);
    const input = label => document.querySelector(`input[aria-label="${label}"]`);
    assert.equal(input('time-context · timeZone').value, 'UTC');
    await act(async () => Simulate.change(input('agent-instructions · instructionFileCandidates'), { target: { value: 'AGENTS.md, RULES.md' } }));
    assert.deepEqual(overrides['agent-instructions'], { instructionFileCandidates: ['AGENTS.md', 'RULES.md'] });
    await act(async () => Simulate.change(input('agent-instructions · maxBytes'), { target: { value: '0' } }));
    assert.equal(overrides['agent-instructions'].maxBytes, 0, 'explicit 0 is kept');
    await render();
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Reset').click());
    assert.deepEqual(overrides['time-context'], {}, 'Reset removes only that key; an empty override is "use the default"');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('the preview dialog shows turn-start content in its own view, not under the prompt grid', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { createRoot } = await import('react-dom/client');
  const { PromptToolsPrototype } = await import('../src/prompt-tools-prototype.tsx');
  const root = createRoot(document.getElementById('root'));
  const result = { prompt: 'p', context: '', sections: [{ name: 'harness:identity', text: 'You are…' }], tools: [], injections: [{ entry: 'time-context', name: '@deepseek-ai/dsh-time-context', text: 'Time sampled…' }] };
  try {
    await act(async () => root.render(React.createElement(PromptToolsPrototype, { locale: 'en', prompt: '', onPromptChange() {}, provided: [], onProvidedChange() {},
      catalog: { presets: [{ id: 'studio-master', tools: [], sections: [], promptProviders: [] }], tools: [] }, onPreview: async () => result, configOverrides: {}, onConfigOverridesChange() {} })));
    await act(async () => [...document.querySelectorAll('button')].find(b => /preview/i.test(b.textContent)).click());
    const dialog = () => document.querySelector('dialog[open]');
    assert.ok(dialog().querySelector('.studio-preview'));
    assert.doesNotMatch(dialog().textContent, /Time sampled…/);
    await act(async () => [...dialog().querySelectorAll('[role=radio]')].find(b => b.textContent.startsWith('Turn start')).click());
    assert.equal(dialog().querySelector('.studio-preview'), null);
    assert.match(dialog().textContent, /Time sampled…/);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('runtime context has its own preview view, by contributor', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { createRoot } = await import('react-dom/client');
  const { PromptToolsPrototype } = await import('../src/prompt-tools-prototype.tsx');
  const root = createRoot(document.getElementById('root'));
  const result = { prompt: 'p', context: '', sections: [], tools: [], injections: [], contexts: [{ name: 'sandbox:policy', text: 'Current DSH file policy: danger-full-access.' }] };
  try {
    await act(async () => root.render(React.createElement(PromptToolsPrototype, { locale: 'en', prompt: '', onPromptChange() {}, provided: [], onProvidedChange() {},
      catalog: { presets: [{ id: 'studio-master', tools: [], sections: [], promptProviders: [] }], tools: [] }, onPreview: async () => result, configOverrides: {}, onConfigOverridesChange() {} })));
    assert.match(document.body.textContent, /attaches to each session directly/);
    await act(async () => [...document.querySelectorAll('button')].find(b => /preview/i.test(b.textContent)).click());
    const dialog = () => document.querySelector('dialog[open]');
    await act(async () => [...dialog().querySelectorAll('[role=radio]')].find(b => b.textContent.startsWith('Runtime context')).click());
    assert.match(dialog().textContent, /sandbox:policy.*danger-full-access/);
    assert.match(dialog().textContent, /only while running/);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
