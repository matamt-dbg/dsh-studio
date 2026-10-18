import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { PresetList } from '../src/preset-manager.tsx';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { optimizedTemplate, BUILTIN_TOOL_PRESETS, OPTIMIZED_PRESET_ID, OPTIMIZED_TOOLS, OPTIMIZED_PROMPT, WORKER_PERSONA } from '../src/optimized-preset.ts';
import { PresetStore } from '../src/host/preset-store.ts';
import { storeRuntime } from './store-runtime.mjs';
const runtime = () => storeRuntime({ base: 'studio-master', document: '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n  config: {complete: true}\n- id: spill-policy\n  name: "@deepseek-ai/dsh-spill-policy"\n' });
test('Optimized selects only its fixed allow list, never an extra profile tool', () => {
  // The desktop profile registers these four through its runtime plugins; they must not leak in.
  const catalog = ['load_workspace_dependencies', 'x_search', 'video_generate', 'image_generate', ...OPTIMIZED_TOOLS];
  const template = optimizedTemplate(catalog);
  assert.equal(OPTIMIZED_TOOLS.length, 27);
  assert.deepEqual([...template.request.tools].sort(), [...OPTIMIZED_TOOLS].sort());
  for (const extra of ['load_workspace_dependencies', 'x_search', 'video_generate', 'image_generate']) assert.ok(!template.request.tools.includes(extra));
});
test('Optimized template carries the #34 tuned values for every selected tool', () => {
  const full = optimizedTemplate([...OPTIMIZED_TOOLS]);
  const { request } = full;
  assert.equal(full.applyWarning, undefined);
  assert.equal(request.tools.indexOf('edit_batch'), request.tools.indexOf('edit') + 1);
  for (const name of ['judge', 'pixie_loop', 'cordis_inspect_list', 'cordis_inspect_query', 'subagent_role']) assert.ok(request.tools.includes(name), name);
  assert.deepEqual(request.configOverrides, { 'spill-policy': { maxInlineTokens: 2500 }, 'studio-batch': { maxLines: null, noSpill: true } });
  assert.deepEqual(request.execution.defaults, { bash: { timeoutMs: 120000 }, job_output: { timeout_ms: 120000 } });
  assert.equal(request.toolOverrides.bash.parameters.timeoutMs, 'Foreground wait in milliseconds; defaults to 120000ms, subject to the runtime cap. A command that runs longer keeps running as a background job; collect it with job_output instead of rerunning it.');
  assert.equal(request.toolOverrides.bash.parameters.run_in_background, 'Use for builds, tests, or scripts expected to take longer than a minute; continue other work and collect the result with job_output.');
  assert.deepEqual(request.toolOverrides.read.parameters, { limit: 'Maximum lines to return. Omit to read the whole file (up to 2000 lines).', offset: '1-based first line. Use only to continue a file longer than the read cap.' });
  assert.deepEqual(request.sections, { 'tool:read': 'Use read, not cat, for text files. One read returns up to 2000 lines; omit limit unless a file is larger.', 'tool:goal': '' });
  assert.equal(request.prompt, OPTIMIZED_PROMPT);
  assert.equal(request.prompt.split('\n').length, 7);
  assert.deepEqual(full.agents, [{ name: 'Worker', role: 'worker', model: 'inherit', reasoning: 'inherit', spawn: 'fresh', persona: WORKER_PERSONA,
    toolFilter: { mode: 'replace', deny: ['send_message', 'interrupt_agent', 'list_agents', 'workflow', 'ask_user_question', 'exit_plan_mode', 'present', 'judge', 'pixie_loop', 'cordis_inspect_list', 'cordis_inspect_query'] } }]);
  // The main agent keeps every tool the Worker hides, so apply accepts the Worker's filter.
  for (const name of full.agents[0].toolFilter.deny) assert.ok(request.tools.includes(name), name);
});
test('Optimized template drops sentences, Config and Worker filter entries for tools it could not select', () => {
  const lean = optimizedTemplate(['read', 'edit', 'bash', 'job_output', 'send_message', 'subagent_role']);
  assert.doesNotMatch(lean.request.prompt, /read_batch|edit_batch/);
  assert.equal(lean.request.prompt.split('\n').length, 6);
  assert.match(lean.request.prompt, /^Read whole files in one call; use offset\/limit only past the read cap\. Do not re-read/);
  assert.equal(lean.request.configOverrides['studio-batch'], undefined);
  assert.deepEqual(lean.agents[0].toolFilter.deny, ['send_message']);
  assert.match(lean.applyWarning, /read_batch, edit_batch, judge, pixie_loop/);
  // Without the role tool there is nothing to start a Worker with.
  assert.deepEqual(optimizedTemplate(['read']).agents, []);
  assert.deepEqual(optimizedTemplate(['bash']).request.sections, { 'tool:goal': '' });
});
test('Optimized seeds once, supports edit/apply/unapply, survives restart, and only deletion is prohibited', async () => {
  const template = optimizedTemplate([]);
  assert.equal(template.nonDeletable, true); assert.equal(template.readOnly, undefined);
  assert.match(template.applyWarning, /read_batch/);
  const defaults = optimizedTemplate(['bash', 'job_output', 'read_batch', 'task_run', 'get_goal', 'create_goal', 'update_goal', 'todo_write']);
  assert.deepEqual(defaults.request.tools, ['bash', 'job_output', 'read_batch']);
  assert.equal(defaults.request.configOverrides['spill-policy'].maxInlineTokens, 2500);
  assert.deepEqual(defaults.request.execution.defaults, { bash: { timeoutMs: 120000 }, job_output: { timeout_ms: 120000 } });
  assert.doesNotMatch(JSON.stringify(defaults.request), /task_run/);
  assert.match(defaults.request.toolOverrides.job_output.parameters.wait, /Use true/);
  assert.equal(optimizedTemplate(['read_batch', 'edit_batch', 'judge', 'pixie_loop', 'task_run']).applyWarning, undefined);
  assert.deepEqual(optimizedTemplate(['read', 'cordis_inspect_list', 'cordis_inspect_query', 'plugin_manager', 'subagent']).request.tools, ['read', 'cordis_inspect_list', 'cordis_inspect_query', 'subagent_role']);
  assert.deepEqual(BUILTIN_TOOL_PRESETS, ['standard', 'ptc', 'minimal', 'cordis']);
  const file = join(await mkdtemp(join(tmpdir(), 'studio-template-')), 'presets.json');
  const fs = await import('node:fs/promises');
  const a = await runtime(); const store = new PresetStore(a.ctx, file);
  const seeded = await store.ensureOptimized([]);
  assert.equal(a.registrations.get(template.id).plugins.find(row => row.id === 'spill-policy').config.maxInlineTokens, 2500);
  assert.equal(seeded.status, 'applied'); assert.ok(a.registrations.has(template.id));
  assert.equal(seeded.customized, undefined);
  await assert.rejects(store.delete(template.id), /non-deletable/);
  assert.equal((await store.apply(template.id)).status, 'applied'); await store.dispose();
  // An unedited Optimized follows the shipped template on the next start.
  const b = await runtime(); const restored = new PresetStore(b.ctx, file);
  await restored.ensureOptimized(['read']);
  assert.deepEqual((await restored.list())[0].request.tools, ['read']);
  assert.equal(b.registrations.get(template.id).name, 'Optimized');
  await restored.dispose();
  // A snapshot composed by an older build (empty compaction group) is rebuilt from the current base.
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  data.presets[0].applied.plugins = '- id: compaction\n  name: cordis:group\n  group: true\n  config: []\n';
  await fs.writeFile(file, JSON.stringify(data));
  const r = await storeRuntime({ base: 'studio-master', document: '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n- id: compaction\n  name: cordis:group\n  group: true\n  config:\n    - id: compaction-basic\n      name: "@deepseek-ai/dsh-compaction-basic"\n- id: spill-policy\n  name: "@deepseek-ai/dsh-spill-policy"\n' });
  const realigned = new PresetStore(r.ctx, file);
  await realigned.ensureOptimized(['read']);
  assert.match(JSON.stringify(r.registrations.get(template.id).plugins), /dsh-compaction-basic/);
  await realigned.dispose();
  const b2 = await runtime(); const again = new PresetStore(b2.ctx, file);
  await again.initialize();
  await again.unapply(template.id); await again.dispose();
  const c = await runtime(); const reopened = new PresetStore(c.ctx, file);
  const retained = await reopened.ensureOptimized(['different']);
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
test('Optimized applies its sections, Worker role and child Tool Filter through the shared apply path', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'studio-template-')), 'presets.json');
  const a = await runtime(); const store = new PresetStore(a.ctx, file);
  const seeded = await store.ensureOptimized(['read', 'subagent_role']);
  assert.equal(seeded.agents.length, 1); assert.equal(seeded.agents[0].name, 'Worker');
  const yaml = JSON.stringify(a.registrations.get(OPTIMIZED_PRESET_ID).plugins);
  const plugins = a.registrations.get(OPTIMIZED_PRESET_ID).plugins;
  const policy = plugins.find(row => row.id === 'studio-policy').config;
  assert.equal(policy.sections['tool:read'], optimizedTemplate(['read']).request.sections['tool:read']);
  const roles = plugins.find(row => row.id === 'studio-roles').config.roles;
  assert.deepEqual(roles.map(role => [role.name, role.persona]), [['Worker', WORKER_PERSONA]]);
  assert.doesNotMatch(yaml, /studio-optimized-policy/);
  await store.dispose();
});
test('An edited Optimized is kept across template changes, reports new defaults, and restores them', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'studio-template-')), 'presets.json');
  const a = await runtime(); const store = new PresetStore(a.ctx, file);
  const seeded = await store.ensureOptimized(['subagent_role']);
  // Saving without changes normalizes the request but is not an edit.
  assert.equal((await store.save(JSON.stringify(seeded))).customized, undefined);
  const saved = await store.save(JSON.stringify({ ...seeded, request: { ...seeded.request, prompt: 'User-edited instruction' } }));
  assert.equal(saved.id, OPTIMIZED_PRESET_ID); assert.equal(saved.status, 'modified');
  assert.equal(saved.customized, true); assert.equal(saved.newDefaults, undefined);
  assert.equal((await store.apply(OPTIMIZED_PRESET_ID)).status, 'applied');
  assert.match(JSON.stringify(a.registrations.get(OPTIMIZED_PRESET_ID).plugins), /User-edited instruction/);
  await store.dispose();
  // A newer template (here: another tool installed) never overwrites the user's edit.
  const b = await runtime(); const next = new PresetStore(b.ctx, file);
  const kept = await next.ensureOptimized(['read', 'subagent_role']);
  assert.equal(kept.request.prompt, 'User-edited instruction');
  assert.equal(kept.customized, true); assert.equal(kept.newDefaults, true);
  await assert.rejects(next.delete(OPTIMIZED_PRESET_ID), /non-deletable/);
  // Restore adopts the current defaults and applies them.
  const back = await next.restoreOptimized();
  const expected = optimizedTemplate(['read', 'subagent_role']);
  assert.deepEqual(back.request, expected.request); assert.deepEqual(back.agents, expected.agents);
  assert.equal(back.status, 'applied'); assert.equal(back.customized, undefined); assert.equal(back.newDefaults, undefined);
  assert.doesNotMatch(JSON.stringify(b.registrations.get(OPTIMIZED_PRESET_ID).plugins), /User-edited instruction/);
  await next.dispose();
});
test('Optimized rows from before it was editable are treated as unedited and adopt the new template', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'studio-template-')), 'presets.json');
  const fs = await import('node:fs/promises');
  const a = await runtime(); const store = new PresetStore(a.ctx, file);
  await store.ensureOptimized(['read']); await store.dispose();
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  delete data.presets[0].templateHash; data.presets[0].request.prompt = 'Older shipped instruction';
  await fs.writeFile(file, JSON.stringify(data));
  const b = await runtime(); const upgraded = new PresetStore(b.ctx, file);
  const row = await upgraded.ensureOptimized(['read']);
  assert.equal(row.request.prompt, optimizedTemplate(['read']).request.prompt); assert.equal(row.customized, undefined);
  await upgraded.dispose();
});
test('A new template that cannot apply keeps the previous snapshot and is reported as needing reapply', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'studio-template-')), 'presets.json');
  const a = await runtime(); const store = new PresetStore(a.ctx, file);
  await store.ensureOptimized(['read']); const before = a.registrations.get(OPTIMIZED_PRESET_ID).plugins; await store.dispose();
  // The next start offers a tool the base composition does not supply, so applying the new template fails.
  const b = await runtime(); const next = new PresetStore(b.ctx, file);
  const row = await next.ensureOptimized(['read', 'bash']);
  assert.equal(row.status, 'modified'); assert.match(row.applyWarning, /Apply failed: .*bash/);
  assert.deepEqual(row.request.tools, ['read', 'bash']);
  assert.deepEqual(b.registrations.get(OPTIMIZED_PRESET_ID).plugins, before);
  await next.dispose();
});
test('A first seed that cannot apply is retried at the next start; a user unapply is kept', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'studio-template-')), 'presets.json');
  const a = await runtime(); const store = new PresetStore(a.ctx, file);
  const failed = await store.ensureOptimized(['read', 'bash']);
  assert.equal(failed.status, 'draft'); assert.match(failed.applyWarning, /Apply failed:/); assert.equal(a.registrations.size, 0);
  await store.dispose();
  const b = await runtime(); const retried = new PresetStore(b.ctx, file);
  const row = await retried.ensureOptimized(['read']);
  assert.equal(row.status, 'applied'); assert.ok(b.registrations.has(OPTIMIZED_PRESET_ID));
  await retried.unapply(OPTIMIZED_PRESET_ID); await retried.dispose();
  const c = await runtime(); const kept = new PresetStore(c.ctx, file);
  assert.equal((await kept.ensureOptimized(['read'])).status, 'draft'); assert.equal(c.registrations.size, 0);
  await kept.dispose();
});

