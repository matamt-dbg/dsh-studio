import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { PixieSettingsPage } from '../src/pixie-settings.tsx';
import { GATE_TEMPLATES, GATE_WHENS, makeTask, taskProblem, taskVariables } from '../src/pixie-gate-task.ts';
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const button = (h, name) => [...h.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent) === name);
const pick = (h, title) => [...h.querySelectorAll('button.studio-pick')].find(b => b.querySelector('.studio-pick-title').textContent.startsWith(title));
const input = (h, label) => h.querySelector(`[aria-label="${label}"]`);
const click = async el => { assert.ok(el); await act(async () => el.click()); };
const change = async (el, value) => { assert.ok(el); await act(async () => { el.value = value; Simulate.change(el); }); };
const SCRIPTS = ['only-search-tools.sh', 'measure-subtitle.sh', 'list-changed-files.sh'];
async function settings(t, locale = 'en', options = {}) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const saved = [], trials = [], folders = [], opened = [];
  const defaultDirectory = '/profile/studio-data/pixie-gate/commands';
  const list = directory => ({ directory: directory || defaultDirectory, defaultDirectory, custom: !!directory, supported: options.supported ?? true, scripts: SCRIPTS });
  const gateActions = {
    read: async () => options.read ?? { entries: [], invalid: [] },
    presets: async () => options.presets ?? [{ id: 'p', name: 'Preset' }, { id: 'q', name: 'Other' }],
    save: async tasks => { if (options.saveError) throw new Error(options.saveError); saved.push(structuredClone(tasks)); return tasks; },
    scripts: async () => list(''),
    saveScriptDirectory: async directory => { if (directory && !/^[~/]/.test(directory)) throw new Error('Gate script folder must be an absolute path'); folders.push(directory); return list(directory.replace(/^~/, '/home/me')); },
    openFolder: async path => { opened.push(path); if (options.openError) throw new Error(options.openError); },
    trial: request => { trials.push(request); return { result: options.trial ? Promise.resolve(options.trial) : new Promise(() => {}), cancel() { trials.cancelled = true; } }; },
  };
  await act(async () => root.render(React.createElement(PixieSettingsPage, { locale, gateActions, actions: { read: async () => ({ contextMode: 'fresh', systemPrompt: '', allowThreadModel: false }), models: async () => ({ groups: [] }), save: async s => s } })));
  t.after(async () => { await act(async () => root.unmount()); host.remove(); });
  host.saved = saved; host.trials = trials; host.folders = folders; host.opened = opened;
  return host;
}
const page = (h, label) => h.querySelector(`section[aria-label="${label}"]`);

