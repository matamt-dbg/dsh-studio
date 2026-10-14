import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/host/role-tool.ts';
import { validateRoleModel } from '../src/host/role-validation.ts';
const role = {name:'Worker',role:'worker',model:'unavailable/model',reasoning:'inherit',spawn:'fresh',persona:''};
test('missing runtime provider rejects before creating a child', async () => {
  let tool; let starts = 0;
  apply({tools:{register: value => {tool=value;}}, llm:{listProviders:()=>[]}, subagents:{resolveMaxDepth:()=>1,startActivation:async()=>{starts++;return {childId:'child'};}}}, {roles:[role]});
  await assert.rejects(tool.execute({action:'call',role:'worker',task:'test'},{agent:{},signal:new AbortController().signal}), /provider.*unavailable.*not registered/);
  assert.equal(starts,0);
});
test('exact runtime resolution accepts custom models and preserves reasoning', async () => {
  let received;
  await validateRoleModel({listProviders:()=>[{id:'custom'}], resolveCallConfig:async c=>{received=c;}}, {...role,model:'custom/model/variant',reasoning:'high'});
  assert.deepEqual(received,{provider:'custom',model:'model/variant',reasoningEffort:'high'});
});
test('inherit needs no catalog; failed validation is not mislabeled missing provider', async () => {
  await validateRoleModel(undefined,{...role,model:'inherit'});
  await assert.rejects(validateRoleModel({listProviders:()=>[{id:'unavailable'}],resolveCallConfig:async()=>{throw Error('secret endpoint');}},role), error => {
    assert.match(error.message,/could not validate/); assert.doesNotMatch(error.message,/secret endpoint|not registered/);return true;
  });
});
test('cancellation during validation prevents continuation', async () => {
  const c=new AbortController();
  await assert.rejects(validateRoleModel({listProviders:()=>[{id:'unavailable'}],resolveCallConfig:async()=>{c.abort();}},role,c.signal),/abort/i);
});
