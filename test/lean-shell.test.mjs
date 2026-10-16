import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('one publishable package declares its own bundle patch and no managed preset', async () => {
  const manifest = JSON.parse(read('../packages/shell/package.json'));
  const { PACKAGE_NAME, STUDIO_VERSION } = await import('../src/package-name.ts');
  assert.equal(manifest.name, PACKAGE_NAME); assert.equal(manifest.version, STUDIO_VERSION);
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml'); assert.ok(manifest.files.includes('cordis.patch.yml'));
  assert.deepEqual(Object.keys(manifest.dependencies), ['js-yaml']);
  assert.equal(read('../packages/shell/cordis.patch.yml'), `- insert:\n    - id: dsh-studio\n      name: '${PACKAGE_NAME}'\n`);
  assert.match(read('../packages/shell/client.js'), new RegExp(`__ModuleLoader__\\.load\\(\\{id: '${PACKAGE_NAME}'`));
  const sources = readdirSync(new URL('../src/', import.meta.url));
  assert.ok(!sources.filter(name => !['preset-catalog.ts', 'preset-diagnostics.tsx', 'preset-export.ts', 'preset-manager.tsx'].includes(name)).some(name => /^(mock|roles|workflow|preset|catalog|experiments|general)/.test(name)));
});

test('built client mounts read-only catalog and registers Studio optimization', async () => {
  let plugin;
  vm.runInNewContext(read('../packages/shell/client.js'), {
    window: { __ModuleLoader__: { load({ factory }) {
      plugin = factory(name => {
        if (name === 'react' || name === 'react/jsx-runtime' || name === 'react-dom') return {};
        if (name === '@deepseek-ai/dsh-client-ui-slots') return { resolveSlotLabel: value => value };
        throw new Error(`Unexpected runtime dependency: ${name}`);
      });
    } } },
  });
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale', 'remote']);
  const registrations = [];
  const subscriptions = [];
  const mounts = [];
  const ctx = {
    // The runtime registers one Remote contribution per package; a second $mount fails activation.
    get: name => name !== 'remote' ? undefined : ({ async $mount(contract) { assert.equal(mounts.filter(item => item.package === contract.package).length, 0, 'one $mount per package'); mounts.push(contract); assert.equal(contract.descriptors[0].method, 'read');
      const parameter = contract.descriptors.find(item => item.method === 'preview').parameters[0];
      assert.equal(parameter.codec.mode, 'strict', 'Remote input requires a strict codec at activation');
      const schema = parameter.codec.create();
      const request = { preset: 'standard', providers: [], tools: ['read'], prompt: 'literal', model: '' };
      assert.equal(schema.parse(request).prompt, 'literal');
      for (const invalid of [null, {}, { ...request, providers: [1] }, { ...request, tools: 'read' }, { ...request, model: null }]) assert.throws(() => schema.parse(invalid));
      return () => {}; } }),
    effect: fn => fn(),
    // Optional services such as the right sidebar never appear in this fake runtime.
    inject: () => ({ dispose() {} }),
    locale: { addLanguage() {}, subscribe() { return () => {}; } },
    slots: {
      entriesOfSlot: () => [],
      subscribe: name => { subscriptions.push(name); return () => {}; },
      inject: (_name, fn) => fn(),
      register: options => { registrations.push(options); return () => {}; },
    },
  };
  await plugin.apply(ctx);
  // Without the right sidebar, Pixie adds only its Studio settings page; the tab and /pixie row need sidebarRightTabs.
  assert.deepEqual(registrations.map(item => item.name), ['local.dsh-studio.services', 'main', 'local.dsh-studio.services', 'sidebar.panellist']);
  assert.equal(registrations[0].id, 'pixie');
  assert.equal(registrations[1].key, 'local-dsh-studio');
  assert.equal(registrations[2].id, 'optimization-prototype');
  assert.equal(registrations[3].id, 'local-dsh-studio');
  const pixie = mounts[0].descriptors.filter(item => item.service === 'studioPixie');
  assert.ok(pixie.length > 0);
  assert.ok(pixie.every(item => item.parameters.every(parameter => parameter.codec.mode === 'strict')));
  assert.equal(pixie.find(item => item.method === 'follow').mode, 'stream');
  assert.deepEqual(Object.keys(registrations[1].children), ['local.dsh-studio.services']);
  assert.deepEqual(subscriptions, ['local.dsh-studio.services']);
});
