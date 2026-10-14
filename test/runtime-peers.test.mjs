import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('packaged Host imports declare runtime peers for desktop resolution', async () => {
  const root = new URL('../packages/shell/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  for (const file of manifest.files.filter(file => file.endsWith('.js') && file !== 'client.js')) {
    const code = await readFile(new URL(file, root), 'utf8');
    for (const match of code.matchAll(/from ["'](@deepseek-ai\/[^"']+)["']/g)) {
      const name = match[1].split('/').slice(0, 2).join('/');
      assert.ok(manifest.peerDependencies[name], `${file} imports undeclared runtime peer ${name}`);
    }
  }
});
