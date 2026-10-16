/** Judge engine: Jev-shaped answers from a conversation model; bad output is an error, never a verdict. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LlmJudgeEngine, validateJudgeRequest } from '../src/host/pixie-judge.ts';

async function* reply(text) { yield { type: 'text-delta', index: 0, text }; yield { type: 'finish', reason: { kind: 'stop' } }; }
const engine = output => {
  const calls = [];
  return { calls, judge: new LlmJudgeEngine({ stream: options => { calls.push(options); return reply(typeof output === 'string' ? output : JSON.stringify(output)); } }, { provider: 'p', model: 'm' }) };
};
const questions = {
  pick: { type: 'choice', instructions: 'What kind of request is this?', criteria: { bug: 'a defect', feature: 'new behavior' } },
  size: { type: 'score', instructions: 'How large is the change?', criteria: ['tiny', 'small', 'large'] },
  clear: { type: 'noul', instructions: 'Is the request unambiguous?' },
};
const signal = new AbortController().signal;

test('valid model output becomes typed answers with the request state in the prompt', async () => {
  const { calls, judge } = engine({ answers: {
    pick: { choice: 'bug', probabilities: { bug: 0.8, feature: 0.2 } },
    size: { score: 1.2, probabilities: [0.1, 0.6, 0.3] },
    clear: { noul: 0.9 },
  } });
  const result = await judge.judge({ state: { request: 'fix login' }, questions }, signal);
  assert.equal(result.ok, true);
  assert.deepEqual(result.answers.pick, { type: 'choice', choice: 'bug', probabilities: { bug: 0.8, feature: 0.2 }, confidence: 0.8 });
  assert.deepEqual(result.answers.size, { type: 'score', score: 1.2, probabilities: [0.1, 0.6, 0.3], confidence: 0.6 });
  assert.deepEqual(result.answers.clear, { type: 'noul', noul: 0.9 });
  assert.match(calls[0].messages[0].content[0].text, /fix login/);
});

test('output wrapped in a code fence is accepted', async () => {
  const { judge } = engine('```json\n{"answers":{"clear":{"noul":0.2}}}\n```');
  const result = await judge.judge({ state: 's', questions: { clear: questions.clear } }, signal);
  assert.deepEqual(result, { ok: true, answers: { clear: { type: 'noul', noul: 0.2 } } });
});

for (const [name, output] of [
  ['non-JSON', 'probably a bug'],
  ['a missing answer', { answers: { pick: { choice: 'bug', probabilities: { bug: 1, feature: 0 } } } }],
  ['an unknown choice', { answers: { pick: { choice: 'docs', probabilities: { bug: 0.5, feature: 0.5 } }, size: { score: 0, probabilities: [1, 0, 0] }, clear: { noul: 1 } } }],
  ['a score out of range', { answers: { pick: { choice: 'bug', probabilities: { bug: 1, feature: 0 } }, size: { score: 3, probabilities: [0, 0, 1] }, clear: { noul: 1 } } }],
  ['probabilities that do not sum to one', { answers: { pick: { choice: 'bug', probabilities: { bug: 0.9, feature: 0.9 } }, size: { score: 0, probabilities: [1, 0, 0] }, clear: { noul: 1 } } }],
  ['a noul outside 0..1', { answers: { pick: { choice: 'bug', probabilities: { bug: 1, feature: 0 } }, size: { score: 0, probabilities: [1, 0, 0] }, clear: { noul: 2 } } }],
]) {
  test(`${name} is a failure, not a verdict`, async () => {
    const result = await engine(output).judge.judge({ state: 's', questions }, signal);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  });
}

test('request validation enforces the Jev question shapes', () => {
  const reject = (question, pattern) => assert.throws(() => validateJudgeRequest({ state: 's', questions: { q: question } }), pattern);
  assert.throws(() => validateJudgeRequest({ state: 's', questions: {} }), /at least one/);
  reject({ type: 'noul', instructions: '' }, /instructions/);
  reject({ type: 'choice', criteria: { a: 'x', b: 'y' } }, /instructions/);
  reject({ type: 'choice', instructions: 'Pick', criteria: { a: 'x' } }, /2–255/);
  reject({ type: 'choice', instructions: 'Pick', criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`o${i}`, 'x'])) }, /2–255/);
  reject({ type: 'choice', instructions: 'Pick', criteria: { a: 'x', b: 1 } }, /2–255/);
  reject({ type: 'score', instructions: 'Rate', criteria: ['only'] }, /2–10/);
  reject({ type: 'score', instructions: 'Rate', criteria: Array.from({ length: 11 }, () => 'level') }, /2–10/);
  reject({ type: 'noul', instructions: 'Yes?', criteria: { maybe: 'x' } }, /criteria/);
  reject({ type: 'box', instructions: 'x' }, /choice, score, or noul/);
  reject({ type: 'choice', options: { a: 'x', b: 'y' } }, /instructions/);
  assert.doesNotThrow(() => validateJudgeRequest({ state: 's', questions }));
  assert.doesNotThrow(() => validateJudgeRequest({ state: 's', questions: { q: { type: 'choice', instructions: 'Pick', criteria: Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`o${i}`, 'x'])) } } }));
});

test('the LLM prompt carries each question\'s instructions and criteria', async () => {
  const { calls, judge } = engine({ answers: { clear: { noul: 0.4 } } });
  await judge.judge({ state: 's', questions: { clear: questions.clear } }, signal);
  assert.match(calls[0].messages[0].content[0].text, /"instructions": "Is the request unambiguous\?"/);
  assert.match(calls[0].system, /criteria/);
});
