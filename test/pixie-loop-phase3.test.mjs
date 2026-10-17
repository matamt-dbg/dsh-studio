/** Pixie Loop 3차 (#31 S14–S16): saved recipes, gate loop engine (check/repair), and `pixie loop` in hook scripts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRecipe, validateRecipeSpec } from '../src/pixie-loop-recipes.ts';
import { PixieLoopRecipes } from '../src/host/pixie-loop-recipe-store.ts';
import { COMPILE_SYSTEM, INTERPRET_SYSTEM } from '../src/host/pixie-loop-engine.ts';
import { recipeGateOutput, runRecipeOn } from '../src/host/pixie-loop-recipe-run.ts';
import { GateTaskRunner } from '../src/host/pixie-gate-task-runner.ts';
import { HELPER_ROUTE, PixieGateHelper } from '../src/host/pixie-gate-helper.ts';
import { validateGateTask } from '../src/pixie-gate-task-contracts.ts';
import { makeTask } from '../src/pixie-gate-task.ts';

const model = { provider: 'p', model: 'pixie' };
const checks = { questions: { korean: { type: 'noul', instructions: 'Is `output` natural Korean with the meaning of `input`?' } }, pass: { korean: { min: 0.7 } } };
const spec = { work: { instruction: 'Translate to Korean.' }, checks, calibration: { pass: [{ input: 'Save', output: '저장' }], fail: [{ input: 'Save', output: 'Save' }] }, limits: { tokens: 50000, timeMs: 30000 }, maxAttempts: 2 };
const reply = text => (async function* () { yield { type: 'text-delta', text }; yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } }; yield { type: 'finish', reason: { kind: 'stop' } }; })();
const llm = (work = () => '저장') => ({ stream: options => reply(options.system === INTERPRET_SYSTEM ? 'Write it in Korean.' : options.system === COMPILE_SYSTEM ? JSON.stringify(checks) : work(options)) });
const judge = { kind: 'judge', label: 'fake', async judge(request) { return { ok: true, answers: { korean: { type: 'noul', noul: /[가-힣]/.test(request.state.output) ? 0.92 : 0.08 } }, usage: { inputTokens: 2, outputTokens: 1 } }; } };
const signal = () => new AbortController().signal;

test('recipe specs have no items or output and must carry calibrated checks', () => {
  assert.throws(() => validateRecipeSpec({ ...spec, items: { inline: [] } }), /no items or output/);
  validateRecipeSpec(spec);
  assert.throws(() => validateRecipe({ name: 'ko', spec, savedAt: 1 }), /checks are missing/);
  assert.throws(() => validateRecipe({ name: 'Bad Name', spec, checks, savedAt: 1 }), /lowercase/);
  assert.equal(validateRecipe({ name: 'ko', spec, checks, savedAt: 1 }).name, 'ko');
});

test('saving a recipe compiles and calibrates once; a calibration failure saves nothing', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'recipes-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PixieLoopRecipes(join(dir, 'recipes.json'));
  const { checks: _checks, ...criteriaSpec } = spec;
  const saved = await store.save({ name: 'ko-review', description: 'Korean review', spec: { ...criteriaSpec, criteria: 'Natural Korean with the same meaning.' } }, { llm: llm(), model, judge }, signal());
  assert.equal(saved.compiledBy, 'pixie'); assert.deepEqual(saved.checks, checks);
  assert.deepEqual((await store.read()).recipes.map(recipe => recipe.name), ['ko-review']);
  const always = { ...judge, async judge() { return { ok: true, answers: { korean: { type: 'noul', noul: 0.9 } } }; } };
  await assert.rejects(store.save({ name: 'broken', spec }, { llm: llm(), model, judge: always }, signal()), /Calibration failed/);
  assert.deepEqual((await store.read()).recipes.map(recipe => recipe.name), ['ko-review']);
  await assert.rejects(store.get('missing'), /Unknown Pixie Loop recipe: missing/);
  await store.remove('ko-review');
  assert.deepEqual((await store.read()).recipes, []);
  assert.match(await readFile(join(dir, 'recipes.json'), 'utf8'), /"recipes": \[\]/);
});

const recipe = { name: 'ko', spec: validateRecipeSpec(spec), checks, compiledBy: 'spec', savedAt: 1 };

test('check judges the target unchanged; repair reworks it with retries and returns the passing text', async () => {
  const pass = await runRecipeOn(recipe, 'check', '저장했습니다', { llm: llm(() => 'never used'), model, judge }, { sessionId: 's', signal: signal(), source: 'gate' });
  assert.equal(pass.passed, true); assert.deepEqual(recipeGateOutput('check', pass), { verdict: 'pass' });
  const fail = await runRecipeOn(recipe, 'check', 'Saved', { llm: llm(), model, judge }, { sessionId: 's', signal: signal(), source: 'gate' });
  assert.equal(fail.passed, false); assert.equal(fail.run.items[0].attempts.length, 1); assert.equal(fail.run.items[0].attempts[0].output, 'Saved');
  assert.match(fail.reason, /Did not pass ko\. Write it in Korean\./);
  assert.deepEqual(recipeGateOutput('check', fail), { verdict: 'stop', reason: fail.reason });
  const repaired = await runRecipeOn(recipe, 'repair', 'Saved', { llm: llm(options => options.messages.length === 1 ? 'Saved' : '저장됨'), model, judge }, { sessionId: 's', signal: signal(), source: 'gate' });
  assert.equal(repaired.passed, true); assert.equal(repaired.output, '저장됨');
  assert.deepEqual(recipeGateOutput('repair', repaired), { verdict: 'pass', replace: '저장됨' });
  assert.equal(repaired.run.source, 'gate'); assert.equal(repaired.run.recipe, 'ko');
  await assert.rejects(runRecipeOn({ ...recipe, spec: { ...recipe.spec, act: { tool: 'bash', command: 'x', safeToRepeat: true, isolated: false, timeoutMs: 1000, maxObservationChars: 100 } } }, 'check', 'x', { llm: llm(), model, judge }, { sessionId: 's', signal: signal(), source: 'gate' }), /cannot run it/);
});

test('gate definitions accept a loop engine; repair only where content can be replaced; not with a script', () => {
  const base = { ...makeTask('Korean check', 'agent-message', ''), presetIds: ['p'] };
  assert.deepEqual(validateGateTask({ ...base, advanced: { ...base.advanced, loop: { recipe: 'ko', mode: 'repair' } } }).advanced.loop, { recipe: 'ko', mode: 'repair' });
  const turnEnd = makeTask('x', 'turn-end', '');
  assert.throws(() => validateGateTask({ ...turnEnd, advanced: { ...turnEnd.advanced, loop: { recipe: 'ko', mode: 'repair' } } }), /repair needs a point/);
  validateGateTask({ ...turnEnd, advanced: { ...turnEnd.advanced, loop: { recipe: 'ko', mode: 'check' } } });
  assert.throws(() => validateGateTask({ ...base, advanced: { ...base.advanced, script: 'a.sh', loop: { recipe: 'ko', mode: 'check' } } }), /either a hook script or a loop recipe/);
  assert.throws(() => validateGateTask({ ...base, advanced: { ...base.advanced, loop: { recipe: 'KO', mode: 'check' } } }), /Invalid gate loop/);
});

test('a loop gate concludes from the recipe, records the run, and counts usage', async () => {
  const records = [];
  const runner = new GateTaskRunner({ llm: llm(options => options.messages.length === 1 ? 'Saved' : '저장됨'), model, judge, loop: { recipe: async name => { assert.equal(name, 'ko'); return recipe; }, record: async run => { records.push(run); } } });
  const task = makeTask('Korean', 'agent-message', '');
  task.advanced.loop = { recipe: 'ko', mode: 'repair' };
  const result = await runner.run(task, 'Saved', signal(), { sessionId: 'session-1', cwd: '/tmp', turn: 1, agent: 'child' });
  assert.equal(result.status, 'done'); assert.equal(result.concludedBy, 'loop');
  assert.deepEqual(result.output, { verdict: 'pass', replace: '저장됨' });
  assert.ok(result.usage.inputTokens > 0);
  assert.equal(records.length, 1); assert.equal(records[0].sessionId, 'session-1'); assert.equal(records[0].source, 'gate');
  task.advanced.loop = { recipe: 'ko', mode: 'check' };
  const stopped = await runner.run(task, 'Saved', signal(), { sessionId: 'session-1', cwd: '/tmp', turn: 1, agent: 'child' });
  assert.equal(stopped.output.verdict, 'stop'); assert.match(stopped.output.reason, /Did not pass ko/);
});

function bash(command, env, stdin = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', command], { env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

test('pixie loop in a hook script: exit 0 with the repaired text, exit 1 with the reason, --json details', async t => {
  const bin = await mkdtemp(join(tmpdir(), 'pixie-loop-helper-')); t.after(() => rm(bin, { recursive: true, force: true }));
  let url;
  const helper = new PixieGateHelper({ binDirectory: bin, url: () => url });
  const http = createServer((req, res) => { if (new URL(req.url, 'http://x').pathname.startsWith(HELPER_ROUTE)) return void helper.handle(req, res); res.writeHead(404); res.end(); });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => http.close(resolve)));
  url = `http://127.0.0.1:${http.address().port}${HELPER_ROUTE}`;
  const calls = [];
  const grant = { target: 'Saved', signal: new AbortController().signal, ask: async () => '', judge: async () => { throw new Error('unused'); },
    loop: async (name, mode, input) => {
      calls.push([name, mode, input]);
      const passed = mode === 'repair' || /[가-힣]/.test(input);
      const text = passed ? (mode === 'repair' ? '저장됨' : input) : 'Did not pass ko. Write it in Korean.';
      return { exit: passed ? 0 : 1, text, json: { recipe: name, mode, passed, reason: passed ? 'Passed ko' : text, runId: 'r', ...(mode === 'repair' ? { output: '저장됨' } : {}) } };
    } };
  const session = await helper.issue(grant);
  let result = await bash('pixie loop --recipe ko', session.env);
  assert.deepEqual([result.code, result.stdout], [1, 'Did not pass ko. Write it in Korean.\n']);
  result = await bash('printf "저장" | pixie loop --recipe ko --input', session.env);
  assert.deepEqual([result.code, result.stdout], [0, '저장\n']);
  result = await bash('pixie loop --recipe ko --mode repair --json', session.env);
  assert.equal(result.code, 0); assert.deepEqual(JSON.parse(result.stdout), { recipe: 'ko', mode: 'repair', passed: true, reason: 'Passed ko', runId: 'r', output: '저장됨' });
  result = await bash('pixie loop --mode check', session.env);
  assert.equal(result.code, 2); assert.match(result.stderr, /usage: pixie loop --recipe/);
  result = await bash('pixie loop --recipe ko --mode fix', session.env);
  assert.equal(result.code, 2); assert.match(result.stderr, /mode must be check or repair/);
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [['ko', 'check'], ['ko', 'check'], ['ko', 'repair']]);
  assert.equal(calls[0][2], 'Saved');
});

test('recipes page lists recipes, saves JSON specs through the Remote, and reports calibration errors', async () => {
  // react-dom decides at import time whether a DOM exists, so the document comes first.
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body></body>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = (await import('react')).default; const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { LoopRecipesPage, EXAMPLE_RECIPE_SPEC } = await import('../src/pixie-loop-recipes-page.tsx');
  validateRecipeSpec(JSON.parse(EXAMPLE_RECIPE_SPEC));
  let recipes = [{ name: 'ko', description: 'Korean review', spec: validateRecipeSpec(spec), checks, compiledBy: 'spec', savedAt: 1 }];
  const saved = [];
  const actions = {
    list: async () => ({ recipes, invalid: [] }),
    save: recipe => { saved.push(recipe); return { result: recipe.name === 'bad' ? Promise.reject(new Error('Calibration failed: x')) : Promise.resolve({ ...recipe, savedAt: 2 }).then(value => { recipes = [...recipes, value]; return value; }), cancel() {} }; },
    remove: async name => { recipes = recipes.filter(recipe => recipe.name !== name); return { recipes, invalid: [] }; },
  };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(LoopRecipesPage, { actions, locale: 'ko' })));
  assert.match(host.textContent, /ko검토/); assert.match(host.textContent, /Korean review · 검사 1개/);
  const input = (label, value) => { const node = host.querySelector(`[aria-label="${label}"]`); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value').set; setter.call(node, value); node.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const saveButton = () => [...host.querySelectorAll('button')].find(button => button.textContent === '확인하고 저장');
  await act(async () => { input('이름', 'Bad Name'); input('명세 (JSON)', JSON.stringify(spec)); });
  assert.match(host.textContent, /소문자, 숫자, -만 쓸 수 있습니다/); assert.equal(saveButton().disabled, true);
  await act(async () => { input('이름', 'ko'); });
  assert.match(host.textContent, /기존 ko 레시피를 바꿉니다/);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '예시 넣기').click());
  assert.equal(host.querySelector('[aria-label="명세 (JSON)"]').value, EXAMPLE_RECIPE_SPEC);
  await act(async () => { input('이름', 'bad'); input('명세 (JSON)', JSON.stringify(spec)); });
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '확인하고 저장').click());
  assert.match(host.textContent, /Calibration failed: x/);
  await act(async () => { input('이름', 'ko-two'); });
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '확인하고 저장').click());
  assert.match(host.textContent, /ko-two을\(를\) 저장했습니다/); assert.deepEqual(saved.map(item => item.name), ['bad', 'ko-two']);
  await act(async () => host.querySelector('[aria-label="ko 삭제"]').click());
  assert.doesNotMatch(host.textContent, /Korean review/);
  await act(async () => root.unmount());
});

test('loop gates receive the hook context so their runs land in the gate session', async () => {
  const { executeTask } = await import('../src/host/pixie-gate-task-executor.ts');
  const records = [];
  const runner = new GateTaskRunner({ llm: llm(), model, judge, loop: { recipe: async () => recipe, record: async run => { records.push(run); } } });
  const task = makeTask('Korean', 'user-message', '');
  task.advanced.loop = { recipe: 'ko', mode: 'check' };
  await executeTask(task, '저장', signal(), async () => runner, () => ({ sessionId: 'session-9', cwd: '/tmp', turn: 1, agent: 'root' }));
  assert.equal(records[0].sessionId, 'session-9');
});
