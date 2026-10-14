import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MasterExtensions, validateExtensions } from '../src/host/master-extensions.ts';

const plugin = (extra = {}) => ({ id: 'extra-tools', name: '@example/tools/provider', ...extra });
const group = config => ({ id: 'tools', name: 'cordis:group', group: true, config });

test('literal compositions round trip, survive reopening, and keep private atomic files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-extensions-'));
  const file = join(directory, 'nested', 'extensions.json');
  const store = new MasterExtensions(file);
  assert.deepEqual(await store.read(), []);
  const rows = [group([plugin({ isolate: { tools: true, other: false }, disabled: false,
    config: { literal: '!!js process.exit()', nested: [null, true, 0, ''], object: {} } })])];
  const saving = store.save(rows);
  rows[0].config[0].config.nested.push('mutated');
  await saving;
  const expected = [group([plugin({ isolate: { tools: true, other: false }, disabled: false,
    config: { literal: '!!js process.exit()', nested: [null, true, 0, ''], object: {} } })])];
  assert.deepEqual(await new MasterExtensions(file).read(), expected);
  assert.deepEqual(await readdir(join(directory, 'nested')), ['extensions.json']);
  const before = await readFile(file, 'utf8');
  await assert.rejects(store.save([plugin({ inject: ['tools'] })]), /Unsupported/);
  assert.equal(await readFile(file, 'utf8'), before);
  await Promise.all([store.save([plugin()]), store.save([])]);
  assert.deepEqual(await store.read(), []);
});

test('malformed disk stores fail closed rather than appearing empty', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-extensions-'));
  const file = join(directory, 'extensions.json');
  for (const content of ['{', 'null', '[]', '{"version":2,"extensions":[]}',
    '{"version":1,"extensions":[{}]}', '{"version":1,"extensions":[],"unknown":true}',
    '{"version":1,"extensions":[],"__proto__":{}}']) {
    await writeFile(file, content);
    await assert.rejects(new MasterExtensions(file).read());
    assert.equal(await readFile(file, 'utf8'), content);
  }
});

test('requires stable ids, package specifiers, and a strict literal row dialect', () => {
  for (const id of [undefined, '', 'Upper', 'a/b', 'a'.repeat(65)]) assert.throws(() => validateExtensions([plugin({ id })]));
  for (const name of ['https://host/plugin', 'file:plugin', '/tmp/plugin', './plugin', '../plugin', 'pkg/../other', 'pkg//part', '@scope', 'pkg@1', 'node:fs', 'pkg\\part']) {
    assert.throws(() => validateExtensions([plugin({ name })]), /package/);
  }
  for (const name of ['plugin', '@scope/plugin', 'plugin/sub-path', '@scope/plugin/sub/path.js']) {
    assert.equal(validateExtensions([plugin({ name })])[0].name, name);
  }
  for (const extra of [{ unknown: true }, { inject: [] }, { intercept: {} }, { disabled: '!!js true' },
    { disabled: null }, { group: true }, { name: 'cordis:group' }, { isolate: true }, { isolate: { tools: 'realm' } }]) {
    assert.throws(() => validateExtensions([plugin(extra)]));
  }
  assert.throws(() => validateExtensions([group({})]));
  assert.throws(() => validateExtensions([plugin(), plugin()]), /Duplicate/);
  assert.throws(() => validateExtensions([group([plugin(), plugin()])]), /Duplicate/);
  assert.doesNotThrow(() => validateExtensions([group([plugin()]), plugin()]));
});

test('bounds composition count and depth recursively', () => {
  const rows = Array.from({ length: 64 }, (_, i) => plugin({ id: `tool-${i}` }));
  assert.equal(validateExtensions(rows).length, 64);
  assert.throws(() => validateExtensions([group(rows)]), /64/);
  let row = plugin();
  for (let i = 1; i < 8; i++) row = group([row]);
  assert.doesNotThrow(() => validateExtensions([row]));
  assert.throws(() => validateExtensions([group([row])]), /depth/);
});

test('rejects poison keys, non-JSON values, accessors, sparse arrays and cycles without execution', () => {
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    for (const config of [JSON.parse(`{"${key}":true}`), { nested: [JSON.parse(`{"${key}":true}`)] }]) {
      assert.throws(() => validateExtensions([plugin({ config })]), /Unsafe/);
    }
    assert.throws(() => validateExtensions([JSON.parse(`{"id":"a","name":"pkg","${key}":{}}`)]), /Unsafe/);
  }
  const cycle = {}; cycle.self = cycle;
  const accessor = Object.defineProperty({}, 'run', { enumerable: true, get() { assert.fail('getter executed'); } });
  for (const config of [undefined, NaN, Infinity, 1n, () => {}, Symbol('x'), new Date(), new Map(),
    { nested: undefined }, [undefined], Array(1), Object.assign([], { extra: true }), cycle, accessor,
    { [Symbol('hidden')]: 1 }, Object.create({ inherited: true })]) {
    assert.throws(() => validateExtensions([plugin({ config })]));
  }
  let config = {};
  for (let i = 0; i < 8; i++) config = { nested: config };
  assert.throws(() => validateExtensions([plugin({ config })]), /depth/);
  assert.throws(() => validateExtensions({}));
  assert.throws(() => validateExtensions(Array(1)));
  const rows = [plugin({ config: { nested: ['value'] } })];
  const clone = validateExtensions(rows);
  clone[0].config.nested.push('different');
  assert.deepEqual(rows[0].config.nested, ['value']);
});
