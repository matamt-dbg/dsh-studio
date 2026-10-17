import assert from 'node:assert/strict';
import test from 'node:test';
import { anthropicRequestBody, translateAnthropic } from '../src/host/provider-anthropic.ts';

const options = (messages = []) => ({ provider: 'claude', model: 'claude-test', messages });
const message = (role, content, extra = {}) => ({ role, content, source: { kind: 'model' }, ...extra });
const text = value => ({ type: 'text', text: value });
const start = { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } } };
const open = (index, content_block) => ({ type: 'content_block_start', index, content_block });
const delta = (index, delta) => ({ type: 'content_block_delta', index, delta });
const close = index => ({ type: 'content_block_stop', index });
const end = (stop_reason = 'end_turn') => [{ type: 'message_delta', delta: { stop_reason }, usage: { output_tokens: 7 } }, { type: 'message_stop' }];
async function collect(events) {
  const result = [];
  for await (const chunk of translateAnthropic((async function* () { for (const event of events) yield typeof event === 'string' ? event : JSON.stringify(event); })())) result.push(chunk);
  return result;
}

test('request maps system, ordered content, tools and merged tool results without identity', () => {
  const body = anthropicRequestBody({ ...options([
    message('system', [text('leading')]), message('user', [text('question')]),
    message('developer', [text('later instruction')]),
    message('assistant', [text('calling'), { type: 'tool-call', id: 'a', name: 'lookup', arguments: '{"q":1}' }, { type: 'tool-call', id: 'b', name: 'lookup', arguments: '{}' }]),
    message('tool', [text('result')], { toolCallId: 'a' }), message('tool', [], { toolCallId: 'b', isError: true }),
  ]), system: 'base', temperature: 0, stop: ['END'], tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }, { name: 'hidden', deferLoading: true }] }, 123);
  assert.equal(body.system, 'base\n\nleading');
  assert.equal(body.max_tokens, 123);
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.stop_sequences, ['END']);
  assert.deepEqual(body.messages.map(m => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(body.messages[0].content.map(b => b.text), ['question', 'later instruction']);
  assert.deepEqual(body.messages[1].content[1], { type: 'tool_use', id: 'a', name: 'lookup', input: { q: 1 } });
  assert.deepEqual(body.messages[2].content[1], { type: 'tool_result', tool_use_id: 'b', content: '(no output)', is_error: true });
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].input_schema.type, 'object');
  assert.equal(JSON.stringify(body).includes('Claude Code'), false);
  assert.equal(anthropicRequestBody(options(), undefined).max_tokens, 4096);
  assert.throws(() => anthropicRequestBody(options(), 0), /positive integer/);
  assert.throws(() => anthropicRequestBody(options([message('assistant', [{ type: 'tool-call', id: 'a', name: 'lookup', arguments: '[]' }])]), 1), /expected an object/);
});

test('streams text and fragmented tool JSON, usage and tool finish', async () => {
  const chunks = await collect([start, { type: 'ping' }, open(0, { type: 'text', text: 'Hi' }), delta(0, { type: 'text_delta', text: ' there' }), close(0),
    open(1, { type: 'tool_use', id: 'call', name: 'lookup', input: {} }), delta(1, { type: 'input_json_delta', partial_json: '{"q":' }), delta(1, { type: 'input_json_delta', partial_json: '"hello"}' }), close(1), ...end('tool_use')]);
  assert.deepEqual(chunks.filter(c => c.type === 'text-delta').map(c => c.text), ['Hi', ' there']);
  assert.deepEqual(chunks.filter(c => c.type === 'block-end').map(c => c.block), [{ type: 'text', text: 'Hi there' }, { type: 'tool-call', id: 'call', name: 'lookup', arguments: '{"q":"hello"}' }]);
  assert.deepEqual(chunks.at(-2).usage, { inputTokens: 16, outputTokens: 7, cacheReadTokens: 4, cacheWriteTokens: 2, totalTokens: 23 });
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls');
});

test('signed and redacted thinking survive public replay envelope; edited thinking does not', async () => {
  const chunks = await collect([start, open(0, { type: 'thinking', thinking: '' }), delta(0, { type: 'thinking_delta', thinking: 'Plan' }), delta(0, { type: 'signature_delta', signature: 'sig' }), delta(0, { type: 'signature_delta', signature: 'nature' }), close(0), open(1, { type: 'redacted_thinking', data: 'opaque' }), close(1), open(2, { type: 'text', text: 'Answer' }), close(2), ...end()]);
  const content = chunks.filter(c => c.type === 'block-end').map(c => c.block);
  const assistant = message('assistant', content, { source: { kind: 'model', replayState: chunks.at(-1).replayState } });
  const body = anthropicRequestBody(options([assistant]), undefined);
  assert.deepEqual(body.messages[0].content, [{ type: 'thinking', thinking: 'Plan', signature: 'signature' }, { type: 'redacted_thinking', data: 'opaque' }, { type: 'text', text: 'Answer' }]);
  content[0].text = 'edited';
  assert.equal(anthropicRequestBody(options([assistant]), 10).messages[0].content.some(b => b.type === 'thinking'), false);
});

test('maps stop reasons and tolerates unknown top-level extension events', async () => {
  for (const [wire, kind] of [['max_tokens', 'max-tokens'], ['end_turn', 'stop'], ['stop_sequence', 'stop'], ['refusal', 'stop'], ['pause_turn', 'stop'], ['model_context_window_exceeded', 'max-tokens']]) {
    const chunks = await collect([start, { type: 'future_extension' }, open(0, { type: 'text', text: 'ok' }), close(0), ...end(wire)]);
    assert.equal(chunks.at(-1).reason.kind, kind);
  }
});

test('rejects malformed, truncated and explicit-error streams', async () => {
  for (const events of [ ['not JSON'], [start, delta(0, { type: 'text_delta', text: 'bad' })], [start, open(0, { type: 'text', text: '' }), ...end()], [start, open(0, { type: 'tool_use', id: 'a', name: 'lookup', input: {} }), delta(0, { type: 'input_json_delta', partial_json: '{' }), close(0)] ]) {
    await assert.rejects(collect(events), error => error.code === 'MALFORMED_RESPONSE');
  }
  await assert.rejects(collect([start, ...end()]), error => error.code === 'EMPTY_RESPONSE');
  await assert.rejects(collect([start]), error => error.code === 'STREAM_CLOSED');
  await assert.rejects(collect([{ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }]), error => error.code === 'RATE_LIMIT' && /slow down/.test(error.message));
});
