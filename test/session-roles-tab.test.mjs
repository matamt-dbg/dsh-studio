import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { SessionRolesTab } from '../src/session-roles-tab.tsx';
import { sessionRolesText } from '../src/session-roles-locale.ts';
import { mergeRoles, editSessionRole, addSessionRole, removeSessionRole, emptySessionRoles } from '../src/session-roles.ts';

const reviewer = { name: 'Reviewer', role: 'review', model: 'provider/a', reasoning: 'high', spawn: 'fork', persona: 'Check evidence' };
const writer = { name: 'Writer', role: 'write', model: 'inherit', reasoning: 'inherit', spawn: 'fresh', persona: '' };
const catalog = { groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'a', name: 'Model A', reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }] } }, { id: 'b', name: 'Model B' }] }], failures: [] };

/** In-memory Host with the real merge rules. */
function host(preset = [reviewer, writer], options = {}) {
  let record = emptySessionRoles();
  const listeners = new Set();
  const view = () => ({ available: options.available ?? true, rootSessionId: 'root', readOnly: options.readOnly ?? false, presetId: 'p', roles: mergeRoles(preset, record), presetRoleIds: preset.map(r => r.role) });
  const commit = next => { record = next; for (const l of listeners) l(); return view(); };
  const calls = [];
  return {
    calls,
    actions: {
      view: async () => view(),
      follow: listener => { listeners.add(listener); listener(); return () => listeners.delete(listener); },
      edit: async (role, patch) => { calls.push(['edit', role, patch]); return commit(editSessionRole(record, preset, role, patch)); },
      add: async input => { calls.push(['add', input]); return commit(addSessionRole(record, preset, input)); },
      remove: async role => { calls.push(['remove', role]); return commit(removeSessionRole(record, role)); },
      models: async () => catalog,
    },
  };
}

function setup() {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  return { dom, root: createRoot(document.getElementById('root')) };
}
const button = (text, scope = document) => [...scope.querySelectorAll('button')].find(b => b.textContent === text);
const { Simulate } = await import('react-dom/test-utils');
const change = async (_dom, element, value) => act(async () => { element.value = value; Simulate.change(element, { target: element }); });

test('editing a preset role saves model, reasoning, persona and spawn, and the card shows the session copy', async () => {
  const { dom, root } = setup();
  const h = host();
  await act(async () => root.render(React.createElement(SessionRolesTab, { actions: h.actions, locale: 'en' })));
  assert.match(document.body.textContent, /Subagents in this session/);
  assert.match(document.querySelector('.studio-role-card').textContent, /Preset/);
  await act(async () => button('Edit').click());
  const dialog = document.querySelector('dialog');
  assert.ok(dialog.open);
  assert.equal(dialog.querySelectorAll('input').length, 0, 'name and role id are not editable for a preset role');
  assert.match(dialog.textContent, /first change copies this role/);
  const [model, reasoning, spawn] = dialog.querySelectorAll('select');
  assert.deepEqual([...reasoning.options].map(o => o.value), ['inherit', 'high', 'low']);
  assert.equal(spawn.value, 'fork');
  await change(dom, spawn, 'fresh');
  await change(dom, model, 'provider/b');
  await change(dom, dialog.querySelector('textarea'), 'Session persona');
  await act(async () => button('Save', dialog).click());
  assert.deepEqual(h.calls, [['edit', 'review', { model: 'provider/b', reasoning: 'inherit', persona: 'Session persona', spawn: 'fresh' }]]);
  assert.equal(document.querySelector('dialog'), null);
  const card = document.querySelector('.studio-role-card');
  assert.match(card.textContent, /Changed in this session/);
  assert.match(card.textContent, /Provider · Model B/);
  await act(async () => button('Use preset', card).click());
  assert.deepEqual(h.calls.at(-1), ['remove', 'review']);
  assert.match(document.querySelector('.studio-role-card').textContent, /Preset/);
  await act(async () => root.unmount()); dom.window.close();
});

test('a temporary role is added with name and id, and removed with Remove', async () => {
  const { dom, root } = setup();
  const h = host([]);
  await act(async () => root.render(React.createElement(SessionRolesTab, { actions: h.actions, locale: 'en' })));
  assert.match(document.body.textContent, /No roles/);
  await act(async () => button('Add role').click());
  const dialog = document.querySelector('dialog');
  assert.equal(button('Save', dialog).disabled, true, 'name and id are required');
  const spawn = dialog.querySelectorAll('select')[2];
  assert.equal(spawn.value, 'fresh');
  await change(dom, spawn, 'fork');
  const [name, id] = dialog.querySelectorAll('input');
  await change(dom, name, 'Scout'); await change(dom, id, 'scout');
  assert.match(dialog.textContent, /Saved instructions are used for new subagents/);
  await change(dom, dialog.querySelector('textarea'), 'Investigate primary sources');
  await act(async () => button('Save', dialog).click());
  assert.deepEqual(h.calls[0], ['add', { name: 'Scout', role: 'scout', model: 'inherit', reasoning: 'inherit', persona: 'Investigate primary sources', spawn: 'fork' }]);
  const card = document.querySelector('.studio-role-card');
  assert.match(card.textContent, /This session/);
  assert.match(card.textContent, /Continue parent/);
  await act(async () => button('Remove', card).click());
  assert.match(document.body.textContent, /No roles/);
  await act(async () => root.unmount()); dom.window.close();
});

