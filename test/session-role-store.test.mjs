import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { dump } from 'js-yaml';
import { SessionRoleStore } from '../src/host/session-role-store.ts';
import { resolveRootSession } from '../src/host/session-root.ts';
import { SessionRoleService } from '../src/host/session-role-service.ts';
import { ROLE_PLUGIN } from '../src/package-name.ts';
import { addSessionRole, editSessionRole } from '../src/session-roles.ts';

const reviewer = { name: 'Reviewer', role: 'review', model: 'inherit', reasoning: 'high', spawn: 'fork', persona: 'Review' };
const temp = prefix => mkdtemp(join(tmpdir(), prefix));

test('records are isolated per session, removed when empty, and rejected when invalid', async () => {
  const root = await temp('studio-session-roles-');
  const store = new SessionRoleStore(root);
  const heard = [];
  const stop = store.subscribe('a', () => heard.push('a'));
  await store.update('a', record => editSessionRole(record, [reviewer], 'review', { persona: 'A only' }));
  assert.equal((await store.read('a')).roles[0].persona, 'A only');
  assert.deepEqual((await store.read('b')).roles, []);
  assert.deepEqual(heard, ['a']);
  // A failed change writes nothing and notifies nobody.
  await assert.rejects(store.update('a', record => editSessionRole(record, [reviewer], 'review', { model: 'bare' })), /model/);
  assert.equal((await store.read('a')).roles[0].persona, 'A only');
  assert.deepEqual(heard, ['a']);
  await store.update('a', () => ({ version: 1, roles: [] }));
  assert.deepEqual(await readdir(root), []);
  stop();
  await writeFile(join(root, 'bad.json'), '{"version":1,"roles":[{"name":"x","role":"x","spawn":"nope"}]}');
  await assert.rejects(store.read('bad'), /Invalid session roles for session bad/);
  for (const id of ['../x', '', 'a/b', 1]) await assert.rejects(async () => store.read(id), /Invalid session id/);
});

test('concurrent changes to one session are serialized', async () => {
  const store = new SessionRoleStore(await temp('studio-session-roles-'));
  await Promise.all(['one', 'two', 'three'].map(role => store.update('s', record => addSessionRole(record, [], { name: role, role }))));
  assert.deepEqual((await store.read('s')).roles.map(r => r.role).sort(), ['one', 'three', 'two']);
});

for (const fails of [false, true]) test(`prune keeps listed sessions and removes deleted ones; listing failure=${fails}`, async () => {
  const store = new SessionRoleStore(await temp('studio-session-roles-'));
  for (const id of ['archived', 'gone']) await store.update(id, record => addSessionRole(record, [], { name: 'x', role: 'x' }));
  const removed = await store.prune(async () => { if (fails) throw new Error('offline'); return [{ sessionId: 'archived' }]; });
  assert.deepEqual(removed, fails ? [] : ['gone']);
  assert.equal((await store.read('archived')).roles.length, 1);
  assert.equal((await store.read('gone')).roles.length, fails ? 1 : 0);
});

test('subagent children climb to their root; forks and unknown parents stop', async () => {
  const headers = {
    root: {}, child: { origin: 'subagent', parentSession: 'root' }, grandchild: { origin: 'subagent', parentSession: 'child' },
    fork: { parentSession: 'root' }, forkChild: { origin: 'subagent', parentSession: 'fork' },
    orphan: { origin: 'subagent', parentSession: 'missing' }, loopA: { origin: 'subagent', parentSession: 'loopB' }, loopB: { origin: 'subagent', parentSession: 'loopA' },
  };
  const lookup = id => headers[id];
  assert.equal(await resolveRootSession('root', lookup), 'root');
  assert.equal(await resolveRootSession('child', lookup), 'root');
  assert.equal(await resolveRootSession('grandchild', async id => lookup(id)), 'root');
  assert.equal(await resolveRootSession('fork', lookup), 'fork');
  assert.equal(await resolveRootSession('forkChild', lookup), 'fork');
  assert.equal(await resolveRootSession('orphan', lookup), 'orphan');
  assert.equal(await resolveRootSession('unknown', lookup), 'unknown');
  assert.ok(['loopA', 'loopB'].includes(await resolveRootSession('loopA', lookup)));
});

async function service({ headers, presets, list = async () => ({ items: [] }) }) {
  const dir = await temp('studio-session-role-service-');
  const ctx = new Context();
  for (const key of ['agentPresets', 'sessionController']) ctx.provide(key);
  ctx.set('agentPresets', {
    composedPreset: () => undefined,
    readDocument: async id => { if (!presets[id]) throw new Error('not found'); return { agentPreset: id, content: dump(presets[id]) }; },
  });
  ctx.set('sessionController', {
    inspect: async id => { if (!headers[id]) throw new Error('missing'); return { meta: headers[id], events: [] }; },
    list,
  });
  const fiber = ctx.plugin(SessionRoleService, dir); await fiber;
  return { fiber, remote: ctx.get('studioSessionRoles'), dir };
}

