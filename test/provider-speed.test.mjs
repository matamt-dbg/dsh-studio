import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyChatGptSpeed, StudioProviderSpeed } from '../src/host/provider-speed.ts';
import { ChatGptSpeedControl, mountSettingsXSpeed, settingsxSpeedDescriptors } from '../src/settingsx-speed-client.tsx';

const options = { provider: 'studio-chatgpt', model: 'gpt-5.5', sessionId: 'one' };
test('priority injection is immutable and isolated to supported session requests', async () => {
  const body = Object.freeze({ model: 'gpt-5.5', messages: [] });
  const seen = [];
  const store = { get: async id => { seen.push(id); return id === 'one'; } };
  assert.deepEqual(await applyChatGptSpeed(body, Object.freeze(options), store), { ...body, service_tier: 'priority' });
  assert.equal(await applyChatGptSpeed(body, { ...options, sessionId: 'two' }, store), body);
  for (const changes of [{ provider: 'openai' }, { model: 'gpt-5.4' }, { model: 'gpt-5.5-pro' }, { sessionId: undefined }, { purpose: 'session-title' }, { purpose: 'compaction' }]) {
    assert.equal(await applyChatGptSpeed(body, { ...options, ...changes }, store), body);
  }
  assert.deepEqual(seen, ['one', 'two']);
  assert.equal(await applyChatGptSpeed(body, options), body);
  assert.equal(body.service_tier, undefined);
});

test('remote validates values and session keys without writing invalid data', async () => {
  const calls = [];
  const receiver = { set: async (...args) => calls.push(args) };
  assert.equal(await StudioProviderSpeed.prototype.save.call(receiver, 'one', 'true'), true);
  assert.equal(await StudioProviderSpeed.prototype.save.call(receiver, 'two', 'false'), false);
  await assert.rejects(StudioProviderSpeed.prototype.save.call(receiver, 'one', 'yes'), TypeError);
  assert.deepEqual(calls, [['one', true], ['two', false]]);
  await assert.rejects(StudioProviderSpeed.prototype.get.call({}, ''), TypeError);
});

test('session preferences survive service handles and never leak to another session', async () => {
  const records = new Map();
  const domain = Promise.resolve({ table: () => ({ get: id => records.get(id), put: async (id, value) => { records.set(id, value); } }) });
  const first = { domain };
  const restarted = { domain };
  await StudioProviderSpeed.prototype.set.call(first, 'one', true);
  assert.equal(await StudioProviderSpeed.prototype.get.call(restarted, 'one'), true);
  assert.equal(await StudioProviderSpeed.prototype.get.call(restarted, 'two'), false);
  await StudioProviderSpeed.prototype.set.call(restarted, 'one', false);
  assert.equal(await StudioProviderSpeed.prototype.get.call(first, 'one'), false);
  await assert.rejects(StudioProviderSpeed.prototype.set.call(first, 'one', 'true'), TypeError);
  assert.equal(records.get('one'), false);
});

test('composer registers a unique public compact cell and strict remote descriptors', () => {
  const registrations = [];
  mountSettingsXSpeed({ slots: { inject: (name, callback) => { assert.equal(name, 'conversation.input.left'); callback(); }, register: (definition, component) => registrations.push({ definition, component }) } });
  assert.equal(registrations.length, 1);
  assert.match(registrations[0].definition.id, /chatgpt-speed$/);
  assert.deepEqual(settingsxSpeedDescriptors().map(value => [value.method, value.parameters.map(p => p.name)]), [['get', ['sessionId']], ['save', ['sessionId', 'payload']]]);
});

test('control has compact accessible pending state and localized copy', () => {
  const actions = { get: async () => false, save: async enabled => enabled };
  for (const [locale, text] of [['en', 'Fast: off'], ['ko', '빠른 모드: 꺼짐'], ['zh', '快速模式：关']]) {
    const html = renderToStaticMarkup(React.createElement(ChatGptSpeedControl, { actions, locale }));
    assert.ok(html.includes(text));
    assert.match(html, /aria-pressed="false"/);
    assert.match(html, /disabled=""/);
    assert.match(html, /studio-small/);
  }
});
