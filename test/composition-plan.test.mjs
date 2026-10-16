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
  // An unselected provider is not an exclusion: the source keeps it with its declared config.
  assert.deepEqual(plan.plugins.find(row=>row.name==='@deepseek-ai/dsh-agent-instructions').config,{maxBytes:65536});
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
  assert.equal(findRow(plan.plugins, '@deepseek-ai/dsh-persona').config.prefix, 'Custom');
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
function findRow(rows, name) {
  for (const row of rows) { const hit = row.name === name ? row : row.group && Array.isArray(row.config) ? findRow(row.config, name) : undefined; if (hit) return hit; }
}
function compactionConfig(plan) {
  return findRow(plan.plugins, compactionName).config;
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

test('persona-only selection keeps compaction, manual compact and context providers in their groups', async () => {
  const { ctx, docs } = fixture();
  docs[MASTER_PRESET_ID] = JSON.stringify([
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'Base', complete: true } },
    { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
    { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
    { id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true, toolResultPruner: true }, config: [
      { id: 'compaction-basic', name: compactionName },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
      { id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner', config: { thresholdChars: 8192 } },
    ] },
  ]);
  const plan = await compositionPlan(ctx, { ...base, preset: MASTER_PRESET_ID, persona: 'Edited',
    configOverrides: { 'compaction/compaction-basic': { thresholdRatio: 0.7 } } });
  const group = plan.plugins.find(row => row.id === 'compaction');
  assert.deepEqual(group.isolate, { compaction: true, toolResultPruner: true });
  assert.deepEqual(group.config.map(row => row.name), [compactionName, '@deepseek-ai/dsh-command-compact', '@deepseek-ai/dsh-compaction-tool-result-pruner']);
  assert.deepEqual(group.config[0].config, { thresholdRatio: 0.7 });
  assert.ok(!plan.plugins.some(row => row.id === 'studio-compaction'));
  assert.ok(findRow(plan.plugins, '@deepseek-ai/dsh-agent-instructions'));
  assert.ok(findRow(plan.plugins, '@deepseek-ai/dsh-time-context'));
  // Persona is edited in place, never duplicated.
  const personas = plan.plugins.filter(row => row.name === '@deepseek-ai/dsh-persona');
  assert.equal(personas.length, 1);
  assert.deepEqual(personas[0].config, { prefix: 'Edited', complete: false });
});

function masterDoc(docs) {
  docs[MASTER_PRESET_ID] = JSON.stringify([
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'Base' } },
    { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
    { id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true, toolResultPruner: true }, config: [
      { id: 'compaction-basic', name: compactionName, config: { thresholdRatio: 0.8 } },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
      { id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner' },
    ] },
  ]);
}
const names = rows => rows.flatMap(row => row.group ? names(row.config) : [row.name]);

test('S1: every Master entry is included by default; an override changes only its fields', async () => {
  const { ctx, docs } = fixture(); masterDoc(docs);
  const all = await compositionPlan(ctx, { ...base, preset: MASTER_PRESET_ID, providers: [] });
  assert.deepEqual(names(all.plugins), ['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-time-context', compactionName, '@deepseek-ai/dsh-command-compact', '@deepseek-ai/dsh-compaction-tool-result-pruner']);
  const edited = await compositionPlan(ctx, { ...base, preset: MASTER_PRESET_ID, providers: [], configOverrides: { 'compaction/compaction-basic': { auto: false } } });
  // auto:false is an override, not an exclusion: compaction and /compact stay.
  assert.deepEqual(findRow(edited.plugins, compactionName).config, { thresholdRatio: 0.8, auto: false });
  assert.ok(findRow(edited.plugins, '@deepseek-ai/dsh-command-compact'));
  // An empty override is "use the default".
  const reset = await compositionPlan(ctx, { ...base, preset: MASTER_PRESET_ID, providers: [], configOverrides: { 'compaction/compaction-basic': {} } });
  assert.deepEqual(findRow(reset.plugins, compactionName).config, { thresholdRatio: 0.8 });
});

test('S1: an excluded entry is left out, its dependants follow, and groups keep isolation', async () => {
  const { ctx, docs } = fixture(); masterDoc(docs);
  const plan = await compositionPlan(ctx, { ...base, preset: MASTER_PRESET_ID, providers: [], configExclusions: ['time-context'] });
  assert.ok(!findRow(plan.plugins, '@deepseek-ai/dsh-time-context'));
  assert.ok(findRow(plan.plugins, compactionName));
  const noCompaction = await compositionPlan(ctx, { ...base, preset: MASTER_PRESET_ID, providers: [], configExclusions: ['compaction/compaction-basic'] });
  const group = noCompaction.plugins.find(row => row.id === 'compaction');
  // /compact needs compaction-basic, so it leaves too; the pruner stays in its isolated group.
  assert.deepEqual(group.config.map(row => row.name), ['@deepseek-ai/dsh-compaction-tool-result-pruner']);
  assert.deepEqual(group.isolate, { compaction: true, toolResultPruner: true });
  // Excluding only /compact keeps automatic compaction.
  const manualOff = await compositionPlan(ctx, { ...base, preset: MASTER_PRESET_ID, providers: [], configExclusions: ['compaction/command-compact'] });
  assert.deepEqual(names(manualOff.plugins.find(row => row.id === 'compaction').config), [compactionName, '@deepseek-ai/dsh-compaction-tool-result-pruner']);
});

test('S1: exclusions reject unknown ids, override conflicts, selected providers and non-Master bases', async () => {
  const { ctx, docs } = fixture(); masterDoc(docs);
  const master = { ...base, preset: MASTER_PRESET_ID, providers: [] };
  await assert.rejects(compositionPlan(ctx, { ...master, configExclusions: ['missing'] }), /Unknown master Config entry: missing/);
  await assert.rejects(compositionPlan(ctx, { ...master, configExclusions: ['time-context'], configOverrides: { 'time-context': { timeZone: 'UTC' } } }), /both overridden and excluded: time-context/);
  // Any Master entry may be excluded; persona is only rejected while it is selected for editing.
  assert.ok(!findRow((await compositionPlan(ctx, { ...master, configExclusions: ['persona'] })).plugins, '@deepseek-ai/dsh-persona'));
  await assert.rejects(compositionPlan(ctx, { ...master, providers: ['@deepseek-ai/dsh-time-context'], configExclusions: ['time-context'] }), /selected prompt providers: @deepseek-ai\/dsh-time-context/);
  await assert.rejects(compositionPlan(ctx, { ...base, configExclusions: ['persona'] }), /require Studio Master/);
  assert.deepEqual(parsePreviewRequest({ ...master, configExclusions: ['a', 'a'] }).configExclusions, ['a']);
  assert.equal(parsePreviewRequest({ ...master, configExclusions: [] }).configExclusions, undefined);
  assert.throws(() => parsePreviewRequest({ ...master, configExclusions: [''] }), /Invalid Config exclusions/);
});
