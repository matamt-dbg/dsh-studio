import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { ConfigEditor } from '../src/config-editor.tsx';

import { readFileSync } from 'node:fs';

test('rc.2 projected Configs render individual controls and inherited schema defaults', async () => {
  const entries = JSON.parse(readFileSync(new URL('./runtime-config-fixture.json', import.meta.url), 'utf8'));
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const { Simulate } = await import('react-dom/test-utils');
  const root = createRoot(document.getElementById('root'));
  let latest; let calls = 0;
  function Harness() {
    const [value, setValue] = React.useState(Object.fromEntries(entries.map(e => [e.id, {}])));
    latest = value;
    return React.createElement(ConfigEditor, { entries, locale: 'en', value, onChange(next) { calls++; setValue(next); } });
  }
  const control = label => document.querySelector(`[aria-label="${label}"]`);
  const open = id => act(async () => control(`Edit: ${id}`).click());
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await open('tool-fs');
    assert.equal(control('tool-fs: readLimit')?.type, 'number');
    assert.equal(control('tool-fs: readLimit').value, '2000');
    assert.equal(control('tool-fs: readMaxBytes').value, '51200');
    await open('tool-bash');
    assert.equal(control('tool-bash: enableRunInBackground').value, 'true');
    await open('spill-policy');
    assert.equal(control('spill-policy: maxInlineTokens')?.type, 'number');
    await open('tool-fs');
    assert.equal(calls, 0, 'displayed defaults must not become saved overrides');
    await act(async () => { const input = control('tool-fs: readLimit'); input.value = '120'; Simulate.change(input); });
    assert.deepEqual(latest['tool-fs'], { readLimit: 120 });
    await act(async () => control('Reset override: tool-fs: readLimit').click());
    assert.deepEqual(latest['tool-fs'], {});
    assert.equal(control('tool-fs: readLimit').value, '2000');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

const entry = {
  id: 'plugin', name: 'Example plugin',
  config: { count: 7, enabled: true, title: 'base', nested: { limit: 9, untouched: 'keep' }, mode: 'a', list: [1], union: null, tags: { keep: 'x' } },
  schema: { type: 'object', $defs: { options: { type: 'object', properties: { limit: { type: 'integer' }, untouched: { type: 'string' } } } }, properties: {
    count: { type: 'number', default: 99 }, enabled: { type: 'boolean' }, title: { type: 'string' },
    nested: { $ref: '#/$defs/options' }, mode: { enum: ['a', 'b', false, 0] }, list: { type: 'array', items: { type: 'number' } },
    union: { anyOf: [{ type: 'string' }, { type: 'null' }] }, absent: { type: 'string', default: 'Do not save' },
    tags: { type: 'object', additionalProperties: { type: 'string' } },
    readonly: { type: 'string', readOnly: true },
  } },
};

test('selection, recursive inputs and reset preserve inheritance and immutable false/zero/empty overrides', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const { Simulate } = await import('react-dom/test-utils');
  const root = createRoot(document.getElementById('root'));
  const initial = Object.freeze({ other: Object.freeze({ retained: true }) });
  const baseBefore = structuredClone(entry.config);
  let latest = initial;
  let calls = 0;
  function Harness({ locale = 'en', entries = [entry] }) {
    const [value, setValue] = React.useState(initial);
    return React.createElement(ConfigEditor, { entries, locale, value, onChange(next) { latest = next; calls++; setValue(next); } });
  }
  const control = label => [...document.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === label);
  const click = label => act(async () => { assert.ok(control(label), label); control(label).click(); });
  const change = (label, value) => act(async () => {
    const element = control(label); assert.ok(element, label); element.value = value;
    Simulate.change(element);
  });
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal(calls, 0);
    const list = () => control('Configs');
    assert.ok(list());
    assert.match(list().textContent, /Schema unavailable/, 'a stale selection stays visible');
    const search = document.querySelector('input[type=search]');
    await act(async () => Simulate.change(search, { target: { value: 'nested' } }));
    assert.equal(control('Example plugin').getAttribute('aria-checked'), 'false', 'nested schema fields are discoverable');
    const rowIndex = () => [...list().children].indexOf(control('Example plugin').closest('li'));
    await act(async () => Simulate.change(search, { target: { value: '' } }));
    const before = rowIndex();
    await click('Example plugin');
    assert.deepEqual(latest, { other: { retained: true }, plugin: {} });
    assert.equal(control('Example plugin').getAttribute('aria-checked'), 'true');
    assert.equal(rowIndex(), before, 'a toggled row keeps its place');
    await click('Edit: plugin');
    assert.ok(control('plugin: count').closest('dialog').open, 'Config fields open in a dialog');
    assert.equal(control('plugin: count').value, '7');
    assert.equal(control('plugin: absent').value, 'Do not save');
    assert.equal(control('plugin: nested.limit').value, '9');
    assert.equal(control('plugin: readonly').disabled, true);
    const row = () => control('Example plugin').closest('li');
    assert.equal(row().querySelector('[data-studio-modified]'), null);
    await change('plugin: count', '8');
    assert.equal(row().querySelector('[data-studio-modified]').textContent, 'Modified');
    await act(async () => Simulate.change(search, { target: { value: 'no-such-setting' } }));
    assert.match(list().textContent, /No matching results/);
    assert.equal(control('plugin: count').value, '8', 'search retains selected draft edits');
    await act(async () => Simulate.change(search, { target: { value: '' } }));
    await change('plugin: count', '7');
    assert.equal(row().querySelector('[data-studio-modified]'), null, 'same as original is not modified');
    await click('Reset override: plugin: count');
    assert.equal(row().querySelector('[data-studio-modified]'), null);
    const selected = latest;
    await change('plugin: count', '0');
    await change('plugin: enabled', 'false');
    await change('plugin: title', '');
    await change('plugin: nested.limit', '0');
    const beforeFraction = calls;
    await change('plugin: nested.limit', '0.5');
    assert.equal(calls, beforeFraction, 'integer inputs must not emit fractional overrides');
    await change('plugin: mode', '2');
    assert.deepEqual(latest.plugin, { count: 0, enabled: false, title: '', nested: { limit: 0 }, mode: false });
    assert.deepEqual(selected.plugin, {});
    assert.equal(latest.other, initial.other);
    const edited = latest;
    await click('Reset override: plugin: nested.limit');
    assert.equal(control('plugin: nested.limit').value, '9');
    assert.equal(Object.hasOwn(latest.plugin, 'nested'), false);
    assert.deepEqual(edited.plugin.nested, { limit: 0 });
    for (const key of ['count', 'enabled', 'title', 'mode']) await click(`Reset override: plugin: ${key}`);
    assert.deepEqual(latest.plugin, {});
    assert.equal(control('plugin: enabled').value, 'true');
    assert.equal(control('plugin: title').value, 'base');
    assert.deepEqual(entry.config, baseBefore);

    assert.equal(document.querySelectorAll('textarea').length, 0);
    assert.equal(control('plugin: list[0]').value, '1', 'number lists edit in place');
    assert.equal(control('plugin: union').value, '', 'a nullable scalar union keeps its scalar control');
    // Dictionary values keep their own control and the key is shown, not edited.
    assert.equal(control('plugin: tags.keep').value, 'x');
    await change('plugin: tags.keep', 'y');
    assert.deepEqual(latest.plugin.tags, { keep: 'y' });
    await change('New key: plugin: tags', 'added');
    await click('Add: plugin: tags');
    assert.deepEqual(latest.plugin.tags, { keep: 'y', added: '' });
    await click('Remove: plugin: tags.added');
    assert.deepEqual(latest.plugin.tags, { keep: 'y' });
    await click('Example plugin');
    assert.deepEqual(latest, { other: { retained: true } });
    assert.equal(document.querySelector('dialog[open]'), null, 'turning off the open Config closes its dialog');
    await click('Example plugin');
    assert.deepEqual(latest.plugin, {});
    assert.deepEqual(initial, { other: { retained: true } });

    const errors = [{ id: 'broken', name: 'Broken', schema: entry.schema, error: 'Projection failed' }, { id: 'missing', name: 'Missing' }];
    await act(async () => root.render(React.createElement(Harness, { entries: errors })));
    assert.equal(control('Broken').disabled, true);
    assert.equal(control('Missing').disabled, true);
    assert.equal(document.querySelectorAll('input:not([type=search]), select, textarea').length, 0);
    assert.equal(control('plugin').getAttribute('aria-checked'), 'true', 'selection without a catalog entry stays removable');
    for (const [locale, search] of [['ko-KR', '설정 검색'], ['zh-CN', '搜索执行设置']]) {
      await act(async () => root.render(React.createElement(Harness, { entries: errors, locale })));
      assert.ok(control(search));
    }
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('local reference cycles and unsupported schemas show unsupported notices without free-form editors', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const schema = { type: 'object', properties: { cyclic: { $ref: '#/$defs/cycle' }, remote: { $ref: 'https://example.invalid/schema' } }, $defs: { cycle: { $ref: '#/$defs/cycle' } } };
  try {
    await act(async () => root.render(React.createElement(ConfigEditor, { entries: [{ id: 'refs', name: 'Refs', schema }], value: { refs: {} }, onChange() { assert.fail('Rendering must not write defaults'); }, locale: 'en' })));
    await act(async () => document.querySelector('[aria-label="Edit: refs"]').click());
    const html = document.querySelector('dialog').innerHTML;
    assert.match(html, /aria-label="refs: cyclic"/);
    assert.match(html, /aria-label="refs: remote"/);
    assert.equal((html.match(/<textarea/g) ?? []).length, 0);
    assert.match(html, /not yet supported/);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

// Fixture captured from `createConfigProjector()` for three real plugin Configs:
// a string list (`tool-subagent.toolFilter.allow`/`deny`), a const/scalar union
// (`tool-subagent.maxDepth`), a literal union with a default (`tool-jobs.completionDelivery`),
// and an object list (`compaction-basic.modelPolicies`).
test('every projected shape edits as a fixed control and replaces the inherited value', async () => {
  const entries = JSON.parse(readFileSync(new URL('./fixtures/config-control-shapes.json', import.meta.url), 'utf8'));
  const baseBefore = structuredClone(entries[0].config);
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const { Simulate } = await import('react-dom/test-utils');
  const root = createRoot(document.getElementById('root'));
  let latest; let calls = 0;
  function Harness() {
    const [value, setValue] = React.useState({ 'tool-subagent': {}, 'tool-jobs': {}, 'compaction/compaction-basic': {} });
    latest = value;
    return React.createElement(ConfigEditor, { entries, locale: 'ko', value, onChange(next) { calls++; setValue(next); } });
  }
  const control = label => [...document.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === label);
  const click = label => act(async () => { assert.ok(control(label), label); control(label).click(); });
  const change = (label, value) => act(async () => {
    const element = control(label); assert.ok(element, label); element.value = value;
    Simulate.change(element);
  });
  const option = (select, text) => { const found = [...select.options].find(item => item.textContent === text); assert.ok(found, text); return found.value; };
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => control('설정: tool-subagent').click());
    assert.equal(document.querySelectorAll('textarea').length, 0, 'no free-form editor appears');
    // Inherited rows render as individual string inputs; an unset sibling keeps only its draft row.
    assert.deepEqual([0, 1, 2, 3].map(index => control(`tool-subagent: toolFilter.deny[${index}]`).value), ['schedule_create', 'schedule_delete', 'schedule_list', 'schedule_update']);
    assert.equal(control('tool-subagent: toolFilter.allow[0]'), undefined);
    assert.ok(control('새 항목: tool-subagent: toolFilter.allow'));
    // A typed draft is not saved until it is committed, so no empty name reaches the override.
    const beforeDraft = calls;
    await change('새 항목: tool-subagent: toolFilter.deny', 'workflow');
    assert.equal(calls, beforeDraft);
    await click('추가: tool-subagent: toolFilter.deny');
    assert.deepEqual(latest['tool-subagent'].toolFilter.deny, ['schedule_create', 'schedule_delete', 'schedule_list', 'schedule_update', 'workflow']);
    // Editing the list replaces the whole array (overrides replace) and leaves the sibling alone.
    await click('삭제: tool-subagent: toolFilter.deny[0]');
    assert.deepEqual(latest['tool-subagent'].toolFilter.deny, ['schedule_delete', 'schedule_list', 'schedule_update', 'workflow']);
    assert.equal(Object.hasOwn(latest['tool-subagent'].toolFilter, 'allow'), false);
    // Removing every row is an explicit empty list, not a reset back to the inherited value.
    for (const _ of [0, 1, 2, 3]) await click('삭제: tool-subagent: toolFilter.deny[0]');
    assert.deepEqual(latest['tool-subagent'].toolFilter.deny, []);
    assert.ok(control('기본값으로: tool-subagent: toolFilter.deny'));
    // A const/scalar union selects a branch; the scalar branch seeds from its own bounds.
    const maxDepth = control('tool-subagent: maxDepth');
    assert.equal(maxDepth.tagName, 'SELECT');
    assert.equal(maxDepth.value, '-1', 'an unset union shows its placeholder');
    await change('tool-subagent: maxDepth', option(maxDepth, 'provider-managed'));
    assert.equal(latest['tool-subagent'].maxDepth, 'provider-managed');
    await change('tool-subagent: maxDepth', option(maxDepth, 'integer'));
    assert.equal(latest['tool-subagent'].maxDepth, 0);
    await change('tool-subagent: maxDepth.value', '3');
    assert.equal(latest['tool-subagent'].maxDepth, 3);
    await click('기본값으로: tool-subagent: maxDepth');
    assert.equal(Object.hasOwn(latest['tool-subagent'], 'maxDepth'), false);
    assert.deepEqual(entries[0].config, baseBefore, 'the inherited Config is never mutated');
    // The same controls serve another plugin's Config: an inherited union default selects itself.
    await act(async () => control('설정: tool-jobs').click());
    const delivery = control('tool-jobs: completionDelivery');
    assert.equal(delivery.tagName, 'SELECT');
    assert.equal(delivery.value, option(delivery, 'wakeup'), 'the projected default is the inherited selection');
    assert.equal(control('tool-jobs: waitTimeoutMs').value, '30000', 'sibling scalars keep their own controls');
    await change('tool-jobs: completionDelivery', option(delivery, 'quiet'));
    assert.equal(latest['tool-jobs'].completionDelivery, 'quiet');
    assert.equal(Object.hasOwn(latest['tool-jobs'], 'waitTimeoutMs'), false);
    // Object items expand into their own form, and editing one rewrites the whole array.
    await act(async () => control('설정: compaction/compaction-basic').click());
    assert.equal(control('compaction/compaction-basic: modelPolicies[0].provider').value, 'route');
    assert.equal(control('compaction/compaction-basic: modelPolicies[0].retainRatio').value, '0.2');
    await change('compaction/compaction-basic: modelPolicies[0].retainRatio', '0.3');
    assert.deepEqual(latest['compaction/compaction-basic'].modelPolicies, [{ provider: 'route', model: 'model/variant', retainRatio: 0.3 }]);
    await click('추가: compaction/compaction-basic: modelPolicies');
    assert.equal(latest['compaction/compaction-basic'].modelPolicies.length, 2, 'a new item starts from the item schema default');
    await click('삭제: compaction/compaction-basic: modelPolicies[1]');
    assert.deepEqual(latest['compaction/compaction-basic'].modelPolicies, [{ provider: 'route', model: 'model/variant', retainRatio: 0.3 }]);
    assert.deepEqual(entries[2].config, { modelPolicies: [{ provider: 'route', model: 'model/variant', retainRatio: 0.2 }] }, 'the inherited list is never mutated');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
