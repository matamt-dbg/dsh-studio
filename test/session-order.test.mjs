/** Ported from @local/dsh-session-cycle 0.1.0 order.test.js; only the import path changed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readView, orderedSessionIds, currentSessionId, adjacentSession } from '../src/session-order.ts';

const defaults = () => readView({ getItem: () => null });
const view = (patch = {}) => ({ ...defaults(), ...patch });
const session = (id, updatedAt = 1, patch = {}) => ({ id, updatedAt, blank: false, retainedBy: {}, ...patch });
const list = (...rows) => ({ ids: rows.map((row) => row.id), byId: Object.fromEntries(rows.map((row) => [row.id, row])) });
const workspace = (workspaceId, sessionIds, path = `/${workspaceId}`) => ({ workspaceId, sessionIds, path });
const registry = (items = [], patch = {}) => ({ items, pinnedSessionIds: [], archivedSessionIds: [], ...patch });
const run = (sessions, workspaces = registry(), patch = {}) => orderedSessionIds(sessions, workspaces, view(patch));

test('readView reads exact key, fresh shipped defaults, plain JSON and legacy archive default', () => {
  let key;
  const missing = readView({ getItem: (k) => { key = k; return null; } });
  assert.equal(key, 'dsh.workspace.view.v5');
  assert.deepEqual(missing, { groupBy: 'workspace', orderBy: 'updated', groupExpansion: {}, sessionOrderByAccount: {}, archivedFilter: 'default' });
  missing.groupExpansion.x = true;
  assert.deepEqual(defaults().groupExpansion, {});
  const saved = view({ groupBy: 'workspace-tree', orderBy: 'manual' });
  delete saved.archivedFilter;
  assert.deepEqual(readView({ getItem: () => JSON.stringify(saved) }), view({ groupBy: 'workspace-tree', orderBy: 'manual' }));
});

test('malformed persisted state blocks instead of silently choosing a different order', () => {
  for (const value of ['{', 'null', '[]', '{}', JSON.stringify(view({ groupBy: 'new-mode' })), JSON.stringify(view({ orderBy: 'recent' })), JSON.stringify(view({ archivedFilter: null })), JSON.stringify(view({ groupExpansion: { a: 1 } })), JSON.stringify(view({ sessionOrderByAccount: { a: [4] } }))]) {
    assert.throws(() => readView({ getItem: () => value }), /Session cycle:/);
  }
  assert.throws(() => readView(null));
  assert.throws(() => readView({ getItem: () => { throw new Error('denied'); } }), /denied/);
});

test('grouped updated order: host group order, local pins, recency tie IDs, ungrouped last', () => {
  const sessions = list(session('b', 4), session('a', 4), session('pin', 0), session('z', 100), session('loose', 999));
  const workspaces = registry([workspace('second', ['b', 'a', 'pin']), workspace('first', ['z'])], { pinnedSessionIds: ['pin', 'loose'] });
  assert.deepEqual(run(sessions, workspaces), ['pin', 'a', 'b', 'z', 'loose']);
  assert.deepEqual(run(sessions, workspaces, { groupBy: 'flat' }), ['loose', 'pin', 'z', 'a', 'b']);
});

test('manual accounts preserve saved order, drop stale IDs, deduplicate and prepend missing pins', () => {
  const sessions = list(session('a', 1), session('b', 5), session('p', 0), session('q', 99), session('new', 100));
  const workspaces = registry([workspace('w', sessions.ids)], { pinnedSessionIds: ['p', 'q'] });
  const patch = { orderBy: 'manual', sessionOrderByAccount: { w: ['a', 'stale', 'q', 'b', 'a'], __flat_session_order__: ['b', 'a', 'q'] } };
  assert.deepEqual(run(sessions, workspaces, patch), ['p', 'q', 'a', 'b', 'new']);
  assert.deepEqual(run(sessions, workspaces, { ...patch, groupBy: 'flat' }), ['p', 'q', 'b', 'a', 'new']);
});

test('new ordinary forks precede saved source; recursive fork chains retain source semantics', () => {
  const sessions = list(session('source', 0), session('child', 3, { parentId: 'source' }), session('grandchild', 4, { parentId: 'child' }), session('other', 9));
  assert.deepEqual(run(sessions, registry(), { orderBy: 'manual', sessionOrderByAccount: { '': ['source', 'other'] } }), ['grandchild', 'child', 'source', 'other']);
  const cyclic = list(session('a', 2, { parentId: 'b' }), session('b', 1, { parentId: 'a' }));
  assert.deepEqual(new Set(run(cyclic, registry(), { orderBy: 'manual' })), new Set(['a', 'b']));
});

test('blank current leads pins; other blanks and subagents stay invisible; current uses retention', () => {
  const sessions = list(session('hidden', 99, { blank: true }), session('pin', 5), session('child', 100, { origin: 'subagent' }), session('blank', 0, { blank: true, retainedBy: { mainView: 1 } }), session('ordinary', 1));
  const workspaces = registry([], { pinnedSessionIds: ['pin'] });
  assert.equal(currentSessionId(sessions), 'blank');
  assert.deepEqual(run(sessions, workspaces, { groupBy: 'flat' }), ['blank', 'pin', 'ordinary']);
  assert.deepEqual(run(sessions, workspaces, { orderBy: 'manual', sessionOrderByAccount: { '': ['ordinary', 'blank', 'pin'] } }), ['blank', 'pin', 'ordinary']);
  assert.equal(currentSessionId(list()), undefined);
});

test('archive filters never produce unopenable targets; archive slots still affect fork order', () => {
  const sessions = list(session('archive', 1), session('fork', 9, { parentId: 'archive' }), session('other', 4));
  const workspaces = registry([], { archivedSessionIds: ['archive'], pinnedSessionIds: ['archive'] });
  const patch = { orderBy: 'manual', sessionOrderByAccount: { '': ['archive', 'other'] } };
  assert.deepEqual(run(sessions, workspaces, patch), ['fork', 'other']);
  assert.deepEqual(run(sessions, workspaces, { ...patch, archivedFilter: 'show' }), ['fork', 'other']);
  assert.deepEqual(run(sessions, workspaces, { ...patch, archivedFilter: 'only' }), []);
});

test('collapsed groups and show-more do not truncate complete ordered membership', () => {
  const sessions = list(...Array.from({ length: 30 }, (_, i) => session(`s${i}`, i)));
  const workspaces = registry([workspace('hidden', sessions.ids)]);
  assert.deepEqual(run(sessions, workspaces, { groupExpansion: { hidden: false } }), [...sessions.ids].reverse());
});

test('workspace-tree uses nearest ancestor and renders descendants before parent sessions', () => {
  const sessions = list(...['parent', 'child', 'grandchild', 'sibling', 'root', 'loose'].map((key) => session(key)));
  const workspaces = registry([
    workspace('p', ['parent'], '/a/'), workspace('r', ['root'], '/other'),
    workspace('c', ['child'], '/a/c'), workspace('s', ['sibling'], '/a/s'),
    workspace('g', ['grandchild'], '/a/c/g'),
  ]);
  assert.deepEqual(run(sessions, workspaces, { groupBy: 'workspace-tree', groupExpansion: { p: false } }), ['grandchild', 'child', 'sibling', 'parent', 'root', 'loose']);
  assert.deepEqual(run(sessions, workspaces), ['parent', 'root', 'child', 'sibling', 'grandchild', 'loose']);
});

test('tree handles Windows separators without treating POSIX backslashes as separators', () => {
  const sessions = list(session('p'), session('c'), session('not-child'));
  assert.deepEqual(run(sessions, registry([workspace('p', ['p'], 'C:\\work\\'), workspace('n', ['not-child'], 'C:\\worker'), workspace('c', ['c'], 'C:/work/child')]), { groupBy: 'workspace-tree' }), ['c', 'p', 'not-child']);
  assert.deepEqual(run(sessions, registry([workspace('p', ['p'], '/a'), workspace('n', ['not-child'], '/a\\b'), workspace('c', ['c'], '/a/c')]), { groupBy: 'workspace-tree' }), ['c', 'p', 'not-child']);
});

test('unknown summaries wait rather than fabricate rows; no mutation of source snapshots', () => {
  const sessions = list(session('a'));
  sessions.ids.push('missing');
  const workspaces = registry([workspace('w', ['missing', 'a'])]);
  const patch = { orderBy: 'manual', sessionOrderByAccount: { w: ['missing', 'a'] } };
  const before = JSON.stringify([sessions, workspaces, patch]);
  assert.deepEqual(run(sessions, workspaces, patch), ['a']);
  assert.equal(JSON.stringify([sessions, workspaces, patch]), before);
});

test('invalid snapshots fail closed', () => {
  assert.throws(() => run({ ids: [], byId: null }));
  assert.throws(() => run(list(session('bad', NaN))));
  assert.throws(() => run(list(session('bad', 1, { retainedBy: null }))));
  assert.throws(() => run(list(session('a')), registry([], { pinnedSessionIds: 'a' })));
  assert.throws(() => run(list(session('a')), registry([workspace('x', ['a']), workspace('y', ['a'])])));
  assert.throws(() => run(list(session('a')), registry([workspace('x', []), workspace('x', [])])));
});

test('adjacent selection wraps both directions and no-ops on unsafe or trivial lists', () => {
  assert.equal(adjacentSession(['a', 'b', 'c'], 'c', 1), 'a');
  assert.equal(adjacentSession(['a', 'b', 'c'], 'a', -1), 'c');
  assert.equal(adjacentSession(['a', 'b', 'c'], 'b', 'next'), 'c');
  assert.equal(adjacentSession(['a', 'b', 'c'], 'b', 'previous'), 'a');
  assert.equal(adjacentSession([], undefined, 1), null);
  assert.equal(adjacentSession(['a'], 'a', 1), null);
  assert.equal(adjacentSession(['a', 'b'], undefined, -1), null);
  assert.equal(adjacentSession(['a', 'b'], 'not-visible', 1), null);
  assert.throws(() => adjacentSession(['a', 'a'], 'a', 1));
  assert.throws(() => adjacentSession(['a', 'b'], 'a', 0));
});
