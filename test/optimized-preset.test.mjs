import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { PresetList } from '../src/preset-manager.tsx';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { optimizedTemplate, BUILTIN_TOOL_PRESETS, OPTIMIZED_TOOLS } from '../src/optimized-preset.ts';
import { PresetStore } from '../src/host/preset-store.ts';
import { storeRuntime } from './store-runtime.mjs';
const runtime = () => storeRuntime({ base: 'studio-master', document: '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n  config: {complete: true}\n- id: spill-policy\n  name: "@deepseek-ai/dsh-spill-policy"\n' });
test('Optimized selects only its fixed allow list, never an extra profile tool', () => {
  // The desktop profile registers these four through its runtime plugins; they must not leak in.
  const catalog = ['load_workspace_dependencies', 'x_search', 'video_generate', 'image_generate', ...OPTIMIZED_TOOLS];
  const template = optimizedTemplate(catalog);
  assert.equal(OPTIMIZED_TOOLS.length, 22);
  assert.deepEqual([...template.request.tools].sort(), [...OPTIMIZED_TOOLS].sort());
  for (const extra of ['load_workspace_dependencies', 'x_search', 'video_generate', 'image_generate']) assert.ok(!template.request.tools.includes(extra));
});
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
  const a = await runtime(); const store = new PresetStore(a.ctx, file);
  const seeded = await store.ensureOptimized([], [{ id: 'spill-policy', name: '@deepseek-ai/dsh-spill-policy' }]);
  assert.equal(a.registrations.get(template.id).plugins[0].config.maxInlineTokens, 2500);
  assert.equal(seeded.status, 'applied'); assert.ok(a.registrations.has(template.id));
  await assert.rejects(store.delete(template.id), /non-deletable/);
  await assert.rejects(store.save(JSON.stringify({ ...seeded, name: 'Customized Optimized', request: { ...seeded.request, prompt: 'User-edited instruction' } })), /locked built-in/);
  assert.equal((await store.list())[0].request.prompt, seeded.request.prompt);
  assert.equal((await store.apply(template.id)).applyWarning, undefined); await store.dispose();
  const b = await runtime(); const restored = new PresetStore(b.ctx, file);
  await restored.ensureOptimized(['read'], [{ id: 'spill-policy', name: '@deepseek-ai/dsh-spill-policy' }]);
  assert.equal((await restored.list())[0].request.prompt, seeded.request.prompt);
  // The locked built-in re-aligns to the shipped allow list instead of freezing its first seed.
  assert.deepEqual((await restored.list())[0].request.tools, ['read']);
  assert.equal(b.registrations.get(template.id).name, 'Optimized');
  // A snapshot composed by an older build (empty compaction group) is rebuilt from the current base.
  const stale = (await import('node:fs/promises'));
  const data = JSON.parse(await stale.readFile(file, 'utf8'));
  await restored.dispose();
  data.presets[0].applied.plugins = '- id: compaction\n  name: cordis:group\n  group: true\n  config: []\n';
  await stale.writeFile(file, JSON.stringify(data));
  const r = await runtime(); const realigned = new PresetStore(r.ctx, file);
  const base = [{ id: 'compaction', name: 'cordis:group', group: true, config: [{ id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' }] }, { id: 'spill-policy', name: '@deepseek-ai/dsh-spill-policy' }];
  await realigned.ensureOptimized(['read'], base);
  assert.ok(r.registrations.get(template.id).plugins[0].config.some(row => row.name === '@deepseek-ai/dsh-compaction-basic'));
  await realigned.dispose();
  const b2 = await runtime(); const again = new PresetStore(b2.ctx, file);
  await again.initialize();
  await again.unapply(template.id); await again.dispose();
  const c = await runtime(); const reopened = new PresetStore(c.ctx, file);
  const retained = await reopened.ensureOptimized(['different'], []);
  assert.equal(retained.status, 'draft'); assert.equal(c.registrations.size, 0);
  assert.equal(retained.name, 'Optimized');
  assert.deepEqual(retained.request.tools, []);
  const { id, ...copy } = retained;
  const saved = await reopened.save(JSON.stringify(copy));
  assert.match(saved.id, /^studio-user-/); assert.equal(saved.nonDeletable, undefined);
  await reopened.delete(saved.id);
  await reopened.apply(template.id); assert.ok(c.registrations.has(template.id));
  await assert.rejects(reopened.delete(template.id), /non-deletable/);
  await reopened.dispose();
});

test('Optimized is locked: Edit and Delete are disabled, Create copy stays available', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root'));
  const template = optimizedTemplate([]); let edited; let copied;
  const api = { list: async () => [template], apply: async () => template, unapply: async () => {}, delete: async () => {} };
  try {
    await act(async () => root.render(React.createElement(PresetList, { locale: 'ko', revision: 0, api, onEdit: value => { edited = value; }, onCopy: value => { copied = value; } })));
    const buttons = [...document.querySelectorAll('article button')].filter(button => !button.closest('.studio-split'));
    assert.deepEqual(buttons.filter(button => button.disabled).map(button => button.textContent), ['편집', '삭제']);
    await act(async () => buttons.find(button => button.textContent === '편집').click());
    await act(async () => buttons.find(button => button.textContent === '복사').click());
    assert.equal(edited, undefined); assert.equal(copied.id, template.id);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
