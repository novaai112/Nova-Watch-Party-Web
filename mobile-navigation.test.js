'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, 'mobile-navigation.js'), 'utf8');

function createHarness({ home = false, people = false } = {}) {
  const listeners = {};
  const homeNode = {};
  const appNode = {};
  const startButton = {
    nodeType: 1,
    contains(target) { return target === this; },
    click() {}
  };
  let selectedTab = 'friends';
  let clickedTab = '';
  const document = {
    body: { classList: { contains(name) { return name === 'people-experience-active' ? people : false; } } },
    addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
    getElementById(id) {
      if (id === 'rm') return null;
      if (id === 'scr' || id === 'fr') return { hidden: true };
      return null;
    },
    querySelector(selector) {
      if (selector === '[data-people-tab].on') return { dataset: { peopleTab: selectedTab } };
      const match = /^\[data-people-tab="([^"]+)"\]$/.exec(selector);
      if (!match) return null;
      return { click() { clickedTab = match[1]; selectedTab = match[1]; } };
    }
  };
  const target = {
    nodeType: 1,
    parentElement: null,
    closest(selector) {
      if (selector.startsWith('input, textarea')) return null;
      if (selector === 'button, a, [role="button"]') return startButton;
      if (selector === '#home') return home ? homeNode : null;
      if (selector === '#app') return people ? appNode : null;
      return null;
    }
  };
  const location = { href: '' };
  vm.runInNewContext(script, {
    document,
    location,
    matchMedia() { return { matches: true }; },
    setTimeout() { return 1; },
    clearTimeout() {}
  });
  return { listeners, location, startButton, target, get clickedTab() { return clickedTab; } };
}

function swipe(harness, endX, endY = 100) {
  harness.listeners.pointerdown[0]({
    pointerType: 'touch',
    pointerId: 1,
    isPrimary: true,
    clientX: 200,
    clientY: 100,
    target: harness.target
  });
  harness.listeners.pointerup[0]({
    pointerId: 1,
    clientX: endX,
    clientY: endY
  });
}

test('home swipe from a button opens the matching adjacent page', () => {
  const harness = createHarness({ home: true });
  swipe(harness, 100);
  assert.equal(harness.location.href, 'profile.html#settings');
});

test('people swipe from a button changes tabs and suppresses its follow-up click', () => {
  const harness = createHarness({ people: true });
  swipe(harness, 100);
  assert.equal(harness.clickedTab, 'recents');

  let prevented = false;
  let stopped = false;
  harness.listeners.click[0]({
    target: harness.startButton,
    preventDefault() { prevented = true; },
    stopImmediatePropagation() { stopped = true; }
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});

test('vertical movement does not trigger a page swipe', () => {
  const harness = createHarness({ home: true });
  swipe(harness, 190, 220);
  assert.equal(harness.location.href, '');
});
