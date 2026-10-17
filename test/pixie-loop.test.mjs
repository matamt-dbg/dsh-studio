/** Pixie Loop (#31): spec validation, code checks, pass rules, compile + calibration, and the item loop with fake models. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedQuestions, parseLoopItemsFile, runCodeChecks, summarizeRun, validateLoopChecks, validateLoopSpec } from '../src/pixie-loop-contracts.ts';
import { COMPILE_SYSTEM, INTERPRET_SYSTEM, interpretInput, runLoop } from '../src/host/pixie-loop-engine.ts';

const checks = {
  questions: { faithful: { type: 'noul', instructions: 'Does `output` keep the full meaning of `input`?' },
    issue: { type: 'choice', instructions: 'Main problem in `output`?', criteria: { ok: 'no problem', mistranslation: 'meaning changed', tone: 'wrong register' } } },
  pass: { faithful: { min: 0.7 }, issue: { accept: ['ok'] } },
};
const base = (extra = {}) => ({
  items: { inline: [{ id: 'a', input: 'Save {name}' }] }, work: { instruction: 'Translate to Korean.' }, checks,
  calibration: { pass: [{ input: 'Save', output: '저장' }], fail: [{ input: 'Save', output: '삭제' }] },
  limits: { tokens: 100000, timeMs: 60000 }, ...extra,
});

test('a valid spec gets defaults; unknown fields and both criteria+checks are rejected', () => {
  const spec = validateLoopSpec(base());
  assert.equal(spec.maxAttempts, 3); assert.equal(spec.concurrency, 4);
  assert.throws(() => validateLoopSpec(base({ extra: 1 })), /Unknown field in spec: extra/);
  assert.throws(() => validateLoopSpec(base({ criteria: 'x' })), /only one of criteria and checks/);
  assert.throws(() => validateLoopSpec({ ...base(), checks: undefined }), /exactly one/);
  assert.throws(() => validateLoopSpec(base({ calibration: { pass: [], fail: [{ input: '', output: '' }] } })), /calibration.pass needs at least one/);
  assert.throws(() => validateLoopSpec(base({ items: { inline: [{ id: 'a', input: 'x' }, { id: 'a', input: 'y' }] } })), /Duplicate item id: a/);
  assert.throws(() => validateLoopSpec(base({ maxAttempts: 11 })), /maxAttempts/);
  assert.throws(() => validateLoopSpec(base({ limits: { tokens: 1 } })), /Unknown|timeMs|tokens/);
  assert.throws(() => validateLoopSpec(base({ codeChecks: [{ type: 'regex', pattern: '(', expect: 'match' }] })), /invalid pattern/);
  assert.deepEqual(validateLoopSpec(base({ items: { path: 'work/a.jsonl' } })).items, { path: 'work/a.jsonl' });
});

test('pass rules must fit the question and leave a failing choice', () => {
  assert.throws(() => validateLoopChecks({ ...checks, pass: { faithful: { min: 0.7 } } }), /checks.pass.issue is required/);
  assert.throws(() => validateLoopChecks({ ...checks, pass: { ...checks.pass, issue: { accept: ['ok', 'mistranslation', 'tone'] } } }), /at least one failing/);
  assert.throws(() => validateLoopChecks({ ...checks, pass: { ...checks.pass, issue: { accept: ['great'] } } }), /options of the question/);
  assert.throws(() => validateLoopChecks({ ...checks, pass: { ...checks.pass, faithful: { min: 1.5 } } }), /at most 1/);
  const answers = { faithful: { type: 'noul', noul: 0.4 }, issue: { type: 'choice', choice: 'ok', probabilities: { ok: 1, mistranslation: 0, tone: 0 }, confidence: 1 } };
  assert.deepEqual(failedQuestions(validateLoopChecks(checks), answers).map(failure => failure.id), ['faithful']);
});

test('code checks: placeholders, regex, json', () => {
  assert.deepEqual(runCodeChecks([{ type: 'placeholders' }], 'Hi {name}, %s <b>x</b>', '{name}님 %s <b>x</b>'), []);
  assert.match(runCodeChecks([{ type: 'placeholders' }], 'Hi {name} {{count}}', '안녕 {count}')[0].message, /missing \{name\} \{\{count\}\}; unexpected \{count\}/);
  assert.deepEqual(runCodeChecks([{ type: 'regex', pattern: '[가-힣]', expect: 'match' }], '', '저장'), []);
  assert.match(runCodeChecks([{ type: 'regex', pattern: '[가-힣]', expect: 'match' }], '', 'Save')[0].message, /does not match/);
  assert.match(runCodeChecks([{ type: 'regex', pattern: 'TODO', expect: 'no-match' }], '', 'a TODO')[0].message, /matches/);
  assert.match(runCodeChecks([{ type: 'json' }], '', 'nope')[0].message, /not JSON/);
  assert.match(runCodeChecks([{ type: 'json', keys: ['a', 'b'] }], '', '{"a":1}')[0].message, /missing keys b/);
});

test('items files are JSONL with line numbers in errors', () => {
  assert.deepEqual(parseLoopItemsFile('{"id":"a","input":"x"}\n\n{"id":"b","input":"y"}\n'), [{ id: 'a', input: 'x' }, { id: 'b', input: 'y' }]);
  assert.throws(() => parseLoopItemsFile('{"id":"a","input":"x"}\nnot json'), /line 2 is not JSON/);
});

test('interpret input carries only failed checks, values, thresholds, the output and the input (D12)', () => {
  const value = interpretInput('in', 'out', { codeFailures: [{ check: 'regex', message: 'm' }], questionFailures: [
    { id: 'faithful', instructions: 'Q', answer: { type: 'noul', noul: 0.3 }, rule: { min: 0.7 } },
    { id: 'issue', instructions: 'C', answer: { type: 'choice', choice: 'tone', probabilities: {}, confidence: 0.9 }, rule: { accept: ['ok'] } }] });
  assert.deepEqual(value, { input: 'in', output: 'out', failedCodeChecks: [{ check: 'regex', message: 'm' }],
    failedQuestions: [{ instructions: 'Q', value: 0.3, threshold: 0.7 }, { instructions: 'C', chose: 'tone', acceptable: ['ok'] }] });
});

/** Fake Pixie: routes by system prompt. `work(messages)` returns the worker output. */
function fakeLlm({ work, compile = [], interpret = () => 'fix it' }) {
  const calls = [];
  const compiles = [...compile];
  return { calls, stream(options) {
    calls.push(options);
    const text = options.system === COMPILE_SYSTEM ? compiles.shift() : options.system === INTERPRET_SYSTEM ? interpret(options) : work(options);
    return (async function* () {
      if (options.signal?.aborted) throw options.signal.reason;
      yield { type: 'text-delta', text }; yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }; yield { type: 'finish', reason: { kind: 'stop' } };
    })();
  } };
}
/** Fake judge: good outputs contain "좋음". */
const fakeJudge = (calls = []) => ({ kind: 'judge', label: 'fake', async judge(request) {
  calls.push(request);
  const good = /좋음|저장/.test(request.state.output) && !/삭제/.test(request.state.output);
  return { ok: true, usage: { inputTokens: 3, outputTokens: 1 }, answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id,
    question.type === 'noul' ? { type: 'noul', noul: good ? 0.9 : 0.2 }
      : question.type === 'choice' ? { type: 'choice', choice: good ? 'ok' : Object.keys(question.criteria).at(-1), probabilities: Object.fromEntries(Object.keys(question.criteria).map((name, index, all) => [name, good ? (index === 0 ? 1 : 0) : (index === all.length - 1 ? 1 : 0)])), confidence: 1 }
        : { type: 'score', score: good ? question.criteria.length - 1 : 0, probabilities: question.criteria.map((_, index, all) => index === (good ? all.length - 1 : 0) ? 1 : 0), confidence: 1 }])) };
} });
const model = { provider: 'p', model: 'pixie' };
const signal = () => new AbortController().signal;
const lastUser = options => options.messages.at(-1).content[0].text;

