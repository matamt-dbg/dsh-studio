/** Service selection retains inputs and follows live registration removal. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { ServiceLayout } from '../src/service-layout.tsx';

test('registered services retain edits across selection and disappear on removal', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const services = [{ id: 'workflow', label: 'Workflow' }, { id: 'preview', label: 'Design preview' }];
  const renderSlot = (_name, props, { only }) => React.createElement('textarea', { defaultValue: only, 'data-active': props.active });
  const render = (items, locale = 'en') => act(async () => root.render(React.createElement(ServiceLayout, { services: items, locale, renderSlot })));
  try {
    await render(services);
    const buttons = () => [...document.querySelectorAll('nav button')];
    assert.equal(buttons()[0].getAttribute('aria-current'), 'page');
    const draft = document.querySelector('textarea');
    draft.value = 'unsaved instruction';
    assert.equal(draft.dataset.active, 'true');
    await act(async () => buttons()[1].click());
    assert.equal(draft.dataset.active, 'false');
    await act(async () => buttons()[0].click());
    assert.equal(draft.dataset.active, 'true');
    assert.equal(document.querySelector('textarea'), draft);
    assert.equal(draft.value, 'unsaved instruction');
    await act(async () => buttons()[1].click());
    await render([services[0]]);
    assert.equal(document.querySelector('nav'), null);
    assert.equal(document.querySelector('.studio-service-panel').hidden, false);
    await render(services);
    assert.equal(buttons()[0].getAttribute('aria-current'), 'page');
    for (const [locale, label] of [['ko', 'Studio 서비스'], ['zh', 'Studio 服务']]) {
      await render(services, locale);
      assert.equal(document.querySelector('nav').getAttribute('aria-label'), label);
    }
    await render([]);
    assert.equal(document.querySelectorAll('textarea').length, 0);
    assert.equal(document.querySelector('[role="status"]').textContent, 'No services are available.');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
