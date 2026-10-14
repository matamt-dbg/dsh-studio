import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PresetStore, studioStorePath } from '../src/host/preset-store.ts';
const request = {preset:'minimal',providers:['@deepseek-ai/dsh-persona'],tools:[],prompt:'Studio instruction',model:'test'};
function runtime() {
  const registrations = new Map(); let broken = false;
  const ctx = {get:()=>({listProviders:()=>[],resolveCallConfig:async config=>config}),agentPresets:{
    list:async()=>[{id:'minimal'},...registrations.values()],
    readDocument:async()=>({content:'- name: "@deepseek-ai/dsh-persona"\n  config: {complete: true}\n'}),
    register:async definition=> {if(registrations.has(definition.id))throw Error('duplicate');registrations.set(definition.id,definition);return async()=>{registrations.delete(definition.id);};},
    resolve:async id=>({...registrations.get(id),broken:broken?'activation failed':undefined}),
    acquireScope:async()=>({key:{},[Symbol.asyncDispose]:async()=>{}}),
  },tools:{schemas:()=>[]}};
  return {ctx,registrations,fail:()=>{broken=true;}};
}
test('profile persistence saves extras, applies policy, restores last applied snapshot, deletes only owned preset',async()=>{
  const file=join(await mkdtemp(join(tmpdir(),'studio-presets-')),'presets.json');
  const a=runtime();const store=new PresetStore(a.ctx,file);
  const draft=await store.save(JSON.stringify({name:'My preset',description:'Description',request,conveniences:{arbitrary:true},agents:[{name:'helper'}]}));
  assert.equal(draft.status,'draft');assert.equal(draft.agents[0].name,'helper');assert.equal(draft.agents[0].model,'inherit');
  await assert.rejects(store.delete('minimal'),/Studio-owned/);
  const applied=await store.apply(draft.id);assert.equal(applied.status,'applied');assert.match(applied.applyWarning,/not applied/);
  const definition=a.registrations.get(draft.id);assert.equal(definition.plugins.at(-1).name,'@matamt-dbg/dsh-studio/policy');assert.equal(definition.plugins.at(-1).config.prompt,request.prompt);
  await store.save(JSON.stringify({...draft,name:'New draft'}));
  assert.equal((await store.list())[0].status,'modified');
  await store.dispose();assert.equal(a.registrations.size,0);
  const b=runtime();const restored=new PresetStore(b.ctx,file);await restored.initialize();
  assert.equal(b.registrations.get(draft.id).name,'My preset');assert.equal((await restored.list())[0].name,'New draft');
  await restored.apply(draft.id);assert.equal(b.registrations.get(draft.id).name,'New draft');
  await restored.unapply(draft.id); assert.equal(b.registrations.size,0); assert.equal((await restored.list())[0].status,'draft');
  await restored.dispose();
  const c=runtime(); const reopened=new PresetStore(c.ctx,file); await reopened.initialize();
  assert.equal(c.registrations.size,0); assert.equal((await reopened.list())[0].name,'New draft');
  await reopened.apply(draft.id); assert.equal(c.registrations.get(draft.id).name,'New draft');
  await reopened.dispose();
  await restored.delete(draft.id);assert.equal(b.registrations.size,0);assert.deepEqual((await restored.list()),[]);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')).presets,[]);
});
test('roles persist legacy overrides but apply only supported settings and replace generic delegation',async()=>{
  const file=join(await mkdtemp(join(tmpdir(),'studio-roles-')),'presets.json');const r=runtime();const store=new PresetStore(r.ctx,file);
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
  const file=join(await mkdtemp(join(tmpdir(),'studio-model-')),'presets.json');const r=runtime();const store=new PresetStore(r.ctx,file);
  const draft=await store.save(JSON.stringify({name:'Valid',description:'',request}));await store.apply(draft.id);
  const before=r.registrations.get(draft.id);
  await store.save(JSON.stringify({...draft,agents:[{name:'Worker',role:'worker',model:'missing/model',reasoning:'inherit',spawn:'fresh',persona:''}]}));
  await assert.rejects(store.apply(draft.id),/not registered/);
  assert.equal(r.registrations.get(draft.id),before);assert.equal((await store.list())[0].status,'modified');await store.dispose();
});
test('activation failure is not reported applied and concurrent saves retain both rows',async()=>{
  const file=join(await mkdtemp(join(tmpdir(),'studio-presets-')),'presets.json');const r=runtime();const store=new PresetStore(r.ctx,file);
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
  const file=join(await mkdtemp(join(tmpdir(),'studio-fold-')),'presets.json');const r=runtime();const store=new PresetStore(r.ctx,file);
  const draft=await store.save(JSON.stringify({name:'Fold',description:'',request:{...request,tools:['subagent','subagent_fork']}}));
  await store.apply(draft.id);
  const plugins=r.registrations.get(draft.id).plugins;
  assert.deepEqual(plugins.at(-1).config.tools,['subagent_role']);
  assert.deepEqual(plugins.find(row=>row.name==='@matamt-dbg/dsh-studio/roles').config.roles,[]);
  await store.dispose();
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
  const r=runtime();const store=new PresetStore(r.ctx,file);await store.initialize();
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
  const r=runtime();const store=new PresetStore(r.ctx,file);await store.initialize();
  const plugins=r.registrations.get(id).plugins;
  assert.deepEqual(plugins.map(row=>row.name),['@matamt-dbg/dsh-studio/batch','cordis:group','@matamt-dbg/dsh-studio/policy']);
  assert.equal(plugins[1].config[0].name,'@matamt-dbg/dsh-studio/roles');
  await store.dispose();
});
