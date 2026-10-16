import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogSnapshot, compareCatalog, cleanRequest, cleanRoles } from '../src/master-snapshot.ts';
import { CatalogBaseline } from '../src/host/catalog-baseline.ts';

const tool = (name, properties = {}) => ({ name, description: name, parameters: { type: 'object', properties } });
const composition = [
  { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs', config: { secret: 'token-123' } },
  { id: 'extra', name: 'example-extra' },
  { id: 'compaction', name: 'cordis:group', group: true, config: [{ id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' }] },
];
const plugins = ids => ids.map(id => ({ id, name: id }));
const all = ['tool-fs', 'extra', 'compaction/compaction-basic'];
const preset = request => ({ id: 'studio-user-1', name: 'Mine', request: { preset: 'studio-master', providers: [], prompt: '', model: 'x', ...request }, agents: [] });

test('snapshots keep identity metadata only and refuse partial collections', () => {
  const snapshot = catalogSnapshot([tool('read')], plugins(all), composition);
  assert.deepEqual(snapshot.configs.map(entry => entry.id), ['compaction/compaction-basic', 'extra', 'tool-fs']);
  assert.doesNotMatch(JSON.stringify(snapshot), /token-123/);
  assert.equal(catalogSnapshot([tool('read')], [...plugins(all.slice(1)), { id: 'tool-fs', name: 'x', error: 'load failed' }], composition), undefined);
  assert.equal(catalogSnapshot([tool('read')], undefined, composition), undefined);
  // Key order is not a schema change.
  const a = catalogSnapshot([tool('read', { a: { type: 'string' }, b: { type: 'number' } })], plugins(all), composition);
  const b = catalogSnapshot([tool('read', { b: { type: 'number' }, a: { type: 'string' } })], plugins(all), composition);
  assert.equal(compareCatalog(a, b, []), undefined);
});

test('compare reports additions, removals, schema changes and the cleanup each preset would get', () => {
  const before = catalogSnapshot([tool('read'), tool('x_search'), tool('bash', { t: { type: 'number' } })], plugins(all), composition);
  const after = catalogSnapshot([tool('read'), tool('image_generate'), tool('bash', { t: { type: 'integer' } })], plugins(['tool-fs', 'compaction/compaction-basic']), composition.filter(row => row.id !== 'extra'));
  const presets = [preset({ tools: ['read', 'x_search'], toolOverrides: { x_search: { description: 'e' }, read: { description: 'r' } }, configOverrides: { extra: { a: 1 }, 'tool-fs': { b: 2 } } }),
    { ...preset({ tools: ['read'] }), id: 'studio-user-2', name: 'Untouched' }];
  const change = compareCatalog(before, after, presets);
  assert.deepEqual(change.added, { tools: ['image_generate'], configs: [] });
  assert.deepEqual(change.removed, { tools: ['x_search'], configs: ['extra'] });
  assert.deepEqual(change.changed, { tools: ['bash'] });
  assert.deepEqual(change.cleanup, [{ id: 'studio-user-1', name: 'Mine', tools: ['x_search'], configs: ['extra'] }]);
  assert.equal(compareCatalog(undefined, after, presets), undefined, 'first collection only becomes the baseline');
  assert.equal(compareCatalog(after, after, presets), undefined, 'the same change is not announced twice');
});

test('a Config id now provided by another package is removed and re-added, not migrated', () => {
  const before = catalogSnapshot([], plugins(all), composition);
  const after = catalogSnapshot([], plugins(all), composition.map(row => row.id === 'extra' ? { ...row, name: 'other-extra' } : row));
  const change = compareCatalog(before, after, [preset({ tools: [], configOverrides: { extra: { a: 1 } } })]);
  assert.deepEqual(change.removed.configs, ['extra']); assert.deepEqual(change.added.configs, ['extra']);
  assert.deepEqual(change.cleanup[0].configs, ['extra']);
});

test('cleanup removes only confirmed names and keeps unrelated overrides', () => {
  const request = { tools: ['read', 'x_search', 'bash'], toolOverrides: { x_search: {}, bash: { description: 'b' } },
    execution: { defaults: { x_search: { timeoutMs: 1 }, bash: { timeoutMs: 2 } }, batch: { tool: 'x_search', parameter: 'calls', maxItems: 2 } },
    subagentToolFilter: { deny: ['x_search'] }, configOverrides: { extra: {}, 'tool-fs': { a: false } }, configExclusions: ['extra'] };
  const next = cleanRequest(request, ['x_search'], ['extra']);
  assert.deepEqual(next, { tools: ['read', 'bash'], toolOverrides: { bash: { description: 'b' } }, execution: { defaults: { bash: { timeoutMs: 2 } } }, configOverrides: { 'tool-fs': { a: false } } });
  assert.deepEqual(cleanRoles([{ name: 'r', toolFilter: { mode: 'extend', deny: ['x_search', 'bash'] } }], ['x_search']), [{ name: 'r', toolFilter: { mode: 'extend', deny: ['bash'] } }]);
  assert.deepEqual(cleanRequest(next, ['x_search'], ['extra']), next, 'idempotent');
});

test('the baseline file is replaced atomically and corrupt data is reported, not overwritten', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'studio-baseline-')), 'catalog-snapshot.json');
  const baseline = new CatalogBaseline(file);
  assert.equal(await baseline.read(), undefined);
  const snapshot = catalogSnapshot([tool('read')], plugins(all), composition);
  await baseline.save(snapshot);
  assert.deepEqual(await baseline.read(), snapshot);
  await writeFile(file, '{"version":2}');
  await assert.rejects(baseline.read(), /Unsupported Studio catalog snapshot/);
  assert.equal(await readFile(file, 'utf8'), '{"version":2}');
});
