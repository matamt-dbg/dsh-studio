import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { PresetList } from '../src/preset-manager.tsx';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { optimizedTemplate, BUILTIN_TOOL_PRESETS } from '../src/optimized-preset.ts';
import { PresetStore } from '../src/host/preset-store.ts';
function runtime() {
  const registrations = new Map();
  return { registrations, ctx: { agentPresets: {
    list: async () => [{ id: 'studio-master' }, ...registrations.values()],
    readDocument: async () => ({ content: '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n  config: {complete: true}\n- id: spill-policy\n  name: "@deepseek-ai/dsh-spill-policy"\n' }),
    register: async row => { assert.ok(!registrations.has(row.id)); registrations.set(row.id, row); return async () => { registrations.delete(row.id); }; },
    resolve: async id => registrations.get(id),
    acquireScope: async () => ({ key: {}, [Symbol.asyncDispose]: async () => {} }),
  }, tools: { schemas: () => [] } } };
}
test('Optimized seeds once, supports edit/apply/unapply, survives restart, and only deletion is prohibited', async () => {
  const template = optimizedTemplate([]);
  assert.equal(template.nonDeletable, true); assert.equal(template.readOnly, undefined);
  assert.match(template.applyWarning, /read_batch/);
  const defaults = optimizedTemplate(['bash', 'job_output', 'read_batch', 'task_run', 'get_goal', 'create_goal', 'update_goal', 'todo_write']);
  assert.deepEqual(defaults.request.tools, ['bash', 'job_output', 'read_batch']);
  assert.equal(defaults.request.configOverrides['spill-policy'].maxInlineTokens, 2500);
  assert.deepEqual(defaults.request.execution.defaults, { bash: { timeoutMs: 600000 }, job_output: { timeout_ms: 120000 } });
  assert.doesNotMatch(JSON.stringify(defaults.request), /task_run/);
  assert.match(defaults.request.toolOverrides.job_output.parameters.wait, /Use true/);
  assert.equal(optimizedTemplate(['read_batch', 'task_run']).applyWarning, undefined);
  assert.deepEqual(optimizedTemplate(['read', 'cordis_inspect_list', 'cordis_inspect_query', 'plugin_manager', 'subagent']).request.tools, ['read', 'subagent_role']);
  assert.deepEqual(BUILTIN_TOOL_PRESETS, ['standard', 'ptc', 'minimal', 'cordis']);
  const file = join(await mkdtemp(join(tmpdir(), 'studio-template-')), 'presets.json');
  const a = runtime(); const store = new PresetStore(a.ctx, file);
  const seeded = await store.ensureOptimized([], [{ id: 'spill-policy', name: '@deepseek-ai/dsh-spill-policy' }]);
  assert.equal(a.registrations.get(template.id).plugins[0].config.maxInlineTokens, 2500);
  assert.equal(seeded.status, 'applied'); assert.ok(a.registrations.has(template.id));
  await assert.rejects(store.delete(template.id), /non-deletable/);
  const edited = await store.save(JSON.stringify({ ...seeded, name: 'Customized Optimized', request: { ...seeded.request, prompt: 'User-edited instruction' } }));
  assert.equal(edited.status, 'modified'); assert.equal(edited.nonDeletable, true);
  assert.equal((await store.apply(template.id)).applyWarning, undefined); await store.dispose();
  const b = runtime(); const restored = new PresetStore(b.ctx, file);
  await restored.ensureOptimized(['read'], []);
  assert.equal((await restored.list())[0].request.prompt, 'User-edited instruction');
  assert.equal(b.registrations.get(template.id).name, 'Customized Optimized');
  await restored.unapply(template.id); await restored.dispose();
  const c = runtime(); const reopened = new PresetStore(c.ctx, file);
  const retained = await reopened.ensureOptimized(['different'], []);
  assert.equal(retained.status, 'draft'); assert.equal(c.registrations.size, 0);
  assert.equal(retained.name, 'Customized Optimized');
  const { id, ...copy } = retained;
  const saved = await reopened.save(JSON.stringify(copy));
  assert.match(saved.id, /^studio-user-/); assert.equal(saved.nonDeletable, undefined);
  await reopened.delete(saved.id);
  await reopened.apply(template.id); assert.ok(c.registrations.has(template.id));
  await assert.rejects(reopened.delete(template.id), /non-deletable/);
  await reopened.dispose();
});

test('Optimized has separate edit/copy actions and disables only Delete', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root'));
  const template = optimizedTemplate([]); let edited; let copied;
  const api = { list: async () => [template], apply: async () => template, unapply: async () => {}, delete: async () => {} };
  try {
    await act(async () => root.render(React.createElement(PresetList, { locale: 'ko', revision: 0, api, onEdit: value => { edited = value; }, onCopy: value => { copied = value; } })));
    const buttons = [...document.querySelectorAll('article button')].filter(button => !button.closest('.studio-split'));
    assert.deepEqual(buttons.filter(button => button.disabled).map(button => button.textContent), ['삭제']);
    await act(async () => buttons.find(button => button.textContent === '편집').click());
    await act(async () => buttons.find(button => button.textContent === '복사').click());
    assert.equal(edited.id, template.id); assert.equal(copied.id, template.id);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
