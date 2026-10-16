/** `judge` tool through the real DSH tool runtime: Jev request shape in, typed answers out, failures as tool errors. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { installJudge, JUDGE_PARAMETERS, JUDGE_TOOL } from '../src/host/judge-tool.ts';
import { createLifetime } from '../src/host/tool-lifetime.ts';
import { BATCH_PLUGIN, JUDGE_PLUGIN } from '../src/package-name.ts';
import { studioLayer } from '../src/host/master-composition.ts';

const questions = {
  natural: { type: 'score', instructions: 'How natural is this Korean UI text?', criteria: ['awkward', 'understandable', 'natural'] },
  polite: { type: 'noul', instructions: 'Does the text use the formal polite ending consistently?' },
  tone: { type: 'choice', instructions: 'Which register does the text use?', criteria: { formal: '합쇼체', polite: '해요체', plain: '반말' } },
};
const jevAnswers = { natural: { type: 'score', score: 1.7, probabilities: { 0: 0.05, 1: 0.2, 2: 0.75 }, confidence: 0.7 }, polite: { type: 'noul', noul: 0.92 }, tone: { type: 'choice', choice: 'formal', probabilities: { formal: 0.9, polite: 0.1, plain: 0 }, confidence: 0.85 } };

async function runtime(t, settings, fetchReply) {
  const ctx = new Context();
  ctx.provide('credentials'); ctx.set('credentials', { resolve: async () => ({ value: 'k' }) });
  const prompt = ctx.plugin(SystemPrompt); await prompt;
  const fiber = ctx.plugin(ToolRuntime); await fiber;
  const life = createLifetime(), calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return fetchReply(); };
  const dispose = installJudge(ctx, life, async () => settings);
  t.after(async () => { globalThis.fetch = realFetch; dispose(); await life.dispose(); await fiber.dispose(); await prompt.dispose(); });
  const call = args => ctx.tools.execute({ callId: ToolCallId(`c${calls.length}`), name: JUDGE_TOOL, arguments: args, signal: new AbortController().signal });
  return { ctx, call, calls };
}
const reply = (status, body) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const base = { contextMode: 'fresh', systemPrompt: '', allowThreadModel: true };

test('the judge tool is registered with the Jev request schema', async t => {
  const { ctx } = await runtime(t, { ...base, judgeEngine: 'jev' }, () => reply(200, {}));
  const schema = ctx.tools.schemas().find(item => item.name === JUDGE_TOOL);
  assert.ok(schema); assert.deepEqual(schema.parameters.required, ['state', 'questions']);
  assert.deepEqual(JUDGE_PARAMETERS.properties.questions.additionalProperties.oneOf.map(item => item.properties.type.const), ['noul', 'choice', 'score']);
  assert.match(schema.description, /does not write or rewrite text/);
});

test('a Jev request returns typed answers, the engine, and usage', async t => {
  const { call, calls } = await runtime(t, { ...base, judgeEngine: 'jev', jevModel: 'jev-1.13.0' }, () => reply(200, { answers: jevAnswers, usage: { input_tokens: 50, output_tokens: 9 } }));
  const result = await call({ state: { ko: '키를 저장했습니다.', en: 'Key saved.' }, questions });
  assert.equal(result.isError, false, JSON.stringify(result.content));
  assert.deepEqual(calls[0].body, { model: 'jev-1.13.0', state: { ko: '키를 저장했습니다.', en: 'Key saved.' }, questions });
  assert.deepEqual(result.value, { engine: 'jev', usage: { inputTokens: 50, outputTokens: 9 }, answers: {
    natural: { type: 'score', score: 1.7, probabilities: [0.05, 0.2, 0.75], confidence: 0.7 },
    polite: { type: 'noul', noul: 0.92 },
    tone: { type: 'choice', choice: 'formal', probabilities: { formal: 0.9, polite: 0.1, plain: 0 }, confidence: 0.85 },
  } });
});

for (const [name, settings, args, fetchReply, pattern] of [
  ['an invalid question', { ...base, judgeEngine: 'jev' }, { state: 's', questions: { q: { type: 'score', instructions: 'x', criteria: ['one'] } } }, () => reply(200, {}), /2–10|criteria|levels/],
  ['a Jev HTTP failure', { ...base, judgeEngine: 'jev' }, { state: 's', questions: { polite: questions.polite } }, () => reply(401, { error: 'bad key' }), /HTTP 401/],
  ['no engine configured', base, { state: 's', questions: { polite: questions.polite } }, () => reply(200, {}), /No decision engine is configured/],
]) test(`${name} is a tool error, never an answer`, async t => {
  const { call, calls } = await runtime(t, settings, fetchReply);
  const result = await call(args);
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), pattern);
  if (name !== 'a Jev HTTP failure') assert.equal(calls.length, 0);
});

test('the judge plugin joins the Studio Master layer next to read_batch', () => {
  const rows = studioLayer();
  assert.deepEqual(rows.filter(row => [BATCH_PLUGIN, JUDGE_PLUGIN].includes(row.name)).map(row => row.id), ['studio-batch', 'studio-judge']);
});
