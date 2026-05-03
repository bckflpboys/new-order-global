// Global Executive — Agent Runtime
// Injected into target tabs to read DOM state and execute browser actions
// Communicates with background.js via chrome.runtime messages

(function () {
  'use strict';

  if (window.__geAgentLoaded) return;
  window.__geAgentLoaded = true;

  console.log('[Global Executive] Agent Runtime loaded');

  // ============================================
  // DOM mutation tracker — used by readPage to flag SPAs that are still
  // rendering, and by executeClick to verify a click had ANY effect on the
  // DOM even when no navigation happened.
  // ============================================
  let __geMutationCount = 0;
  let __geLastMutationAt = 0;
  try {
    const __obs = new MutationObserver((muts) => {
      __geMutationCount += muts.length;
      __geLastMutationAt = Date.now();
    });
    const startObs = () => {
      if (document.body) __obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      else setTimeout(startObs, 50);
    };
    startObs();
  } catch (e) { /* MutationObserver unavailable — non-fatal */ }
  function snapshotMutations() { return { count: __geMutationCount, lastAt: __geLastMutationAt }; }
  function mutationsSince(snap) {
    return Math.max(0, __geMutationCount - (snap?.count || 0));
  }
  // Wait `ms` and report how many mutations happened in that window.
  function awaitMutations(ms = 500) {
    return new Promise((resolve) => {
      const before = snapshotMutations();
      setTimeout(() => resolve(mutationsSince(before)), ms);
    });
  }

  // ============================================
  // Element health helpers — answer "why didn't my click work?" up-front.
  // ============================================
  function getElementHealth(el) {
    if (!el || !el.getBoundingClientRect) return { exists: false };
    const rect = el.getBoundingClientRect();
    const cs = (el.ownerDocument && el.ownerDocument.defaultView)
      ? el.ownerDocument.defaultView.getComputedStyle(el)
      : null;
    const hidden = !!(cs && (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0));
    const offscreen = (rect.width === 0 && rect.height === 0);
    const disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true');
    const pointerNone = !!(cs && cs.pointerEvents === 'none');
    // Detect if another element is on top of the centre point.
    let coveredBy = null;
    try {
      if (!hidden && !offscreen && rect.width > 0 && rect.height > 0) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const inViewport = cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight;
        if (inViewport) {
          const top = document.elementFromPoint(cx, cy);
          if (top && top !== el && !el.contains(top) && !top.contains(el)) {
            coveredBy = buildSelector(top);
          }
        }
      }
    } catch { /* best-effort */ }
    return {
      exists: true,
      visible: !hidden && !offscreen,
      hidden,
      offscreen,
      disabled,
      pointerNone,
      coveredBy,
      rect: { x: rect.left|0, y: rect.top|0, w: rect.width|0, h: rect.height|0 }
    };
  }

  // ============================================
  // Page State Reader
  // ============================================
  function readPageState() {
    // SPA / load-state hints — agent can use these to decide whether to
    // wait or proceed without guessing.
    const sinceMutation = __geLastMutationAt ? (Date.now() - __geLastMutationAt) : null;
    const stillMutating = sinceMutation !== null && sinceMutation < 600;
    const state = {
      url: location.href,
      pathname: location.pathname,
      title: document.title,
      readyState: document.readyState,
      // True if the DOM has mutated within the last ~600ms (page likely still rendering)
      loading: stillMutating || document.readyState !== 'complete',
      msSinceLastMutation: sinceMutation,
      mutationCount: __geMutationCount,
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

    // === Canvas / video / WebGL coverage ===
    // If the viewport is dominated by <canvas>/<video>/<iframe> (games, 3D
    // tours, Figma, Google Maps, YouTube fullscreen, WebGL editors), DOM
    // reading gives no signal. Flag it so the agent knows to `screenshot`
    // and use `clickAt`/`typeText` (coord-based debugger actions) instead.

    try {
      const vpW = innerWidth || 1, vpH = innerHeight || 1;
      const vpArea = vpW * vpH;
      let visualArea = 0;
      const visualEls = [];
      document.querySelectorAll('canvas, video, iframe[src], embed, object').forEach(el => {
        const r = el.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, vpW) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, vpH) - Math.max(r.top, 0));
        const a = w * h;
        if (a > 0) {
          visualArea += a;
          if (visualEls.length < 5) visualEls.push({ tag: el.tagName, w: w|0, h: h|0, ratio: +(a/vpArea).toFixed(2) });
        }
      });
      const ratio = visualArea / vpArea;
      const textLen = (state.visibleText || '').length;
      state.canvasCoverage = +ratio.toFixed(2);
      state.visualElements = visualEls;
      // Heuristic: >50% visual AND thin DOM text → probably a canvas/video app.
      state.renderingCanvasHeavy = ratio > 0.5 && textLen < 400;
      if (state.renderingCanvasHeavy) {
        state.hint = 'This page is dominated by canvas/video/iframe content with little DOM text. `readPage` cannot see what is rendered. Take a `screenshot` and use coord-based actions (`clickAt`, `doubleClickAt`, `typeText`, `pressKeyAt`, `scrollAt`, `dragAndDrop`) instead of `click`/`type`.';
      }
    } catch { /* best-effort */ }

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
  // Multi-strategy click. Accepts any of:
  //   selector, text, href, label, role, index, clickType
  // and falls back through strategies until it finds a candidate.
  async function executeClick(params) {
    const index = params.index || 0;
    const clickType = params.clickType || 'left';
    const elements = resolveClickCandidates(params);

    if (!elements || elements.length === 0) {
      const hints = [];
      if (params.selector) hints.push(`selector="${params.selector}"`);
      if (params.text) hints.push(`text~="${params.text}"`);
      if (params.href) hints.push(`href~="${params.href}"`);
      if (params.label) hints.push(`label~="${params.label}"`);
      if (params.role) hints.push(`role="${params.role}"`);
      return { success: false, reason: 'no_match', error: `No clickable element found for: ${hints.join(', ') || '<no targeting params>'}`, recovery: 'Try a different targeting strategy: text, label, href, or call readPage to see what is actually on screen.' };
    }

    if (index >= elements.length) {
      return { success: false, reason: 'index_out_of_range', error: `Index ${index} out of range (found ${elements.length} candidates)`, candidatesFound: elements.length };
    }

    const el = elements[index];
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    // Give the browser a tick to settle scroll-into-view.
    await new Promise(r => setTimeout(r, 80));

    // Pre-click health check — bail with a STRUCTURED reason so the agent
    // can pick a real recovery instead of retrying a doomed click.
    const health = getElementHealth(el);
    if (health.hidden || health.offscreen) {
      return { success: false, reason: 'hidden', error: 'Element exists but is hidden/offscreen.', health, recovery: 'Scroll to bring it into view, waitForElement to become visible, or close the modal that hides it.' };
    }
    if (health.disabled) {
      return { success: false, reason: 'disabled', error: 'Element is disabled.', health, recovery: 'A required field is probably empty/invalid. Fill prerequisites first; do not retry the click.' };
    }
    if (health.pointerNone) {
      return { success: false, reason: 'pointer_none', error: 'Element has pointer-events:none.', health, recovery: 'Click the parent or the actual handler — try targeting by text/label instead of this selector.' };
    }
    if (health.coveredBy) {
      return { success: false, reason: 'covered', error: `Element is covered by another element (${health.coveredBy}).`, health, recovery: 'Dismiss the overlay/modal/cookie-banner first, or click the covering element if it IS the intended target.' };
    }

    // Capture pre-click state so we can report what actually changed.
    const beforeUrl = location.href;
    const mutSnap = snapshotMutations();
    const isAnchor = el.tagName === 'A';
    const targetBlank = isAnchor && (el.getAttribute('target') === '_blank' || el.target === '_blank');
    const href = isAnchor ? el.href : null;

    // Dispatch realistic pointer + mouse events. Some sites listen for
    // pointerdown only, others for mousedown only — fire both.
    const fire = (type, init = {}) => {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: clickType === 'right' ? 2 : 0, ...init })); } catch {}
    };
    const firePointer = (type) => {
      try { el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse' })); } catch {}
    };

    fire('mouseover');
    fire('mouseenter');
    firePointer('pointerover');
    firePointer('pointerdown');
    fire('mousedown');
    firePointer('pointerup');
    fire('mouseup');

    if (clickType === 'right') {
      fire('contextmenu');
    } else if (clickType === 'double') {
      try { el.click(); } catch {}
      fire('click');
      try { el.click(); } catch {}
      fire('dblclick');
    } else {
      try { el.click(); } catch (e) { fire('click'); }
    }

    // Wait briefly and observe what actually changed.
    const domDelta = await awaitMutations(500);
    const afterUrl = location.href;
    const navigated = beforeUrl !== afterUrl;
    const tookEffect = navigated || targetBlank || domDelta > 0;

    return {
      success: tookEffect,
      reason: tookEffect ? undefined : 'no_effect',
      clicked: {
        tag: el.tagName,
        text: (el.textContent || '').trim().substring(0, 100),
        selector: buildSelector(el),
        href: href || undefined,
        candidatesFound: elements.length
      },
      navigated,
      beforeUrl,
      afterUrl,
      openedNewTab: !!targetBlank,
      domChangedWithin500ms: domDelta,
      health,
      hint: targetBlank
        ? 'target=_blank — content opened in a NEW tab. Use switchTab to interact; current tab is unchanged.'
        : (!tookEffect
            ? 'Click dispatched but produced NO navigation AND NO DOM mutation in 500ms. The handler likely did not fire. Try: a different selector (text/label/href), pressKey Enter on the focused element, or click the parent.'
            : (!navigated ? 'Page changed via JS (DOM mutated). Wait briefly then proceed; do NOT readPage twice in a row.' : undefined)),
      error: !tookEffect ? 'Click had no observable effect (no nav, no DOM change in 500ms).' : undefined
    };
  }

  // Resolve click candidates from any combination of selector / text / href /
  // label / role. Returns an array of Elements ranked by specificity.
  function resolveClickCandidates(params) {
    // 1) Explicit selector path (with optional text filter) — keeps prior behaviour.
    if (params.selector) {
      let els = findElements(params.selector, params.text);
      if (els.length) return els;
      // fall through to attribute-based fallbacks
    }

    const candidates = new Set();
    const pushAll = (list) => { for (const el of list) candidates.add(el); };

    // 2) href substring — anchors only.
    if (params.href) {
      const needle = String(params.href).toLowerCase();
      pushAll(Array.from(document.querySelectorAll('a[href]')).filter(a =>
        (a.getAttribute('href') || '').toLowerCase().includes(needle) ||
        (a.href || '').toLowerCase().includes(needle)
      ));
    }

    // 3) aria-label / title / name match.
    if (params.label) {
      const needle = String(params.label).toLowerCase();
      pushAll(Array.from(document.querySelectorAll('[aria-label], [title], [name]')).filter(el => {
        const a = (el.getAttribute('aria-label') || '').toLowerCase();
        const t = (el.getAttribute('title') || '').toLowerCase();
        const n = (el.getAttribute('name') || '').toLowerCase();
        return a.includes(needle) || t.includes(needle) || n.includes(needle);
      }));
    }

    // 4) role match (interactive only).
    if (params.role) {
      pushAll(document.querySelectorAll(`[role="${CSS.escape(params.role)}"]`));
    }

    // 5) text-only fallback — search anchors / buttons / [role=button] / [role=link] / [onclick].
    if (params.text) {
      const needle = String(params.text).toLowerCase();
      const interactive = document.querySelectorAll(
        'a, button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], [onclick]'
      );
      for (const el of interactive) {
        const txt = (el.textContent || '').trim().toLowerCase();
        const lab = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
        if (txt.includes(needle) || lab.includes(needle)) candidates.add(el);
      }
    }

    let arr = Array.from(candidates);

    // If multiple targeting params were combined, intersect by re-filtering.
    if (params.text && (params.href || params.label || params.role)) {
      const needle = String(params.text).toLowerCase();
      arr = arr.filter(el => ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || ''))
        .toLowerCase().includes(needle));
    }

    // Visible elements first (rough heuristic: has size + not display:none).
    arr.sort((a, b) => {
      const va = isLikelyVisible(a) ? 0 : 1;
      const vb = isLikelyVisible(b) ? 0 : 1;
      return va - vb;
    });

    return arr;
  }

  function isLikelyVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = (el.ownerDocument && el.ownerDocument.defaultView)
      ? el.ownerDocument.defaultView.getComputedStyle(el)
      : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0)) return false;
    return true;
  }

  // React-friendly value setter: bypasses React's synthetic-event guard so
  // controlled inputs actually pick up the new value.
  function setNativeValue(el, value) {
    try {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) { desc.set.call(el, value); return; }
    } catch { /* fall through */ }
    el.value = value;
  }

  function executeType(params) {
    const els = findElements(params.selector);
    const el = els && els[params.index || 0];
    if (!el) {
      return { success: false, reason: 'no_match', error: `Input not found: ${params.selector}`, recovery: 'Use readPage to list inputs and pick a name/label-based selector. Try input[name="..."] or input[placeholder="..."].' };
    }
    const tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !el.isContentEditable) {
      return { success: false, reason: 'not_typable', error: `Element ${tag} is not a typable input.` };
    }
    const health = getElementHealth(el);
    if (health.hidden || health.offscreen) {
      return { success: false, reason: 'hidden', error: 'Input is hidden/offscreen.', health };
    }
    if (health.disabled || el.readOnly) {
      return { success: false, reason: 'disabled', error: 'Input is disabled or readonly.', health, recovery: 'A previous step probably needs to enable this field — fill prerequisites first.' };
    }

    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    try { el.focus(); } catch {}

    const text = params.text || '';
    if (el.isContentEditable) {
      if (params.clear) el.textContent = '';
      el.textContent = (params.clear ? text : (el.textContent || '') + text);
    } else {
      const newValue = params.clear ? text : (el.value || '') + text;
      // Fire beforeinput so React/Vue/lit-element listeners can intercept.
      try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' })); } catch {}
      setNativeValue(el, newValue);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    if (params.pressEnter) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      const form = el.closest && el.closest('form');
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
    }

    const finalValue = el.isContentEditable ? (el.textContent || '') : (el.value || '');
    const verified = finalValue.includes(text);
    return {
      success: verified,
      reason: verified ? undefined : 'value_not_set',
      typed: text.substring(0, 100),
      into: buildSelector(el),
      verified,
      currentValue: finalValue.substring(0, 200),
      recovery: verified ? undefined : 'The element rejected the value (custom input mask, controlled component blocking). Try clicking the input first, then pressKey for each character, OR use the keyboard simulation pattern.'
    };
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
    const els = findElements(params.selector);
    const el = els && els[params.index || 0];
    if (!el || el.tagName !== 'SELECT') {
      return { success: false, reason: 'no_match', error: `Select element not found: ${params.selector}` };
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
    const els = findElements(params.selector);
    const el = els && els[params.index || 0];
    if (!el) {
      return { success: false, reason: 'no_match', error: `Element not found: ${params.selector}` };
    }
    if (el.isContentEditable) el.textContent = '';
    else setNativeValue(el, '');
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

  // Wait for the DOM to be "quiet" — no mutations for `idleMs` in a row.
  // Resolves earlier than a blind `wait(5000)` on fast pages, and later on
  // slow SPAs. Returns { stable: true } on success, or { stable: false,
  // reason: 'timeout' } if `timeout` is hit first.
  function executeWaitForStable(params) {
    const idleMs = Math.min(Math.max(params?.idleMs || 500, 100), 10000);
    const timeout = Math.min(Math.max(params?.timeout || 8000, 500), 30000);
    const start = Date.now();
    return new Promise((resolve) => {
      let lastSeen = __geLastMutationAt || Date.now();
      const tick = () => {
        const now = Date.now();
        const sinceMut = now - (__geLastMutationAt || lastSeen);
        if (sinceMut >= idleMs) {
          return resolve({ success: true, stable: true, waitedMs: now - start, msSinceLastMutation: sinceMut });
        }
        if (now - start >= timeout) {
          return resolve({ success: false, stable: false, reason: 'timeout', waitedMs: now - start, msSinceLastMutation: sinceMut,
            recovery: 'Page is still mutating after timeout. Consider taking a `screenshot`, or proceed anyway if the key element is already visible.' });
        }
        setTimeout(tick, Math.min(200, idleMs / 2));
      };
      tick();
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
            result = await executeClick(params);
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
          case 'waitForStable':
            result = await executeWaitForStable(params);
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
