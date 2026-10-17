/** Korean DSH dictionary registration and missing-key checks (#30 S3). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { checkDshKo, checkDshKoSupport, registerDshKo } from '../src/dsh-ko-locale.ts';
import { dshKo } from '../src/dsh-ko/index.ts';

/** Mirrors DSH 0.2.0-rc.2 LocaleRuntime.register: one occupant per (ns, locale), idempotent disposer. */
function fakeLocale() {
  const dicts = new Map();
  return {
    dicts,
    register(ns, locale, dict) {
      const key = `${ns}/${locale}`;
      if (dicts.has(key)) throw new Error(`locale namespace "${ns}" already has locale "${locale}"`);
      dicts.set(key, dict);
      return () => { if (dicts.get(key) === dict) dicts.delete(key); };
    },
  };
}

const dictionaries = {
  alpha: { ko: { hello: '안녕하세요, {name}님' } },
  beta: { ko: { ok: '확인' } },
  gamma: { ko: { bye: '종료' } },
  empty: { ko: {} },
};

test('registers one ko dictionary per namespace and removes all on dispose', () => {
  const locale = fakeLocale();
  const dispose = registerDshKo(locale, dictionaries);
  assert.deepEqual([...locale.dicts.keys()], ['alpha/ko', 'beta/ko', 'gamma/ko']);
  assert.equal(locale.dicts.get('alpha/ko').hello, '안녕하세요, {name}님');
  dispose();
  assert.equal(locale.dicts.size, 0);
  dispose();
  assert.equal(locale.dicts.size, 0);
});

test('a namespace that already has ko is reported and does not affect the others', () => {
  const locale = fakeLocale();
  const shipped = { ok: 'DSH 확인' };
  const disposeShipped = locale.register('beta', 'ko', shipped);
  const failures = [];
  const dispose = registerDshKo(locale, dictionaries, failure => failures.push(failure));
  assert.deepEqual(failures.map(failure => failure.ns), ['beta']);
  assert.match(String(failures[0].error), /already has locale "ko"/);
  assert.deepEqual([...locale.dicts.keys()].sort(), ['alpha/ko', 'beta/ko', 'gamma/ko']);
  assert.equal(locale.dicts.get('beta/ko'), shipped);
  dispose();
  assert.deepEqual([...locale.dicts.keys()], ['beta/ko']);
  assert.equal(locale.dicts.get('beta/ko'), shipped);
  disposeShipped();
});

test('reports missing, extra, placeholder, and unknown-namespace findings for one source', () => {
  const source = { ref: 'test', namespaces: {
    alpha: { keys: { hello: { en: 'Hello {name}' }, count: { en: '{n} items' }, skip: { en: 'Skip' }, left: { en: 'Left' } } },
    beta: { keys: { ok: { en: 'OK' } } },
    delta: { keys: { x: { en: 'X' } } },
  } };
  const report = checkDshKo({
    alpha: { ko: { hello: '안녕하세요', count: '{n}개', gone: '없음' }, fallback: ['skip'] },
    beta: { ko: { ok: '확인' } },
    omega: { ko: { z: 'Z' } },
  }, source);
  assert.equal(report.ok, false);
  assert.deepEqual(report.unknownNamespaces, ['omega']);
  assert.deepEqual(report.untranslated, ['delta']);
  assert.deepEqual(report.namespaces, [
    { ns: 'alpha', missing: ['left'], extra: ['gone'], placeholders: ['hello'] },
    { ns: 'beta', missing: [], extra: [], placeholders: [] },
  ]);
  assert.equal(checkDshKo({ beta: { ko: { ok: '확인' } } }, source).ok, true);
});

test('keys and namespaces of one supported version are not stray; missing in either fails', () => {
  const rc = { ref: 'rc', namespaces: { a: { keys: { old: { en: 'Old' }, both: { en: 'Both' } } } } };
  const alpha = { ref: 'alpha', namespaces: { a: { keys: { both: { en: 'Both' }, added: { en: 'Added' } } }, b: { keys: { y: { en: 'Y' } } } } };
  const full = { a: { ko: { old: '이전', both: '공통', added: '추가' } }, b: { ko: { y: '와이' } } };
  const ok = checkDshKoSupport(full, [rc, alpha]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.reports[0].unknownNamespaces, ['b']);
  assert.deepEqual(ok.reports[0].namespaces[0].extra, ['added']);
  const partial = checkDshKoSupport({ a: { ko: { both: '공통', added: '추가', typo: '오타' } }, c: { ko: { z: 'Z' } } }, [rc, alpha]);
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.reports[0].namespaces[0].missing, ['old']);
  assert.deepEqual(partial.strayNamespaces, ['c']);
  assert.deepEqual(partial.strayKeys, ['a.typo']);
});

// The extracted DSH sources are fork research data and are not exported with the public snapshot.
const sourcesDir = new URL('../docs/research/ko-locale/', import.meta.url);
// Keys whose placeholders changed in DSH 0.2.1-rc.1. The Korean follows 0.2.1-rc.1 and later; older runtimes show the
// newer placeholder literally (accepted for 0.6.1).
const VERSION_CONFLICTS = { 'dsh-v0.2.0-rc.2': ['pluginManager.installDoneRestart', 'pluginManager.reasonIncompatibleVersion', 'pluginManager.restartNotice'], 'dsh-v0.2.1-alpha.2': ['pluginManager.installDoneRestart', 'pluginManager.reasonIncompatibleVersion', 'pluginManager.restartNotice'] };
test('shipped dictionaries pass against every supported DSH source', { skip: !existsSync(new URL('source-rc2.json', sourcesDir)) && 'DSH locale sources are not in this checkout' }, () => {
  const sources = ['source-rc2.json', 'source-alpha2.json', 'source-rc1-0.2.1.json', 'source-rc2-0.2.1.json']
    .map(name => JSON.parse(readFileSync(new URL(`../docs/research/ko-locale/${name}`, import.meta.url), 'utf8')));
  const result = checkDshKoSupport(dshKo, sources);
  assert.deepEqual({ strayNamespaces: result.strayNamespaces, strayKeys: result.strayKeys }, { strayNamespaces: [], strayKeys: [] });
  for (const report of result.reports) {
    const allowed = new Set(VERSION_CONFLICTS[report.source] ?? []);
    for (const finding of report.namespaces) {
      const placeholders = finding.placeholders.filter(key => !allowed.has(`${finding.ns}.${key}`));
      assert.deepEqual({ missing: finding.missing, placeholders }, { missing: [], placeholders: [] }, `${report.source} ${finding.ns}`);
    }
  }
});
