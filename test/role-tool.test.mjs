import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/host/role-tool.ts';
import { parseRoles, executableRoles } from '../src/role-settings.ts';
const role = {name:'Reviewer',role:'review',model:'route/model/variant',reasoning:'high',spawn:'fork',persona:'Review carefully',overrides:{danger:true}};
test('a runtime without native child policy must not silently ignore persona and tool filters', async () => {
  let definition; let calls = 0;
  const ctx = {
    get: () => undefined,
    tools: { register: value => { definition = value; } },
    subagents: {
      resolveMaxDepth: () => 1,
      getProvider: () => ({ capabilities: { agentPreset: true, agentOptions: true } }),
      startActivation: async () => { calls++; return { childId: 'unrestricted' }; },
    },
  };
  apply(ctx, { roles: [{ ...role, model: 'inherit', reasoning: 'inherit' }], toolFilter: { deny: ['read'] } });
  await assert.rejects(definition.execute({ action: 'call', role: 'review', task: 'review' },
    { agent: { id: 'parent' }, signal: new AbortController().signal }), /Studio.*child.*policy/i);
  assert.equal(calls, 0, 'No child may start without its policy owner');
});
test('roles validate and project only supported executable settings',()=>{
  assert.deepEqual(parseRoles([role]),[role]);
  assert.equal('overrides' in executableRoles([role])[0],false);
  assert.throws(()=>parseRoles([role,role]),/unique/);
  for(const patch of [{model:'bare'}, {model:'a/'},{spawn:'other'},{reasoning:''}]) assert.throws(()=>parseRoles([{...role,...patch}]));
  assert.equal(parseRoles([{name:'legacy'}])[0].model,'inherit');
});
for(const api of ['startActivation','startContinuable']) test(`role delegates through native ${api}`,async()=>{
  let definition; const starts=[];
  const ctx={llm:{listProviders:()=>[{id:'route'}],resolveCallConfig:async config=>config},tools:{register:d=>{definition=d;}},subagents:{resolveMaxDepth:()=>2,[api]:async spec=>{starts.push(spec);return {childId:'child-1'};}}};
  apply(ctx,{roles:[role]});
  const signal=new AbortController().signal;const parent={};const exec={signal,agent:parent};
  const listed=JSON.parse((await definition.execute({action:'list'},exec)).result);
  assert.equal(listed.roles[0].role,'review');assert.equal('overrides' in listed.roles[0],false);
  const result=JSON.parse((await definition.execute({action:'call',role:'review',task:'Check it'},exec)).result);
  assert.equal(result.subagentId,'child-1');const spec=starts[0];
  assert.equal(spec.provider,'fork');assert.equal(spec.signal,signal);assert.equal(spec.request.parent,parent);
  assert.equal(spec.request.maxDepth,2);assert.deepEqual(spec.request.agentOptions,{provider:'route',model:'model/variant',reasoningEffort:'high'});
  assert.equal(spec.request.persona,role.persona);assert.equal(spec.delivery,api==='startActivation'?'parent':undefined);
  await assert.rejects(definition.execute({action:'call',role:'missing',task:'x'},exec),/Unknown/);
  await assert.rejects(definition.execute({action:'call',role:'review',task:''},exec),/task/);
  await assert.rejects(definition.execute({action:'call',role:'review',task:'x'},{signal,agent:undefined}),/calling agent/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(definition.execute({action:'call',role:'review',task:'x'},{signal:controller.signal,agent:parent}));
  assert.equal(starts.length,1);
});
test('inherit and fresh use native defaults without arbitrary overrides',async()=>{
  let definition;let spec;apply({tools:{register:d=>{definition=d;}},subagents:{resolveMaxDepth:()=>1,startActivation:async s=>{spec=s;return {childId:'c'};}}},{roles:[{...role,spawn:'fresh',model:'inherit',reasoning:'inherit',persona:''}]});
  await definition.execute({action:'call',role:'review',task:'x'},{agent:{},signal:new AbortController().signal});
  assert.equal(spec.provider,'spawn');assert.equal(spec.request.agentOptions,undefined);assert.equal(spec.request.persona,undefined);assert.equal(spec.request.overrides,undefined);
});
test('without saved roles, call starts a fresh child identical to the parent',async()=>{
  let definition;let spec;apply({tools:{register:d=>{definition=d;}},subagents:{resolveMaxDepth:()=>undefined,startActivation:async s=>{spec=s;return {childId:'c'};}}},{roles:[]});
  assert.match(definition.description,/same model and settings/);
  assert.deepEqual(JSON.parse((await definition.execute({action:'list'},{signal:new AbortController().signal})).result).roles,[]);
  const result=JSON.parse((await definition.execute({action:'call',task:'x'},{agent:{},signal:new AbortController().signal})).result);
  assert.equal(result.subagentId,'c');assert.equal(spec.provider,'spawn');assert.equal(spec.request.agentOptions,undefined);assert.equal(spec.request.persona,undefined);
});
test('a preset tool filter reaches every fresh and fork child request',async()=>{
  const specs=[];let definition;
  apply({tools:{register:d=>{definition=d;}},subagents:{resolveMaxDepth:()=>undefined,startActivation:async s=>{specs.push(s);return {childId:'c'};}}},
    {roles:[{...role,role:'fresh',spawn:'fresh',model:'inherit',reasoning:'inherit',persona:''},{...role,role:'fork',spawn:'fork',model:'inherit',reasoning:'inherit',persona:''}],toolFilter:{deny:['ask_user_question','present']}});
  for(const name of ['fresh','fork']) await definition.execute({action:'call',role:name,task:'x'},{agent:{},signal:new AbortController().signal});
  assert.deepEqual(specs.map(s=>s.provider),['spawn','fork']);
  for(const s of specs) assert.deepEqual(s.request.toolFilter,{deny:['ask_user_question','present']});
  assert.throws(()=>apply({tools:{register:()=>{}},subagents:{}},{roles:[],toolFilter:{deny:[1]}}),/Invalid subagent tool filter/);
});
test('without a tool filter the child request carries none',async()=>{
  let definition;let spec;apply({tools:{register:d=>{definition=d;}},subagents:{resolveMaxDepth:()=>undefined,startActivation:async s=>{spec=s;return {childId:'c'};}}},{roles:[],toolFilter:{deny:[]}});
  await definition.execute({action:'call',task:'x'},{agent:{},signal:new AbortController().signal});
  assert.equal(spec.request.toolFilter,undefined);
});
test('roles use, extend or replace the preset Tool Filter',async()=>{
  const specs=[];let definition;
  const plain={...role,model:'inherit',reasoning:'inherit',persona:''};
  apply({tools:{register:d=>{definition=d;}},subagents:{resolveMaxDepth:()=>undefined,startActivation:async s=>{specs.push(s);return {childId:'c'};}}},
    {roles:[{...plain,role:'worker',spawn:'fork'},{...plain,role:'reviewer',spawn:'fresh',toolFilter:{mode:'extend',deny:['bash','write']}},
      {...plain,role:'own',spawn:'fresh',toolFilter:{mode:'replace',deny:['bash']}},{...plain,role:'open',spawn:'fresh',toolFilter:{mode:'replace',deny:[]}}],toolFilter:{deny:['ask_user_question']}});
  for(const name of ['worker','reviewer','own','open']) await definition.execute({action:'call',role:name,task:'x'},{agent:{},signal:new AbortController().signal});
  assert.deepEqual(specs.map(s=>s.request.toolFilter),[{deny:['ask_user_question']},{deny:['ask_user_question','bash','write']},{deny:['bash']},undefined]);
  assert.throws(()=>parseRoles([{name:'a',toolFilter:{deny:'bash'}}]),/Invalid role tool filter/);
  assert.throws(()=>parseRoles([{name:'a',toolFilter:{mode:'merge',deny:[]}}]),/Invalid role tool filter/);
  // 0.2.6 stored a role list without a mode; it replaced the default and still does.
  assert.deepEqual(parseRoles([{name:'a',toolFilter:{deny:['bash']}}])[0].toolFilter,{mode:'replace',deny:['bash']});
});
