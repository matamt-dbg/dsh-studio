import { test } from 'node:test';
import assert from 'node:assert/strict';
import StudioCatalog from '../src/host/shell.ts';
import { MasterCatalog } from '../src/host/master-catalog.ts';
import { MASTER_PRESET_ID } from '../src/master-preset.ts';

const rows = name => [{ id: name, name: `example-${name}` }];
const catalog = name => ({ presets: [], tools: [{ name, description: name }] });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Characterized against the pre-extraction shell; now exercise the same owner methods.
// Keep the real shell read delegate to check current-snapshot reads and defensive clones.
function fixture() {
  const events = [];
  const current = catalog('current');
  let saved = rows('old');
  const registrations = new Map([[MASTER_PRESET_ID, { id: MASTER_PRESET_ID, old: true }]]);
  const registry = {
    async register(definition) {
      const label = definition.id === MASTER_PRESET_ID ? 'master' : 'probe';
      events.push(`register:${label}`);
      assert.equal(registrations.has(definition.id), false, 'dispose before replacing a registration');
      registrations.set(definition.id, definition);
      return async () => { events.push(`dispose:${label}`); registrations.delete(definition.id); };
    },
    async resolve(id) { events.push(`resolve:${id === MASTER_PRESET_ID ? 'master' : 'probe'}`); return {}; },
    async list() { return []; },
    async readDocument() { return { content: '- id: base\n  name: example-base\n' }; },
    async acquireScope() {
      events.push('acquire:master');
      return { key: {}, async [Symbol.asyncDispose]() { events.push('release:master'); } };
    },
  };
  const ctx = {
    agentPresets: registry,
    loader: { async await() { events.push('loader:ready'); }, async import() { return {}; }, unwrapExports: value => value },
    tools: { schemas: () => [{ name: 'read', description: 'Read a file' }] },
    systemPrompt: { async assemble() { return { sections: [], tools: [] }; } },
    get(name) { return this[name]; },
  };
  const service = Object.create(MasterCatalog.prototype);
  service.read = () => StudioCatalog.prototype.read.call({ master: service });
  Object.defineProperty(service, 'ctx', { value: ctx });
  Object.assign(service, {
    snapshot: Promise.resolve(current), changes: Promise.resolve(), stopped: false,
    standard: [{ id: 'base', name: 'example-base' }], standardSource: 'dsh',
    extensions: {
      async read() { events.push('extensions:read'); return structuredClone(saved); },
      async save(value) { events.push('extensions:save'); saved = structuredClone(value); },
    },
    async disposeMaster() { events.push('dispose:old'); registrations.delete(MASTER_PRESET_ID); },
    store: {
      setMaster() { events.push('store:setMaster'); },
      async ensureOptimized() { events.push('store:ensureOptimized'); },
      async cleanable() { return []; },
    },
    baseline: { async read() { return undefined; }, async save() { events.push('baseline:save'); } },
  });
  return { service, ctx, registry, events, current, registrations, saved: () => structuredClone(saved) };
}

function stubCapture(f, implementation = async value => catalog(value[0].id)) {
  f.service.capture = async value => {
    const name = value[0].id;
    f.events.push(`capture:${name}`);
    f.service.disposeMaster = async () => { f.events.push(`dispose:${name}`); };
    return implementation(value);
  };
}

test('start defers capture, exposes its current promise, and stop awaits it before disposal', async () => {
  const f = fixture();
  const owner = new MasterCatalog(f.ctx, f.service.extensions, f.service.baseline);
  const release = deferred();
  const entered = deferred();
  const events = [];
  owner.capture = async () => { events.push('capture'); entered.resolve(); await release.promise; return f.current; };
  owner.disposeMaster = async () => { events.push('dispose'); };
  owner.start(f.service.store);
  assert.deepEqual(events, [], 'capture must not run in the activation stack');
  const ready = owner.ready();
  assert.equal(ready, owner.ready());
  await entered.promise;
  const stopping = owner.stop();
  assert.equal(owner.stopped, true);
  assert.deepEqual(events, ['capture']);
  release.resolve();
  assert.equal(await ready, f.current);
  await stopping;
  assert.deepEqual(events, ['capture', 'dispose']);
});

