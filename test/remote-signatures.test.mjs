/** Host Remote parameter names are the wire names the gateway checks; Client descriptors must match them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const host = readFileSync(new URL('../src/host/shell.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/shell.tsx', import.meta.url), 'utf8');

test('studioCatalog Client descriptors use the Host method parameter names', () => {
  const signatures = new Map([...host.matchAll(/@Remote\s+async (\w+)\(([^)]*)\)/g)].map(([, method, params]) => [method, params.split(',').map(param => param.split(':')[0].trim()).filter(Boolean)]));
  const list = client.match(/\.\.\.\[('listPresets'[^\]]*)\]\.map\(method/)[1].split(',').map(item => item.trim().replace(/'/g, ''));
  const none = client.match(/parameters: \[([^\]]*)\]\.includes\(method\) \? \[\]/)[1].split(',').map(item => item.trim().replace(/'/g, ''));
  const payload = client.match(/name: \[([^\]]*)\]\.includes\(method\) \? 'payload' : 'id'/)[1].split(',').map(item => item.trim().replace(/'/g, ''));
  for (const method of list) {
    const expected = none.includes(method) ? [] : [payload.includes(method) ? 'payload' : 'id'];
    assert.deepEqual(signatures.get(method), expected, method);
  }
});
