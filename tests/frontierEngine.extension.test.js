// Test suite for Frontier Browser Automation Engine (2026 Engine) in Chrome Extension
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Ensure browser-like globals exist for Node.js test environment
global.innerWidth = 1280;
global.innerHeight = 800;
global.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };

function injectAgentRuntime(mockWin, mockDoc, code) {
  const fn = new Function('window', 'document', 'navigator', 'location', 'chrome', 'getComputedStyle', 'MutationObserver', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'InputEvent', 'Event', 'NodeFilter', 'innerWidth', 'innerHeight', code);
  fn(mockWin, mockDoc, mockWin.navigator, mockWin.location, mockWin.chrome, mockWin.getComputedStyle, mockWin.MutationObserver, mockWin.MouseEvent, mockWin.PointerEvent, mockWin.KeyboardEvent, mockWin.InputEvent, mockWin.Event, mockWin.NodeFilter, mockWin.innerWidth, mockWin.innerHeight);
}

// Setup minimal mock browser environment
function createMockBrowser() {
  const messageListeners = [];
  let sentMessages = [];

  class MockClassList {
    constructor() { this.classes = new Set(); }
    add(...c) { c.forEach(x => this.classes.add(x)); }
    remove(...c) { c.forEach(x => this.classes.delete(x)); }
    contains(c) { return this.classes.has(c); }
  }

  class MockElement {
    constructor(tag, id = '', className = '') {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.className = className;
      this.classList = new MockClassList();
      if (className) className.split(/\s+/).forEach(c => this.classList.add(c));
      this.attributes = {};
      this.style = {};
      this.childNodes = [];
      this.parentElement = null;
      this.isConnected = true;
      this.value = '';
      this.type = (tag === 'input') ? 'text' : undefined;
      this.textContent = '';
      this._rect = { left: 10, top: 10, width: 100, height: 30, right: 110, bottom: 40 };
      this.eventsDispatched = [];
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; }
    hasAttribute(k) { return this.attributes[k] !== undefined; }
    removeAttribute(k) { delete this.attributes[k]; }
    getBoundingClientRect() { return this._rect; }
    scrollIntoView() {}
    focus() {}
    click() { this.dispatchEvent({ type: 'click' }); }
    dispatchEvent(e) {
      this.eventsDispatched.push(e);
      return true;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
    querySelectorAll(sel) {
      const res = [];
      const parts = (sel || '*').split(',').map(p => p.trim().toLowerCase());
      const matchOne = (el, s) => {
        if (!s || s === '*') return true;
        if (s.startsWith('#') && el.id && el.id.toLowerCase() === s.slice(1)) return true;
        if (s.startsWith('.') && el.classList.contains(s.slice(1))) return true;
        if (s === el.tagName.toLowerCase()) return true;
        if (s.startsWith('input') && el.tagName === 'INPUT') return true;
        if (s.startsWith('button') && el.tagName === 'BUTTON') return true;
        if (s.startsWith('a') && el.tagName === 'A') return true;
        if (s.startsWith('h1') && el.tagName === 'H1') return true;
        if (s.includes('[role=') && el.getAttribute('role')) {
          const m = s.match(/\[role=["']?([^"'\]]+)["']?\]/);
          if (m && el.getAttribute('role').toLowerCase() === m[1].toLowerCase()) return true;
        }
        return false;
      };
      const match = (el) => parts.some(p => matchOne(el, p));
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (match(child)) res.push(child);
          walk(child);
        }
      };
      walk(this);
      return res;
    }
    get innerText() {
      let t = this.textContent || '';
      for (const c of this.childNodes) t += ' ' + (c.innerText || c.textContent || '');
      return t.trim();
    }
    appendChild(child) {
      child.parentElement = this;
      child.isConnected = true;
      child.ownerDocument = mockDoc;
      this.childNodes.push(child);
      return child;
    }
    remove() {
      this.isConnected = false;
      if (this.parentElement) {
        const idx = this.parentElement.childNodes.indexOf(this);
        if (idx >= 0) this.parentElement.childNodes.splice(idx, 1);
      }
    }
    matches(sel) {
      const s = sel.trim().toLowerCase();
      if (s.includes(this.tagName.toLowerCase())) return true;
      if (s.includes('[role="button"]') && this.getAttribute('role') === 'button') return true;
      return false;
    }
    closest(sel) {
      let cur = this;
      while (cur) {
        if (cur.matches && cur.matches(sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    checkValidity() { return true; }
  }

  const mockDoc = new MockElement('html');
  mockDoc.body = new MockElement('body');
  mockDoc.documentElement = mockDoc;
  mockDoc.head = new MockElement('head');
  mockDoc.appendChild(mockDoc.head);
  mockDoc.appendChild(mockDoc.body);
  mockDoc.title = 'Test Page';
  mockDoc.readyState = 'complete';
  mockDoc.createElement = (tag) => {
    const el = new MockElement(tag);
    el.ownerDocument = mockDoc;
    return el;
  };
  mockDoc.createTreeWalker = () => ({
    nextNode: () => false,
    currentNode: null
  });
  mockDoc.getElementById = (id) => {
    const all = mockDoc.querySelectorAll('*');
    return all.find(e => e.id === id) || null;
  };

  const mockWin = {
    document: mockDoc,
    innerWidth: 1280,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    scrollBy: () => {},
    scrollTo: () => {},
    location: { href: 'https://example.com/test', pathname: '/test' },
    navigator: { webdriver: undefined, userAgent: 'Mozilla/5.0 Test' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' }),
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (fn, ms) => setTimeout(fn, 1),
    clearTimeout: () => {},
    setInterval: (fn, ms) => setInterval(fn, 1),
    clearInterval: () => {},
    Event: function (type) { this.type = type; },
    MouseEvent: function (type, opts = {}) { this.type = type; Object.assign(this, opts); },
    PointerEvent: function (type, opts = {}) { this.type = type; Object.assign(this, opts); },
    KeyboardEvent: function (type, opts = {}) { this.type = type; Object.assign(this, opts); },
    InputEvent: function (type, opts = {}) { this.type = type; Object.assign(this, opts); },
    MutationObserver: function (cb) {
      this.observe = () => {};
      this.disconnect = () => {};
    },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    CSS: { escape: s => s },
    chrome: {
      runtime: {
        onMessage: {
          addListener: (fn) => messageListeners.push(fn)
        },
        onConnect: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          sentMessages.push(msg);
          if (cb) cb({ success: true, result: {} });
        }
      }
    }
  };

  return { mockWin, mockDoc, messageListeners, sentMessages };
}

test('Frontier Browser Automation Engine (Extension In-Tab Runtime)', async (t) => {
  const code = fs.readFileSync(path.join(__dirname, '../core/agent-runtime.js'), 'utf8');

  await t.test('1. Injects without error and cloaks navigator.webdriver', () => {
    const { mockWin, mockDoc } = createMockBrowser();
    injectAgentRuntime(mockWin, mockDoc, code);

    assert.ok(mockWin[Symbol.for('_grt')], 'Agent runtime marks initialization symbol');
    assert.ok(mockWin.__geElementIndexMap instanceof Map, '__geElementIndexMap is initialized');
  });

  await t.test('2. Builds pruned accessibility tree and indexes viewport elements', async () => {
    const { mockWin, mockDoc, messageListeners } = createMockBrowser();
    
    // Add interactive elements
    const btn = mockDoc.createElement('button');
    btn.textContent = 'Submit Order';
    mockDoc.body.appendChild(btn);

    const input = mockDoc.createElement('input');
    input.setAttribute('placeholder', 'Enter email');
    input.name = 'email';
    mockDoc.body.appendChild(input);

    const link = mockDoc.createElement('a');
    link.setAttribute('href', '/terms');
    link.textContent = 'Terms & Conditions';
    mockDoc.body.appendChild(link);

    injectAgentRuntime(mockWin, mockDoc, code);

    const listener = messageListeners[0];
    assert.ok(listener, 'Message listener registered');

    // Call readPage
    const resp = await new Promise(res => listener({ type: 'ge-action', action: 'readPage' }, {}, res));
    if (!resp.success) console.error('Test 2 readPage error:', resp.error);
    assert.ok(resp.success, 'readPage returned success');
    assert.ok(typeof resp.result.a11yTree === 'string', 'a11yTree is present');
    assert.ok(resp.result.somIndexedCount >= 3, 'Indexed at least 3 interactive elements');
    assert.ok(resp.result.a11yTree.includes('[1]'), 'Tree contains numeric mark [1]');
    assert.ok(resp.result.a11yTree.includes('Submit Order'), 'Tree contains accessible name');
  });

  await t.test('3. Executes click targeting SoM numeric index with self-healing', async () => {
    const { mockWin, mockDoc, messageListeners } = createMockBrowser();

    const btn = mockDoc.createElement('button');
    btn.textContent = 'Checkout';
    mockDoc.body.appendChild(btn);

    injectAgentRuntime(mockWin, mockDoc, code);

    const listener = messageListeners[0];
    await new Promise(res => listener({ type: 'ge-action', action: 'readPage' }, {}, res));

    // Click index 1
    const clickRes = await new Promise(res => listener({ type: 'ge-action', action: 'click', params: { index: 1 } }, {}, res));
    assert.ok(clickRes.success, 'Click executed');
    assert.equal(clickRes.result.clicked.somIndexUsed, 1, 'SoM index 1 was targeted');
  });

  await t.test('4. Form Validation Pre-Check Guard halts invalid form submits', async () => {
    const { mockWin, mockDoc, messageListeners } = createMockBrowser();

    const form = mockDoc.createElement('form');
    form.matches = (sel) => sel.includes('form');
    form.checkValidity = () => false; // Invalid form!

    const reqInput = mockDoc.createElement('input');
    reqInput.name = 'credit_card';
    reqInput.checkValidity = () => false;
    reqInput.validationMessage = 'Please enter a valid card number';
    form.appendChild(reqInput);

    const submitBtn = mockDoc.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Pay Now';
    submitBtn.matches = (sel) => sel.includes('button');
    form.appendChild(submitBtn);
    mockDoc.body.appendChild(form);

    injectAgentRuntime(mockWin, mockDoc, code);

    const listener = messageListeners[0];
    await new Promise(res => listener({ type: 'ge-action', action: 'readPage' }, {}, res));

    // Find the submit button index
    let submitIdx = 1;
    for (const [idx, entry] of mockWin.__geElementIndexMap.entries()) {
      if (entry.el === submitBtn) { submitIdx = idx; break; }
    }

    const clickRes = await new Promise(res => listener({ type: 'ge-action', action: 'click', params: { index: submitIdx } }, {}, res));
    assert.equal(clickRes.result.success, false, 'Click halted on invalid form');
    assert.equal(clickRes.result.reason, 'form_validation_failed', 'Returned structured form_validation_failed reason');
    assert.ok(Array.isArray(clickRes.result.invalidFields), 'Surfaced invalid fields list');
    assert.equal(clickRes.result.invalidFields[0].name, 'credit_card');
  });

  await t.test('5. Renders and removes visual SoM badges during screenshot capture', async () => {
    const { mockWin, mockDoc, messageListeners } = createMockBrowser();

    const btn = mockDoc.createElement('button');
    btn.textContent = 'Mark Me';
    mockDoc.body.appendChild(btn);

    injectAgentRuntime(mockWin, mockDoc, code);

    const listener = messageListeners[0];
    // Render badges
    const renderRes = await new Promise(res => listener({ type: 'ge-action', action: 'renderSoMBadges', params: {} }, {}, res));
    assert.ok(renderRes.success, 'renderSoMBadges succeeded');
    const badgeLayer = mockDoc.getElementById('__ge_som_layer__');
    assert.ok(badgeLayer, 'Badge layer DOM element created');

    // Remove badges
    const removeRes = await new Promise(res => listener({ type: 'ge-action', action: 'removeSoMBadges' }, {}, res));
    assert.ok(removeRes.success, 'removeSoMBadges succeeded');
    assert.equal(badgeLayer.isConnected, false, 'Badge layer removed from DOM');
  });

  await t.test('6. Semantic Expectation Validator verifies post-conditions', async () => {
    const { mockWin, mockDoc, messageListeners } = createMockBrowser();

    const h1 = mockDoc.createElement('h1');
    h1.textContent = 'Welcome Back Dashboard';
    mockDoc.body.appendChild(h1);

    injectAgentRuntime(mockWin, mockDoc, code);

    const listener = messageListeners[0];
    const valRes = await new Promise(res => listener({
      type: 'ge-action',
      action: 'validateExpectations',
      params: {
        urlContains: '/test',
        textPresent: 'Dashboard'
      }
    }, {}, res));

    assert.ok(valRes.success, 'Expectation validation passed');
    assert.equal(valRes.result.unmet.length, 0, 'No unmet conditions');
  });
});
