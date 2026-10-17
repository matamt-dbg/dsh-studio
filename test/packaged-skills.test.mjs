/** Release packaging ships only the intended agent skills (#28 D10, #30). Source-level, no build. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const SHIPPED = ['studio-pixie-hook-guide', 'studio-pixie-loop-guide'];
const DEV_ONLY = ['studio-dsh-ko-translate', 'studio-ko-review', 'studio-provider-guide'];

test('build.mjs rebuilds the skills folder and copies only shipped skills', () => {
  const build = read('build.mjs');
  assert.match(build, /await rm\(new URL\('packages\/shell\/skills\/', import\.meta\.url\), \{ recursive: true, force: true \}\)/);
  const copied = [...build.matchAll(/packages\/shell\/skills\/([\w-]+)\//g)].map(match => match[1]);
  assert.deepEqual([...new Set(copied)], SHIPPED);
  for (const name of DEV_ONLY) assert.doesNotMatch(build, new RegExp(`'[^']*${name}[^']*'`), `${name} is referenced by build.mjs`);
});

test('the Host installs only shipped skills', () => {
  const shell = read('src/host/shell.ts');
  const list = shell.match(/for \(const bundled of \[([^\]]*)\]\)/);
  assert.ok(list, 'skill install loop not found');
  assert.deepEqual(list[1].split(',').map(name => name.trim()).filter(Boolean), ['pixieHookSkill', 'pixieLoopSkill']);
});

test('dev skills live outside the release docs', () => {
  const dir = ['../release/docs/appendix/', '../docs/appendix/'].map(path => new URL(path, import.meta.url)).find(url => { try { readdirSync(url); return true; } catch { return false; } });
  const appendix = readdirSync(dir);
  for (const name of ['studio-dsh-ko-translate', 'studio-ko-review']) assert.ok(!appendix.includes(name), `${name} must not be in release/docs`);
});
