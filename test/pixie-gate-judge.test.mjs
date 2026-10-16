import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateJudgePass } from '../src/pixie-gate-contracts.ts';

test('all/any pass rules include boundaries and explain every failed condition', () => {
  const conditions = [{ question: 'n', type: 'noul', threshold: 0.7 }, { question: 's', type: 'score', min: 1 }, { question: 'c', type: 'choice', allowed: ['yes'] }];
  const answers = { n: { type: 'noul', noul: 0.7 }, s: { type: 'score', score: 1 }, c: { type: 'choice', choice: 'yes' } };
  assert.equal(evaluateJudgePass({ mode: 'all', conditions }, answers).pass, true);
  answers.n.noul = 0.699; answers.s.score = 0.999;
  const failed = evaluateJudgePass({ mode: 'all', conditions }, answers); assert.equal(failed.pass, false); assert.match(failed.reason, /n:.*s:/);
  assert.equal(evaluateJudgePass({ mode: 'any', conditions }, answers).pass, true);
  answers.c.choice = 'no'; const allFailed = evaluateJudgePass({ mode: 'any', conditions }, answers); assert.equal(allFailed.pass, false);
  assert.deepEqual(allFailed.failedConditions, [{ ...conditions[0], actual: 0.699 }, { ...conditions[1], actual: 0.999 }, { ...conditions[2], actual: 'no' }]);
  assert.throws(() => evaluateJudgePass({ mode: 'any', conditions }, {}), /answer/);
});