const probeEvents = ['extensions:read', 'register:probe', 'resolve:probe', 'dispose:probe'];

test('broken probe is disposed without retiring the current Master or replacing its snapshot', async () => {
  const f = fixture();
  const snapshot = f.service.snapshot;
  const master = f.registrations.get(MASTER_PRESET_ID);
  f.registry.resolve = async () => { f.events.push('resolve:probe'); return { broken: 'probe activation failed' }; };
  f.service.capture = () => assert.fail('broken probe must not capture');

  await assert.rejects(f.service.replaceExtensions(rows('new')), /probe activation failed/);
  assert.deepEqual(f.events, probeEvents);
  assert.equal(f.service.snapshot, snapshot);
  assert.equal(f.registrations.get(MASTER_PRESET_ID), master);
  assert.equal(f.registrations.size, 1);
  assert.deepEqual(f.saved(), rows('old'));
  const read = await f.service.read();
  read.tools[0].description = 'mutated by caller';
  assert.deepEqual(await f.service.read(), f.current, 'public reads are defensive clones');
});

test('capture failure disposes the attempted Master then restores previous rows before rejecting', async () => {
  const f = fixture();
  const failure = new Error('capture failed');
  stubCapture(f, async value => {
    if (value[0].id === 'new') throw failure;
    return catalog('restored');
  });

  await assert.rejects(f.service.replaceExtensions(rows('new')), error => error === failure);
  assert.deepEqual(f.events, [...probeEvents, 'dispose:old', 'capture:new', 'dispose:new', 'capture:old']);
  assert.deepEqual(f.saved(), rows('old'));
  assert.deepEqual(await f.service.read(), catalog('restored'));
});

test('extension persistence failure also rolls back and never publishes the candidate catalog', async () => {
  const f = fixture();
  const failure = new Error('save failed');
  stubCapture(f);
  f.service.extensions.save = async () => { f.events.push('extensions:save'); throw failure; };

  await assert.rejects(f.service.replaceExtensions(rows('new')), error => error === failure);
  assert.deepEqual(f.events, [...probeEvents, 'dispose:old', 'capture:new', 'extensions:save', 'dispose:new', 'capture:old']);
  assert.deepEqual(await f.service.read(), catalog('old'));
  assert.deepEqual(f.saved(), rows('old'));
});

test('restore failure takes precedence over the original capture error, including public read', async () => {
  const f = fixture();
  const original = new Error('candidate capture failed');
  const restore = new Error('restore capture failed');
  stubCapture(f, async value => { throw value[0].id === 'new' ? original : restore; });

  await assert.rejects(f.service.replaceExtensions(rows('new')), error => error === restore);
  assert.deepEqual(f.events, [...probeEvents, 'dispose:old', 'capture:new', 'dispose:new', 'capture:old']);
  await assert.rejects(f.service.read(), error => error === restore);
  assert.deepEqual(f.saved(), rows('old'));
});

for (const rejectFirst of [false, true]) {
  test(`concurrent replacements serialize${rejectFirst ? ' and continue after the first rejects' : ' through persistence'}`, async () => {
    const f = fixture();
    const entered = deferred();
    const release = deferred();
    const failure = new Error('first capture failed');
    stubCapture(f, async value => {
      if (value[0].id === 'first') {
        entered.resolve();
        await release.promise;
        if (rejectFirst) throw failure;
      }
      return catalog(value[0].id);
    });
    const first = f.service.replaceExtensions(rows('first'));
    const firstResult = rejectFirst ? assert.rejects(first, error => error === failure) : first;
    await entered.promise;
    const second = f.service.replaceExtensions(rows('second'));
    // Flush promise reactions, not wall-clock timers: the second operation remains queued.
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(f.events, [...probeEvents, 'dispose:old', 'capture:first']);
    assert.deepEqual(f.saved(), rows('old'));
    let readSettled = false;
    const during = f.service.read().then(value => { readSettled = true; return value; }, error => { readSettled = true; throw error; });
    const duringResult = rejectFirst ? assert.rejects(during, error => error === failure) : during;
    await Promise.resolve();
    assert.equal(readSettled, false, 'reads during replacement await the in-flight snapshot');

    release.resolve();
    await firstResult;
    await duringResult;
    assert.deepEqual(await second, catalog('second'));
    const firstTail = rejectFirst
      ? ['dispose:first', 'capture:old']
      : ['extensions:save'];
    assert.deepEqual(f.events, [
      ...probeEvents, 'dispose:old', 'capture:first', ...firstTail,
      ...probeEvents, `dispose:${rejectFirst ? 'old' : 'first'}`, 'capture:second', 'extensions:save',
    ]);
    assert.deepEqual(f.saved(), rows('second'));
    assert.deepEqual(await f.service.read(), catalog('second'));
  });
}

