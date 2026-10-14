/** Studio self-update: version choice, Host install request, and the status bar states. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { compareStable, isNewer, pickUpdate, packumentUrl } from '../src/update-check.ts';
import { StudioUpdater } from '../src/host/studio-update.ts';
import { createUpdateStore } from '../src/update-store.ts';
import { SidebarIcon, VersionFooter } from '../src/update-indicator.tsx';
import { PACKAGE_NAME, STUDIO_VERSION } from '../src/package-name.ts';
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';

const peers = range => ({ peerDependencies: { '@deepseek-ai/dsh-app-boot': range, '@deepseek-ai/cordis-plugin-include': '*' } });
const bump = (version, by) => { const [a, b, c] = version.split('-')[0].split('.').map(Number); return `${a}.${b}.${c + by}`; };

test('version ordering ignores prereleases and older releases', () => {
  assert.equal(compareStable('0.2.10', '0.2.9'), 1);
  assert.equal(compareStable('0.0.0-stage', '0.0.1'), -1);
  assert.ok(isNewer('0.2.8', '0.2.7'));
  assert.ok(!isNewer('0.2.7', '0.2.7'));
  assert.ok(!isNewer('0.3.0-beta.1', '0.2.7'));
  assert.equal(packumentUrl('https://r.example/', '@a/b'), 'https://r.example/@a%2fb');
});

test('offers the newest compatible release and names an incompatible latest', () => {
  const compatible = manifest => manifest.peerDependencies?.['@deepseek-ai/dsh-app-boot'] === 'ok';
  const document = { 'dist-tags': { latest: '0.3.0' }, versions: {
    '0.2.7': peers('ok'), '0.2.8': peers('ok'), '0.2.9': { ...peers('ok'), deprecated: 'broken' }, '0.3.0': peers('no'), '0.0.0-stage': peers('ok'),
  } };
  assert.deepEqual(pickUpdate(document, '0.2.7', compatible), { latest: '0.3.0', available: '0.2.8', incompatibleLatest: '0.3.0' });
  assert.deepEqual(pickUpdate(document, '0.3.0', compatible), { latest: '0.3.0' });
  assert.deepEqual(pickUpdate({ 'dist-tags': { latest: '0.2.8' }, versions: { '0.2.8': peers('ok') } }, '0.2.7', compatible), { latest: '0.2.8', available: '0.2.8' });
});

async function profile(dependencies) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-update-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies }));
  return dir;
}

function updater({ dir, manager, document }) {
  const fetches = [];
  const ctx = { get: name => name === 'pluginManager' ? manager : name === 'profileContext' ? { dir } : undefined };
  const fetcher = async (url, init) => { fetches.push({ url, accept: init.headers.accept }); return { ok: true, status: 200, json: async () => structuredClone(document) }; };
  return { updater: new StudioUpdater(ctx, fetcher), fetches };
}

test('Host checks DSH peers against the running runtime and installs only the offered exact version', async () => {
  const runtime = getDshRuntimeVersion();
  const next = bump(STUDIO_VERSION, 1);
  const newest = bump(STUDIO_VERSION, 2);
  const document = { 'dist-tags': { latest: newest }, versions: { [next]: peers(runtime), [newest]: peers('0.0.1') } };
  const installs = [];
  const manager = {
    registries: async () => ({ registry: 'https://mirror.example', resolved: null }),
    installBundle: async (spec, options) => { installs.push({ spec, options }); return { application: 'restart-required', version: next }; },
  };
  const dir = await profile({ [PACKAGE_NAME]: `^${STUDIO_VERSION}` });
  try {
    const { updater: subject, fetches } = updater({ dir, manager, document });
    const status = await subject.status();
    assert.deepEqual(status, { current: STUDIO_VERSION, runtimeVersion: runtime, source: `^${STUDIO_VERSION}`, latest: newest, available: next, incompatibleLatest: newest });
    assert.equal(fetches[0].url, `https://mirror.example/${PACKAGE_NAME.replace('/', '%2f')}`);
    await subject.status();
    assert.equal(fetches.length, 1, 'a recent answer is reused');
    await subject.status(true);
    assert.equal(fetches.length, 2, 'force asks again');
    await assert.rejects(subject.update(newest), /not the offered update/);
    await assert.rejects(subject.update('file:/tmp/x'), /not the offered update/);
    assert.equal(installs.length, 0);
    assert.deepEqual(await subject.update(next), { status: 'restart-required', version: next });
    assert.deepEqual(installs, [{ spec: `${PACKAGE_NAME}@${next}`, options: { enabled: true } }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Host reports why it cannot install and passes failures through', async () => {
  const runtime = getDshRuntimeVersion();
  const next = bump(STUDIO_VERSION, 1);
  const document = { 'dist-tags': { latest: next }, versions: { [next]: peers(runtime) } };
  const dir = await profile({});
  try {
    const noManager = updater({ dir, manager: undefined, document }).updater;
    const status = await noManager.status();
    assert.equal(status.blocked, 'no-plugin-manager');
    assert.equal(status.available, next);
    const notDeclared = updater({ dir, manager: { registries: async () => ({ registry: null, resolved: null }), installBundle: async () => assert.fail('must not install') }, document }).updater;
    assert.equal((await notDeclared.status()).blocked, 'not-profile-dependency');
    await assert.rejects(notDeclared.update(next), /cannot update/);
  } finally { await rm(dir, { recursive: true, force: true }); }
  const declared = await profile({ [PACKAGE_NAME]: STUDIO_VERSION });
  try {
    const failing = updater({ dir: declared, document, manager: {
      registries: async () => { throw new Error('pnpm missing'); },
      installBundle: async () => ({ application: 'failed', error: { code: 'operation-error', diagnostic: 'ETARGET' } }),
    } });
    const status = await failing.updater.status();
    assert.equal(failing.fetches[0].url.startsWith('https://registry.npmjs.org/'), true, 'falls back to the public registry');
    assert.equal(status.blocked, undefined);
    assert.deepEqual(await failing.updater.update(next), { status: 'failed', version: next, message: 'ETARGET' });
  } finally { await rm(declared, { recursive: true, force: true }); }
});

async function mount(element) {
  const dom = new JSDOM('<button id="row"><span id="glyph"></span><span>DSH Studio</span></button><div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const footer = createRoot(document.getElementById('root'));
  const icon = createRoot(document.getElementById('glyph'));
  await act(async () => { footer.render(element.footer); icon.render(element.icon); });
  const close = async () => { await act(async () => { footer.unmount(); icon.unmount(); }); dom.window.close(); };
  return { close };
}
const deferred = () => { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; };

test('footer shows only the version until an installable update exists', async () => {
  const store = createUpdateStore({ status: async () => ({ current: '0.2.7', latest: '0.2.7' }), update: async () => assert.fail() }, '0.2.7');
  const view = await mount({ footer: React.createElement(VersionFooter, { store, locale: 'ko' }), icon: React.createElement(SidebarIcon, { size: 16, store, locale: 'ko' }) });
  try {
    await act(async () => store.refresh());
    assert.equal(document.getElementById('root').textContent, 'v0.2.7');
    assert.equal(document.querySelector('#root button'), null);
    assert.equal(document.querySelector('.studio-sidebar-update'), null);
  } finally { await view.close(); }
});

test('a version already installed on disk waits for restart instead of being offered again', async () => {
  const runtime = getDshRuntimeVersion();
  const next = bump(STUDIO_VERSION, 1);
  const dir = await profile({ [PACKAGE_NAME]: next });
  try {
    const target = join(dir, 'node_modules', ...PACKAGE_NAME.split('/'));
    await import('node:fs/promises').then(fs => fs.mkdir(target, { recursive: true }));
    await writeFile(join(target, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: next }));
    const manager = { registries: async () => ({ registry: null, resolved: null }), installBundle: async () => assert.fail() };
    const { updater: subject } = updater({ dir, manager, document: { 'dist-tags': { latest: next }, versions: { [next]: peers(runtime) } } });
    const status = await subject.status();
    assert.equal(status.installed, next);
    assert.equal(status.available, undefined);
    const store = createUpdateStore({ status: async () => status, update: async () => assert.fail() }, STUDIO_VERSION);
    await store.refresh();
    assert.deepEqual(store.getSnapshot(), { phase: 'installed', current: STUDIO_VERSION, version: next });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('blocked or failed lookups offer nothing', async () => {
  for (const status of [async () => ({ current: '0.2.7', available: '0.2.8', blocked: 'not-profile-dependency' }), async () => { throw new Error('offline'); }]) {
    const store = createUpdateStore({ status, update: async () => assert.fail() }, '0.2.7');
    await store.refresh();
    assert.deepEqual(store.getSnapshot(), { phase: 'idle', current: '0.2.7' });
  }
});

test('an offered update marks the sidebar row and the footer icon installs it', async () => {
  const calls = [];
  const install = deferred();
  const store = createUpdateStore({
    status: async force => { calls.push(force); return { current: '0.2.7', available: '0.2.8' }; },
    update: async version => { calls.push(version); return install.promise; },
  }, '0.2.7');
  await store.refresh();
  const view = await mount({ footer: React.createElement(VersionFooter, { store, locale: 'en' }), icon: React.createElement(SidebarIcon, { size: 16, store, locale: 'en' }) });
  try {
    const mark = document.querySelector('#row > .studio-sidebar-update');
    assert.ok(mark, 'wide row gets a trailing mark inside the sidebar button');
    assert.equal(mark.getAttribute('aria-label'), 'Update to v0.2.8');
    assert.equal(document.getElementById('root').textContent, 'v0.2.7', 'no text besides the version');
    const button = document.querySelector('#root button');
    assert.equal(button.getAttribute('aria-label'), 'Update to v0.2.8');
    await act(async () => { button.click(); });
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute('aria-label'), 'Installing v0.2.8');
    await act(async () => { install.resolve({ status: 'restart-required', version: '0.2.8' }); await install.promise; });
    assert.deepEqual(calls, [false, '0.2.8']);
    assert.equal(button.getAttribute('aria-label'), 'Installed v0.2.8. Restart DSH to use it.');
    assert.equal(document.querySelector('.studio-sidebar-update'), null, 'sidebar mark clears once installed');
    await store.refresh(true);
    assert.equal(store.getSnapshot().phase, 'installed', 'a later lookup does not re-offer the running version');
  } finally { await view.close(); }
});

test('collapsed sidebar shows a dot; a failed install stays retryable', async () => {
  let attempt = 0;
  const store = createUpdateStore({
    status: async () => ({ current: '0.2.7', available: '0.2.8' }),
    update: async version => (++attempt === 1 ? { status: 'failed', version, message: 'ETARGET' } : { status: 'restart-required', version }),
  }, '0.2.7');
  await store.refresh();
  const view = await mount({ footer: React.createElement(VersionFooter, { store, locale: 'zh' }), icon: React.createElement(SidebarIcon, { size: 18, store, locale: 'zh' }) });
  try {
    assert.ok(document.querySelector('#glyph .studio-sidebar-dot'));
    assert.equal(document.querySelector('.studio-sidebar-update'), null);
    const button = document.querySelector('#root button');
    await act(async () => { button.click(); });
    assert.match(button.getAttribute('aria-label'), /无法更新到 v0\.2\.8.*ETARGET/);
    assert.equal(button.disabled, false);
    await act(async () => { button.click(); });
    assert.equal(store.getSnapshot().phase, 'installed');
    assert.equal(document.querySelector('#glyph .studio-sidebar-dot'), null);
  } finally { await view.close(); }
});
