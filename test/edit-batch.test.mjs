import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, installEditBatch, EditBatchError } from '../src/host/edit-batch-tool.ts';

test('applyEdits applies in order against the previous result', () => {
  const out = applyEdits('a = 1\nb = 2\n', [{ old_string: 'a = 1', new_string: 'a = 10' }, { old_string: 'a = 10\nb', new_string: 'a = 10\nc' }], 'f');
  assert.equal(out.content, 'a = 10\nc = 2\n');
  assert.equal(out.replacements, 2);
});

test('applyEdits rejects a missing or ambiguous edit and names its index', () => {
  assert.throws(() => applyEdits('x\nx\n', [{ old_string: 'x', new_string: 'y' }], 'f'), e => e instanceof EditBatchError && e.code === 'FS_AMBIGUOUS_EDIT' && /edits\[0\]/.test(e.message));
  assert.throws(() => applyEdits('x\n', [{ old_string: 'x', new_string: 'y' }, { old_string: 'z', new_string: 'w' }], 'f'), e => e.code === 'FS_EDIT_NOT_FOUND' && /edits\[1\]/.test(e.message));
  assert.equal(applyEdits('x\nx\n', [{ old_string: 'x', new_string: 'y', replace_all: true }], 'f').content, 'y\ny\n');
});

function fakeCtx(file, { observed = true, legacy = false } = {}) {
  const workingDirectory = legacy ? undefined : { async ensure() { return '/work'; } };
  let tool; const events = []; const writes = [];
  const fs = {
    async resolve(path, opts) { file.cwd = opts?.cwd; return { targetKey: path, displayPath: path }; },
    async readText() { file.onRead?.(); return file.content; },
    async stat() { return { version: file.version, type: "file" }; },
    async writeText(target, content, expected) {
      if (expected?.kind === 'replaceIfVersion' && expected.version !== file.version) { const e = new Error('stale'); e.code = 'FS_STALE_VERSION'; throw e; }
      writes.push(content); file.content = content; file.version = `v${writes.length + 1}`; return { version: file.version, operation: 'update', before: null, after: content };
    },
    processPath(target) { return `/abs/${target.displayPath}`; },
  };
  const ctx = {
    get: name => name === 'tools' ? { register(t) { tool = t; return () => {}; } } : name === 'fs' ? fs : name === 'workingDirectory' ? workingDirectory : undefined,
    async waterfall(name, target) { events.push(name); if (!observed) { const e = new Error('edit requires reading'); e.code = 'FS_NOT_OBSERVED'; throw e; } return { version: file.version }; },
    emit(name, target, observation) { events.push(`${name}:${observation.version}`); },
  };
  installEditBatch(ctx);
  return { tool, events, writes };
}
const exec = { agent: { session: {} }, signal: new AbortController().signal };

test('edit_batch writes once, guarded by the observed version, and records the new version', async () => {
  const file = { content: 'one\ntwo\nthree\n', version: 'v1' };
  const { tool, events, writes } = fakeCtx(file);
  const out = await tool.execute({ file_path: 'f.txt', edits: [{ old_string: 'one', new_string: '1' }, { old_string: 'three', new_string: '3' }] }, exec);
  assert.deepEqual(writes, ['1\ntwo\n3\n']);
  assert.deepEqual(events, ['fs/edit-intent', 'fs/observed:v2']);
  assert.equal(out.edits, 2); assert.equal(out.path, '/abs/f.txt');
});

test('edit_batch leaves the file unchanged when any edit fails', async () => {
  const file = { content: 'one\ntwo\n', version: 'v1' };
  const { tool, writes, events } = fakeCtx(file);
  await assert.rejects(tool.execute({ file_path: 'f.txt', edits: [{ old_string: 'one', new_string: '1' }, { old_string: 'nope', new_string: 'x' }] }, exec), /edits\[1\]/);
  assert.equal(writes.length, 0); assert.equal(file.content, 'one\ntwo\n'); assert.ok(!events.some(e => e.startsWith('fs/observed')));
});

test('edit_batch refuses an unread file and a file changed since it was read', async () => {
  await assert.rejects(fakeCtx({ content: 'a', version: 'v1' }, { observed: false }).tool.execute({ file_path: 'f', edits: [{ old_string: 'a', new_string: 'b' }] }, exec), /reading/);
  // A concurrent writer changes the file after the intent was taken: the guarded write must fail.
  const file = { content: 'a', version: 'v1' }; const { tool, writes } = fakeCtx(file);
  file.onRead = () => { file.version = 'v9'; };
  await assert.rejects(tool.execute({ file_path: 'f', edits: [{ old_string: 'a', new_string: 'b' }] }, exec), /stale/);
  assert.equal(writes.length, 0); assert.equal(file.content, 'a');
});

test('edit_batch keeps CRLF line endings for a CRLF file', async () => {
  const file = { content: 'a\r\nb\r\n', version: 'v1' };
  const { tool, writes } = fakeCtx(file);
  await tool.execute({ file_path: 'f', edits: [{ old_string: 'a\nb', new_string: 'a\nc' }] }, exec);
  assert.equal(writes[0], 'a\r\nc\r\n');
});

test('edit_batch rejects bad arguments before touching the file', async () => {
  const file = { content: 'a', version: 'v1' }; const { tool, writes, events } = fakeCtx(file);
  await assert.rejects(tool.execute({ file_path: 'f', edits: [] }, exec));
  await assert.rejects(tool.execute({ file_path: '', edits: [{ old_string: 'a', new_string: 'b' }] }, exec));
  await assert.rejects(tool.execute({ file_path: 'f', edits: [{ old_string: '', new_string: 'b' }] }, exec));
  assert.equal(writes.length, 0); assert.equal(events.length, 0);
});

test('edit_batch resolves against the session cwd when DSH has no workingDirectory service (0.2.0-rc.2)', async () => {
  const file = { content: 'a', version: 'v1' };
  const { tool } = fakeCtx(file, { legacy: true });
  await tool.execute({ file_path: 'f', edits: [{ old_string: 'a', new_string: 'b' }] }, { agent: { session: { header: { cwd: '/session' } } }, signal: new AbortController().signal });
  assert.equal(file.cwd, '/session'); assert.equal(file.content, 'b');
  const next = { content: 'a', version: 'v1' };
  await fakeCtx(next).tool.execute({ file_path: 'f', edits: [{ old_string: 'a', new_string: 'b' }] }, exec);
  assert.equal(next.cwd, '/work');
});
