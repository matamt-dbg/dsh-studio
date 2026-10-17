/** SettingsX page: command rows reflect DSH bindings and toggles; provider rows show registration results. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { ProviderAccounts } from '../src/settingsx-accounts.tsx';
import { providerTemplate } from '../src/provider-templates.ts';
import { SettingsXPage } from '../src/settingsx-page.tsx';
import { STUDIO_COMMANDS, readDisabled, DISABLED_KEY, resolveSessionTarget } from '../src/settingsx-commands.ts';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const list = { directory: '/profile/studio-data/providers', entries: [
  { file: 'local.json', status: 'registered', definition: { version: 1, id: 'local', name: 'Local', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1234/v1', models: [{ id: 'm', name: 'Model M' }], credential: { kind: 'none' } } },
  { file: 'broken.json', status: 'invalid', issues: [{ code: 'models-empty', path: 'models' }] },
  { file: 'dup.json', status: 'conflict', detail: 'route', definition: { version: 1, id: 'deepseek', name: 'Dup', protocol: 'openai-chat', baseURL: 'http://x/v1', models: [{ id: 'a' }], credential: { kind: 'none' } } },
] };

async function render(t, props) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  t.after(() => { act(() => root.unmount()); host.remove(); });
  await act(async () => root.render(React.createElement(SettingsXPage, props)));
  return host;
}

test('release page omits provider navigation when provider integration is not mounted', async t => {
  const host = await render(t, { locale: 'en', shortcuts: { rows: [], setEnabled() {} } });
  assert.match(host.textContent, /Shortcuts/);
  assert.doesNotMatch(host.textContent, /Providers|ChatGPT|Claude/);
});

test('shortcut rows show assigned keys, defaults, and toggles', async t => {
  const calls = [];
  const rows = STUDIO_COMMANDS.map(spec => ({ id: spec.id, enabled: spec.key !== 'fullscreen', keys: spec.key === 'previous' ? ['⌘', '⇧', '['] : null }));
  const host = await render(t, { locale: 'en', shortcuts: { rows, setEnabled: (id, on) => calls.push([id, on]) },
    providers: { list: async () => list, reload: async () => list } });
  const rowsText = [...host.querySelectorAll('section[aria-label="Shortcuts"] .studio-settings-card .studio-settings-row')].map(row => row.textContent);
  assert.equal(rowsText.length, STUDIO_COMMANDS.length);
  assert.match(rowsText[0], /Previous sidebar session.*Key: ⌘ ⇧ \[.*Default key: ⌘⇧\[/);
  assert.match(rowsText[2], /Sidebar session 1.*Not assigned/);
  assert.doesNotMatch(rowsText[2], /default key/i);
  assert.doesNotMatch(host.textContent, /Other harnesses|Codex|Default keys apply|private DSH setting|Open DSH shortcut settings/);
  const fullscreen = host.querySelector('[role="switch"][aria-label="Toggle full screen"]');
  assert.equal(fullscreen.getAttribute('aria-checked'), 'false');
  await act(async () => fullscreen.click());
  assert.deepEqual(calls, [['studio.settingsx.fullscreen', true]]);
});

test('provider page lists registered, invalid, and conflicting files and reloads', async t => {
  let reloads = 0;
  const host = await render(t, { locale: 'ko', shortcuts: { rows: [], setEnabled() {} },
    providers: { list: async () => list, reload: async () => { reloads++; return { ...list, entries: [] }; } } });
  await act(async () => [...host.querySelectorAll('nav button')].find(button => button.textContent === '프로바이더').click());
  const text = host.textContent;
  assert.match(text, /\/profile\/studio-data\/providers/);
  assert.match(text, /Local.*local.*등록됨/);
  assert.match(text, /http:\/\/127\.0\.0\.1:1234\/v1\/chat\/completions/);
  assert.match(text, /broken\.json.*잘못됨.*models: 모델을 하나 이상 넣으세요/);
  assert.match(text, /다른 프로바이더가 이미 “deepseek” 경로를 씁니다/);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '다시 읽기').click());
  assert.equal(reloads, 1);
  assert.match(host.textContent, /아직 정의 파일이 없습니다/);
});

test('disabled command ids survive only when known; session targets block while loading', () => {
  const storage = value => ({ getItem: key => (key === DISABLED_KEY ? value : null) });
  assert.deepEqual([...readDisabled(storage('["studio.settingsx.copy-cwd","other"]'))], ['studio.settingsx.copy-cwd']);
  assert.deepEqual([...readDisabled(storage('{bad'))], []);
  const session = (id, mainView = 0) => ({ id, updatedAt: id === 'a' ? 2 : 1, blank: false, retainedBy: { mainView } });
  const sessions = { phase: 'ready', ids: ['a', 'b'], byId: { a: session('a', 1), b: session('b') } };
  const workspaces = { phase: 'ready', state: 'idle', items: [], pinnedSessionIds: [], archivedSessionIds: [] };
  const empty = { getItem: () => null };
  assert.deepEqual(resolveSessionTarget({ sessions, workspaces, storage: empty }, { key: 'next' }), { status: 'handled', target: 'b' });
  assert.deepEqual(resolveSessionTarget({ sessions, workspaces, storage: empty }, { key: 'goto', position: 2 }), { status: 'handled', target: 'b' });
  assert.deepEqual(resolveSessionTarget({ sessions, workspaces, storage: empty }, { key: 'goto', position: 3 }), { status: 'blocked', reason: 'empty' });
  assert.deepEqual(resolveSessionTarget({ sessions: { ...sessions, phase: 'loading' }, workspaces, storage: empty }, { key: 'next' }), { status: 'blocked', reason: 'unavailable' });
  assert.deepEqual(resolveSessionTarget({ sessions, workspaces, storage: { getItem: () => '{"groupBy":"new"}' } }, { key: 'next' }), { status: 'blocked', reason: 'unavailable' });
});


test('subscription template buttons create once and open OAuth without exposing JSON', async t => {
  let current = { directory: '/providers', entries: [], auth: {} }; const calls = [];
  const host = await render(t, { locale: 'en', shortcuts: { rows: [], setEnabled() {} }, providers: {
    list: async () => current, reload: async () => current,
    addTemplate: async id => { calls.push(['add', id]); current = { ...current, entries: [{ file: 'studio-claude.json', status: 'registered', definition: providerTemplate(id) }] }; return current; },
    signIn: async route => { calls.push(['signIn', route]); return { url: 'https://example.test/login' }; },
    openURL: url => calls.push(['open', url]), waitSignIn: async () => current,
  } });
  await act(async () => [...host.querySelectorAll('nav button')].find(button => button.textContent === 'Providers').click());
  const button = [...host.querySelectorAll('button')].find(button => button.textContent === 'Add Claude and sign in');
  assert.match(host.textContent, /Claude Code compatibility headers/);
  await act(async () => button.click());
  assert.deepEqual(calls, [['add', 'claude'], ['signIn', 'studio-claude'], ['open', 'https://example.test/login']]);
  assert.equal(button.disabled, true);
});


test('account management keeps manual selection, usage and confirmed removal separate', async t => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  t.after(() => { act(() => root.unmount()); host.remove(); });
  const calls = []; const accounts = [{ id: 'a', label: 'A', email: 'a@example.test', isDefault: true }, { id: 'b', label: 'B', isDefault: false }];
  const props = { route: 'studio-chatgpt', accounts, locale: 'en', onList: next => calls.push(['list', next]), actions: {
    selectAccount: async (...args) => { calls.push(['select', ...args]); return list; },
    removeAccount: async (...args) => { calls.push(['remove', ...args]); return list; },
    usage: async (...args) => { calls.push(['usage', ...args]); return { status: 'ready', checkedAt: 1000, windows: [{ id: 'primary', usedPercent: 50, resetAt: 2000 }] }; },
  } };
  await act(async () => root.render(React.createElement(ProviderAccounts, props)));
  const buttons = label => [...host.querySelectorAll('button')].filter(button => button.textContent === label);
  await act(async () => buttons('Manage accounts')[0].click());
  assert.equal(buttons('Use as default')[0].disabled, true);
  await act(async () => buttons('Refresh usage')[1].click());
  assert.equal(host.querySelector('progress').value, 50);
  await act(async () => buttons('Use as default')[1].click());
  assert.ok(calls.some(call => call.join() === 'select,studio-chatgpt,b'));
  await act(async () => buttons('Sign out')[1].click());
  assert.ok(!calls.some(call => call[0] === 'remove'));
  await act(async () => buttons('Confirm sign out')[0].click());
  assert.ok(calls.some(call => call.join() === 'remove,studio-chatgpt,b'));
});
