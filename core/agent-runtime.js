// Global Executive — Agent Runtime
// Injected into target tabs to read DOM state and execute browser actions
// Communicates with background.js via chrome.runtime messages

(function () {
  'use strict';

  if (window.__geAgentLoaded) return;
  window.__geAgentLoaded = true;

  console.log('[Global Executive] Agent Runtime loaded');

  // ============================================
  // Page State Reader
  // ============================================
  function readPageState() {
    const state = {
      url: location.href,
      title: document.title,
      visibleText: '',
      headings: [],
      links: [],
      buttons: [],
      inputs: [],
      forms: [],
      images: [],
      tables: []
    };

    // Visible text (limited)
    const body = document.body;
    if (body) {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(tag)) return NodeFilter.FILTER_REJECT;
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
          if (node.textContent.trim().length === 0) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      const textParts = [];
      let totalLen = 0;
      const MAX_TEXT = 15000;
      while (walker.nextNode() && totalLen < MAX_TEXT) {
        const text = walker.currentNode.textContent.trim();
        if (text.length > 0) {
          textParts.push(text);
          totalLen += text.length;
        }
      }
      state.visibleText = textParts.join(' ').substring(0, MAX_TEXT);
    }

    // Headings
    document.querySelectorAll('h1, h2, h3, h4').forEach((h, i) => {
      if (i < 30) {
        state.headings.push({ tag: h.tagName, text: h.textContent.trim().substring(0, 200) });
      }
    });

    // Links (top 50)
    document.querySelectorAll('a[href]').forEach((a, i) => {
      if (i < 50) {
        const rect = a.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          state.links.push({
            text: a.textContent.trim().substring(0, 100),
            href: a.href,
            selector: buildSelector(a)
          });
        }
      }
    });

    // Buttons (top 30)
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((btn, i) => {
      if (i < 30) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          state.buttons.push({
            text: (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').trim().substring(0, 100),
            selector: buildSelector(btn),
            type: btn.type || 'button',
            disabled: btn.disabled
          });
        }
      }
    });

    // Inputs (top 30)
    document.querySelectorAll('input, textarea, select').forEach((inp, i) => {
      if (i < 30) {
        state.inputs.push({
          type: inp.type || inp.tagName.toLowerCase(),
          name: inp.name || '',
          placeholder: inp.placeholder || '',
          value: inp.type === 'password' ? '***' : (inp.value || '').substring(0, 200),
          selector: buildSelector(inp),
          label: getInputLabel(inp)
        });
      }
    });

    // Forms
    document.querySelectorAll('form').forEach((form, i) => {
      if (i < 10) {
        state.forms.push({
          action: form.action || '',
          method: form.method || 'get',
          selector: buildSelector(form),
          inputCount: form.querySelectorAll('input, textarea, select').length
        });
      }
    });

    // Images (top 20)
    document.querySelectorAll('img[src]').forEach((img, i) => {
      if (i < 20) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
          state.images.push({
            alt: (img.alt || '').substring(0, 100),
            src: img.src,
            selector: buildSelector(img)
          });
        }
      }
    });

    // Tables (top 5)
    document.querySelectorAll('table').forEach((table, i) => {
      if (i < 5) {
        const rows = table.querySelectorAll('tr');
        const headers = [];
        const firstRow = table.querySelector('tr');
        if (firstRow) {
          firstRow.querySelectorAll('th, td').forEach(cell => {
            headers.push(cell.textContent.trim().substring(0, 50));
          });
        }
        state.tables.push({
          selector: buildSelector(table),
          headers,
          rowCount: rows.length
        });
      }
    });

    return state;
  }

  // ============================================
  // Action Executors
  // ============================================
  function executeClick(params) {
    const elements = findElements(params.selector, params.text);
    const index = params.index || 0;

    if (!elements || elements.length === 0) {
      return { success: false, error: `No element found for: ${params.selector}${params.text ? ` (text: "${params.text}")` : ''}` };
    }

    if (index >= elements.length) {
      return { success: false, error: `Index ${index} out of range (found ${elements.length} elements)` };
    }

    const el = elements[index];
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Dispatch realistic events
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();

    return {
      success: true,
      clicked: {
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 100),
        selector: buildSelector(el)
      }
    };
  }

  function executeType(params) {
    const el = document.querySelector(params.selector);
    if (!el) {
      return { success: false, error: `Input not found: ${params.selector}` };
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();

    if (params.clear) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Type character by character for realistic behavior
    const text = params.text || '';
    el.value = params.clear ? text : el.value + text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    if (params.pressEnter) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      // Also try submitting the parent form
      const form = el.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true }));
      }
    }

    return { success: true, typed: text.substring(0, 100), into: buildSelector(el) };
  }

  function executeScroll(params) {
    const direction = params.direction || 'down';
    const amount = Math.min(params.amount || 500, 5000);
    const scrollY = direction === 'down' ? amount : -amount;

    window.scrollBy({ top: scrollY, behavior: 'smooth' });

    return {
      success: true,
      scrolledTo: window.scrollY + scrollY,
      pageHeight: document.body.scrollHeight,
      viewportHeight: window.innerHeight,
      atBottom: (window.scrollY + window.innerHeight + amount) >= document.body.scrollHeight
    };
  }

  function executeSelect(params) {
    const el = document.querySelector(params.selector);
    if (!el || el.tagName !== 'SELECT') {
      return { success: false, error: `Select element not found: ${params.selector}` };
    }

    // Try matching by value first, then by text
    let found = false;
    for (const option of el.options) {
      if (option.value === params.value || option.textContent.trim() === params.value) {
        el.value = option.value;
        found = true;
        break;
      }
    }

    if (!found) {
      return { success: false, error: `Option "${params.value}" not found in select` };
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { success: true, selected: params.value };
  }

  function executePressKey(params) {
    const key = params.key || 'Enter';
    const activeEl = document.activeElement || document.body;

    const keyMap = {
      'Enter': 13, 'Tab': 9, 'Escape': 27, 'Backspace': 8,
      'ArrowDown': 40, 'ArrowUp': 38, 'ArrowLeft': 37, 'ArrowRight': 39,
      'Space': 32, 'Delete': 46, 'Home': 36, 'End': 35
    };

    const keyCode = keyMap[key] || 0;
    activeEl.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode, bubbles: true }));
    activeEl.dispatchEvent(new KeyboardEvent('keypress', { key, code: key, keyCode, bubbles: true }));
    activeEl.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, keyCode, bubbles: true }));

    return { success: true, key, target: buildSelector(activeEl) };
  }

  function executeHover(params) {
    const elements = findElements(params.selector, params.text);
    if (!elements || elements.length === 0) {
      return { success: false, error: `No element found for: ${params.selector}` };
    }
    const el = elements[params.index || 0];
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.dispatchEvent(new MouseEvent('mousemove', opts));
    return { success: true, hovered: buildSelector(el) };
  }

  // Upload a user-staged file into a file input.
  // params: { selector, fileRef, index? }
  function executeUploadFile(params) {
    return new Promise((resolve) => {
      try {
        const elements = findElements(params.selector);
        if (!elements || elements.length === 0) {
          return resolve({ success: false, error: `No file input found: ${params.selector}` });
        }
        const input = elements[params.index || 0];
        if (!input || input.tagName !== 'INPUT' || input.type !== 'file') {
          return resolve({ success: false, error: `Element is not a file input: ${params.selector}` });
        }

        chrome.runtime.sendMessage({ type: 'ge-get-staged-file', ref: params.fileRef }, async (resp) => {
          if (!resp || !resp.success) {
            return resolve({ success: false, error: resp?.error || 'Failed to load staged file' });
          }
          try {
            const { name, mimeType, dataUrl } = resp.file;
            // Convert dataUrl to a File object
            const fetchRes = await fetch(dataUrl);
            const blob = await fetchRes.blob();
            const file = new File([blob], name || 'upload', { type: mimeType || blob.type || 'application/octet-stream' });

            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;

            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            resolve({ success: true, uploaded: { name: file.name, size: file.size, type: file.type, into: buildSelector(input) } });
          } catch (err) {
            resolve({ success: false, error: 'Failed to attach file: ' + err.message });
          }
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  function executeClear(params) {
    const el = document.querySelector(params.selector);
    if (!el) {
      return { success: false, error: `Element not found: ${params.selector}` };
    }
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, cleared: buildSelector(el) };
  }

  function executeExtract(params) {
    const items = document.querySelectorAll(params.items);
    if (!items || items.length === 0) {
      return { success: false, error: `No items found for: ${params.items}`, data: [] };
    }

    const limit = Math.min(params.limit || 50, 200);
    const data = [];

    items.forEach((item, i) => {
      if (i >= limit) return;
      const entry = {};

      for (const [fieldName, selector] of Object.entries(params.fields || {})) {
        // Support "selector|attribute" syntax
        const parts = selector.split('|');
        const sel = parts[0];
        const attr = parts[1];

        const fieldEl = item.querySelector(sel);
        if (fieldEl) {
          entry[fieldName] = attr ? (fieldEl.getAttribute(attr) || '') : fieldEl.textContent.trim();
        } else {
          entry[fieldName] = '';
        }
      }

      data.push(entry);
    });

    return { success: true, count: data.length, total: items.length, data };
  }

  function executeWaitForElement(params) {
    return new Promise((resolve) => {
      const selector = params.selector;
      const timeout = Math.min(params.timeout || 10000, 30000);

      const existing = document.querySelector(selector);
      if (existing) {
        return resolve({ success: true, found: true, selector });
      }

      const observer = new MutationObserver((mutations, obs) => {
        const found = document.querySelector(selector);
        if (found) {
          obs.disconnect();
          resolve({ success: true, found: true, selector });
        }
      });

      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve({ success: false, found: false, error: `Element not found after ${timeout}ms: ${selector}` });
      }, timeout);
    });
  }

  // ============================================
  // Helper Functions
  // ============================================
  function buildSelector(el) {
    if (!el || !el.tagName) return '';
    if (el.id) return `#${el.id}`;

    const tag = el.tagName.toLowerCase();

    // Try data-testid or aria-label
    if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
    if (el.getAttribute('aria-label')) return `[aria-label="${el.getAttribute('aria-label')}"]`;
    if (el.name) return `${tag}[name="${el.name}"]`;

    // Class-based selector
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).slice(0, 3).join('.');
      if (classes) return `${tag}.${classes}`;
    }

    return tag;
  }

  // Pierce shadow roots and same-origin iframes when looking for elements.
  // Returns Array<Element>. Falls back gracefully if shadow DOM not present.
  function deepQuerySelectorAll(selector, root) {
    const results = [];
    const seen = new Set();
    function visit(node) {
      if (!node || seen.has(node)) return;
      seen.add(node);
      try {
        const matches = node.querySelectorAll ? node.querySelectorAll(selector) : [];
        for (const m of matches) results.push(m);
      } catch (e) { /* ignore invalid selector at this level */ }
      // Recurse into shadow roots
      const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const el of all) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
      // Recurse into same-origin iframes
      const iframes = node.querySelectorAll ? node.querySelectorAll('iframe') : [];
      for (const f of iframes) {
        try {
          const doc = f.contentDocument;
          if (doc) visit(doc);
        } catch (e) { /* cross-origin, skip */ }
      }
    }
    visit(root || document);
    return results;
  }

  function findElements(selector, text) {
    let elements = [];
    try {
      // Light path first — fast on large pages
      elements = Array.from(document.querySelectorAll(selector));
      if (elements.length === 0) {
        // Fallback to deep search across shadow DOM / iframes
        elements = deepQuerySelectorAll(selector, document);
      }
    } catch (e) {
      console.warn('[Global Executive] Invalid selector:', selector);
      return [];
    }

    if (text) {
      const needle = text.toLowerCase();
      elements = elements.filter(el =>
        (el.textContent || '').toLowerCase().includes(needle)
      );
    }

    return elements;
  }

  function getInputLabel(input) {
    // Check for associated label
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) return label.textContent.trim().substring(0, 100);
    }
    // Check parent label
    const parentLabel = input.closest('label');
    if (parentLabel) return parentLabel.textContent.trim().substring(0, 100);
    // Check aria-label
    return input.getAttribute('aria-label') || '';
  }

  // ============================================
  // Keep-alive port — the background service worker connects here while a
  // background-mode task is running so that the SW's idle timer keeps
  // getting reset by port-message activity. We just accept the connection
  // and ignore the heartbeat payload; its mere presence keeps the SW alive.
  // ============================================
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'ge-bg-keepalive') return;
    port.onMessage.addListener(() => { /* heartbeat — no-op */ });
    port.onDisconnect.addListener(() => { /* SW will reopen if still running */ });
  });

  // ============================================
  // Message Handler — receives commands from background.js
  // ============================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ge-ping') {
      sendResponse({ pong: true, agentRuntime: true });
      return;
    }

    if (message.type !== 'ge-action') return;

    const { action, params } = message;

    (async () => {
      try {
        let result;
        switch (action) {
          case 'readPage':
            result = readPageState();
            break;
          case 'click':
            result = executeClick(params);
            break;
          case 'type':
            result = executeType(params);
            break;
          case 'scroll':
            result = executeScroll(params);
            break;
          case 'select':
            result = executeSelect(params);
            break;
          case 'pressKey':
            result = executePressKey(params);
            break;
          case 'clear':
            result = executeClear(params);
            break;
          case 'extract':
            result = executeExtract(params);
            break;
          case 'waitForElement':
            result = await executeWaitForElement(params);
            break;
          case 'hover':
            result = executeHover(params);
            break;
          case 'uploadFile':
            result = await executeUploadFile(params);
            break;
          default:
            result = { success: false, error: `Unknown action: ${action}` };
        }
        sendResponse({ success: true, result });
      } catch (err) {
        console.error('[Global Executive] Action error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true; // Keep channel open for async response
  });

})();
