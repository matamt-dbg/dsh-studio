import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSessionRole, editSessionRole, emptySessionRoles, mergeRoles, parseSessionRoles, removeSessionRole, selectRole, PARENT_ROLE } from '../src/session-roles.ts';

const reviewer = { name: 'Reviewer', role: 'review', model: 'route/a', reasoning: 'high', spawn: 'fork', persona: 'Review carefully', toolFilter: { mode: 'extend', deny: ['bash'] } };
const writer = { name: 'Writer', role: 'write', model: 'inherit', reasoning: 'inherit', spawn: 'fresh', persona: '' };
const preset = [reviewer, writer];

test('preset roles pass through when the session owns none', () => {
  assert.deepEqual(mergeRoles(preset, emptySessionRoles()).map(r => [r.role, r.source]), [['review', 'preset'], ['write', 'preset']]);
});

test('first edit copies the whole preset role and only model, reasoning and persona change', () => {
  const record = editSessionRole(emptySessionRoles(), preset, 'review', { model: 'route/b', persona: 'Be brief', spawn: 'fresh', toolFilter: { mode: 'replace', deny: [] }, name: 'X' });
  assert.deepEqual(record.roles, [{ ...reviewer, model: 'route/b', persona: 'Be brief' }]);
  const merged = mergeRoles(preset, record);
  assert.deepEqual(merged.map(r => [r.role, r.source]), [['review', 'session'], ['write', 'preset']]);
  assert.equal(merged[0].spawn, 'fork');
  assert.deepEqual(merged[0].toolFilter, reviewer.toolFilter);
  // A second edit works on the session copy, not the preset.
  const again = editSessionRole(record, preset, 'review', { reasoning: 'low' });
  assert.deepEqual(again.roles, [{ ...reviewer, model: 'route/b', persona: 'Be brief', reasoning: 'low' }]);
});

test('session copies survive later preset changes and deletion', () => {
  const record = editSessionRole(emptySessionRoles(), preset, 'review', { model: 'route/b' });
  const changed = [{ ...reviewer, model: 'route/z', persona: 'new' }, writer];
  assert.equal(mergeRoles(changed, record)[0].model, 'route/b');
  assert.equal(mergeRoles(changed, record)[0].persona, reviewer.persona);
  const removed = mergeRoles([writer], record);
  assert.deepEqual(removed.map(r => [r.role, r.source]), [['write', 'preset'], ['review', 'session']]);
});

test('temporary roles start fresh with the preset tool filter and reject taken identifiers', () => {
  const record = addSessionRole(emptySessionRoles(), preset, { name: 'Scout', role: 'scout', model: 'route/c', reasoning: 'medium', persona: 'Look around', spawn: 'fork', toolFilter: { mode: 'replace', deny: [] } });
  assert.deepEqual(record.roles, [{ name: 'Scout', role: 'scout', model: 'route/c', reasoning: 'medium', spawn: 'fresh', persona: 'Look around' }]);
  assert.deepEqual(mergeRoles(preset, record).map(r => r.role), ['review', 'write', 'scout']);
  assert.throws(() => addSessionRole(record, preset, { name: 'Again', role: 'scout' }), /already/);
  assert.throws(() => addSessionRole(record, preset, { name: 'Clash', role: 'review' }), /already/);
  assert.throws(() => addSessionRole(record, preset, { name: 'Bad', role: 'bad', model: 'bare' }), /model/);
  assert.equal(addSessionRole(emptySessionRoles(), preset, { name: 'Min', role: 'min' }).roles[0].model, 'inherit');
});

test('removing a session role reverts a copy and deletes a temporary role', () => {
  let record = editSessionRole(emptySessionRoles(), preset, 'review', { model: 'route/b' });
  record = addSessionRole(record, preset, { name: 'Scout', role: 'scout' });
  record = removeSessionRole(removeSessionRole(record, 'review'), 'scout');
  assert.deepEqual(record.roles, []);
  assert.throws(() => removeSessionRole(record, 'review'), /not a session role/);
});

test('edits validate and reject unknown roles', () => {
  assert.throws(() => editSessionRole(emptySessionRoles(), preset, 'missing', { model: 'route/b' }), /Unknown role/);
  assert.throws(() => editSessionRole(emptySessionRoles(), preset, 'review', { model: 'bare' }), /model/);
  assert.throws(() => editSessionRole(emptySessionRoles(), preset, 'review', { reasoning: 'two words' }), /reasoning/);
  // Persona keeps its whitespace.
  assert.equal(editSessionRole(emptySessionRoles(), preset, 'review', { persona: '  indented\n' }).roles[0].persona, '  indented\n');
});

test('stored records parse strictly', () => {
  const record = editSessionRole(emptySessionRoles(), preset, 'review', { model: 'route/b' });
  assert.deepEqual(parseSessionRoles(JSON.parse(JSON.stringify(record))), record);
  for (const bad of [null, [], { version: 2, roles: [] }, { version: 1 }, { version: 1, roles: [reviewer, reviewer] }, { version: 1, roles: [{ ...reviewer, spawn: 'x' }] }])
    assert.throws(() => parseSessionRoles(bad));
  // Legacy override data is never carried into a session record.
  assert.equal('overrides' in parseSessionRoles({ version: 1, roles: [{ ...writer, overrides: { a: 1 } }] }).roles[0], false);
});

test('call selection uses merged roles and falls back to the parent role when there are none', () => {
  const record = addSessionRole(emptySessionRoles(), [], { name: 'Scout', role: 'scout' });
  assert.equal(selectRole(mergeRoles([], record), 'scout').role, 'scout');
  assert.equal(selectRole(mergeRoles([], record), 'missing'), undefined);
  assert.equal(selectRole([], 'anything'), PARENT_ROLE);
  assert.equal(selectRole([], undefined), PARENT_ROLE);
});
