/** Jev engine: current HTTP wire shape in and out; every failure stays an error and never leaks the key. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JEV_ENDPOINT, JevJudgeEngine } from '../src/host/jev-judge.ts';

const KEY = 'ts-secret-key';
const credentials = { resolve: async ref => ref === 'TYPESAFE_API_KEY' ? { value: KEY, source: 'store' } : undefined };
const response = (status, body, headers = {}) => ({ status, headers: { get: name => headers[name] ?? null }, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
const engine = (replies, options = {}) => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); const next = replies.shift(); if (next instanceof Error) throw next; return next; };
  return { calls, judge: new JevJudgeEngine({ credentials: 'credentials' in options ? options.credentials : credentials, model: options.model ?? 'jev-latest', fetch }) };
};
const questions = {
  dept: { type: 'choice', instructions: 'Which team should handle this?', criteria: { billing: 'Payments', technical: 'Bugs' } },
  mood: { type: 'score', instructions: 'How frustrated is the customer?', criteria: ['Calm', 'Frustrated', 'Very angry'] },
  urgent: { type: 'noul', instructions: 'Does this convey urgency?', criteria: { true: 'Time-sensitive', false: 'No urgency' } },
};
const answers = {
  dept: { type: 'choice', choice: 'billing', probabilities: { billing: 0.88, technical: 0.12 }, confidence: 0.81 },
  mood: { type: 'score', score: 1.05, legend: { 0: 'Calm', 1: 'Frustrated', 2: 'Very angry' }, probabilities: { 0: 0, 1: 0.95, 2: 0.05 }, confidence: 0.92 },
  urgent: { type: 'noul', noul: 0.95 },
};
const ok = () => response(200, { model: 'jev-1.13.0', answers, usage: { input_tokens: 318, output_tokens: 34 } });
const signal = () => new AbortController().signal;

test('sends the documented request and maps all three answer types', async () => {
  const { calls, judge } = engine([ok()]);
  const result = await judge.judge({ state: 'Payouts failing for 3 days', questions }, signal());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, JEV_ENDPOINT);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].init.headers, { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' });
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'jev-latest', state: 'Payouts failing for 3 days', questions });
  assert.deepEqual(result, { ok: true, usage: { inputTokens: 318, outputTokens: 34 }, answers: {
    dept: { type: 'choice', choice: 'billing', probabilities: { billing: 0.88, technical: 0.12 }, confidence: 0.81 },
    mood: { type: 'score', score: 1.05, probabilities: [0, 0.95, 0.05], confidence: 0.92 },
    urgent: { type: 'noul', noul: 0.95 },
  } });
});

test('retries 429 and 529, honoring retry-after, then succeeds', async () => {
  const { calls, judge } = engine([response(429, 'slow down', { 'retry-after': '0' }), response(529, 'overloaded', { 'retry-after': '0' }), ok()]);
  const result = await judge.judge({ state: 's', questions }, signal());
  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
});

test('a persistent 529 fails after the retry budget', async () => {
  const { calls, judge } = engine([0, 1, 2].map(() => response(529, 'overloaded', { 'retry-after': '0' })));
  const result = await judge.judge({ state: 's', questions }, signal());
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 529/);
  assert.equal(calls.length, 3);
});

for (const [name, reply, pattern] of [
  ['401', response(401, 'invalid key'), /HTTP 401/],
  ['422', response(422, '{"detail":"criteria"}'), /HTTP 422/],
  ['a network error', new Error('ECONNRESET'), /ECONNRESET/],
  ['non-JSON', response(200, 'oops'), /not JSON/],
  ['a missing answer', response(200, { answers: { dept: answers.dept, mood: answers.mood } }), /Missing answer for "urgent"/],
  ['an unknown choice', response(200, { answers: { ...answers, dept: { ...answers.dept, choice: 'sales' } } }), /unknown option/],
  ['score probabilities for the wrong levels', response(200, { answers: { ...answers, mood: { ...answers.mood, probabilities: { 0: 1 } } } }), /one probability per level/],
]) {
  test(`${name} is a failure that does not leak the key`, async () => {
    const result = await engine([reply]).judge.judge({ state: 's', questions }, signal());
    assert.equal(result.ok, false);
    assert.match(result.error, pattern);
    assert.doesNotMatch(result.error, new RegExp(KEY));
  });
}

test('a missing key or credentials service fails before any request', async () => {
  for (const options of [{ credentials: { resolve: async () => undefined } }, { credentials: undefined }]) {
    const { calls, judge } = engine([ok()], options);
    const result = await judge.judge({ state: 's', questions }, signal());
    assert.equal(result.ok, false);
    assert.match(result.error, /TYPESAFE_API_KEY|credentials/);
    assert.equal(calls.length, 0);
  }
});

test('an invalid question is rejected before any request', async () => {
  const { calls, judge } = engine([ok()]);
  const result = await judge.judge({ state: 's', questions: { q: { type: 'noul', instructions: '' } } }, signal());
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test('cancellation during a retry wait stops the call', async () => {
  const controller = new AbortController();
  const { calls, judge } = engine([response(429, 'slow', { 'retry-after': '3' }), ok()]);
  const pending = judge.judge({ state: 's', questions }, controller.signal);
  setTimeout(() => controller.abort(new Error('gate timed out')), 10);
  const result = await pending;
  assert.deepEqual(result, { ok: false, error: 'gate timed out' });
  assert.equal(calls.length, 1);
});
