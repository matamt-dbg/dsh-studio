/** Pixie Loop 2차 (#31 S9–S13): act, extract, route, episode, and selection, with fake models and a fake bash. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actCommand, parseOptions, shellWord, summarizeRun, validateLoopSpec } from '../src/pixie-loop-contracts.ts';
import { EXTRACT_SYSTEM, INTERPRET_SYSTEM, runLoop } from '../src/host/pixie-loop-engine.ts';

const model = { provider: 'p', model: 'pixie' };
const signal = () => new AbortController().signal;
const reply = text => (async function* () { yield { type: 'text-delta', text }; yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } }; yield { type: 'finish', reason: { kind: 'stop' } }; })();
const llmFrom = work => { const calls = []; return { calls, stream(options) { calls.push(options); return reply(options.system === INTERPRET_SYSTEM ? 'try another selector' : options.system.startsWith(EXTRACT_SYSTEM) ? `short:${options.messages[0].content[0].text.slice(0, 20)}` : work(options)); } }; };
const noulJudge = (good, calls = []) => ({ kind: 'judge', label: 'fake', async judge(request) {
  calls.push(request);
  const answers = {};
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type === 'noul') answers[id] = { type: 'noul', noul: good(request.state) ? 0.9 : 0.1 };
    else { const names = Object.keys(question.criteria); const pick = typeof good(request.state) === 'string' ? good(request.state) : names[0]; answers[id] = { type: 'choice', choice: pick, probabilities: Object.fromEntries(names.map(name => [name, name === pick ? 0.9 : 0.1 / (names.length - 1)])), confidence: 0.9 }; }
  }
  return { ok: true, answers, usage: { inputTokens: 3, outputTokens: 1 } };
} });
const checks = { questions: { works: { type: 'noul', instructions: 'Does `observation` show the button was clicked?' } }, pass: { works: { min: 0.7 } } };
const act = extra => ({ tool: 'bash', command: 'node probe.mjs {{output}}', safeToRepeat: true, ...extra });
const calibration = { pass: [{ input: 'x', output: '#ok', observation: 'clicked' }], fail: [{ input: 'x', output: '#no', observation: 'no element' }] };
const limits = { tokens: 100000, timeMs: 60000 };

test('act rules: bash only, safeToRepeat required, known variables, episode and extract need act', () => {
  const base = { items: { inline: [{ id: 'a', input: 'x' }] }, work: { instruction: 'w' }, checks, calibration, limits };
  assert.equal(validateLoopSpec({ ...base, act: act() }).act.isolated, false);
  assert.throws(() => validateLoopSpec({ ...base, act: act({ safeToRepeat: false }) }), /safe to repeat/);
  assert.throws(() => validateLoopSpec({ ...base, act: act({ tool: 'write' }) }), /act.tool must be bash/);
  assert.throws(() => validateLoopSpec({ ...base, act: act({ command: 'echo {{secret}}' }) }), /unknown variable: secret/);
  assert.throws(() => validateLoopSpec({ ...base, mode: 'episode' }), /episode needs act/);
  assert.throws(() => validateLoopSpec({ ...base, extract: { instruction: 'x' } }), /extract needs act/);
  assert.throws(() => validateLoopSpec({ ...base, route: { question: 'works' } }), /choice question/);
  assert.throws(() => validateLoopSpec({ ...base, checks: undefined }), /exactly one of criteria and checks/);
  // A plain selection needs no review and no calibration.
  validateLoopSpec({ items: base.items, work: base.work, limits, select: { instructions: 'Pick', optionsFrom: 'input' } });
  assert.throws(() => validateLoopSpec({ items: base.items, work: base.work, limits, select: { instructions: 'Pick', optionsFrom: 'observation' } }), /needs mode episode/);
});

test('act commands quote every value as one shell word', () => {
  assert.equal(shellWord(`it's`), `'it'\\''s'`);
  assert.equal(actCommand('probe {{output}} --id {{ id }}', { output: `a'; rm -rf / #`, input: '', id: 'x y' }), `probe 'a'\\''; rm -rf / #' --id 'x y'`);
});

test('options come only from the source and respect the engine limit', () => {
  assert.deepEqual(parseOptions('{"options":["up",{"name":"down","description":"go down"}]}', 's'), [{ name: 'up', description: 'up' }, { name: 'down', description: 'go down' }]);
  assert.throws(() => parseOptions('{"options":["only"]}', 's'), /at least 2/);
  assert.throws(() => parseOptions(JSON.stringify({ options: Array.from({ length: 256 }, (_, index) => `o${index}`) }), 's'), /at most 255/);
  assert.throws(() => parseOptions('{"options":["a","a"]}', 's'), /unique/);
});

test('act runs each output, the judge sees the observation, retries see what ran, extract shortens it', async () => {
  const commands = [];
  const runAct = async command => { commands.push(command); return { ok: true, text: command.includes("'#good'") ? 'clicked the button' : 'no element matched' }; };
  const llm = llmFrom(options => options.messages.length === 1 ? '#bad' : '#good');
  const judged = [];
  const spec = validateLoopSpec({ items: { inline: [{ id: 'page', input: 'Find the Save button' }] }, work: { instruction: 'Give a CSS selector.' }, checks, calibration, limits,
    act: act(), extract: { instruction: 'Keep only whether it clicked.' } });
  const run = await runLoop(spec, spec.items.inline, { llm, model, judge: noulJudge(state => /clicked/.test(state.observation ?? ''), judged), act: runAct }, { sessionId: 's', signal: signal() });
  assert.equal(run.status, 'done', run.reason);
  const item = run.items[0];
  assert.equal(item.status, 'passed'); assert.equal(item.attempts.length, 2);
  assert.deepEqual(commands, ["node probe.mjs '#bad'", "node probe.mjs '#good'"]);
  assert.equal(item.attempts[0].observation, 'short:no element matched');
  assert.ok(judged.some(request => request.state.observation === 'short:clicked the button'));
  const retry = llm.calls.find(call => call.messages.length === 3);
  assert.match(retry.messages[2].content[0].text, /Running it produced:\nshort:no element matched/);
  assert.match(retry.system, /Your output is executed/);
});

test('acts run one at a time unless isolated; a failing command is an observation', async () => {
  let active = 0, peak = 0;
  const runAct = async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return { ok: false, text: 'boom' }; };
  const items = Array.from({ length: 4 }, (_, index) => ({ id: `i${index}`, input: 'x' }));
  const make = isolated => validateLoopSpec({ items: { inline: items }, work: { instruction: 'w' }, checks, calibration, limits, act: act({ isolated }), maxAttempts: 1, concurrency: 4 });
  const clicked = state => state.observation === 'clicked';
  const run = await runLoop(make(false), items, { llm: llmFrom(() => '#x'), model, judge: noulJudge(clicked), act: runAct }, { sessionId: 's', signal: signal() });
  assert.equal(peak, 1);
  assert.equal(run.items[0].status, 'escalated'); assert.match(run.items[0].attempts[0].observation, /^\[command failed\]\nboom/);
  peak = 0;
  await runLoop(make(true), items, { llm: llmFrom(() => '#x'), model, judge: noulJudge(clicked), act: runAct }, { sessionId: 's', signal: signal() });
  assert.ok(peak > 1, `isolated acts overlap (peak ${peak})`);
});

test('episodes continue from each new observation until the goal is reached', async () => {
  let position = 0;
  const runAct = async command => { if (command.includes("'right'")) position++; return { ok: true, text: `position ${position}` }; };
  const llm = llmFrom(() => 'right');
  const spec = validateLoopSpec({ items: { inline: [{ id: 'game', input: 'Reach position 3' }] }, work: { instruction: 'Reply with one move.' }, mode: 'episode', maxAttempts: 5,
    checks: { questions: { goal: { type: 'noul', instructions: 'Does `observation` show position 3?' } }, pass: { goal: { min: 0.5 } } },
    calibration: { pass: [{ input: 'x', output: 'right', observation: 'position 3' }], fail: [{ input: 'x', output: 'right', observation: 'position 1' }] }, limits, act: act({ command: 'game {{output}}' }) });
  const run = await runLoop(spec, spec.items.inline, { llm, model, judge: noulJudge(state => state.observation === 'position 3'), act: runAct }, { sessionId: 's', signal: signal() });
  const item = run.items[0];
  assert.equal(item.status, 'passed'); assert.equal(item.attempts.length, 3);
  const third = llm.calls.filter(call => call.system.includes('step by step')).at(-1);
  assert.match(third.messages.at(-1).content[0].text, /^Step result:\nposition 2/);
  assert.equal(run.mode, 'episode');
});

test('selection: the engine picks from listed options; low confidence escalates; episodes read options from the observation', async () => {
  const judged = [];
  const items = [{ id: 'a', input: '{"state":"enemy near","options":[{"name":"attack","description":"hit"},{"name":"flee","description":"run"}]}' }];
  const plain = validateLoopSpec({ items: { inline: items }, work: { instruction: 'Choose' }, limits, select: { instructions: 'Which action best keeps the player alive?', optionsFrom: 'input' } });
  const run = await runLoop(plain, items, { llm: llmFrom(() => 'unused'), model: undefined, judge: noulJudge(() => 'flee', judged) }, { sessionId: 's', signal: signal() });
  assert.equal(run.items[0].status, 'passed'); assert.equal(run.items[0].output, 'flee');
  assert.deepEqual(Object.keys(judged[0].questions.pick.criteria), ['attack', 'flee']);
  const shy = validateLoopSpec({ ...plain, select: { instructions: 'Pick', optionsFrom: 'input', minConfidence: 0.95 } });
  const low = await runLoop(shy, items, { llm: llmFrom(() => ''), model, judge: noulJudge(() => 'flee') }, { sessionId: 's', signal: signal() });
  assert.equal(low.items[0].status, 'escalated'); assert.match(low.items[0].attempts[0].error, /below 0.95/);

  let hp = 2;
  const runAct = async command => { if (command.includes("'heal'")) hp++; return { ok: true, text: JSON.stringify({ hp, options: ['heal', 'wait'] }) }; };
  const episode = validateLoopSpec({ items: { inline: [{ id: 'g', input: 'Keep hp at 4' }] }, work: { instruction: 'Play' }, mode: 'episode', maxAttempts: 5, limits,
    select: { instructions: 'Which action raises hp?', optionsFrom: 'observation' }, act: act({ command: 'game {{output}}' }),
    checks: { questions: { done: { type: 'noul', instructions: 'Is hp 4 in `observation`?' } }, pass: { done: { min: 0.5 } } },
    calibration: { pass: [{ input: 'x', output: 'heal', observation: '{"hp":4}' }], fail: [{ input: 'x', output: 'heal', observation: '{"hp":2}' }] } });
  const played = await runLoop(episode, episode.items.inline, { llm: llmFrom(() => ''), model, judge: { kind: 'judge', label: 'f', async judge(request) {
    if (request.questions.pick) return { ok: true, answers: { pick: { type: 'choice', choice: 'heal', probabilities: { heal: 0.8, wait: 0.2 }, confidence: 0.8 } } };
    return { ok: true, answers: { done: { type: 'noul', noul: /"hp":4/.test(request.state.observation ?? '') ? 0.9 : 0.1 } } };
  } }, act: runAct }, { sessionId: 's', signal: signal() });
  assert.equal(played.items[0].status, 'passed', JSON.stringify(played.items[0]));
  assert.equal(played.items[0].attempts.length, 2); assert.equal(played.items[0].attempts[1].selection.choice, 'heal');
});

test('route groups items by a choice answer and the summary counts the groups', async () => {
  const routeChecks = { questions: { kind: { type: 'choice', instructions: 'What kind of report is `input`?', criteria: { bug: 'a defect', feature: 'a request', unclear: 'cannot tell' } } }, pass: { kind: { accept: ['bug', 'feature'] } } };
  const items = [{ id: 'a', input: 'crash on save' }, { id: 'b', input: 'add dark mode' }, { id: 'c', input: 'hmm' }];
  const spec = validateLoopSpec({ items: { inline: items }, work: { instruction: 'Restate the report in one line.' }, checks: routeChecks, route: { question: 'kind' }, maxAttempts: 1, limits,
    calibration: { pass: [{ input: 'crash on save', output: 'Crash' }], fail: [{ input: 'hmm', output: 'hmm' }] } });
  const pick = state => /crash/.test(state.input) ? 'bug' : /dark/.test(state.input) ? 'feature' : 'unclear';
  const run = await runLoop(spec, items, { llm: llmFrom(options => options.messages[0].content[0].text), model, judge: noulJudge(pick) }, { sessionId: 's', signal: signal() });
  assert.deepEqual(Object.fromEntries(run.items.map(item => [item.id, [item.status, item.bucket]])), { a: ['passed', 'bug'], b: ['passed', 'feature'], c: ['escalated', 'unclear'] });
  assert.deepEqual(summarizeRun(run).buckets, { bug: 1, feature: 1, unclear: 1 });
});

test('review fixes: quoted placeholders are rejected, options come from raw output, plain picks run code checks', async () => {
  const base = { items: { inline: [{ id: 'a', input: 'x' }] }, work: { instruction: 'w' }, checks, calibration, limits };
  for (const command of [`printf '%s' "{{output}}"`, `echo '{{output}}'`, 'echo x{{output}}', 'echo {{output}}.txt']) {
    assert.throws(() => validateLoopSpec({ ...base, act: act({ command }) }), /bare words/, command);
  }
  for (const command of ['node probe.mjs {{output}}', 'game {{output}};echo done', 'probe {{output}} | head -1', 'echo "fixed text" {{output}}']) validateLoopSpec({ ...base, act: act({ command }) });

  // extract shortens what reviewers see, but options stay what the command printed (D6).
  const runAct = async () => ({ ok: true, text: JSON.stringify({ hp: 4, options: ['heal', 'wait'] }) });
  const llm = llmFrom(() => '');
  llm.stream = options => reply(options.system.startsWith(EXTRACT_SYSTEM) ? '{"options":["invented","made-up"]}' : 'x');
  const seen = [];
  const episode = validateLoopSpec({ items: { inline: [{ id: 'g', input: 'goal' }] }, work: { instruction: 'Play' }, mode: 'episode', maxAttempts: 2, limits,
    select: { instructions: 'Pick', optionsFrom: 'observation' }, act: act(), extract: { instruction: 'shorten' },
    checks: { questions: { done: { type: 'noul', instructions: 'Done?' } }, pass: { done: { min: 0.5 } } },
    calibration: { pass: [{ input: 'x', output: 'heal', observation: 'done' }], fail: [{ input: 'x', output: 'heal', observation: 'not' }] } });
  await runLoop(episode, episode.items.inline, { llm, model, act: runAct, judge: { kind: 'judge', label: 'f', async judge(request) {
    if (request.questions.pick) { seen.push(Object.keys(request.questions.pick.criteria)); return { ok: true, answers: { pick: { type: 'choice', choice: 'heal', probabilities: { heal: 1, wait: 0 }, confidence: 1 } } }; }
    return { ok: true, answers: { done: { type: 'noul', noul: request.state.observation === 'done' ? 0.9 : 0.1 } } };
  } } }, { sessionId: 's', signal: signal() });
  assert.deepEqual(seen[0], ['heal', 'wait']);

  const pick = validateLoopSpec({ items: { inline: [{ id: 'p', input: '{"options":["up","down"]}' }] }, work: { instruction: 'Choose' }, limits,
    select: { instructions: 'Pick', optionsFrom: 'input' }, codeChecks: [{ type: 'regex', pattern: '^up$', expect: 'match' }] });
  const down = await runLoop(pick, pick.items.inline, { llm: llmFrom(() => ''), model, judge: noulJudge(() => 'down') }, { sessionId: 's', signal: signal() });
  assert.equal(down.items[0].status, 'escalated'); assert.match(down.items[0].attempts[0].codeFailures[0].message, /does not match/);
});

test('review fixes: a failing engine keeps the attempt, and the token cap stops before the next call', async () => {
  let judged = 0;
  const failing = { kind: 'judge', label: 'f', async judge(request) { judged++; if (request.state.input === 'boom') return { ok: false, error: 'HTTP 529' }; return { ok: true, answers: { works: { type: 'noul', noul: request.state.observation === 'clicked' ? 0.9 : 0.1 } } }; } };
  const spec = validateLoopSpec({ items: { inline: [{ id: 'b', input: 'boom' }] }, work: { instruction: 'w' }, checks, calibration, limits, act: act() });
  const run = await runLoop(spec, spec.items.inline, { llm: llmFrom(() => '#x'), model, judge: failing, act: async () => ({ ok: true, text: 'no element' }) }, { sessionId: 's', signal: signal() });
  const item = run.items[0];
  assert.equal(item.status, 'error'); assert.equal(item.attempts.length, 1);
  assert.equal(item.attempts[0].output, '#x'); assert.equal(item.attempts[0].observation, 'no element'); assert.equal(item.attempts[0].error, 'HTTP 529');

  // Each generate call costs 400; at a cap of 1000 the third call must not start, and act must not run after the cap.
  let acts = 0;
  const heavy = { stream: () => (async function* () { yield { type: 'text-delta', text: '#x' }; yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 0 } }; yield { type: 'finish', reason: { kind: 'stop' } }; })() };
  const capped = validateLoopSpec({ items: { inline: [{ id: 'c', input: 'x' }] }, work: { instruction: 'w' }, checks, calibration, limits: { tokens: 1000, timeMs: 60000 }, act: act() });
  const stopped = await runLoop(capped, capped.items.inline, { llm: heavy, model, judge: failing, act: async () => { acts++; return { ok: true, text: 'clicked' }; } }, { sessionId: 's', signal: signal() });
  assert.equal(stopped.status, 'stopped'); assert.equal(acts, 0, 'no act after the generate call that reached the cap');
});