test('first-try pass, retry-then-pass, and escalation; threads never mix and retries accumulate', async () => {
  const items = [{ id: 'one', input: 'A' }, { id: 'two', input: 'B' }, { id: 'three', input: 'C' }];
  const llm = fakeLlm({ work: options => {
    const input = options.messages[0].content[0].text;
    const attempts = options.messages.filter(message => message.role === 'assistant').length;
    if (input === 'A') return '좋음 A';
    if (input === 'B') return attempts === 0 ? '나쁨 B' : '좋음 B';
    return '나쁨 C';
  } });
  const updates = [];
  const run = await runLoop(validateLoopSpec(base({ items: { inline: items }, maxAttempts: 2, concurrency: 2 })), items, { llm, model, judge: fakeJudge(), update: value => updates.push(value) }, { sessionId: 's', signal: signal() });
  assert.equal(run.status, 'done');
  const byId = Object.fromEntries(run.items.map(item => [item.id, item]));
  assert.equal(byId.one.status, 'passed'); assert.equal(byId.one.attempts.length, 1);
  assert.equal(byId.two.status, 'passed'); assert.equal(byId.two.attempts.length, 2); assert.equal(byId.two.attempts[0].feedback, 'fix it');
  assert.equal(byId.three.status, 'escalated'); assert.equal(byId.three.attempts.length, 2);
  for (const call of llm.calls.filter(call => call.system !== INTERPRET_SYSTEM && call.system !== COMPILE_SYSTEM)) {
    const texts = call.messages.map(message => message.content[0].text).join('\n');
    const own = call.messages[0].content[0].text;
    for (const other of ['A', 'B', 'C'].filter(name => name !== own)) assert.doesNotMatch(texts, new RegExp(`(좋음|나쁨) ${other}`));
  }
  const retry = llm.calls.find(call => call.messages.length === 3 && call.messages[0].content[0].text === 'B');
  assert.ok(retry, 'the retry of B carries its first output and the feedback');
  assert.equal(retry.messages[1].content[0].text, '나쁨 B'); assert.match(lastUser(retry), /Reviewer notes: fix it/);
  assert.ok(updates.length > 3);
  const summary = summarizeRun(run);
  assert.equal(summary.passed, 2); assert.deepEqual(summary.escalated.map(item => [item.id, item.attempts, item.failed]), [['three', 2, ['faithful', 'issue']]]);
  assert.equal(summary.usage.judge.inputTokens > 0, true);
});