test('a failed save keeps the dialog and its edits', async () => {
  const { dom, root } = setup();
  const h = host();
  h.actions.edit = async () => { throw new Error('provider "x" is not registered'); };
  await act(async () => root.render(React.createElement(SessionRolesTab, { actions: h.actions, locale: 'en' })));
  await act(async () => button('Edit').click());
  const dialog = document.querySelector('dialog');
  await change(dom, dialog.querySelector('textarea'), 'Keep me');
  await act(async () => button('Save', dialog).click());
  assert.ok(document.querySelector('dialog').open);
  assert.match(document.querySelector('dialog [role=alert]').textContent, /Could not save.*not registered/);
  assert.equal(document.querySelector('dialog textarea').value, 'Keep me');
  await act(async () => root.unmount()); dom.window.close();
});

test('child sessions are read-only and sessions without the role tool say so', async () => {
  const { dom, root } = setup();
  await act(async () => root.render(React.createElement(SessionRolesTab, { actions: host(undefined, { readOnly: true }).actions, locale: 'en' })));
  assert.match(document.body.textContent, /subagent session/);
  assert.equal(button('Edit'), undefined); assert.equal(button('Add role'), undefined);
  await act(async () => root.render(React.createElement(SessionRolesTab, { key: 'b', actions: host(undefined, { available: false }).actions, locale: 'en' })));
  assert.match(document.body.textContent, /no subagent role tool/);
  assert.equal(document.querySelector('.studio-role-card'), null);
  await act(async () => root.unmount()); dom.window.close();
});

test('a load failure offers retry', async () => {
  const { dom, root } = setup();
  let fail = true;
  const h = host();
  const view = h.actions.view;
  h.actions.view = async () => { if (fail) throw new Error('offline'); return view(); };
  await act(async () => root.render(React.createElement(SessionRolesTab, { actions: h.actions, locale: 'en' })));
  assert.match(document.querySelector('[role=alert]').textContent, /Could not load.*offline/);
  fail = false;
  await act(async () => button('Retry').click());
  assert.match(document.body.textContent, /Reviewer/);
  await act(async () => root.unmount()); dom.window.close();
});

test('every locale has the same keys and the Korean copy follows the verb rules', () => {
  const keys = ['tab', 'title', 'description', 'revert', 'remove', 'save', 'add'];
  for (const locale of ['en', 'ko', 'zh']) for (const key of keys) assert.ok(sessionRolesText(locale, key), `${locale}.${key}`);
  assert.equal(sessionRolesText('ko', 'remove'), '제거');
  assert.equal(sessionRolesText('ko', 'add'), '역할 추가');
  assert.equal(sessionRolesText('fr', 'save'), 'Save');
});

test('UI snapshot: Korean loading state', () => {
  const view = { available: true, rootSessionId: 'root', readOnly: false, roles: [], presetRoleIds: [] };
  // Before the first view arrives the tab shows only the loading line.
  const markup = renderToStaticMarkup(React.createElement(SessionRolesTab, { actions: { view: async () => view, follow: () => () => {}, edit: async () => view, add: async () => view, remove: async () => view, models: async () => catalog }, locale: 'ko' }));
  assert.equal(markup, '<div class="studio-page-stack studio-session-roles"><p class="studio-muted" role="status">불러오는 중…</p></div>');
});

test('UI snapshot: Korean cards for a copy, a preset role and a temporary role', async () => {
  const { dom, root } = setup();
  const preset = [reviewer, writer];
  const record = addSessionRole(editSessionRole(emptySessionRoles(), preset, 'review', { persona: 'x' }), preset, { name: 'Scout', role: 'scout' });
  const view = { available: true, rootSessionId: 'root', readOnly: false, roles: mergeRoles(preset, record), presetRoleIds: ['review', 'write'] };
  await act(async () => root.render(React.createElement(SessionRolesTab, { actions: { view: async () => view, follow: l => { l(); return () => {}; }, edit: async () => view, add: async () => view, remove: async () => view, models: async () => catalog }, locale: 'ko' })));
  const cards = [...document.querySelectorAll('.studio-role-card')].map(card => ({
    title: card.querySelector('h3').textContent,
    badge: card.querySelector('.studio-card-head > :last-child').textContent,
    meta: card.querySelector('.studio-card-meta').textContent,
    actions: [...card.querySelectorAll('button')].map(b => b.textContent),
  }));
  assert.deepEqual(cards, [
    { title: 'Reviewer', badge: '이 세션에서 변경됨', meta: 'Provider · Model A · 추론 high · 부모 대화 이어받기', actions: ['편집', '프리셋 값 사용'] },
    { title: 'Writer', badge: '프리셋', meta: '부모 모델 사용 · 추론 기본값 · 새 대화', actions: ['편집'] },
    { title: 'Scout', badge: '이 세션', meta: '부모 모델 사용 · 추론 기본값 · 새 대화', actions: ['편집', '제거'] },
  ]);
  await act(async () => root.unmount()); dom.window.close();
});
