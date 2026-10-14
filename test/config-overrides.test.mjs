import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyConfigOverrides, validateConfigOverrides } from '../src/config-overrides.ts';
import { parsePreviewRequest } from '../src/prompt-composition.ts';
test('entry-path overrides preserve realms, merge objects, replace arrays and retain explicit false/zero/empty', () => {
 const rows = [{ id: 'group', name: 'cordis:group', group: true, isolate: { service: true }, config: [{ id: 'a', name: 'plugin', config: { nested: { keep: 1, count: 2 }, enabled: true, text: 'x', list: [1, 2] } }] }];
 const before = JSON.stringify(rows);
 const next = applyConfigOverrides(rows, { 'group/a': { nested: { count: 0 }, enabled: false, text: '', list: [] } });
 assert.deepEqual(next[0].config[0].config, { nested: { keep: 1, count: 0 }, enabled: false, text: '', list: [] });
 assert.deepEqual(next[0].isolate, { service: true }); assert.equal(JSON.stringify(rows), before);
 assert.throws(() => applyConfigOverrides(rows, { unknown: {} }), /Unknown/);
 assert.throws(() => validateConfigOverrides(JSON.parse('{"a":{"__proto__":{}}}')), /Unsafe/);
});
test('request codec preserves Config overrides', () => {
 const request = { preset: 'studio-master', providers: [], tools: [], prompt: '', model: 'testLLM', configOverrides: { 'tool-fs': { limit: 0 } } };
 assert.deepEqual(parsePreviewRequest(request), request);
});