test('a failed code check skips the judge and feeds the failure back', async () => {
  const judged = [];
  const llm = fakeLlm({ work: options => options.messages.length === 1 ? '좋음 저장' : '좋음 {name} 저장' });
  const spec = validateLoopSpec(base({ codeChecks: [{ type: 'placeholders' }], calibration: { pass: [{ input: 'Save', output: '저장' }], fail: [{ input: 'Save', output: '삭제' }] } }));
  const run = await runLoop(spec, spec.items.inline, { llm, model, judge: fakeJudge(judged) }, { sessionId: 's', signal: signal() });
  const item = run.items[0];
  assert.equal(item.status, 'passed'); assert.equal(item.attempts.length, 2);
  assert.equal(item.attempts[0].answers, undefined); assert.match(item.attempts[0].codeFailures[0].message, /missing \{name\}/);
  assert.equal(judged.filter(request => request.state.input === 'Save {name}').length, 1);
  const retry = llm.calls.find(call => call.messages.length === 3);
  assert.match(lastUser(retry), /Exact checks failed: placeholders/);
});

test('compile: Pixie output is validated, corrected once, then calibrated', async () => {
  const compiled = JSON.stringify(checks);
  const ok = await runLoop(validateLoopSpec({ ...base(), checks: undefined, criteria: 'faithful, polite' }), [{ id: 'a', input: 'x' }],
    { llm: fakeLlm({ compile: ['not json', compiled], work: () => '좋음' }), model, judge: fakeJudge() }, { sessionId: 's', signal: signal() });
  assert.equal(ok.status, 'done'); assert.equal(ok.compiledBy, 'pixie'); assert.deepEqual(ok.checks, checks);
  const bad = await runLoop(validateLoopSpec({ ...base(), checks: undefined, criteria: 'x' }), [{ id: 'a', input: 'x' }],
    { llm: fakeLlm({ compile: ['nope', '{"questions":{}}'], work: () => '좋음' }), model, judge: fakeJudge() }, { sessionId: 's', signal: signal() });
  assert.equal(bad.status, 'error'); assert.match(bad.reason, /could not compile/); assert.equal(bad.items[0].status, 'skipped');
});

test('calibration that does not separate the examples refuses to start', async () => {
  const spec = validateLoopSpec(base({ calibration: { pass: [{ input: 'Save', output: '저장' }], fail: [{ input: 'Save', output: '좋음 저장' }] } }));
  const llm = fakeLlm({ work: () => '좋음' });
  const run = await runLoop(spec, spec.items.inline, { llm, model, judge: fakeJudge() }, { sessionId: 's', signal: signal() });
  assert.equal(run.status, 'error'); assert.match(run.reason, /Calibration failed/);
  assert.equal(llm.calls.length, 0, 'no worker call before calibration passes');
});

