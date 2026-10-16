/** Fork snapshot: only user and assistant text from the session's model-visible messages. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkSnapshot } from '../src/host/pixie-fork.ts';

const user = (seq, text, source = { kind: 'user' }) => ({ type: 'user/message', seq, time: seq, surfaceOp: 'append', data: { id: `u${seq}`, role: 'user', source, content: [{ type: 'text', text }] } });
const assistant = (seq, content) => ({ type: 'assistant/message', seq, time: seq, data: { turn: 1, step: 1, stream: [], message: { id: `a${seq}`, role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content } } });

test('keeps user and assistant text in order and drops everything else', () => {
  const events = [
    { type: 'system/message', seq: 0, time: 0, data: { turn: 1, step: 1, message: { role: 'system', content: [{ type: 'text', text: 'SYSTEM' }] } } },
    user(1, 'question'),
    assistant(2, [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'answer' }, { type: 'tool-call', id: 't', name: 'bash', arguments: '{}' }]),
    { type: 'tool/result', seq: 3, time: 3, data: { message: { role: 'tool', content: [{ type: 'text', text: 'tool output' }] } } },
    { type: 'command/run', seq: 4, time: 4, data: { commandId: 'c', name: 'pixie', args: ' hi', source: { kind: 'user' } } },
    assistant(5, [{ type: 'text', text: 'final' }]),
  ];
  assert.deepEqual(forkSnapshot(events), [
    { role: 'user', text: 'question' },
    { role: 'assistant', text: 'answer', provider: 'p', model: 'm' },
    { role: 'assistant', text: 'final', provider: 'p', model: 'm' },
  ]);
});

test('drops injected user context and empty messages', () => {
  const events = [
    user(1, 'real'),
    user(2, '<file-change notice>', { kind: 'inject' }),
    assistant(3, [{ type: 'tool-call', id: 't', name: 'bash', arguments: '{}' }]),
  ];
  assert.deepEqual(forkSnapshot(events), [{ role: 'user', text: 'real' }]);
});

test('a compaction checkpoint stands in for the range it replaced', () => {
  const events = [
    user(1, 'old one'),
    assistant(2, [{ type: 'text', text: 'old answer' }]),
    { ...user(3, 'summary of earlier work', { kind: 'compact-checkpoint', compactionId: 'c1' }), surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 } },
    user(4, 'next'),
  ];
  assert.deepEqual(forkSnapshot(events), [{ role: 'user', text: 'summary of earlier work' }, { role: 'user', text: 'next' }]);
});