test('gate group holds composition and scope pages after Judge, loaded from the Host', async t => {
  const task = { ...makeTask('Stored'), instruction: 'Check it', enabled: true, presetIds: ['p'] };
  const host = await settings(t, 'ko', { read: { entries: [task], invalid: [{ index: 1, raw: {}, error: { code: 'invalid-entry', message: 'Invalid gate task' } }] } });
  const nav = [...host.querySelectorAll('nav.studio-nav > *')].map(el => el.textContent);
  assert.deepEqual(nav.slice(-3), ['게이트', '게이트 구성', '적용 범위']);
  assert.ok(nav.indexOf('판정') < nav.indexOf('게이트'));
  const comp = page(host, '게이트 구성');
  assert.doesNotMatch(comp.textContent, /화면 시안/);
  assert.match(comp.querySelector('[data-gate-task]').textContent, /Stored/);
  assert.match(comp.textContent, /읽을 수 없는 게이트 1개.*#2 Invalid gate task/);
  assert.equal(button(comp, '저장됨').disabled, true);
});

test('Save sends the whole edited list and reports failures', async t => {
  const host = await settings(t);
  const comp = page(host, 'Gate composition');
  await click(button(comp, 'New gate'));
  await click(pick(comp.querySelector('dialog'), 'Instruction format check'));
  const editor = [...comp.querySelectorAll('dialog')].find(d => input(d, 'What to send Pixie'));
  await click(button(editor, 'Apply'));
  assert.match(comp.textContent, /Unsaved changes/);
  await click(input(comp, 'Gate on Instruction format check'));
  await click(button(comp, 'Save'));
  assert.equal(host.saved.length, 1); assert.equal(host.saved[0][0].name, 'Instruction format check'); assert.equal(host.saved[0][0].enabled, false);
  assert.equal(button(comp, 'Saved').disabled, true); assert.doesNotMatch(comp.textContent, /Unsaved changes/);
});
test('a failed save keeps the draft and shows the Host error', async t => {
  const host = await settings(t, 'en', { saveError: 'Only one enabled gate per preset and when is supported' });
  const comp = page(host, 'Gate composition');
  await click(button(comp, 'New gate'));
  await click(pick(comp.querySelector('dialog'), 'Blank gate'));
  const editor = [...comp.querySelectorAll('dialog')].find(d => input(d, 'What to send Pixie'));
  await change(input(editor, 'What to send Pixie'), 'x'); await click(button(editor, 'Apply'));
  await click(button(comp, 'Save'));
  assert.match(comp.querySelector('[role=alert]').textContent, /Could not save \(Only one enabled gate/);
  assert.equal(button(comp, 'Save').disabled, false);
});

test('new gate offers one template per point and the blank gate, with no coming-soon entries', async t => {
  const host = await settings(t);
  const comp = page(host, 'Gate composition');
  await click(button(comp, 'New gate'));
  const picker = comp.querySelector('dialog');
  assert.deepEqual([...picker.querySelectorAll('.studio-pick-title')].map(el => el.textContent), [
    'Instruction format checkWhen you send an instruction', 'Agent message protocolWhen agents message each other', 'Block risky commandsBefore a tool runs',
    'Digest long tool resultsWhen a tool result arrives', 'Verify the final answerWhen the agent finishes its answer', 'Blank gate']);
  assert.equal(picker.querySelector('[aria-disabled=true]'), null); assert.doesNotMatch(picker.textContent, /Coming soon/);
  await click(pick(picker, 'Verify the final answer'));
  const editor = [...comp.querySelectorAll('dialog')].find(d => input(d, 'What to send Pixie'));
  assert.equal(input(editor, 'When').value, 'turn-end');
  assert.equal(input(editor, 'Judge question (passes when “yes” is likely)'), null);
  await click(button(editor, 'Apply'));
  const card = comp.querySelector('[data-gate-task]');
  assert.match(card.querySelector('.studio-gate-sentence').textContent, /When the agent finishes its answer→Check that the answer covers/);
  assert.equal(input(card, 'Gate on Verify the final answer').getAttribute('aria-checked'), 'true');
});

test('editor shows two fields up front; script, judge and limits live under Advanced', async t => {
  const host = await settings(t);
  const comp = page(host, 'Gate composition');
  await click(button(comp, 'New gate'));
  await click(pick(comp.querySelector('dialog'), 'Instruction format check'));
  const editor = [...comp.querySelectorAll('dialog')].find(d => input(d, 'What to send Pixie'));
  const advanced = editor.querySelector('details.studio-disclosure');
  assert.ok(advanced.contains(input(editor, 'Pixie hook script')));
  assert.deepEqual([...input(editor, 'Pixie hook script').options].map(o => o.value), ['', ...SCRIPTS]);
  await change(input(editor, 'Pixie hook script'), 'measure-subtitle.sh');
  assert.match(editor.querySelector('.studio-gate-vars').textContent, /\{\{hooks\.measure-subtitle\.text\}\}/);
  assert.match(advanced.textContent, /\/profile\/studio-data\/pixie-gate\/commands/);
  assert.equal(input(editor, 'Decide the verdict with the judge model'), null);
  assert.ok(input(editor, 'Confirm before replacing'));
  await change(input(editor, 'What to send Pixie'), '');
  await click(button(editor, 'Apply'));
  assert.match(editor.textContent, /Describe what Pixie should do/);
  assert.equal(comp.querySelector('[data-gate-task]'), null);
});

test('trial calls the Host and shows the five output fields, the applied plan and usage', async t => {
  const trial = { output: { verdict: 'stop', reason: 'No done criteria', replace: 'Fix login. Done when tests pass.' }, plan: { stop: true, reason: 'No done criteria', suggestion: 'Fix login. Done when tests pass.', notes: [] }, usage: { inputTokens: 12, outputTokens: 5 } };
  const host = await settings(t, 'en', { trial });
  const comp = page(host, 'Gate composition');
  await click(button(comp, 'New gate'));
  await click(pick(comp.querySelector('dialog'), 'Instruction format check'));
  const editor = [...comp.querySelectorAll('dialog')].find(d => input(d, 'What to send Pixie'));
  assert.match(editor.textContent, /Calls the configured Pixie model/);
  assert.match(editor.textContent, /Pixie checks the content and decides the gate result\. See the guide for details on results\. Guide/);
  await change(input(editor, 'Sample your instruction'), 'fix login');
  await click(button(editor, 'Run'));
  assert.equal(host.trials[0].text, 'fix login'); assert.equal(host.trials[0].task.when, 'user-message');
  const result = editor.querySelector('dl.studio-gate-result');
  assert.deepEqual([...result.querySelectorAll('dt')].map(d => d.textContent).slice(0, 6), ['Verdict', 'Reason', 'Replacement', 'Addition', 'Note', 'What happens']);
  assert.match(result.textContent, /Stopped.*No done criteria.*Fix login\. Done when tests pass\..*\(empty\).*Tokens in 12 · out 5/s);
});
test('a running trial can be cancelled', async t => {
  const host = await settings(t);
  const comp = page(host, 'Gate composition');
  await click(button(comp, 'New gate'));
  await click(pick(comp.querySelector('dialog'), 'Digest long tool results'));
  const editor = [...comp.querySelectorAll('dialog')].find(d => input(d, 'What to send Pixie'));
  await change(input(editor, 'Pixie hook script'), 'only-search-tools.sh');
  assert.match(editor.textContent, /Gate tests do not run the script\./);
  await change(input(editor, 'Sample tool name (optional)'), 'grep');
  await change(input(editor, 'Sample the tool result'), 'lines');
  await click(button(editor, 'Run'));
  assert.equal(host.trials[0].toolName, 'grep'); assert.match(editor.textContent, /Running…/);
  await click(button(editor, 'Cancel'));
  assert.equal(host.trials.cancelled, true); assert.ok(button(editor, 'Run'));
});

test('scope lists Studio presets, adds gates per preset, and switches one preset without touching another', async t => {
  const host = await settings(t);
  const comp = page(host, 'Gate composition');
  await click(button(comp, 'New gate'));
  await click(pick(comp.querySelector('dialog'), 'Blank gate'));
  const editor = [...comp.querySelectorAll('dialog')].find(d => input(d, 'What to send Pixie'));
  await change(input(editor, 'What to send Pixie'), 'Check it');
  await click(button(editor, 'Apply'));
  const scope = page(host, 'Scope');
  const preset = id => scope.querySelector(`[data-gate-preset="${id}"]`);
  assert.match(preset('p').textContent, /Preset.*0 gates · 0 on.*No gates on this preset/s);
  assert.equal(scope.querySelector('[data-gate-preset=""]'), null);
  for (const id of ['p', 'q']) {
    await click(button(preset(id), 'Add gate'));
    const dialog = [...scope.querySelectorAll('dialog')].find(d => d.open);
    await click(pick(dialog, 'New gate'));
  }
  assert.equal(scope.querySelector('[data-gate-preset=""]'), null);
  assert.match(comp.querySelector('[data-gate-task]').textContent, /2 presets/);
  const toggle = id => input(preset(id), 'Enabled New gate');
  assert.equal(toggle('p').getAttribute('aria-checked'), 'true'); assert.equal(toggle('q').getAttribute('aria-checked'), 'true');
  await click(toggle('p'));
  assert.equal(toggle('p').getAttribute('aria-checked'), 'false');
  assert.equal(toggle('q').getAttribute('aria-checked'), 'true');
  assert.match(preset('p').textContent, /1 gates · 0 on/); assert.match(preset('q').textContent, /1 gates · 1 on/);
  await click(button(preset('q'), 'Add gate'));
  assert.match([...scope.querySelectorAll('dialog')].find(d => d.open).textContent, /No gate to add/);
  await click(button([...scope.querySelectorAll('dialog')].find(d => d.open), 'Close'));
  await click(button(comp.querySelector('[data-gate-task]'), 'Duplicate'));
  await click(button(preset('q'), 'Add gate'));
  await click(pick([...scope.querySelectorAll('dialog')].find(d => d.open), 'New gate (Duplicate)'));
  assert.match(preset('q').textContent, /More than one enabled gate at this moment/);
  assert.doesNotMatch(preset('p').textContent, /More than one enabled gate/);
  await click(button(preset('q').querySelector('[data-gate-scope]'), 'Remove from preset'));
  assert.doesNotMatch(preset('q').textContent, /More than one enabled gate/);
  await click(button(comp, 'Save'));
  const [first, copy] = host.saved[0];
  assert.deepEqual([first.presetIds, first.disabledPresetIds, first.enabled], [['p'], ['p'], true]);
  assert.deepEqual([copy.presetIds, copy.disabledPresetIds], [['q'], undefined]);
  await click(input(comp, 'Gate on New gate'));
  assert.equal(toggle('p').disabled, true); assert.match(preset('p').textContent, /The gate is off everywhere/);
});
test('scope shows only Studio presets; gates only reach a preset through Add gate', async t => {
  const task = { ...makeTask('Old'), instruction: 'x', presetIds: ['standard'] };
  const host = await settings(t, 'en', { read: { entries: [task], invalid: [] }, presets: [] });
  const scope = page(host, 'Scope');
  assert.match(scope.textContent, /No presets made in Studio yet/);
  assert.equal(scope.querySelector('[data-gate-preset]'), null);
  assert.doesNotMatch(scope.textContent, /Old/);
  assert.equal(scope.querySelector('section').getAttribute('aria-label'), 'Script folder');
});

test('script folder shows the default, saves a custom folder and resets it', async t => {
  const host = await settings(t);
  const scope = page(host, 'Scope');
  const folder = scope.querySelector('section[aria-label="Script folder"]');
  assert.match(folder.textContent, /Default folder: \/profile\/studio-data\/pixie-gate\/commands$/);
  assert.doesNotMatch(folder.textContent, /\d+ scripts/);
  await click(button(folder, 'Open folder'));
  assert.deepEqual(host.opened, ['/profile/studio-data/pixie-gate/commands']);
  assert.equal(button(folder, 'Use default').disabled, true);
  await change(input(folder, 'Script folder'), '~/my-gates');
  await click(button(folder, 'Use folder'));
  assert.deepEqual(host.folders, ['~/my-gates']);
  assert.match(folder.textContent, /Current folder: \/home\/me\/my-gates/);
  await click(button(folder, 'Use default'));
  assert.deepEqual(host.folders, ['~/my-gates', '']);
  assert.match(folder.textContent, /Default folder:/);
  await change(input(folder, 'Script folder'), 'relative');
  await click(button(folder, 'Use folder'));
  assert.match(folder.querySelector('[role=alert]').textContent, /Could not change the folder \(Gate script folder must be an absolute path\)/);
});
test('opening the script folder reports a failure', async t => {
  const host = await settings(t, 'en', { openError: 'Path has no verified Host path' });
  const folder = page(host, 'Scope').querySelector('section[aria-label="Script folder"]');
  await click(button(folder, 'Open folder'));
  assert.match(folder.querySelector('[role=alert]').textContent, /Could not open the folder \(Path has no verified Host path\)/);
});

test('hook script points to the guide instead of inlining its contract', async t => {
  const host = await settings(t);
  const comp = page(host, 'Gate composition');
  await click(button(comp, 'New gate'));
  await click(pick(comp.querySelector('dialog'), 'Digest long tool results'));
  const editor = [...comp.querySelectorAll('dialog')].find(d => input(d, 'What to send Pixie'));
  assert.equal(input(editor, 'Tools'), null);
  assert.equal(input(editor, 'Pixie hook script').value, '');
  const link = [...editor.querySelectorAll('a')].find(a => a.textContent === 'script guide');
  assert.equal(link.closest('p').textContent, 'See the script guide for the full script rules.');
  assert.match(link.getAttribute('href'), /docs\/appendix\/pixie-gate\.md$/);
  assert.doesNotMatch(editor.textContent, /PIXIE_TOOL_NAME|exit code/i);
  assert.match(editor.textContent, /Available only when DSH runs with a bash profile\./);
});
test('a stored script missing from the folder stays selectable and unsupported environments are shown', async t => {
  const task = { ...makeTask('Old'), instruction: 'x', advanced: { ...makeTask('x').advanced, script: 'gone.sh' } };
  const host = await settings(t, 'en', { read: { entries: [task], invalid: [] }, supported: false });
  const comp = page(host, 'Gate composition');
  await click(button(comp.querySelector('[data-gate-task]'), 'Edit'));
  const editor = [...comp.querySelectorAll('dialog')].find(d => input(d, 'What to send Pixie'));
  assert.equal(input(editor, 'Pixie hook script').value, 'gone.sh');
  assert.match(editor.textContent, /gone\.sh \(not in folder\)/);
  assert.match(editor.textContent, /Hook scripts are not supported in this environment/);
});

test('task model: templates, variables and problems', () => {
  assert.deepEqual(GATE_TEMPLATES.map(item => item.when), GATE_WHENS);
  const task = makeTask('x'); task.instruction = 'do';
  assert.deepEqual(taskVariables(task), []);
  task.advanced.script = 'list-changed-files.sh';
  assert.deepEqual(taskVariables(task), ['{{hooks.list-changed-files.text}}', '{{hooks.list-changed-files.data}}']);
  assert.equal(taskProblem(task), undefined);
  task.advanced.timeoutMs = 0; assert.equal(taskProblem(task), 'limits');
});

for (const locale of ['ko', 'zh']) test(`preview is localized: ${locale}`, async t => {
  const host = await settings(t, locale);
  const comp = page(host, locale === 'ko' ? '게이트 구성' : '门控构成');
  await click(button(comp, locale === 'ko' ? '새 게이트' : '新建门控'));
  assert.doesNotMatch(comp.querySelector('dialog').textContent, /Instruction|Coming soon|Blank gate/);
});
