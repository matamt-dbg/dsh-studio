import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compositionPlan } from '../src/host/composition-plan.ts';
import { parsePreviewRequest } from '../src/prompt-composition.ts';
const base = { preset: 'minimal', providers: ['@deepseek-ai/dsh-persona'], tools: [], prompt: '', model: 'test' };
function fixture() {
  const docs = { minimal: '- name: "@deepseek-ai/dsh-persona"\n  config: { prefix: Original, complete: true, includeRuntimeContext: false }\n', standard: '- name: "@deepseek-ai/dsh-agent-instructions"\n  config: { maxBytes: 65536 }\n- name: "example-tool-provider"\n' };
  const disposed = [];
  const ctx = { agentPresets: { list: async () => Object.keys(docs).map(id => ({ id })), readDocument: async id => ({ content: docs[id] }), acquireScope: async id => ({ key: { id }, [Symbol.asyncDispose]: async () => disposed.push(id) }) }, tools: { schemas: scope => scope?.id === 'standard' ? [{ name: 'standard_tool' }] : [] } };
  return { ctx, docs, disposed };
}
test('minimal persona copied, public settings merged, cross-preset providers available', async () => {
  const {ctx, docs} = fixture(); const original = docs.minimal;
  const { plugins } = await compositionPlan(ctx, {...base, persona:'Edited', providers:[...base.providers,'@deepseek-ai/dsh-agent-instructions'], providerConfigs:{'@deepseek-ai/dsh-agent-instructions':{maxBytes:42}}});
  assert.deepEqual(plugins[0].config,{prefix:'Edited',complete:false,includeRuntimeContext:false});
  assert.equal(plugins[1].config.maxBytes,42);
  assert.equal(docs.minimal,original);
  assert.equal((await compositionPlan(ctx,base)).plugins[0].config.prefix,'Original');
  await assert.rejects(compositionPlan(ctx,{...base,providerConfigs:{'@deepseek-ai/dsh-persona':{complete:true}}}),/Unsupported provider setting/);
});
test('tool source composition stays intact and leases close, missing source fails',async()=>{
  const {ctx,disposed}=fixture();
  const plan=await compositionPlan(ctx,{...base,tools:['standard_tool']});
  assert.ok(plan.plugins.some(row=>row.name==='example-tool-provider'));
  assert.ok(!plan.plugins.some(row=>row.name==='@deepseek-ai/dsh-agent-instructions'));
  assert.deepEqual(disposed,['minimal','standard']);
  await assert.rejects(compositionPlan(ctx,{...base,tools:['missing']}),/No compatible/);
});
test('remote codec retains explicit empty override but rejects malformed patches',()=>{
  assert.equal(parsePreviewRequest({...base,persona:''}).persona,'');
  assert.deepEqual(parsePreviewRequest({...base,toolOverrides:{read:{parameters:{file_path:''}}}}).toolOverrides,{read:{parameters:{file_path:''}}});
  assert.throws(()=>parsePreviewRequest({...base,toolOverrides:{read:{execute:'code'}}}),/Invalid tool overrides/);
});