test('real capture with fake services registers and resolves Master, releases its lease, and clones public reads', async () => {
  const f = fixture();
  await f.service.disposeMaster();
  f.events.length = 0;
  const extra = [{ id: 'private', name: 'example-private', config: { token: 'secret' } }];
  f.service.snapshot = f.service.capture(extra);
  const result = await f.service.read();

  assert.deepEqual(f.events, ['loader:ready', 'register:master', 'resolve:master', 'acquire:master', 'release:master', 'store:setMaster', 'store:ensureOptimized', 'baseline:save']);
  assert.deepEqual(result.base, { preset: 'standard', source: 'dsh' });
  assert.deepEqual(result.added, [{ id: 'studio-added/private', name: 'example-private' }]);
  assert.equal(result.plugins.find(plugin => plugin.id === 'studio-added/private').config, undefined);
  assert.equal(result.presets[0].id, MASTER_PRESET_ID);
  assert.equal(result.tools[0].name, 'read');
  result.tools[0].description = 'changed';
  result.added.length = 0;
  const again = await f.service.read();
  assert.equal(again.tools[0].description, 'Read a file');
  assert.equal(again.added.length, 1);
  await f.service.disposeMaster();
  assert.equal(f.registrations.size, 0);
});

test('real capture rejects a broken new Master and replacement restores the old composition in order', async () => {
  const f = fixture();
  let masters = 0;
  f.registry.resolve = async id => {
    const master = id === MASTER_PRESET_ID;
    f.events.push(`resolve:${master ? 'master' : 'probe'}`);
    return master && ++masters === 1 ? { broken: 'new Master activation failed' } : {};
  };

  await assert.rejects(f.service.replaceExtensions(rows('new')), /Studio Master: new Master activation failed/);
  assert.deepEqual(f.events, [
    ...probeEvents, 'dispose:old', 'loader:ready', 'register:master', 'resolve:master',
    'dispose:master', 'loader:ready', 'register:master', 'resolve:master',
    'acquire:master', 'release:master', 'store:setMaster', 'store:ensureOptimized', 'baseline:save',
  ]);
  assert.deepEqual(f.saved(), rows('old'));
  assert.deepEqual((await f.service.read()).added, [{ id: 'studio-added/old', name: 'example-old' }]);
  assert.equal(f.registrations.size, 1);
  await f.service.disposeMaster();
});

test('stop while capture awaits loader rejects initialization before registering Master', async () => {
  const f = fixture();
  const entered = deferred();
  const release = deferred();
  f.ctx.loader.await = async () => { f.events.push('loader:waiting'); entered.resolve(); await release.promise; };
  await f.service.disposeMaster();
  f.events.length = 0;
  f.service.snapshot = f.service.capture(rows('new'));
  const result = assert.rejects(f.service.read(), /Studio stopped during catalog initialization/);
  await entered.promise;
  const stopped = f.service.stop();
  assert.equal(f.service.stopped, true);
  release.resolve();
  await result;
  await stopped;
  assert.deepEqual(f.events, ['loader:waiting', 'dispose:old']);
  assert.equal(f.registrations.size, 0);
  assert.deepEqual(f.saved(), rows('old'));
});