test('an engine error marks the item error, never failed', async () => {
  const judge = { kind: 'judge', label: 'x', calls: 0, async judge(request) { if (request.state.input === 'boom') return { ok: false, error: 'HTTP 529' }; return fakeJudge().judge(request); } };
  const items = [{ id: 'a', input: 'boom' }, { id: 'b', input: 'fine' }];
  const run = await runLoop(validateLoopSpec(base({ items: { inline: items } })), items, { llm: fakeLlm({ work: () => '좋음' }), model, judge }, { sessionId: 's', signal: signal() });
  assert.deepEqual(run.items.map(item => [item.id, item.status]).sort(), [['a', 'error'], ['b', 'passed']]);
  assert.equal(run.items.find(item => item.id === 'a').error, 'HTTP 529');
});

test('token limit stops the run and leaves the rest skipped; cancel is cancelled', async () => {
  const items = Array.from({ length: 6 }, (_, index) => ({ id: `i${index}`, input: `x${index}` }));
  const spec = validateLoopSpec(base({ items: { inline: items }, concurrency: 1, limits: { tokens: 1000, timeMs: 60000 } }));
  const heavy = fakeLlm({ work: () => '좋음' });
  const stream = heavy.stream.bind(heavy);
  heavy.stream = options => (async function* () { for await (const chunk of stream(options)) yield chunk.type === 'usage' ? { type: 'usage', usage: { inputTokens: 400, outputTokens: 0 } } : chunk; })();
  const run = await runLoop(spec, items, { llm: heavy, model, judge: fakeJudge() }, { sessionId: 's', signal: signal() });
  assert.equal(run.status, 'stopped'); assert.match(run.reason, /Token limit/);
  assert.ok(run.items.some(item => item.status === 'skipped'));
  assert.ok(summarizeRun(run).skipped > 0);

  const controller = new AbortController();
  const slow = fakeLlm({ work: () => { controller.abort(new Error('user')); return '좋음'; } });
  const cancelled = await runLoop(spec, items, { llm: slow, model, judge: fakeJudge() }, { sessionId: 's', signal: controller.signal });
  assert.equal(cancelled.status, 'cancelled');
});

test('concurrency stays within the limit', async () => {
  let active = 0, peak = 0;
  const items = Array.from({ length: 8 }, (_, index) => ({ id: `i${index}`, input: `x${index}` }));
  const llm = { stream: options => (async function* () {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    yield { type: 'text-delta', text: '좋음' }; yield { type: 'finish', reason: { kind: 'stop' } };
  })() };
  const run = await runLoop(validateLoopSpec(base({ items: { inline: items }, concurrency: 3 })), items, { llm, model, judge: fakeJudge() }, { sessionId: 's', signal: signal() });
  assert.equal(run.status, 'done'); assert.ok(peak <= 3, `peak ${peak}`);
});

test('no model or engine is a run error before any call', async () => {
  const spec = validateLoopSpec(base());
  assert.match((await runLoop(spec, spec.items.inline, { llm: fakeLlm({ work: () => '' }), model: undefined, judge: fakeJudge() }, { sessionId: 's', signal: signal() })).reason, /No Pixie model/);
  assert.match((await runLoop(spec, spec.items.inline, { llm: fakeLlm({ work: () => '' }), model, judge: undefined }, { sessionId: 's', signal: signal() })).reason, /No decision engine/);
});

test('placeholders also keep inline code spans and link targets', () => {
  assert.deepEqual(runCodeChecks([{ type: 'placeholders' }], 'Use `pixie_loop` and see [guide](docs/a.md).', '`pixie_loop`를 쓰고 [가이드](docs/a.md)를 보세요.'), []);
  assert.match(runCodeChecks([{ type: 'placeholders' }], 'Use `pixie_loop`.', 'pixie_loop를 쓰세요.')[0].message, /missing `pixie_loop`/);
  assert.match(runCodeChecks([{ type: 'placeholders' }], 'See [guide](docs/a.md).', '[가이드](docs/b.md)를 보세요.')[0].message, /missing \]\(docs\/a\.md\)/);
  assert.deepEqual(runCodeChecks([{ type: 'placeholders' }], 'Run `{{output}}` here', '`{{output}}`를 여기서 실행'), []);
});
