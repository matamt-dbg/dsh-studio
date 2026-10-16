import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTask } from '../src/pixie-gate-task.ts';
import { PixieGateDefinitions } from '../src/host/pixie-gate-definitions.ts';
import { readRuntimeGateDefinitions } from '../src/host/pixie-gate-definition-reader.ts';
test('invalid and legacy entries are isolated with raw data and file preserved', async () => {
 const file = join(await mkdtemp(join(tmpdir(), 'tasks-')), 'definitions.json');
 const valid = makeTask('valid', 'user-message', 'Check');
 const raw = [{ bad: true }, { definition: { id: 'old' }, presetIds: [] }, valid]; const text = JSON.stringify(raw); await writeFile(file, text);
 const store = new PixieGateDefinitions(file), result = await store.read();
 assert.deepEqual(result.entries, [valid]); assert.deepEqual(result.invalid.map(x => x.index), [0, 1]); assert.deepEqual(result.invalid[1].raw, raw[1]); assert.equal(result.invalid[1].error.code, 'legacy-gate-definition'); assert.equal(await readFile(file, 'utf8'), text);
 assert.deepEqual(await readRuntimeGateDefinitions({ definitions: () => store.read() }), [valid]);
 assert.throws(() => store.save(raw)); assert.equal(await readFile(file, 'utf8'), text);
});
for (const text of ['{', '{}']) test(`broken file ${text} is preserved and fail open`, async () => {
 const file = join(await mkdtemp(join(tmpdir(), 'tasks-')), 'definitions.json'); await writeFile(file, text); const store = new PixieGateDefinitions(file);
 assert.ok((await store.read()).error); assert.deepEqual(await readRuntimeGateDefinitions({ definitions: () => store.read() }), []); assert.equal(await readFile(file, 'utf8'), text);
});
test('reader failures are fail open and saves validate duplicate bindings', async () => {
 assert.deepEqual(await readRuntimeGateDefinitions({ definitions: async () => { throw new Error('read'); } }), []);
 const store = new PixieGateDefinitions(join(await mkdtemp(join(tmpdir(), 'tasks-')), 'definitions.json'));
 const task = { ...makeTask('a', 'user-message', 'Check'), enabled: true, presetIds: ['p'] };
 assert.throws(() => store.save([task, { ...task, id: 'other' }])); await store.save([task]); assert.deepEqual((await store.read()).entries, [task]);
});
