import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installBatch } from '../src/host/batch-tool.ts';
import { installTasks } from '../src/host/task-tool.ts';
import { createLifetime } from '../src/host/tool-lifetime.ts';
const exec = () => ({ agent: { id: 'owner' }, signal: new AbortController().signal, callId: 'call', rootCallId: 'root', token: {}, deferContext() {} });
test('packaged batch validates before dispatch and preserves nested policy lineage', async () => {
 let tool; const calls = []; const life = createLifetime();
 const tools = { register(t) { tool = t; return () => {}; }, async execute(call) { calls.push(call); return { isError: call.name === 'grep', content: [] }; } };
 installBatch({ get: () => tools }, life, true, 8, 200);
 const context = exec();
 await assert.rejects(tool.execute({ calls: [{ name: 'read', arguments: { limit: 201 } }] }, context));
 await assert.rejects(tool.execute({ calls: [{ name: 'bash', arguments: {} }] }, context)); assert.equal(calls.length, 0);
 const result = await tool.execute({ calls: [{ name: 'read', arguments: { limit: 1 } }, { name: 'grep', arguments: {} }, { name: 'glob', arguments: {} }] }, context);
 assert.equal(result.length, 2); assert.equal(calls.length, 2);
 assert.equal(calls[0].parent, context.token); assert.equal(calls[0].rootCallId, context.rootCallId); assert.equal(calls[0].agent, context.agent);
 await life.dispose();
});
test('packaged tasks use native jobs and reject failed or foreign dependencies', async () => {
 let tool; let counter = 0; const rows = new Map(); const pending = new Map(); const calls = []; const life = createLifetime();
 const jobs = { events: { subscribe: () => () => {} }, get(id, owner) { const row = rows.get(id); assert.equal(row.owner, owner); return row; }, start(spec) { const id = `task-${++counter}`; const row = { id, owner: spec.owner, status: 'running' }; rows.set(id, row); const run = spec.run({ id, append() {} }); pending.set(id, run.done.then(outcome => Object.assign(row, outcome))); return id; }, async wait(id) { await pending.get(id); } };
 const tools = { register(t) { tool = t; return () => {}; }, async execute(call) { calls.push(call); return { content: [], value: { kind: 'foreground', exitCode: call.arguments.command === 'fail' ? 1 : 0, signal: null } }; } };
 installTasks({ get: name => name === 'jobs' ? jobs : tools }, life, 120000, 600000);
 const context = exec(); const first = await tool.execute({ command: 'ok', description: 'ok' }, context); assert.equal(first.status, 'completed');
 const second = await tool.execute({ command: 'fail', description: 'fail', requires_success: [first.task_id] }, context); assert.equal(second.status, 'failed');
 const third = await tool.execute({ command: 'blocked', description: 'blocked', requires_success: [second.task_id] }, context); assert.equal(third.status, 'failed'); assert.equal(calls.length, 2);
 assert.equal(calls[0].parent, context.token); assert.equal(calls[0].agent, context.agent);
 await assert.rejects(tool.execute({ command: 'bad', description: 'bad', requires_success: [first.task_id] }, { ...context, agent: { id: 'other' } }), /foreign/);
 await life.dispose();
});
test('read_batch without maxLines lets read use its own limit', async () => {
 let tool; const calls = []; const life = createLifetime();
 installBatch({ get: () => ({ register(t) { tool = t; return () => {}; }, async execute(call) { calls.push(call); return { isError: false, content: [] }; } }) }, life, true, 8, undefined);
 await tool.execute({ calls: [{ name: 'read', arguments: { file_path: 'a' } }, { name: 'read', arguments: { file_path: 'b', limit: 5000 } }] }, exec());
 assert.equal(calls.length, 2); assert.ok(!/requires limit/.test(tool.description));
 await life.dispose();
});
test('read_batch spill exemption runs inside spill-policy and replaces the value', async () => {
 const { Context } = await import('@deepseek-ai/cordis');
 const { exemptFromSpill } = await import('../src/host/batch-tool.ts');
 const ctx = new Context();
 // Mirrors dsh-spill-policy: prepended, passes value replacements through, otherwise bounds content.
 const seen = [];
 ctx.on('tools/post-execute', async (e, r, next) => { const d = await next(); seen.push(d); return Object.hasOwn(d, 'value') ? d : { kind: 'accept', content: [{ type: 'text', text: 'SPILLED' }] }; }, { prepend: true });
 exemptFromSpill(ctx);
 const run = name => ctx.waterfall('tools/post-execute', { name }, { isError: false, value: [{ ok: 1 }], content: [] }, async () => ({ kind: 'accept' }));
 const batch = await run('read_batch'); assert.deepEqual(batch, { kind: 'accept', value: [{ ok: 1 }] });
 const bash = await run('bash'); assert.equal(bash.content[0].text, 'SPILLED');
});