test('Optimized can be edited and restored; only Delete is disabled', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root'));
  const template = { ...optimizedTemplate([]), customized: true, newDefaults: true }; let edited; let copied; let restored = 0;
  const api = { list: async () => [template], apply: async () => template, unapply: async () => {}, delete: async () => {}, restoreOptimized: async () => { restored++; return template; } };
  try {
    await act(async () => root.render(React.createElement(PresetList, { locale: 'ko', revision: 0, api, onEdit: value => { edited = value; }, onCopy: value => { copied = value; } })));
    const card = document.querySelector('article');
    assert.match(card.textContent, /직접 편집함/); assert.match(card.textContent, /새 기본값/);
    const buttons = [...card.querySelectorAll('button')].filter(button => !button.closest('.studio-split'));
    assert.deepEqual(buttons.filter(button => button.disabled).map(button => button.textContent), ['삭제']);
    await act(async () => buttons.find(button => button.textContent === '편집').click());
    await act(async () => buttons.find(button => button.textContent === '복사').click());
    assert.equal(edited.id, template.id); assert.equal(copied.id, template.id);
    await act(async () => buttons.find(button => button.textContent === '기본값으로 복구').click());
    const confirm = [...document.querySelectorAll('button')].find(button => button.textContent === '복구하고 반영');
    assert.ok(confirm); assert.equal(restored, 0);
    await act(async () => confirm.click());
    assert.equal(restored, 1);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
