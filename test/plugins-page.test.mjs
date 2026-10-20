/** #38 Plugins service: installed list by scope, include with initial config, register snippet, migration, profile settings. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { composeProfileConfig, configDiff, profileSnippet, secretKeys, snippetId } from '../src/profile-config.ts';
import { withoutSecrets } from '../src/secret-fields.ts';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!dom.window.HTMLDialogElement.prototype.showModal) {
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
}
const EXA = '@deepseek-ai/dsh-web-search-exa';

test('profile config: diff excludes secrets, compose keeps / replaces / deletes secrets and follows inherited values', () => {
  const roles = { apiKeyEnv: 'credential-ref' };
  assert.deepEqual(configDiff({ searchType: 'auto', apiKey: 'a' }, { searchType: 'neural', apiKey: 'b', apiKeyEnv: 'X' }, roles), { searchType: 'neural', apiKeyEnv: 'X' });
  assert.deepEqual(secretKeys({ token: 'secret' }, { apiKey: 1, model: 2 }), ['apiKey', 'token']);
  const inherited = { searchType: 'auto', baseURL: 'https://api' };
  const current = { searchType: 'neural', apiKey: 'old-key' };
  assert.deepEqual(composeProfileConfig({ inherited, current, diff: { searchType: 'keyword' }, secrets: {} }), { searchType: 'keyword', baseURL: 'https://api', apiKey: 'old-key' });
  assert.deepEqual(composeProfileConfig({ inherited, current, diff: {}, secrets: { apiKey: { action: 'replace', value: 'new-key' } } }), { searchType: 'auto', baseURL: 'https://api', apiKey: 'new-key' });
  assert.deepEqual(composeProfileConfig({ inherited, current, diff: {}, secrets: { apiKey: { action: 'delete' } } }), inherited, 'equal to inherited, so configEditor drops the override');
  assert.throws(() => composeProfileConfig({ inherited, current, diff: { apiKey: 'x' }, secrets: {} }), /secret action/);
  assert.throws(() => composeProfileConfig({ inherited, current, diff: {}, secrets: { apiKey: { action: 'replace', value: '' } } }), /Enter a value/);
});

test('register snippet and secret-free schema', () => {
  assert.equal(snippetId(EXA), 'web-search-exa');
  assert.equal(profileSnippet(EXA, 'web-search-exa', ['apiKey']), "- insert:\n    - id: web-search-exa\n      name: '@deepseek-ai/dsh-web-search-exa'\n      config:\n        apiKey: <apiKey>\n");
  const schema = { anyOf: [{ type: 'object', properties: { apiKey: {}, searchType: {} } }, { $ref: '#/x' }] };
  assert.deepEqual(Object.keys(withoutSecrets(schema).anyOf[0].properties), ['searchType']);
});

async function render(t, element) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  t.after(() => { act(() => root.unmount()); host.remove(); });
  await act(async () => root.render(element));
  await act(async () => {});
  return host;
}
const click = async (scope, text) => act(async () => [...scope.querySelectorAll('button')].find(b => b.textContent === text).click());

function fixture(overrides = {}) {
  const calls = [];
  const plugins = [
    { package: EXA, entry: EXA, version: '0.2.1-rc.2', scope: 'profile', evidence: 'compatibility', state: 'installed' },
    { package: 'my-tools', entry: 'my-tools', version: '1.0.0', scope: 'unknown', evidence: 'none', state: 'installed' },
    { package: 'agent-x', entry: 'agent-x', scope: 'agent', evidence: 'compatibility', state: 'installed' },
    { package: 'in', entry: 'in', scope: 'agent', evidence: 'master', state: 'in-master' },
  ];
  const view = { patchId: 'web', name: '@deepseek-ai/dsh-web', role: 'service', schema: { type: 'object', properties: { searchProvider: { type: 'string' } } },
    effective: { searchProvider: 'deepseek' }, inherited: { searchProvider: 'deepseek' }, diff: {}, secrets: [] };
  const exaView = { patchId: 'web-search-exa', name: EXA, role: 'plugin', schema: { type: 'object', properties: { apiKey: { type: 'string' }, searchType: { type: 'string' } } },
    effective: {}, inherited: {}, diff: {}, secrets: [{ key: 'apiKey', set: false }] };
  const actions = {
    installed: async () => ({ plugins, errors: {} }),
    migration: async () => overrides.migration ?? [],
    migrate: async id => { calls.push(['migrate', id]); return { appliedIn: [{ preset: 'a', name: 'Alpha' }] }; },
    include: async (name, config) => { calls.push(['include', name, config]); },
    schema: async () => ({ type: 'object', properties: { limit: { type: 'integer' } } }),
    profiles: async () => [exaView, view],
    saveProfile: async payload => { calls.push(['save', payload]); if (overrides.saveError) throw new Error(overrides.saveError); return [exaView, { ...view, diff: payload.diff, effective: payload.diff }]; },
    copy: async text => { calls.push(['copy', text]); },
  };
  return { actions, calls };
}

test('installed page shows scope badges and the right action per row', async t => {
  const { PluginsPage } = await import('../src/plugins-page.tsx');
  const { actions } = fixture();
  const host = await render(t, React.createElement(PluginsPage, { locale: 'en', actions }));
  const rows = [...host.querySelectorAll('.studio-settings-card')[0].querySelectorAll('.studio-settings-row')].map(row => row.textContent);
  assert.match(rows[0], /Profile-wide.*Newly installed.*Checked by Studio.*Register in profile/);
  assert.match(rows[1], /Needs check.*Include as agent feature/);
  assert.match(rows[2], /Agent feature.*Set up and include/);
  assert.match(rows[3], /In base composition/);
  assert.ok(!/Set up and include|Register/.test(rows[3]));
});

test('include opens the initial settings, warns for unknown scope, and sends config with the name', async t => {
  const { PluginsPage } = await import('../src/plugins-page.tsx');
  const { actions, calls } = fixture();
  const host = await render(t, React.createElement(PluginsPage, { locale: 'en', actions }));
  await click(host, 'Include as agent feature');
  await act(async () => {});
  const dialog = document.querySelector('dialog[open]');
  assert.match(dialog.textContent, /not confirmed that this plugin runs per preset/);
  const { Simulate } = await import('react-dom/test-utils');
  const input = dialog.querySelector('input[type=number]');
  input.value = '3';
  await act(async () => Simulate.change(input));
  await click(dialog, 'Include');
  assert.deepEqual(calls, [['include', 'my-tools', { limit: 3 }]]);
});

test('register applies directly, keeps the manual snippet as a fallback, and reports failures', async t => {
  const { PluginsPage } = await import('../src/plugins-page.tsx');
  const { actions, calls } = fixture();
  let fail = true;
  actions.register = async entry => { calls.push(['register', entry]); if (fail) throw new Error('row failed to activate'); return { id: 'web-search-exa', warnings: [], profiles: [] }; };
  const host = await render(t, React.createElement(PluginsPage, { locale: 'en', actions }));
  await click(host, 'Register in profile');
  const dialog = document.querySelector('dialog[open]');
  assert.match(dialog.textContent, /applies it now/);
  assert.match(dialog.querySelector('pre').textContent, /- id: web-search-exa\n {6}name: '@deepseek-ai\/dsh-web-search-exa'/);
  await click(dialog, 'Copy');
  await click(dialog, 'Register');
  assert.match(dialog.textContent, /Could not register\. row failed to activate/);
  fail = false;
  await click(dialog, 'Register');
  assert.deepEqual(calls.map(c => c[0]), ['copy', 'register', 'register']);
  assert.equal(document.querySelector('dialog[open]'), null);
  assert.match(host.textContent, /Registered in the profile/);
});

test('register patch text: appends an insert, replaces an empty flow list, keeps comments and expressions, unique ids', async () => {
  const { appendInsert, uniqueRowId } = await import('../src/host/profile-register.ts');
  const empty = '# header\n# more\n[]\n';
  assert.equal(appendInsert(empty, { id: 'web-search-exa', name: EXA }), "# header\n# more\n- insert:\n    - id: web-search-exa\n      name: '@deepseek-ai/dsh-web-search-exa'\n");
  const existing = "# keep me\n- id: web\n  config:\n    key: !!js process.env.X\n";
  const next = appendInsert(existing, { id: 'x', name: 'x-plugin', config: { a: 1 } });
  assert.ok(next.startsWith(existing.trimEnd()), 'existing text is untouched');
  assert.match(next, /- insert:\n    - id: x\n      name: x-plugin\n      config:\n        a: 1\n$/);
  assert.equal(uniqueRowId(EXA, new Set(['web-search-exa', 'web-search-exa-2'])), 'web-search-exa-3');
});

test('migration card moves a row and reports presets to reapply', async t => {
  const { PluginsPage } = await import('../src/plugins-page.tsx');
  const { actions, calls } = fixture({ migration: [{ id: 'dsh-web-search-exa', entry: EXA, config: {}, overrides: [{ preset: 'a', name: 'Alpha', config: {} }], appliedIn: [] }] });
  const host = await render(t, React.createElement(PluginsPage, { locale: 'en', actions }));
  assert.match(host.textContent, /Per-preset settings: Alpha/);
  await click(host, 'Move');
  assert.deepEqual(calls, [['migrate', 'dsh-web-search-exa']]);
  assert.match(host.textContent, /Reapply these presets before registering it in the profile: Alpha/);
});

test('profile settings: service row, secret keep/replace, save sends diff and secret actions, failures keep edits', async t => {
  const { PluginsPage } = await import('../src/plugins-page.tsx');
  const { actions, calls } = fixture();
  const host = await render(t, React.createElement(PluginsPage, { locale: 'en', actions }));
  await act(async () => [...host.querySelectorAll('.studio-nav-item')].find(b => b.textContent === 'Profile settings').click());
  await act(async () => {});
  const page = [...host.querySelectorAll('.studio-page-stack')].find(node => /Profile settings/.test(node.querySelector('h1, h2')?.textContent ?? ''));
  assert.match(page.textContent, /Service/);
  assert.match(page.textContent, /apiKey: Not set/);
  const buttons = [...page.querySelectorAll('button')].filter(b => b.textContent === 'Settings');
  await act(async () => buttons[0].click());
  const dialog = document.querySelector('dialog[open]');
  assert.match(dialog.textContent, /Applies to every session/);
  assert.equal(dialog.querySelectorAll('input[aria-label$="apiKey"]').length, 0, 'secret is not in the schema form');
  const save = () => [...dialog.querySelectorAll('button')].find(b => /^(Save|Saved|Saving…)$/.test(b.textContent));
  assert.equal(save().disabled, true);
  const { Simulate } = await import('react-dom/test-utils');
  await act(async () => Simulate.change(dialog.querySelector('select[aria-label="apiKey: Secret"]'), { target: { value: 'replace' } }));
  await act(async () => Simulate.change(dialog.querySelector('input[type=password]'), { target: { value: 'sk-new' } }));
  assert.equal(save().disabled, false);
  await act(async () => save().click());
  assert.deepEqual(calls.at(-1), ['save', { patchId: 'web-search-exa', diff: {}, secrets: { apiKey: { action: 'replace', value: 'sk-new' } } }]);
});

test('profile save failure keeps edits and shows the error', async t => {
  const { PluginsPage } = await import('../src/plugins-page.tsx');
  const { actions } = fixture({ saveError: 'overridden by a home patch' });
  const host = await render(t, React.createElement(PluginsPage, { locale: 'en', actions }));
  await act(async () => [...host.querySelectorAll('.studio-nav-item')].find(b => b.textContent === 'Profile settings').click());
  await act(async () => {});
  const page = [...host.querySelectorAll('.studio-page-stack')].find(node => /Profile settings/.test(node.querySelector('h1, h2')?.textContent ?? ''));
  await act(async () => [...page.querySelectorAll('button')].filter(b => b.textContent === 'Settings')[1].click());
  const dialog = document.querySelector('dialog[open]');
  const { Simulate } = await import('react-dom/test-utils');
  await act(async () => Simulate.change(dialog.querySelector('input[type=text]'), { target: { value: 'exa' } }));
  await act(async () => [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Save').click());
  assert.match(dialog.textContent, /Could not save\. Your edits are kept\. overridden by a home patch/);
  assert.equal(dialog.querySelector('input[type=text]').value, 'exa');
});

test('register writes the patch inside an HMR transaction and restores it when activation fails', async t => {
  const { registerProfilePlugin } = await import('../src/host/profile-register.ts');
  const { mkdtemp, writeFile, readFile, rm, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 's38-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const patchPath = join(dir, 'cordis.patch.yml');
  const original = '# comment\n- id: web\n  config:\n    searchProvider: deepseek\n';
  await writeFile(patchPath, original);
  const events = [];
  let fail = true;
  const hmr = {
    runExclusive: async op => { events.push('begin'); try { return await op(); } finally { events.push('end'); } },
    reconcileProfile: async ids => { events.push(['reconcile', ids ?? []]); if (fail && ids?.length) throw new Error('row failed'); return { warnings: [], pending: [] }; },
  };
  const ctx = { get: name => ({ profileContext: { patchPath }, hmr, pluginManager: { listPlugins: async () => [{ patchId: 'web' }] } })[name] };
  const installed = [{ package: EXA, entry: EXA, scope: 'profile', evidence: 'compatibility', state: 'installed' }];
  await assert.rejects(registerProfilePlugin(ctx, installed, { entry: EXA }), /row failed/);
  assert.equal(await readFile(patchPath, 'utf8'), original, 'restored');
  assert.deepEqual(events, ['begin', ['reconcile', ['web-search-exa']], ['reconcile', []], 'end']);
  fail = false;
  const result = await registerProfilePlugin(ctx, installed, { entry: EXA });
  assert.equal(result.id, 'web-search-exa');
  assert.match(await readFile(patchPath, 'utf8'), /^# comment\n- id: web\n[\s\S]*- insert:\n    - id: web-search-exa\n/);
  assert.equal((await stat(patchPath)).mode & 0o777, 0o600);
  await assert.rejects(registerProfilePlugin(ctx, [{ ...installed[0], state: 'profile-active' }], { entry: EXA }), /not a profile-wide plugin waiting/);
  await assert.rejects(registerProfilePlugin({ get: name => name === 'profileContext' ? { patchPath } : undefined }, installed, { entry: EXA }), /without hot reload/);
});

test('service groups: membership, selector options keep an unknown current value, query matching', async () => {
  const { serviceOf, selectorOptions, matchesQuery, groupTitle } = await import('../src/service-groups.ts');
  assert.equal(serviceOf('@deepseek-ai/dsh-web'), 'web');
  assert.equal(serviceOf(EXA), 'web');
  assert.equal(serviceOf('third-party', ['web']), 'web', 'an unknown plugin joins by its injected service');
  assert.equal(serviceOf('third-party', ['tools']), undefined);
  assert.equal(serviceOf('@deepseek-ai/dsh-subagent-codex'), 'subagents');
  assert.equal(serviceOf('@deepseek-ai/dsh-repeat-tool-reminder'), 'guard');
  assert.equal(serviceOf('@deepseek-ai/dsh-tool-subagent'), undefined, 'preset-scoped tools are not profile categories');
  assert.equal(serviceOf('@deepseek-ai/dsh-jobs-local'), undefined, 'single-implementation infrastructure is left out');
  assert.equal(groupTitle('web', 'ko'), '웹 검색·가져오기');
  const running = [{ id: 'exa', kind: 'search' }, { id: 'http', kind: 'fetch' }, { id: 'deepseek-fetch-api', kind: 'fetch' }];
  assert.deepEqual(selectorOptions('fetch', running, 'http'), [{ id: 'deepseek-fetch-api', known: true }, { id: 'http', known: true }]);
  assert.deepEqual(selectorOptions('search', running, 'gone'), [{ id: 'exa', known: true }, { id: 'gone', known: false }]);
  assert.equal(matchesQuery('', 'x'), true);
  assert.equal(matchesQuery('web exa', 'Web search', '@deepseek-ai/dsh-web-search-exa'), true);
  assert.equal(matchesQuery('perplexity', 'exa'), false);
});

test('profile page groups a service with its providers, picks providers from running ones, and searches', async t => {
  const { PluginsPage } = await import('../src/plugins-page.tsx');
  const calls = [];
  let views = [
    { patchId: 'web', name: '@deepseek-ai/dsh-web', role: 'service', service: 'web', active: true, selectors: [{ field: 'searchProvider', kind: 'search' }, { field: 'fetchProvider', kind: 'fetch' }],
      schema: { type: 'object', properties: {} }, effective: { searchProvider: 'exa', fetchProvider: 'http' }, inherited: { searchProvider: 'deepseek-official', fetchProvider: 'http' }, diff: { searchProvider: 'exa' }, secrets: [] },
    { patchId: 'web-search-exa', name: EXA, role: 'plugin', service: 'web', active: true, provides: [{ id: 'exa', kind: 'search' }], effective: {}, inherited: {}, diff: {}, secrets: [{ key: 'apiKey', set: true }] },
    { patchId: 'web-deepseek-api', name: '@deepseek-ai/dsh-web-deepseek-api', role: 'plugin', service: 'web', active: true, provides: [{ id: 'deepseek-search-api', kind: 'search' }, { id: 'deepseek-fetch-api', kind: 'fetch' }], effective: {}, inherited: {}, diff: {}, secrets: [] },
    { patchId: 'web-fetch-http', name: '@deepseek-ai/dsh-web-fetch-http', role: 'plugin', service: 'web', active: true, provides: [{ id: 'http', kind: 'fetch' }], effective: {}, inherited: {}, diff: {}, secrets: [] },
    { patchId: 'web-search-perplexity', name: '@deepseek-ai/dsh-web-search-perplexity', role: 'plugin', service: 'web', active: false, provides: [{ id: 'perplexity', kind: 'search' }], effective: {}, inherited: {}, diff: {}, secrets: [] },
    { patchId: 'other', name: 'other-plugin', role: 'plugin', active: true, effective: {}, inherited: {}, diff: {}, secrets: [] },
  ];
  const { actions } = fixture();
  actions.profiles = async () => views;
  actions.saveProfile = async payload => { calls.push(payload); views = views.map(v => v.patchId === payload.patchId ? { ...v, diff: payload.diff, effective: { ...v.effective, ...payload.diff } } : v); return views; };
  const host = await render(t, React.createElement(PluginsPage, { locale: 'en', actions }));
  await act(async () => [...host.querySelectorAll('.studio-nav-item')].find(b => b.textContent === 'Profile settings').click());
  await act(async () => {});
  const cards = [...host.querySelectorAll('section.studio-settings-card')].filter(card => card.closest('[hidden]') === null);
  const web = cards.find(card => card.getAttribute('aria-label') === 'Web search and fetch');
  assert.ok(web, 'web group card');
  assert.match(web.textContent, /dsh-web.*Service/);
  assert.match(web.textContent, /web-search-exa.*Search.*In use/);
  assert.match(web.textContent, /Provider ID: deepseek-search-api · Provider ID: deepseek-fetch-api/);
  assert.match(web.textContent, /web-search-perplexity.*Off/);
  assert.ok(cards.some(card => card.getAttribute('aria-label') === 'Other profile settings' && /other-plugin/.test(card.textContent)));
  const search = web.querySelector('select[aria-label="Search provider"]');
  const values = select => [...select.options].map(o => o.value);
  assert.deepEqual(values(search), ['__studio_default__', 'deepseek-search-api', 'exa', '__studio_manual__'], 'the inactive provider is not offered');
  assert.equal(search.value, 'exa');
  assert.match(search.options[0].textContent, /Use default \(deepseek-official\)/);
  const fetch = web.querySelector('select[aria-label="Fetch provider"]');
  assert.equal(fetch.value, '__studio_default__', 'fetch is not overridden');
  const { Simulate } = await import('react-dom/test-utils');
  await act(async () => Simulate.change(fetch, { target: { value: 'deepseek-fetch-api' } }));
  assert.deepEqual(calls.at(-1), { patchId: 'web', diff: { searchProvider: 'exa', fetchProvider: 'deepseek-fetch-api' }, secrets: {} });
  // Manual entry: a provider the list does not know, then empty = back to the default.
  const searchNow = () => [...host.querySelectorAll('select[aria-label="Search provider"]')].find(el => el.closest('[hidden]') === null);
  await act(async () => Simulate.change(searchNow(), { target: { value: '__studio_manual__' } }));
  const manual = [...host.querySelectorAll('input[aria-label="Search provider: Enter manually"]')].find(el => el.closest('[hidden]') === null);
  assert.equal(manual.value, 'exa');
  assert.match(host.textContent, /Only providers that follow DSH plugin naming conventions/);
  await act(async () => Simulate.change(manual, { target: { value: 'my-search' } }));
  const saveButton = () => [...manual.parentElement.querySelectorAll('button')].find(b => b.textContent === 'Save');
  await act(async () => saveButton().click());
  assert.deepEqual(calls.at(-1).diff, { searchProvider: 'my-search', fetchProvider: 'deepseek-fetch-api' });
  assert.match(searchNow().selectedOptions[0].textContent, /my-search \(not running\)/);
  await act(async () => Simulate.change(searchNow(), { target: { value: '__studio_manual__' } }));
  const manual2 = [...host.querySelectorAll('input[aria-label="Search provider: Enter manually"]')].find(el => el.closest('[hidden]') === null);
  await act(async () => Simulate.change(manual2, { target: { value: '  ' } }));
  await act(async () => [...manual2.parentElement.querySelectorAll('button')].find(b => b.textContent === 'Save').click());
  assert.deepEqual(calls.at(-1).diff, { fetchProvider: 'deepseek-fetch-api' }, 'empty manual entry removes the override');
  await act(async () => Simulate.change(searchNow(), { target: { value: '__studio_default__' } }));
  await act(async () => Simulate.change([...host.querySelectorAll('select[aria-label="Fetch provider"]')].find(el => el.closest('[hidden]') === null), { target: { value: '__studio_default__' } }));
  assert.deepEqual(calls.at(-1).diff, {}, 'choosing the default removes the override');
  const input = [...host.querySelectorAll('input[type=search]')].find(el => el.placeholder.startsWith('Search plugins, services'));
  await act(async () => Simulate.change(input, { target: { value: 'perplexity' } }));
  const visible = [...host.querySelectorAll('section.studio-settings-card')].filter(card => card.closest('[hidden]') === null).map(card => card.textContent).join('\n');
  assert.match(visible, /web-search-perplexity/);
  assert.doesNotMatch(visible, /web-fetch-http|other-plugin/);
});

test('installed page search filters rows', async t => {
  const { PluginsPage } = await import('../src/plugins-page.tsx');
  const { actions } = fixture();
  const host = await render(t, React.createElement(PluginsPage, { locale: 'en', actions }));
  const input = [...host.querySelectorAll('input[type=search]')].find(el => el.placeholder.startsWith('Search plugin names'));
  const { Simulate } = await import('react-dom/test-utils');
  await act(async () => Simulate.change(input, { target: { value: 'my-tools' } }));
  const rows = [...host.querySelectorAll('.studio-settings-row')].filter(row => row.closest('[hidden]') === null).map(row => row.textContent);
  assert.equal(rows.length, 1); assert.match(rows[0], /my-tools/);
  await act(async () => Simulate.change(input, { target: { value: 'zzz' } }));
  assert.match(host.textContent, /No matching results\./);
});

test('a configured credential reference replaces the misleading literal "not set" line', async t => {
  const { PluginsPage } = await import('../src/plugins-page.tsx');
  const { actions } = fixture();
  actions.profiles = async () => [{ patchId: 'web-deepseek-api', name: '@deepseek-ai/dsh-web-deepseek-api', role: 'plugin', service: 'web', active: true, provides: [{ id: 'deepseek-fetch-api', kind: 'fetch' }],
    effective: {}, inherited: {}, diff: {}, secrets: [{ key: 'apiKey', set: false }], credentials: [{ field: 'apiKeyEnv', ref: 'DEEPSEEK_API_KEY', configured: true, source: 'store' }] }];
  const host = await render(t, React.createElement(PluginsPage, { locale: 'en', actions }));
  await act(async () => [...host.querySelectorAll('.studio-nav-item')].find(b => b.textContent === 'Profile settings').click());
  await act(async () => {});
  const text = [...host.querySelectorAll('section.studio-settings-card')].filter(c => c.closest('[hidden]') === null).map(c => c.textContent).join('');
  assert.match(text, /DEEPSEEK_API_KEY: Set \(credential store\)/);
  assert.doesNotMatch(text, /apiKey: Not set/);
});


test('provider detection order: config name or default, then *_PROVIDER_ID exports, then the table', async () => {
  const { detectProviders } = await import('../src/service-groups.ts');
  assert.deepEqual(detectProviders({ name: '@deepseek-ai/dsh-subagent-codex', service: 'subagents', defaults: { providerName: 'codex' } }), [{ id: 'codex', kind: 'subagent', source: 'config' }]);
  assert.deepEqual(detectProviders({ name: '@deepseek-ai/dsh-subagent-codex', service: 'subagents', config: { providerName: 'codex-fast' }, defaults: { providerName: 'codex' } })[0].id, 'codex-fast');
  assert.deepEqual(detectProviders({ name: '@deepseek-ai/dsh-mcp-client', service: 'mcp', config: { serverName: 'memorix' } }), [{ id: 'memorix', kind: 'mcp', source: 'config' }]);
  assert.deepEqual(detectProviders({ name: 'acme-web-search-foo', service: 'web', exports: { FOO_PROVIDER_ID: 'foo', VERSION: '1' } }), [{ id: 'foo', kind: 'search', source: 'export' }], 'kind from the package name');
  assert.deepEqual(detectProviders({ name: 'x', service: 'web', exports: { X_SEARCH_PROVIDER_ID: 'xs', X_FETCH_PROVIDER_ID: 'xf' } }).map(p => [p.id, p.kind]), [['xs', 'search'], ['xf', 'fetch']]);
  assert.deepEqual(detectProviders({ name: 'x', service: 'web', exports: { X_PROVIDER_ID: 'x' } }), [], 'no kind, no entry: left to manual input');
  assert.deepEqual(detectProviders({ name: '@deepseek-ai/dsh-web-fetch-http', service: 'web' }), [{ id: 'http', kind: 'fetch', source: 'table' }]);
});

test('review #2/#6: register errors are redacted and a failed restore is reported', async t => {
  const { registerProfilePlugin } = await import('../src/host/profile-register.ts');
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 's38r-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const patchPath = join(dir, 'cordis.patch.yml');
  const original = '- id: other\n  config:\n    apiKey: existing-secret-value\n';
  await writeFile(patchPath, original);
  let restoreFails = false;
  let lastConfig;
  const hmr = {
    runExclusive: op => op(),
    reconcileProfile: async ids => {
      if (ids?.length) throw new Error(`activation failed: bad key ${lastConfig ?? 'none'} and existing-secret-value`);
      if (restoreFails) throw new Error('reload failed near existing-secret-value');
      return { warnings: ['row other: apiKey existing-secret-value'], pending: [] };
    },
  };
  const ctx = { get: name => ({ profileContext: { patchPath }, hmr })[name] };
  const installed = [{ package: EXA, entry: EXA, scope: 'profile', evidence: 'compatibility', state: 'installed' }];
  lastConfig = 'new-secret-value';
  const error = await registerProfilePlugin(ctx, installed, { entry: EXA, config: { apiKey: 'new-secret-value' } }).catch(e => e);
  assert.match(error.message, /Registration failed: activation failed: bad key <secret> and <secret>\. The profile patch file was restored\./);
  assert.equal(await readFile(patchPath, 'utf8'), original);
  restoreFails = true;
  lastConfig = undefined;
  const error2 = await registerProfilePlugin(ctx, installed, { entry: EXA }).catch(e => e);
  assert.match(error2.message, /reloading it also failed \(reload failed near <secret>\); restart DSH/);
  assert.ok(!/secret-value/.test(error.message + error2.message));
  await writeFile(patchPath, '- id: [unclosed\n  apiKey: leaked-in-parse');
  const error3 = await registerProfilePlugin(ctx, installed, { entry: EXA }).catch(e => e);
  assert.match(error3.message, /could not be parsed/);
  assert.ok(!error3.message.includes('leaked-in-parse'));
  await writeFile(patchPath, original);
  restoreFails = false;
  hmr.reconcileProfile = async () => ({ warnings: ['row other: apiKey existing-secret-value'], pending: [] });
  const ok = await registerProfilePlugin(ctx, installed, { entry: EXA });
  assert.equal(ok.warnings, 1, 'warnings are counted, never quoted');
});

test('review #5: registration waits while applied presets still mount the plugin', async t => {
  const { registerProfilePlugin } = await import('../src/host/profile-register.ts');
  const ctx = { get: name => ({ profileContext: { patchPath: '/nonexistent' }, hmr: { runExclusive: op => op(), reconcileProfile: async () => ({ warnings: [], pending: [] }) } })[name] };
  const installed = [{ package: EXA, entry: EXA, scope: 'profile', evidence: 'compatibility', state: 'installed', pendingPresets: [{ id: 'a', name: 'Alpha' }] }];
  await assert.rejects(registerProfilePlugin(ctx, installed, { entry: EXA }), /Reapply or unapply these presets first.*Alpha/);
  const { PluginsPage } = await import('../src/plugins-page.tsx');
  const { actions } = fixture();
  actions.installed = async () => ({ plugins: installed, errors: {} });
  const host = await render(t, React.createElement(PluginsPage, { locale: 'en', actions }));
  assert.match(host.textContent, /Reapply presets first/);
  assert.match(host.textContent, /Reapply these presets before registering it in the profile: Alpha/);
  assert.equal([...host.querySelectorAll('button')].some(b => b.textContent === 'Register in profile'), false);
});

test('rows with nothing to edit show "No settings" instead of an empty dialog', async t => {
  const { hasEditableFields } = await import('../src/secret-fields.ts');
  assert.equal(hasEditableFields(undefined, 0), false);
  assert.equal(hasEditableFields({ anyOf: [{ type: ['object', 'null'], properties: {} }, { $ref: '#/$defs/loaderExpression' }] }, 0), false, 'token-meter: schema without properties');
  assert.equal(hasEditableFields({ type: 'object', properties: { apiKey: {} } }, 0), false, 'only a secret property, with no secret control listed');
  assert.equal(hasEditableFields({ type: 'object', properties: { apiKey: {} } }, 1), true);
  assert.equal(hasEditableFields({ type: 'object', properties: { thresholds: {} } }, 0), true);
  const { PluginsPage } = await import('../src/plugins-page.tsx');
  const { actions } = fixture();
  actions.profiles = async () => [
    { patchId: 'token-meter', name: '@deepseek-ai/dsh-token-meter', role: 'plugin', service: 'llm', active: true, schema: { type: 'object', properties: {} }, effective: {}, inherited: {}, diff: {}, secrets: [] },
    { patchId: 'llm-retry', name: '@deepseek-ai/dsh-llm-retry', role: 'plugin', service: 'llm', active: true, schema: { type: 'object', properties: { maxAttempts: { type: 'integer' } } }, effective: {}, inherited: {}, diff: {}, secrets: [] },
  ];
  const host = await render(t, React.createElement(PluginsPage, { locale: 'en', actions }));
  await act(async () => [...host.querySelectorAll('.studio-nav-item')].find(b => b.textContent === 'Profile settings').click());
  await act(async () => {});
  const rows = [...host.querySelectorAll('.studio-settings-row')].filter(r => r.closest('[hidden]') === null && /token-meter|llm-retry/.test(r.textContent));
  const tokenMeter = rows.find(r => r.textContent.includes('token-meter'));
  const retry = rows.find(r => r.textContent.includes('llm-retry'));
  assert.match(tokenMeter.textContent, /No settings/);
  assert.equal([...tokenMeter.querySelectorAll('button')].some(b => b.textContent === 'Settings'), false);
  assert.ok([...retry.querySelectorAll('button')].some(b => b.textContent === 'Settings'));
});
