import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compositionPlan } from '../src/host/composition-plan.ts';
import { parsePreviewRequest } from '../src/prompt-composition.ts';
import { MASTER_PRESET_ID } from '../src/master-preset.ts';
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
  const plan=await compositionPlan(ctx,{...base,preset:'standard',tools:['standard_tool']});
  assert.ok(plan.plugins.some(row=>row.name==='example-tool-provider'));
  assert.ok(!plan.plugins.some(row=>row.name==='@deepseek-ai/dsh-agent-instructions'));
  assert.deepEqual(disposed,['standard']);
  await assert.rejects(compositionPlan(ctx,{...base,tools:['standard_tool']}),/Requested preset minimal does not supply tools: standard_tool/);
  await assert.rejects(compositionPlan(ctx,{...base,tools:['missing']}),/Requested preset minimal does not supply tools: missing/);
  assert.deepEqual(disposed,['standard','minimal','minimal']);
});
test('remote codec retains explicit empty override but rejects malformed patches',()=>{
  assert.equal(parsePreviewRequest({...base,persona:''}).persona,'');
  assert.deepEqual(parsePreviewRequest({...base,toolOverrides:{read:{parameters:{file_path:''}}}}).toolOverrides,{read:{parameters:{file_path:''}}});
  assert.throws(()=>parsePreviewRequest({...base,toolOverrides:{read:{execute:'code'}}}),/Invalid tool overrides/);
});

test('requested custom preset wins duplicate scoped and global tool names', async () => {
  const { ctx, docs, disposed } = fixture();
  docs.custom = '- name: "custom-tool-provider"\n- name: "@deepseek-ai/dsh-persona"\n  config: { prefix: Custom }\n';
  docs.minimal += '- name: "minimal-tool-provider"\n';
  ctx.tools.schemas = () => [{ name: 'duplicate' }, { name: 'global_tool' }];
  const plan = await compositionPlan(ctx, { ...base, preset: 'custom', tools: ['duplicate', 'global_tool'] });
  assert.equal(plan.plugins[0].config.prefix, 'Custom');
  assert.ok(plan.plugins.some(row => row.name === 'custom-tool-provider'));
  assert.ok(!plan.plugins.some(row => row.name === 'minimal-tool-provider'));
  assert.ok(!plan.plugins.some(row => row.name === 'example-tool-provider'));
  assert.deepEqual(disposed, ['custom']);
});
test('inherited global tools work but hidden globals do not bypass requested scope', async () => {
  const { ctx, docs, disposed } = fixture();
  docs.custom = '[]';
  ctx.tools.schemas = () => [{ name: 'global_tool' }];
  assert.deepEqual((await compositionPlan(ctx, { ...base, preset: 'custom', providers: [], tools: ['global_tool'] })).plugins, []);
  ctx.tools.schemas = scope => scope ? [] : [{ name: 'global_tool' }];
  await assert.rejects(compositionPlan(ctx, { ...base, preset: 'custom', tools: ['global_tool'] }), /does not supply tools: global_tool/);
  assert.deepEqual(disposed, ['custom', 'custom']);
});
test('source lease closes on schema errors without cross-preset retry', async () => {
  const { ctx, disposed } = fixture();
  ctx.tools.schemas = () => { throw new Error('schema failure'); };
  await assert.rejects(compositionPlan(ctx, { ...base, tools: ['tool'] }), /schema failure/);
  assert.deepEqual(disposed, ['minimal']);
});
const compactionName = '@deepseek-ai/dsh-compaction-basic';
function compactionFixture(retention = { retainRatio: 0.16 }) {
  const fixtureResult = fixture();
  fixtureResult.docs[MASTER_PRESET_ID] = JSON.stringify([
    { id: 'group', name: 'cordis:group', group: true, config: [
      { id: 'compact', name: compactionName, config: { ...retention, thresholdRatio: 0.8 } },
      { id: 'tool', name: 'master-tool-provider' },
    ] },
  ]);
  return fixtureResult;
}
const masterRequest = { ...base, preset: MASTER_PRESET_ID, providers: [compactionName] };
function compactionConfig(plan) {
  return plan.plugins.find(row => row.id === 'studio-compaction').config.find(row => row.name === compactionName).config;
}
test('master stays its own source and configOverrides switches retention forms without mutation', async () => {
  for (const [original, patch] of [[{ retainRatio: 0.16 }, { retainTokens: 0 }], [{ retainTokens: 100 }, { retainRatio: 0.2 }]]) {
    const { ctx, docs, disposed } = compactionFixture(original);
    const before = docs[MASTER_PRESET_ID];
    const plan = await compositionPlan(ctx, { ...masterRequest, configOverrides: { 'group/compact': patch } });
    assert.deepEqual(compactionConfig(plan), { ...patch, thresholdRatio: 0.8 });
    assert.ok(plan.plugins.some(row => row.group && row.config.some(child => child.name === 'master-tool-provider')));
    assert.deepEqual(disposed, [MASTER_PRESET_ID]);
    assert.equal(docs[MASTER_PRESET_ID], before);
    assert.deepEqual(compactionConfig(await compositionPlan(ctx, masterRequest)), { ...original, thresholdRatio: 0.8 });
  }
});
test('providerConfigs retains later precedence and rejects explicit ambiguous retention', async () => {
  const { ctx } = compactionFixture();
  const plan = await compositionPlan(ctx, { ...masterRequest,
    configOverrides: { 'group/compact': { retainTokens: 100 } },
    providerConfigs: { [compactionName]: { retainRatio: 0.2 } },
  });
  assert.deepEqual(compactionConfig(plan), { retainRatio: 0.2, thresholdRatio: 0.8 });
  assert.deepEqual(compactionConfig(await compositionPlan(ctx, { ...masterRequest,
    providerConfigs: { [compactionName]: { retainTokens: 0 } },
  })), { retainTokens: 0, thresholdRatio: 0.8 });
  const both = { retainTokens: 100, retainRatio: 0.2 };
  await assert.rejects(compositionPlan(ctx, { ...masterRequest, configOverrides: { 'group/compact': both } }), /mutually exclusive/);
  await assert.rejects(compositionPlan(ctx, { ...masterRequest, providerConfigs: { [compactionName]: both } }), /mutually exclusive/);
});
