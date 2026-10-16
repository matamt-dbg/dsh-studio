import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PixieStore } from '../src/host/pixie-store.ts';
import { PixieGateDefinitions } from '../src/host/pixie-gate-definitions.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'studio-gate-migration-'));
  const sessions = join(root, 'pixie'); await mkdir(sessions);
  return { root, sessions, legacy: join(sessions, 'gates.json'), target: join(root, 'pixie-gate', 'definitions.json') };
}
test('legacy fallback is not migrated or modified', async () => {
  const f = await fixture(); await writeFile(f.legacy, '[]');
  const definitions = new PixieGateDefinitions(f.target);
  assert.deepEqual(await definitions.read(), { entries: [], invalid: [] });
  assert.equal(await readFile(f.legacy, 'utf8'), '[]'); await assert.rejects(access(f.target), { code: 'ENOENT' });
});
test('missing legacy is empty; failed migration preserves source', async () => {
  const f = await fixture(); assert.deepEqual(await new PixieGateDefinitions(f.target, f.legacy).read(), { entries: [], invalid: [] });
  await writeFile(f.legacy, '[]'); await writeFile(join(f.root, 'blocked'), 'file');
  await assert.rejects(new PixieGateDefinitions(join(f.root, 'blocked', 'definitions.json'), f.legacy).read());
  assert.equal(await readFile(f.legacy, 'utf8'), '[]');
});
test('prune removes only matching session envelopes, preserving legacy definitions and malformed JSON', async () => {
  const f = await fixture();
  for (const [name, text] of [['gates.json', '[]'], ['settings.json', '{}'], ['broken.json', '{'], ['wrong.json', '{"sessionId":"other","threads":[]}'], ['gone.json', '{"sessionId":"gone","threads":[]}']]) await writeFile(join(f.sessions, name), text);
  assert.deepEqual(await new PixieStore(f.sessions).prune(async () => false), ['gone']);
  for (const name of ['gates.json', 'settings.json', 'broken.json', 'wrong.json']) await access(join(f.sessions, name));
});
