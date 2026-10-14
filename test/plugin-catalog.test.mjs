import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({ entryPoints: ['src/plugin-catalog.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { readPluginCatalog } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
test('waits for Loader and reads Config through owning tree without preset calls or raw secret export', async () => {
  let release; const settled = new Promise(resolve => { release = resolve; }); let imported = 0;
  const entry = { id: 'external', options: { name: 'external-plugin', config: { apiKey: 'secret' } }, parent: { tree: { async import(name) { assert.equal(name, 'external-plugin'); imported++; return { default: { Config: {} } }; } } } };
  const pending = readPluginCatalog({ await: () => settled, entries: () => [entry], unwrapExports: value => value.default }, async () => ({ type: 'object' }));
  assert.equal(imported, 0); release(); const result = await pending;
  assert.equal(imported, 1); assert.deepEqual(result, [{ id: 'external', name: 'external-plugin', schema: { type: 'object' } }]);
});
test('reports individual import failure without hiding other entries', async () => {
  const result = await readPluginCatalog({ async await() {}, entries: () => [{ id: 'broken', options: { name: 'broken' }, parent: { tree: { import() { throw new Error('missing module'); } } } }], unwrapExports: value => value }, async () => ({}));
  assert.match(result[0].error, /missing module/);
});
