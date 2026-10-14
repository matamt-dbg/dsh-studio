import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/host/role-tool.ts';
import { parseRoles, executableRoles } from '../src/role-settings.ts';
const role = {name:'Reviewer',role:'review',model:'route/model/variant',reasoning:'high',spawn:'fork',persona:'Review carefully',overrides:{danger:true}};
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
