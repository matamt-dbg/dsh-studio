import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PresetStore, studioStorePath } from '../src/host/preset-store.ts';
const request = {preset:'minimal',providers:['@deepseek-ai/dsh-persona'],tools:[],prompt:'Studio instruction',model:'test'};
import { storeRuntime as runtime } from './store-runtime.mjs';
test('profile persistence saves extras, applies policy, restores last applied snapshot, deletes only owned preset',async()=>{
  const file=join(await mkdtemp(join(tmpdir(),'studio-presets-')),'presets.json');
  const a=await runtime();const store=new PresetStore(a.ctx,file);
  const draft=await store.save(JSON.stringify({name:'My preset',description:'Description',request,conveniences:{arbitrary:true},agents:[{name:'helper'}]}));
  assert.equal(draft.status,'draft');assert.equal(draft.agents[0].name,'helper');assert.equal(draft.agents[0].model,'inherit');
  await assert.rejects(store.delete('minimal'),/Studio-owned/);
  const applied=await store.apply(draft.id);assert.equal(applied.status,'applied');assert.equal(applied.applyWarning,undefined);
  const definition=a.registrations.get(draft.id);assert.equal(definition.plugins.at(-1).name,'@matamt-dbg/dsh-studio/policy');assert.equal(definition.plugins.at(-1).config.prompt,request.prompt);
  await store.save(JSON.stringify({...draft,name:'New draft'}));
  assert.equal((await store.list())[0].status,'modified');
  await store.dispose();assert.equal(a.registrations.size,0);
  const b=await runtime();const restored=new PresetStore(b.ctx,file);await restored.initialize();
  assert.equal(b.registrations.get(draft.id).name,'My preset');assert.equal((await restored.list())[0].name,'New draft');
  await restored.apply(draft.id);assert.equal(b.registrations.get(draft.id).name,'New draft');
  await restored.unapply(draft.id); assert.equal(b.registrations.size,0); assert.equal((await restored.list())[0].status,'draft');
  await restored.dispose();
  const c=await runtime(); const reopened=new PresetStore(c.ctx,file); await reopened.initialize();
  assert.equal(c.registrations.size,0); assert.equal((await reopened.list())[0].name,'New draft');
  await reopened.apply(draft.id); assert.equal(c.registrations.get(draft.id).name,'New draft');
  await reopened.dispose();
  await restored.delete(draft.id);assert.equal(b.registrations.size,0);assert.deepEqual((await restored.list()),[]);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')).presets,[]);
});
test('reopening removes only the retired legacy warning and preserves stored data', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'studio-legacy-warning-')), 'presets.json');
  const store = new PresetStore((await runtime()).ctx, file);
  await store.save(JSON.stringify({ name: 'Legacy', description: '', request, conveniences: { arbitrary: true } }));
  await store.save(JSON.stringify({ name: 'Other', description: '', request }));
  await store.dispose();
  const disk = JSON.parse(await readFile(file, 'utf8'));
  disk.presets[0].applyWarning = 'Work convenience settings are saved but not applied yet. Legacy role overrides are stored only; roles apply only their supported settings.';
  disk.presets[1].applyWarning = 'Missing dependency';
  await writeFile(file, JSON.stringify(disk));
  const reopened = new PresetStore((await runtime()).ctx, file);
  const rows = await reopened.list();
  assert.equal(rows[0].applyWarning, undefined);
  assert.deepEqual(rows[0].conveniences, { arbitrary: true });
  assert.equal(rows[1].applyWarning, 'Missing dependency');
  await reopened.dispose();
});
test('roles persist legacy overrides but apply only supported settings and replace generic delegation',async()=>{
  const file=join(await mkdtemp(join(tmpdir(),'studio-roles-')),'presets.json');const r=await runtime();const store=new PresetStore(r.ctx,file);
  const role={name:'Reviewer',role:'review',model:'inherit',reasoning:'inherit',spawn:'fork',persona:'Review',overrides:{arbitrary:{unsafe:true}}};
  const draft=await store.save(JSON.stringify({name:'Roles',description:'',request,agents:[role]}));
  const {overrides,...updated}=role;
  const saved=await store.save(JSON.stringify({...draft,agents:[updated]}));
  assert.deepEqual(saved.agents[0].overrides,overrides);
  await store.apply(draft.id);
  const plugins=r.registrations.get(draft.id).plugins;
  const roles=plugins.find(row=>row.name==='@matamt-dbg/dsh-studio/roles');
  assert.deepEqual(roles.config.roles,[updated]);
  assert.deepEqual(plugins.at(-1).config.tools,['subagent_role']);
  await assert.rejects(store.save(JSON.stringify({...draft,agents:[role,role]})),/unique/);
  await store.dispose();
});
test('invalid role can be saved but apply preserves the last working snapshot', async()=>{
  const file=join(await mkdtemp(join(tmpdir(),'studio-model-')),'presets.json');const r=await runtime();const store=new PresetStore(r.ctx,file);
  const draft=await store.save(JSON.stringify({name:'Valid',description:'',request}));await store.apply(draft.id);
  const before=r.registrations.get(draft.id);
  await store.save(JSON.stringify({...draft,agents:[{name:'Worker',role:'worker',model:'missing/model',reasoning:'inherit',spawn:'fresh',persona:''}]}));
  await assert.rejects(store.apply(draft.id),/not registered/);
  assert.equal(r.registrations.get(draft.id),before);assert.equal((await store.list())[0].status,'modified');await store.dispose();
});
test('activation failure is not reported applied and concurrent saves retain both rows',async()=>{
  const file=join(await mkdtemp(join(tmpdir(),'studio-presets-')),'presets.json');const r=await runtime();const store=new PresetStore(r.ctx,file);
  const rows=await Promise.all(['one','two'].map(name=>store.save(JSON.stringify({name,description:'',request}))));
  assert.equal((await store.list()).length,2);r.fail();await assert.rejects(store.apply(rows[0].id),/activation failed/);
  assert.equal((await store.list())[0].status,'draft');assert.equal(r.registrations.size,0);
  assert.throws(()=>studioStorePath({}),/requires a profile/);assert.equal(studioStorePath({DSH_PROFILE_DIR:'/profile'}),'/profile/studio-data/presets.json');
});
test('generic delegation tools fold into subagent_role even without saved roles',async()=>{
  const {delegationTools}=await import('../src/delegation.ts');
  assert.deepEqual(delegationTools(['read','subagent','subagent_fork','list_subagent_models']),['read','subagent_role']);
  assert.deepEqual(delegationTools(['read']),['read']);
  assert.deepEqual(delegationTools(['read'],true),['read','subagent_role']);
  const file=join(await mkdtemp(join(tmpdir(),'studio-fold-')),'presets.json');const r=await runtime();const store=new PresetStore(r.ctx,file);
  const draft=await store.save(JSON.stringify({name:'Fold',description:'',request:{...request,tools:['subagent','subagent_fork']}}));
  await store.apply(draft.id);
  const plugins=r.registrations.get(draft.id).plugins;
  assert.deepEqual(plugins.at(-1).config.tools,['subagent_role']);
  assert.deepEqual(plugins.find(row=>row.name==='@matamt-dbg/dsh-studio/roles').config.roles,[]);
  await store.dispose();
});
test('restore rejects missing policy dependencies without losing the applied snapshot and recovers on reactivation', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'studio-dependency-')), 'presets.json');
  const a = await runtime(); const first = new PresetStore(a.ctx, file);
  const draft = await first.save(JSON.stringify({ name: 'Dependency', description: '', request: { ...request, tools: ['read'] } }));
  await first.apply(draft.id); await first.dispose();
  assert.equal(a.registrations.has(draft.id), false);
  const before = await readFile(file, 'utf8');
  const b = await runtime(); b.removeTool('read'); const missing = new PresetStore(b.ctx, file);
  const [failed] = await missing.list();
  assert.equal(failed.status, 'modified'); assert.match(failed.applyWarning, /read/);
  assert.equal(b.registrations.has(draft.id), false);
  assert.equal(await readFile(file, 'utf8'), before); await missing.dispose();
  const c = await runtime(); const recovered = new PresetStore(c.ctx, file);
  assert.equal((await recovered.list())[0].status, 'applied');
  assert.ok(c.registrations.has(draft.id)); await recovered.dispose();
});
test('withdrawn task_run drops out of saved tool lists',async()=>{
  const {delegationTools}=await import('../src/delegation.ts');
  const {masterComposition}=await import('../src/host/master-composition.ts');
  assert.deepEqual(delegationTools(['bash','task_run']),['bash']);
  assert.ok(!JSON.stringify(masterComposition()).includes('dsh-studio/tasks'));
});
test('presets saved with the old studio_role name restore and edit as subagent_role',async()=>{
  const {writeFile,mkdir}=await import('node:fs/promises');const {dump}=await import('js-yaml');
  const dir=await mkdtemp(join(tmpdir(),'studio-rename-'));const file=join(dir,'presets.json');
  const policy={tools:['read','studio_role'],toolOverrides:{studio_role:{description:'Custom'}},sections:{},prompt:''};
  const legacyRequest={...request,tools:['read','studio_role'],toolOverrides:{studio_role:{description:'Custom'}}};
  const applied={name:'Old',description:'',plugins:dump([{id:'studio-roles',name:'@matamt-dbg/dsh-studio/roles',config:{roles:[]}},{id:'studio-policy',name:'@matamt-dbg/dsh-studio/policy',config:policy}])};
  await writeFile(file,JSON.stringify({version:1,presets:[{id:'studio-user-00000000-0000-0000-0000-000000000000',name:'Old',description:'',request:legacyRequest,conveniences:{},agents:[],updatedAt:'',status:'applied',applied}]}));
  const r=await runtime();const store=new PresetStore(r.ctx,file);await store.initialize();
  const policyRow=r.registrations.get('studio-user-00000000-0000-0000-0000-000000000000').plugins.at(-1).config;
  assert.deepEqual(policyRow.tools,['read','subagent_role']);assert.deepEqual(policyRow.toolOverrides,{subagent_role:{description:'Custom'}});
  const [row]=await store.list();assert.deepEqual(row.request.toolOverrides,{subagent_role:{description:'Custom'}});
  const {delegationTools}=await import('../src/delegation.ts');assert.deepEqual(delegationTools(row.request.tools),['read','subagent_role']);
  await store.dispose();
});
test('applied snapshots naming the pre-publication @local package restore under the published name',async()=>{
  const {writeFile}=await import('node:fs/promises');const {dump}=await import('js-yaml');
  const file=join(await mkdtemp(join(tmpdir(),'studio-pkg-')),'presets.json');const id='studio-user-11111111-1111-1111-1111-111111111111';
  const applied={name:'Old',description:'',plugins:dump([{id:'studio-batch',name:'@local/dsh-studio-shell/batch'},{id:'g',name:'cordis:group',group:true,config:[{id:'studio-roles',name:'@local/dsh-studio-shell/roles',config:{roles:[]}}]},{id:'studio-policy',name:'@local/dsh-studio-shell/policy',config:{tools:['read'],toolOverrides:{},sections:{},prompt:''}}])};
  await writeFile(file,JSON.stringify({version:1,presets:[{id,name:'Old',description:'',request,conveniences:{},agents:[],updatedAt:'',status:'applied',applied}]}));
  const r=await runtime();const store=new PresetStore(r.ctx,file);await store.initialize();
  const plugins=r.registrations.get(id).plugins;
  assert.deepEqual(plugins.map(row=>row.name),['@matamt-dbg/dsh-studio/batch','cordis:group','@matamt-dbg/dsh-studio/policy']);
  assert.equal(plugins[1].config[0].name,'@matamt-dbg/dsh-studio/roles');
  await store.dispose();
});
test('a subagent tool filter is validated on apply and reaches both the role tool and the policy',async()=>{
  const file=join(await mkdtemp(join(tmpdir(),'studio-child-filter-')),'presets.json');const r=await runtime();const store=new PresetStore(r.ctx,file);
  const draft=await store.save(JSON.stringify({name:'Filter',description:'',request:{...request,tools:['read','subagent_role'],subagentToolFilter:{deny:['read']}}}));
  assert.deepEqual(draft.request.subagentToolFilter,{deny:['read']});
  await store.apply(draft.id);
  const plugins=r.registrations.get(draft.id).plugins;
  assert.deepEqual(plugins.find(row=>row.name==='@matamt-dbg/dsh-studio/roles').config.toolFilter,{deny:['read']});
  assert.deepEqual(plugins.at(-1).config.childToolFilter,{deny:['read']});
  // A hidden tool the preset does not select would fail every delegation; reject it when applying.
  const bad=await store.save(JSON.stringify({...draft,request:{...draft.request,subagentToolFilter:{deny:['write']}}}));
  await assert.rejects(store.apply(bad.id),/Subagent Tool Filter may only list tools selected in this preset: write/);
  // Extend and replace role lists are checked too; extend also carries the default into the policy set.
  const roles=await store.save(JSON.stringify({...draft,agents:[{name:'Reviewer',role:'reviewer',toolFilter:{mode:'extend',deny:['subagent_role']}}]}));
  await assert.rejects(store.apply(roles.id),/may only list tools selected in this preset: subagent_role/);
  // An empty filter is not stored, and a preset without delegation carries no filter.
  const empty=await store.save(JSON.stringify({name:'Empty',description:'',request:{...request,tools:['read'],subagentToolFilter:{deny:[]}}}));
  assert.equal(empty.request.subagentToolFilter,undefined);
  await assert.rejects(store.save(JSON.stringify({name:'Bad',description:'',request:{...request,subagentToolFilter:{deny:'read'}}})),/Invalid subagent tool filter/);
  await store.dispose();
});
test('the policy may hide the union of the default and every role list, resolved per mode',async()=>{
  const file=join(await mkdtemp(join(tmpdir(),'studio-role-filter-')),'presets.json');const r=await runtime();const store=new PresetStore(r.ctx,file);
  const roles=[{name:'Worker',role:'worker'},{name:'Reviewer',role:'reviewer',toolFilter:{mode:'extend',deny:['subagent_role']}}];
  // subagent_role itself cannot be filtered; use only tools the fixture base supplies (read).
  const draft=await store.save(JSON.stringify({name:'Union',description:'',request:{...request,tools:['read','subagent_role'],subagentToolFilter:{deny:['read']}},agents:[roles[0],{...roles[1],toolFilter:{mode:'replace',deny:[]}}]}));
  await store.apply(draft.id);
  let plugins=r.registrations.get(draft.id).plugins;
  assert.deepEqual(plugins.at(-1).config.childToolFilter,{deny:['read']});
  assert.deepEqual(plugins.find(row=>row.name==='@matamt-dbg/dsh-studio/roles').config.roles[1].toolFilter,{mode:'replace',deny:[]});
  // A replace-only list that drops the default still keeps the default hideable for the other roles.
  const extend=await store.save(JSON.stringify({...draft,agents:[roles[0],{...roles[1],toolFilter:{mode:'extend',deny:[]}}]}));
  await store.apply(extend.id);
  plugins=r.registrations.get(draft.id).plugins;
  assert.deepEqual(plugins.at(-1).config.childToolFilter,{deny:['read']});
  await store.dispose();
});
