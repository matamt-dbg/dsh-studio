/** Owner-local checks for Studio style isolation and native control behavior. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { StudioSurface, Button } from '../src/ui.tsx';
import { studioStyles } from '../src/ui-styles.ts';

const dom = new JSDOM('<!doctype html><div id="first"></div><div id="second"></div><button id="outside">Outside Studio</button>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');

test('each mounted Studio surface retains its own stylesheet when another surface leaves', async () => {
  const first = createRoot(document.getElementById('first'));
  const second = createRoot(document.getElementById('second'));
  let firstMounted = true;
  try {
    await act(async () => {
      first.render(React.createElement(StudioSurface, { className: 'studio-shell' }, 'Sidebar'));
      second.render(React.createElement(StudioSurface, null, 'Agents'));
    });
    const firstStyle = document.querySelector('#first .studio-ui > style');
    const secondStyle = document.querySelector('#second .studio-ui > style');
    assert.equal(firstStyle.textContent, studioStyles);
    assert.equal(secondStyle.textContent, studioStyles);
    assert.notEqual(firstStyle, secondStyle);
    assert.ok(document.querySelector('#first .studio-ui').classList.contains('studio-shell'));
    await act(async () => first.unmount());
    firstMounted = false;
    assert.equal(document.querySelector('#first style'), null);
    assert.equal(document.querySelector('#second style'), secondStyle);
    assert.equal(secondStyle.textContent, studioStyles);
    assert.equal(document.head.querySelector('style'), null);
  } finally {
    await act(async () => {
      if (firstMounted) first.unmount();
      second.unmount();
    });
  }
  assert.equal(document.querySelector('style'), null);
});

test('Studio Button retains native type, disabled, form, ARIA and event semantics', async () => {
  const root = createRoot(document.getElementById('first'));
  let clicks = 0;
  let submissions = 0;
  try {
    await act(async () => root.render(React.createElement(StudioSurface, null,
      React.createElement('form', { onSubmit(event) { event.preventDefault(); submissions++; } },
        React.createElement(Button, { primary: true, className: 'local-action', 'aria-label': 'Apply settings', onClick() { clicks++; } }, 'Apply'),
        React.createElement(Button, { disabled: true, onClick() { clicks++; } }, 'Unavailable'),
        React.createElement(Button, { type: 'submit', name: 'action', value: 'save' }, 'Save'),
        React.createElement(Button, { role: 'switch', 'aria-checked': true }, 'Enabled'),
      ),
    )));
    const [apply, disabled, submit, toggle] = document.querySelectorAll('#first button');
    assert.equal(apply.tagName, 'BUTTON');
    assert.equal(apply.type, 'button');
    assert.equal(apply.getAttribute('aria-label'), 'Apply settings');
    assert.ok(apply.classList.contains('studio-button'));
    assert.ok(apply.classList.contains('studio-primary'));
    assert.ok(apply.classList.contains('local-action'));
    assert.equal(apply.hasAttribute('primary'), false);
    assert.equal(disabled.disabled, true);
    assert.equal(submit.type, 'submit');
    assert.equal(submit.name, 'action');
    assert.equal(submit.value, 'save');
    assert.equal(toggle.getAttribute('role'), 'switch');
    assert.equal(toggle.getAttribute('aria-checked'), 'true');
    await act(async () => { apply.click(); disabled.click(); });
    assert.equal(clicks, 1);
    assert.equal(submissions, 0);
    await act(async () => submit.click());
    assert.equal(submissions, 1);
  } finally {
    await act(async () => root.unmount());
  }
});

test('embedded CSS scopes every rule and keeps host token references inside the Studio adapter', async () => {
  const root = createRoot(document.getElementById('first'));
  try {
    await act(async () => root.render(React.createElement(StudioSurface)));
    const sheet = document.querySelector('#first style').sheet;
    assert.ok(sheet);
    let adapterReferences = 0;
    let scopedRules = 0;
    const inspect = rules => {
      for (const rule of rules) {
        if (typeof rule.selectorText !== 'string' && rule.cssRules) { inspect(rule.cssRules); continue; }
        assert.equal(typeof rule.selectorText, 'string', 'only scoped style rules or rule groups are allowed');
        // Ignore selector-list commas within functional pseudo-classes such as :is().
        const selectors = rule.selectorText.replace(/\([^()]*\)/g, '').split(',');
        for (const selector of selectors) assert.match(selector.trim(), /^\.studio-ui(?=[\s.:#[>+~]|$)/);
        scopedRules++;
        for (let index = 0; index < rule.style.length; index++) {
          const property = rule.style[index];
          const value = rule.style.getPropertyValue(property);
          assert.doesNotMatch(value, /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i, 'colors must use theme aliases');
          if (value.includes('--dsw-')) {
            assert.equal(rule.selectorText, '.studio-ui');
            assert.match(property, /^--studio-/);
            assert.match(value, /^var\(--dsw-[\w-]+\)$/);
            adapterReferences++;
          }
        }
      }
    };
    inspect(sheet.cssRules);
    assert.ok(scopedRules > 0);
    assert.ok(adapterReferences > 0);
    assert.equal(document.getElementById('outside').closest('.studio-ui'), null);
    assert.equal(document.documentElement.getAttribute('style'), null);
    assert.equal(document.body.getAttribute('style'), null);
  } finally {
    await act(async () => root.unmount());
  }
});

test.after(() => dom.window.close());
