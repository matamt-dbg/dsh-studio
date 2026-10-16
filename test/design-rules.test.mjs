/** Source-level design system rules from docs/design-system.md. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { studioStyles } from '../src/ui-styles.ts';

const src = new URL('../src/', import.meta.url);
const testDir = new URL('./', import.meta.url);
const sources = readdirSync(src).filter(name => /\.tsx?$/.test(name));
const read = name => readFileSync(new URL(name, src), 'utf8');
const PRIMITIVES = /from '@deepseek-ai\/dsh-client-ui-primitives'/;
const COLOR = /#[\da-f]{3}(?:[\da-f]{3})?\b|\b(?:rgb|hsl)a?\(/i;

test('Studio styles keep font weight at or below 500', () => {
  const weights = [...studioStyles.matchAll(/font-weight:\s*(\d+)/g)].map(match => Number(match[1]));
  assert.ok(weights.length > 0);
  for (const weight of weights) assert.ok(weight <= 500, `font-weight ${weight} exceeds 500`);
});

test('only ui-host.tsx imports host primitives directly', () => {
  const importers = sources.filter(name => PRIMITIVES.test(read(name)));
  assert.deepEqual(importers, ['ui-host.tsx']);
});

test('modules loaded by Node tests never reach ui-host.tsx', () => {
  // Covers `import x from`, `export … from`, and side-effect `import './x'` forms.
  const local = text => [...text.matchAll(/(?:from|import)\s*'\.\.?\/(?:src\/)?([\w-]+\.tsx?)'/g)].map(match => match[1]);
  const roots = readdirSync(testDir).filter(name => name.endsWith('.test.mjs'))
    .flatMap(name => [...readFileSync(new URL(name, testDir), 'utf8').matchAll(/from '\.\.\/src\/([\w-]+\.tsx?)'/g)].map(match => match[1]));
  assert.ok(roots.includes('ui.tsx'));
  const seen = new Set();
  const visit = (name, path) => {
    assert.notEqual(name, 'ui-host.tsx', `Node test import chain reaches ui-host.tsx: ${[...path, name].join(' -> ')}`);
    if (seen.has(name) || !sources.includes(name)) return;
    seen.add(name);
    for (const next of local(read(name))) visit(next, [...path, name]);
  };
  for (const root of new Set(roots)) visit(root, []);
});

test('feature modules use shared parts instead of inline styles, color literals, or Button classes', () => {
  for (const name of sources.filter(name => name.endsWith('.tsx') && name !== 'ui.tsx' && name !== 'ui-host.tsx')) {
    const text = read(name);
    assert.doesNotMatch(text, /\bstyle=\{/, `${name} uses an inline style`);
    assert.doesNotMatch(text, COLOR, `${name} uses a color literal`);
    assert.doesNotMatch(text, /['"`\s]studio-button\b/, `${name} reuses the Button class instead of Button`);
  }
});

test('locale copy has no Markdown backticks: settings and gate text render as plain text', async () => {
  for (const name of sources.filter(name => /locale\.ts$/.test(name))) {
    const strings = [...read(name).matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map(match => match[1]);
    for (const text of strings) assert.doesNotMatch(text, /`/, `${name}: ${text}`);
  }
});
