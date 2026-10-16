import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PixieStore } from '../src/host/pixie-store.ts';
import { PixieRuntime } from '../src/host/pixie-runtime.ts';

test('Pixie optional timeout ends a stuck model request as error, not cancelled or pass', async () => {
  const store = new PixieStore(await mkdtemp(join(tmpdir(), 'studio-pixie-timeout-')));
  let signal;
  const runtime = new PixieRuntime({ store, timeoutMs: 10,
    llm: { stream(options) { signal = options.signal; return { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; } }; } },
    settings: async () => ({ model: { provider: 'p', model: 'm' }, contextMode: 'fresh', systemPrompt: '', allowThreadModel: true }),
    sessionEvents: async () => [],
  });
  const frames = [];
  for await (const frame of runtime.ask('s', { question: 'hello' }, new AbortController().signal)) frames.push(frame);
  assert.equal(frames.at(-1).status, 'error'); assert.match(frames.at(-1).error, /timed out/);
  assert.equal(signal.aborted, true);
  assert.equal((await store.read('s')).threads[0].turns[0].status, 'error');
});
