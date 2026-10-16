/** Studio skill install: writes into <DSH home>/skills, updates its own copy, never overwrites a user edit. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill } from '../src/host/skill-install.ts';
import { pixieHookSkill } from '../src/host/pixie-hook-skill.ts';

const root = async t => { const dir = await mkdtemp(join(tmpdir(), 'studio-skills-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
const skill = files => ({ name: 'demo', files });

test('a fresh install writes every file, and a second run reports them current', async t => {
  const dir = await root(t);
  assert.deepEqual(await installSkill(dir, skill({ 'SKILL.md': 'v1', 'guide.md': 'g1' })), { 'SKILL.md': 'installed', 'guide.md': 'installed' });
  assert.equal(await readFile(join(dir, 'demo', 'SKILL.md'), 'utf8'), 'v1');
  assert.deepEqual(await installSkill(dir, skill({ 'SKILL.md': 'v1', 'guide.md': 'g1' })), { 'SKILL.md': 'current', 'guide.md': 'current' });
});

test('a new Studio version updates untouched files and keeps a user-edited one', async t => {
  const dir = await root(t);
  await installSkill(dir, skill({ 'SKILL.md': 'v1', 'guide.md': 'g1' }));
  await writeFile(join(dir, 'demo', 'SKILL.md'), 'my own rules');
  assert.deepEqual(await installSkill(dir, skill({ 'SKILL.md': 'v2', 'guide.md': 'g2' })), { 'SKILL.md': 'kept-user-edit', 'guide.md': 'installed' });
  assert.equal(await readFile(join(dir, 'demo', 'SKILL.md'), 'utf8'), 'my own rules');
  assert.equal(await readFile(join(dir, 'demo', 'guide.md'), 'utf8'), 'g2');
  // The kept file stays the user's on later runs too.
  assert.deepEqual(await installSkill(dir, skill({ 'SKILL.md': 'v3', 'guide.md': 'g2' })), { 'SKILL.md': 'kept-user-edit', 'guide.md': 'current' });
});

test('an existing skill folder Studio never installed is left alone', async t => {
  const dir = await root(t);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, 'demo'), { recursive: true });
  await writeFile(join(dir, 'demo', 'SKILL.md'), 'someone else');
  assert.deepEqual(await installSkill(dir, skill({ 'SKILL.md': 'v1' })), { 'SKILL.md': 'kept-user-edit' });
  assert.equal(await readFile(join(dir, 'demo', 'SKILL.md'), 'utf8'), 'someone else');
});

test('the Pixie hook skill carries the rules and the full guide', () => {
  const { name, files } = pixieHookSkill();
  assert.equal(name, 'studio-pixie-hook-guide');
  assert.match(files['SKILL.md'], /^---\nname: studio-pixie-hook-guide\n/);
  assert.match(files['SKILL.md'], /`guide\.md` next to this file/);
  for (const rule of ['Exit 0 to run the Pixie task, 10 to skip the gate, 11 to apply stdout', 'pixie judge [--type bool|select|score]', 'Decision engine']) assert.ok(files['SKILL.md'].includes(rule), rule);
  assert.match(files['guide.md'], /^# Pixie Gate guide/);
  assert.match(files['guide.md'], /claim-check\.sh/);
});

test('the built package ships the skill files the Host reads', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/shell/package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.files.includes('skills'));
  const packaged = await readFile(new URL('../packages/shell/skills/studio-pixie-hook-guide/SKILL.md', import.meta.url), 'utf8');
  assert.equal(packaged, pixieHookSkill().files['SKILL.md']);
  const index = await readFile(new URL('../packages/shell/index.js', import.meta.url), 'utf8');
  assert.match(index, /\.\/skills\/\$\{name\}\/SKILL\.md/);
});