test('Remote view, edit, add and remove follow the root and its preset', async () => {
  const presets = {
    studio: [{ id: 'group', group: true, config: [{ id: 'studio-roles', name: ROLE_PLUGIN, config: { roles: [reviewer] } }] }],
    plain: [{ id: 'other', name: 'some-plugin' }],
  };
  const headers = { root: { agentPreset: 'studio' }, child: { origin: 'subagent', parentSession: 'root', agentPreset: 'studio' }, bare: { agentPreset: 'plain' } };
  const h = await service({ headers, presets });
  try {
    let view = await h.remote.view('root');
    assert.deepEqual({ ...view, roles: view.roles.map(r => [r.role, r.source]) }, { available: true, rootSessionId: 'root', readOnly: false, presetId: 'studio', roles: [['review', 'preset']], presetRoleIds: ['review'] });
    view = await h.remote.editRole('root', JSON.stringify({ role: 'review', persona: 'Session persona', spawn: 'fresh' }));
    assert.deepEqual([view.roles[0].source, view.roles[0].persona, view.roles[0].spawn], ['session', 'Session persona', 'fork']);
    view = await h.remote.addRole('root', JSON.stringify({ name: 'Scout', role: 'scout', reasoning: 'low' }));
    assert.deepEqual(view.roles.map(r => r.role), ['review', 'scout']);
    // The child sees the root's roles and cannot change them.
    const child = await h.remote.view('child');
    assert.deepEqual([child.rootSessionId, child.readOnly, child.roles.map(r => r.role)], ['root', true, ['review', 'scout']]);
    await assert.rejects(h.remote.editRole('child', JSON.stringify({ role: 'review', persona: 'x' })), /read-only/);
    await assert.rejects(h.remote.removeRole('child', 'scout'), /read-only/);
    // A preset without the Studio role tool shows unavailable and refuses edits.
    assert.deepEqual(await h.remote.view('bare'), { available: false, rootSessionId: 'bare', readOnly: false, presetId: 'plain', roles: [], presetRoleIds: [] });
    await assert.rejects(h.remote.addRole('bare', JSON.stringify({ name: 'x', role: 'x' })), /no Studio role tool/);
    view = await h.remote.removeRole('root', 'review');
    assert.deepEqual(view.roles.map(r => [r.role, r.source, r.persona]), [['review', 'preset', 'Review'], ['scout', 'session', '']]);
    await assert.rejects(h.remote.editRole('root', JSON.stringify({ role: 'missing', model: 'inherit' })), /Unknown role/);
  } finally { await h.fiber.dispose(); }
});

test('model validation runs before a change is saved', async () => {
  const h = await service({ headers: { root: { agentPreset: 'studio' } }, presets: { studio: [{ id: 'r', name: ROLE_PLUGIN, config: { roles: [reviewer] } }] } });
  try {
    // No llm service is mounted, so an explicit route cannot be validated.
    await assert.rejects(h.remote.editRole('root', JSON.stringify({ role: 'review', model: 'route/x' })), /validation unavailable/);
    assert.equal((await h.remote.view('root')).roles[0].source, 'preset');
  } finally { await h.fiber.dispose(); }
});

test('follow syncs first and after each committed change of the root', async () => {
  const h = await service({ headers: { root: { agentPreset: 'studio' }, child: { origin: 'subagent', parentSession: 'root' } }, presets: { studio: [{ id: 'r', name: ROLE_PLUGIN, config: { roles: [reviewer] } }] } });
  const abort = new AbortController();
  try {
    const stream = h.remote.follow('child', abort.signal);
    assert.deepEqual((await stream.next()).value, { type: 'sync' });
    const next = stream.next();
    await h.remote.addRole('root', JSON.stringify({ name: 'Scout', role: 'scout' }));
    assert.deepEqual((await next).value, { type: 'sync' });
    abort.abort();
    assert.equal((await stream.next()).done, true);
  } finally { abort.abort(); await h.fiber.dispose(); }
});

test('service prunes records of deleted sessions on start', async () => {
  let listed; const observed = new Promise(resolve => { listed = resolve; });
  const dir = await temp('studio-session-role-prune-');
  const root = join(dir, 'session-roles');
  await mkdir(root, { recursive: true });
  const store = new SessionRoleStore(root);
  for (const id of ['kept', 'gone']) await store.update(id, record => addSessionRole(record, [], { name: 'x', role: 'x' }));
  const ctx = new Context();
  for (const key of ['agentPresets', 'sessionController']) ctx.provide(key);
  ctx.set('agentPresets', { composedPreset: () => undefined, readDocument: async () => { throw new Error('none'); } });
  ctx.set('sessionController', { inspect: async () => ({}), list: async () => { listed(); return { items: [{ sessionId: 'kept' }] }; } });
  const fiber = ctx.plugin(SessionRoleService, dir); await fiber;
  await observed;
  await fiber.dispose();
  assert.deepEqual((await readdir(root)).sort(), ['kept.json']);
});
