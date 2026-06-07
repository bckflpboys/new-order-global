// Global Executive — Agent Runtime
// Injected into target tabs to read DOM state and execute browser actions
// Communicates with background.js via chrome.runtime messages

(function () {
  'use strict';

  if (window[Symbol.for('_grt')]) return;
  window[Symbol.for('_grt')] = true;

  // ============================================
  // DOM mutation tracker — used by readPage to flag SPAs that are still
  // rendering, and by executeClick to verify a click had ANY effect on the
  // DOM even when no navigation happened.
  // ============================================
  let __geMutationCount = 0;
  let __geLastMutationAt = 0;

  // ============================================
  // Console tap — rolling buffer of the last 100 console messages so the
  // agent can diagnose JS errors, failed network calls (console.error from
  // most SPAs), etc. via `readConsole`. Patches console at injection time
  // so we capture everything from load forward. Original console behaviour
  // is preserved \u2014 we just wrap.
  // ============================================
  const __geConsoleBuffer = [];
  const __GE_CONSOLE_LIMIT = 100;
  try {
    const levels = ['log', 'info', 'warn', 'error', 'debug'];
    for (const level of levels) {
      const orig = console[level];
      if (typeof orig !== 'function') continue;
      console[level] = function(...args) {
        try {
          const msg = args.map(a => {
            if (a == null) return String(a);
            if (typeof a === 'string') return a;
            if (a instanceof Error) return (a.stack || a.message || String(a));
            try { return JSON.stringify(a); } catch { return String(a); }
          }).join(' ').slice(0, 2000);
          __geConsoleBuffer.push({ level, message: msg, at: Date.now() });
          if (__geConsoleBuffer.length > __GE_CONSOLE_LIMIT) __geConsoleBuffer.shift();
        } catch { /* never break user console */ }
        return orig.apply(this, args);
      };
    }
    // Also capture uncaught errors + unhandled rejections \u2014 invisible to
    // the agent otherwise.
    window.addEventListener('error', (e) => {
      try {
        __geConsoleBuffer.push({ level: 'error', message: `[uncaught] ${e.message} @ ${e.filename}:${e.lineno}`, at: Date.now() });
        if (__geConsoleBuffer.length > __GE_CONSOLE_LIMIT) __geConsoleBuffer.shift();
      } catch {}
    });
    window.addEventListener('unhandledrejection', (e) => {
      try {
        const r = e.reason;
        const msg = (r && (r.stack || r.message)) || String(r);
        __geConsoleBuffer.push({ level: 'error', message: `[unhandledrejection] ${msg}`.slice(0, 2000), at: Date.now() });
        if (__geConsoleBuffer.length > __GE_CONSOLE_LIMIT) __geConsoleBuffer.shift();
      } catch {}
    });
  } catch { /* console patch failed \u2014 non-fatal */ }

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
      // Deterministic signal: page is fully loaded AND idle for ≥600ms.
      // Callers (server, macros) should prefer this over inferring from
      // the loading/readyState/msSinceLastMutation triple.
      pageLoadComplete: document.readyState === 'complete' && !stillMutating,
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

    // Helper: viewport intersection check — agents should prefer
    // in-viewport targets first to skip pre-scroll round-trips.
    const vpW = innerWidth || 1, vpH = innerHeight || 1;
    const inViewport = (rect) => rect.bottom > 0 && rect.right > 0 && rect.top < vpH && rect.left < vpW;

    // === Build a form index up front ===
    // Pre-collect forms so we can stamp `formIndex` onto every input/button
    // we record. This is THE highest-leverage change for login / search /
    // checkout flows: the agent sees "input #3 belongs to form #0 (the
    // login form)" without having to cross-reference selectors manually.
    const allForms = Array.from(document.querySelectorAll('form')).slice(0, 10);
    const formIndexOf = (el) => {
      try {
        const f = el.closest && el.closest('form');
        if (!f) return -1;
        const idx = allForms.indexOf(f);
        return idx;
      } catch { return -1; }
    };

    // Links (top 50)
    document.querySelectorAll('a[href]').forEach((a, i) => {
      if (i < 50) {
        const rect = a.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          state.links.push({
            text: a.textContent.trim().substring(0, 100),
            href: a.href,
            selector: buildSelector(a),
            inViewport: inViewport(rect),
            target: a.target || undefined
          });
        }
      }
    });

    // Buttons (top 30)
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((btn, i) => {
      if (i < 30) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const fi = formIndexOf(btn);
          state.buttons.push({
            text: (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').trim().substring(0, 100),
            selector: buildSelector(btn),
            type: btn.type || 'button',
            disabled: !!btn.disabled,
            inViewport: inViewport(rect),
            formIndex: fi >= 0 ? fi : undefined
          });
        }
      }
    });

    // Inputs (top 30) — now with interactability + form linkage so the
    // agent never burns a step typing into a disabled / hidden / wrong-form
    // field.
    document.querySelectorAll('input, textarea, select').forEach((inp, i) => {
      if (i < 30) {
        const rect = (inp.getBoundingClientRect && inp.getBoundingClientRect()) || { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
        const isHidden = (inp.type === 'hidden') || (rect.width === 0 && rect.height === 0);
        const fi = formIndexOf(inp);
        state.inputs.push({
          type: inp.type || inp.tagName.toLowerCase(),
          name: inp.name || '',
          placeholder: inp.placeholder || '',
          value: inp.type === 'password' ? '***' : (inp.value || '').substring(0, 200),
          selector: buildSelector(inp),
          label: getInputLabel(inp),
          disabled: !!inp.disabled,
          required: !!inp.required,
          readonly: !!inp.readOnly,
          inViewport: !isHidden && inViewport(rect),
          hidden: isHidden,
          formIndex: fi >= 0 ? fi : undefined
        });
      }
    });

    // Forms — nest field/button selectors so login + search + checkout
    // forms are visible holistically. The agent can do `extract` on the
    // form, or `type` into form.fields[i].selector, without joining tables.
    allForms.forEach((form, i) => {
      const fields = [];
      const buttons = [];
      try {
        form.querySelectorAll('input, textarea, select').forEach((inp, j) => {
          if (j >= 20) return;
          const t = (inp.type || inp.tagName.toLowerCase()).toLowerCase();
          if (t === 'hidden') return;
          fields.push({
            type: t,
            name: inp.name || '',
            label: getInputLabel(inp),
            placeholder: inp.placeholder || '',
            required: !!inp.required,
            disabled: !!inp.disabled,
            selector: buildSelector(inp)
          });
        });
        form.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach((btn, j) => {
          if (j >= 5) return;
          buttons.push({
            text: (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').trim().substring(0, 80),
            type: btn.type || 'button',
            disabled: !!btn.disabled,
            selector: buildSelector(btn)
          });
        });
      } catch { /* best effort */ }
      state.forms.push({
        formIndex: i,
        action: form.action || '',
        method: form.method || 'get',
        selector: buildSelector(form),
        name: form.name || form.id || '',
        inputCount: fields.length,
        fields,
        buttons
      });
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

    // === Content signature for server-side diffing ===
    // Compact fingerprint of the page's interactive surface + dynamic
    // state. The server uses this to detect "same page" (skip re-sending
    // full DOM to the LLM \u2014 big token win) and to compute deltas.
    //
    // Must capture EVERY signal the agent needs for correct decisions:
    //   \u2022 URL (full, including query/hash) \u2014 ?tab=A vs ?tab=B matters
    //   \u2022 Interactive elements (buttons, links, inputs, headings)
    //   \u2022 Form input VALUES (masked if password) \u2014 typing changes state
    //   \u2022 Alerts / toasts / modals / role=alert \u2014 error banners etc.
    // Not cryptographic; FNV-1a is fine for change detection.
    try {
      const parts = [location.href];  // full URL, not just pathname

      for (const b of state.buttons) parts.push('B:' + (b.selector || '') + '|' + (b.text || '').slice(0, 40));
      for (const l of state.links) parts.push('L:' + (l.href || '').slice(0, 120) + '|' + (l.text || '').slice(0, 40));
      for (const h of state.headings) parts.push('H:' + h.tag + '|' + (h.text || '').slice(0, 60));

      // Inputs: include value so typed state is reflected in the hash.
      // Mask password / hidden values so we never leak secrets into the
      // signature (it is stored on the task document server-side).
      for (const i of state.inputs) {
        let v = '';
        try {
          if (i.type === 'password' || i.type === 'hidden') {
            v = i.selector ? (document.querySelector(i.selector)?.value ? '***' : '') : '';
          } else if (i.selector) {
            const el = document.querySelector(i.selector);
            const raw = el ? (el.value != null ? String(el.value) : (el.checked ? 'on' : '')) : '';
            v = raw.slice(0, 60);
          }
        } catch { /* selector could be malformed */ }
        parts.push('I:' + (i.selector || '') + '|' + (i.name || '') + '|' + (i.type || '') + '|' + v);
      }

      // Alerts / toasts / modals / errors \u2014 any of these appearing MUST
      // change the hash even if the rest of the page is identical.
      try {
        const alertEls = document.querySelectorAll(
          '[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"], ' +
          '.alert, .error, .errorMessage, .error-message, .toast, .notification, ' +
          '[role="dialog"], [role="alertdialog"], dialog[open]'
        );
        let alertIdx = 0;
        for (const el of alertEls) {
          if (alertIdx >= 10) break;
          const r = el.getBoundingClientRect();
          if (r.width < 5 || r.height < 5) continue; // ignore hidden
          const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
          if (!txt) continue;
          parts.push('A:' + (el.getAttribute('role') || el.tagName.toLowerCase()) + '|' + txt);
          alertIdx++;
        }
      } catch { /* best-effort */ }

      const sig = parts.join('\n');
      // FNV-1a 32-bit
      let hh = 0x811c9dc5;
      for (let i = 0; i < sig.length; i++) {
        hh ^= sig.charCodeAt(i);
        hh = (hh + ((hh << 1) + (hh << 4) + (hh << 7) + (hh << 8) + (hh << 24))) >>> 0;
      }
      state.contentHash = 'h' + hh.toString(16);
      state.signature = sig.length > 4000 ? sig.slice(0, 4000) : sig;
      // Element counts for server-side collision guard: if hash matches
      // but counts differ, it's a hash collision, not a true match.
      state.elementCounts = {
        buttons: state.buttons.length,
        links: state.links.length,
        inputs: state.inputs.length,
        headings: state.headings.length
      };
    } catch { /* best-effort */ }

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
    // Only scroll if element is not already in viewport
    const _elR = el.getBoundingClientRect();
    const _elInVP = _elR.top >= 0 && _elR.left >= 0 &&
                    _elR.bottom <= innerHeight && _elR.right <= innerWidth &&
                    _elR.width > 0 && _elR.height > 0;
    if (!_elInVP) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
    }

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

    // Dispatch realistic pointer + mouse events with coordinates and timing.
    const _cRect = el.getBoundingClientRect();
    const _cx = _cRect.left + _cRect.width / 2 + (Math.random() * 6 - 3);
    const _cy = _cRect.top + _cRect.height / 2 + (Math.random() * 6 - 3);
    const _mBase = { clientX: _cx, clientY: _cy, screenX: _cx, screenY: _cy };
    const fire = (type, init = {}) => {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: clickType === 'right' ? 2 : 0, ..._mBase, ...init })); } catch {}
    };
    const firePointer = (type) => {
      try { el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse', ..._mBase })); } catch {}
    };

    fire('mouseover');
    fire('mouseenter');
    firePointer('pointerover');
    // Human-like pre-click pause
    await new Promise(r => setTimeout(r, 10 + Math.random() * 25));
    firePointer('pointerdown');
    fire('mousedown');
    // Human-like press-to-release gap (40–120ms)
    await new Promise(r => setTimeout(r, 40 + Math.random() * 80));
    firePointer('pointerup');
    fire('mouseup');

    if (clickType === 'right') {
      fire('contextmenu');
    } else if (clickType === 'double') {
      try { el.click(); } catch {}
      fire('click');
      await new Promise(r => setTimeout(r, 40 + Math.random() * 60));
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

  // Resolve type-target candidates from any combination of selector / name /
  // label / placeholder. Returns an array of input/textarea/contenteditable
  // elements ranked by visibility. The cascade only runs as a FALLBACK —
  // the explicit `selector` path is tried first to preserve prior behaviour.
  function resolveTypeCandidates(params) {
    // 1) Explicit selector first — keeps prior behaviour for callers that
    //    already supplied a working selector.
    if (params.selector) {
      const els = findElements(params.selector);
      if (els && els.length) return els;
      // fall through to attribute fallbacks
    }

    const seen = new Set();
    const candidates = [];
    const push = (el) => {
      if (!el || seen.has(el)) return;
      const tag = el.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !el.isContentEditable) return;
      // Skip checkbox / radio / hidden / submit / button input subtypes —
      // those aren't typable.
      if (tag === 'INPUT') {
        const t = (el.type || 'text').toLowerCase();
        if (['checkbox','radio','hidden','submit','button','reset','file','image','range','color'].includes(t)) return;
      }
      seen.add(el); candidates.push(el);
    };

    // 2) name="..." (case-insensitive substring match — robust to LLM giving
    //    a fragment like "email" instead of the exact name attribute).
    if (params.name) {
      const needle = String(params.name).toLowerCase();
      for (const el of document.querySelectorAll('input[name], textarea[name]')) {
        if ((el.getAttribute('name') || '').toLowerCase().includes(needle)) push(el);
      }
    }

    // 3) label="..." — look up <label for=ID> + parent <label> wrapping +
    //    aria-label / aria-labelledby. Substring match because LLM-supplied
    //    labels often paraphrase ("Email" vs the actual "Email address").
    if (params.label) {
      const needle = String(params.label).toLowerCase();
      // (a) <label for="ID">
      for (const lab of document.querySelectorAll('label[for]')) {
        if ((lab.textContent || '').toLowerCase().includes(needle)) {
          const el = document.getElementById(lab.getAttribute('for'));
          if (el) push(el);
        }
      }
      // (b) <label> wrapping an input
      for (const lab of document.querySelectorAll('label')) {
        if ((lab.textContent || '').toLowerCase().includes(needle)) {
          const inputs = lab.querySelectorAll('input, textarea, [contenteditable]');
          for (const i of inputs) push(i);
        }
      }
      // (c) aria-label / aria-labelledby on the input itself
      for (const el of document.querySelectorAll('input[aria-label], textarea[aria-label], [contenteditable][aria-label]')) {
        if ((el.getAttribute('aria-label') || '').toLowerCase().includes(needle)) push(el);
      }
      for (const el of document.querySelectorAll('input[aria-labelledby], textarea[aria-labelledby]')) {
        const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        for (const id of ids) {
          const labEl = document.getElementById(id);
          if (labEl && (labEl.textContent || '').toLowerCase().includes(needle)) { push(el); break; }
        }
      }
    }

    // 4) placeholder="..." — substring match.
    if (params.placeholder) {
      const needle = String(params.placeholder).toLowerCase();
      for (const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
        if ((el.getAttribute('placeholder') || '').toLowerCase().includes(needle)) push(el);
      }
    }

    // Visible elements first.
    candidates.sort((a, b) => (isLikelyVisible(a) ? 0 : 1) - (isLikelyVisible(b) ? 0 : 1));
    return candidates;
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

  async function executeType(params) {
    // Multi-strategy input resolution. Same philosophy as resolveClickCandidates:
    // try the explicit `selector` first (preserves prior behaviour), then
    // cascade through `name` / `label` / `placeholder` so the LLM can target
    // an input the way a human reads the form (label text, placeholder
    // ghost text, or `name="email"` from page-state recall) without having
    // to guess a selector. The cascade only fires when `selector` returns
    // nothing — a matched-but-disabled / hidden input is a real failure
    // and gets reported with its structured `reason` below.
    const candidates = resolveTypeCandidates(params);
    const el = candidates && candidates[params.index || 0];
    if (!el) {
      const tried = [];
      if (params.selector)    tried.push(`selector="${params.selector}"`);
      if (params.name)        tried.push(`name="${params.name}"`);
      if (params.label)       tried.push(`label~="${params.label}"`);
      if (params.placeholder) tried.push(`placeholder~="${params.placeholder}"`);
      return {
        success: false,
        reason: 'no_match',
        error: `Input not found for: ${tried.join(', ') || '<no targeting params>'}`,
        recovery: 'Use readPage to list inputs and pick a name/label-based selector. You can also target by `label`, `name`, or `placeholder` directly — e.g. `{ "label": "Email" }` or `{ "placeholder": "Search..." }`.'
      };
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

    // Only scroll if element is not in viewport
    const _tR = el.getBoundingClientRect();
    const _tInVP = _tR.top >= 0 && _tR.left >= 0 &&
                   _tR.bottom <= innerHeight && _tR.right <= innerWidth &&
                   _tR.width > 0 && _tR.height > 0;
    if (!_tInVP) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    }
    // Focus via realistic click sequence instead of bare focus()
    try {
      const _fR = el.getBoundingClientRect();
      const _fx = _fR.left + _fR.width / 2 + (Math.random() * 4 - 2);
      const _fy = _fR.top + _fR.height / 2 + (Math.random() * 4 - 2);
      const _fB = { bubbles: true, cancelable: true, view: window, clientX: _fx, clientY: _fy };
      el.dispatchEvent(new PointerEvent('pointerdown', { ..._fB, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mousedown', _fB));
      el.focus();
      el.dispatchEvent(new PointerEvent('pointerup', { ..._fB, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mouseup', _fB));
      el.dispatchEvent(new MouseEvent('click', _fB));
    } catch { try { el.focus(); } catch {} }

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

  // ============================================
  // executeScrollUntil — scroll until a target is in the viewport
  // ============================================
  // Compresses the typical "scroll, readPage, scroll, readPage..." loop
  // into ONE round-trip. Targets by selector OR text; bounded by max
  // passes (default 8) so we never loop forever on infinite-scroll pages
  // that auto-load forever.
  //
  // Returns the same shape as `scroll` plus { found, target, passes,
  // scrolledTotal }. Agent should follow up with `click`/`extract` on
  // the target if found, or pivot if not.
  async function executeScrollUntil(params) {
    const direction = params.direction === 'up' ? 'up' : 'down';
    const stepAmount = Math.max(100, Math.min(parseInt(params.amount, 10) || 800, 4000));
    const passesReq = parseInt(params.maxPasses, 10);
    const maxPasses = Math.max(1, Math.min(Number.isFinite(passesReq) ? passesReq : 8, 20));
    const selector = params.selector || '';
    const text = (params.text || '').toLowerCase();
    const requireInteractable = !!params.interactable;

    if (!selector && !text) {
      return { success: false, reason: 'invalid_params', error: 'scrollUntil requires either `selector` or `text`.' };
    }

    const vpW = innerWidth || 1, vpH = innerHeight || 1;
    const inVP = (rect) => rect && rect.bottom > 0 && rect.right > 0 && rect.top < vpH && rect.left < vpW && rect.width > 0 && rect.height > 0;

    const findTarget = () => {
      // Selector path first.
      if (selector) {
        try {
          const els = findElements(selector, text || undefined);
          for (const el of (els || [])) {
            const r = el.getBoundingClientRect();
            if (inVP(r)) return el;
          }
        } catch { /* malformed selector — fall through */ }
      }
      // Text-only path: search interactive + text-ish elements.
      if (text) {
        const haystack = document.querySelectorAll('a, button, [role="button"], h1, h2, h3, h4, p, li, span, div');
        for (const el of haystack) {
          const t = (el.textContent || '').trim().toLowerCase();
          if (!t || !t.includes(text)) continue;
          const r = el.getBoundingClientRect();
          if (inVP(r)) return el;
        }
      }
      return null;
    };

    // Pass 0 — element already in view?
    let target = findTarget();
    if (target) {
      return {
        success: true,
        found: true,
        passes: 0,
        scrolledTotal: 0,
        target: { selector: buildSelector(target), tag: target.tagName, text: (target.textContent || '').trim().substring(0, 100) }
      };
    }

    let scrolled = 0;
    let lastScrollY = window.scrollY;
    let stuckCount = 0;
    for (let pass = 1; pass <= maxPasses; pass++) {
      const dy = direction === 'down' ? stepAmount : -stepAmount;
      window.scrollBy({ top: dy, behavior: 'instant' in window.scrollBy ? 'instant' : 'auto' });
      // Allow lazy-loaded content + intersection observers to fire.
      await new Promise(r => setTimeout(r, 350));
      scrolled += stepAmount;
      target = findTarget();
      if (target) {
        try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
        await new Promise(r => setTimeout(r, 150));
        const r2 = target.getBoundingClientRect();
        const interactable = !target.disabled && getComputedStyle(target).pointerEvents !== 'none';
        if (requireInteractable && !interactable) {
          return {
            success: false,
            found: true,
            interactable: false,
            reason: 'found_but_not_interactable',
            passes: pass,
            scrolledTotal: scrolled,
            target: { selector: buildSelector(target), tag: target.tagName, text: (target.textContent || '').trim().substring(0, 100) },
            recovery: 'Element is on screen but disabled / pointer-events:none. A prerequisite is probably unmet.'
          };
        }
        return {
          success: true,
          found: true,
          interactable,
          passes: pass,
          scrolledTotal: scrolled,
          target: { selector: buildSelector(target), tag: target.tagName, text: (target.textContent || '').trim().substring(0, 100), inViewport: inVP(r2) }
        };
      }
      // Detect "scroll didn't move" (already at end of page).
      if (Math.abs(window.scrollY - lastScrollY) < 5) {
        stuckCount++;
        if (stuckCount >= 2) {
          return {
            success: false,
            found: false,
            reason: 'reached_page_end',
            passes: pass,
            scrolledTotal: scrolled,
            atEnd: true,
            recovery: 'Reached the end of the scrollable region without finding the target. Try a different selector/text, scroll up if you went too far, or fetch the next page if this is paginated.'
          };
        }
      } else {
        stuckCount = 0;
      }
      lastScrollY = window.scrollY;
    }

    return {
      success: false,
      found: false,
      reason: 'max_passes_reached',
      passes: maxPasses,
      scrolledTotal: scrolled,
      recovery: 'Did not find the target within the pass budget. The element may not exist on this page — `readPage` to confirm, or refine the selector/text.'
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

  // Upload a file into a file input. Source priority:
  //   1. params.fileUrl  \u2014 a signed URL the server injected (e.g. when
  //      `fileRef` was a captured-file id like "cap_a1b2c3"). Fetched
  //      directly here without round-tripping through the SW.
  //   2. params.fileRef  \u2014 a key into the user's staged briefing files.
  //      Looked up via the SW message bus the original implementation used.
  // params: { selector, fileRef?, fileUrl?, fileMime?, fileName?, index? }
  async function executeUploadFile(params) {
    try {
      const elements = findElements(params.selector);
      if (!elements || elements.length === 0) {
        return { success: false, error: `No file input found: ${params.selector}` };
      }
      const input = elements[params.index || 0];
      if (!input || input.tagName !== 'INPUT' || input.type !== 'file') {
        return { success: false, error: `Element is not a file input: ${params.selector}` };
      }

      let blob, name, mimeType;

      if (params.fileUrl && /^https?:\/\//i.test(params.fileUrl)) {
        // Path 1: server-injected signed URL (captured file).
        try {
          const resp = await fetch(params.fileUrl);
          if (!resp.ok) {
            return { success: false, error: `Failed to fetch fileUrl: HTTP ${resp.status}`,
              recovery: 'The signed URL may have expired. Have the agent retry \u2014 the server refreshes URLs on each step.' };
          }
          blob = await resp.blob();
          mimeType = params.fileMime || blob.type || 'application/octet-stream';
          name = params.fileName || (params.fileRef || 'upload');
        } catch (e) {
          return { success: false, error: 'Failed to fetch fileUrl: ' + e.message };
        }
      } else {
        // Path 2: legacy staged-file lookup via SW.
        const resp = await new Promise((r) => {
          chrome.runtime.sendMessage({ type: 'ge-get-staged-file', ref: params.fileRef }, r);
        });
        if (!resp || !resp.success) {
          return { success: false, error: resp?.error || 'Failed to load staged file' };
        }
        try {
          const fetchRes = await fetch(resp.file.dataUrl);
          blob = await fetchRes.blob();
          name = resp.file.name;
          mimeType = resp.file.mimeType || blob.type || 'application/octet-stream';
        } catch (e) {
          return { success: false, error: 'Failed to decode staged file: ' + e.message };
        }
      }

      const file = new File([blob], name || 'upload', { type: mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      return {
        success: true,
        uploaded: { name: file.name, size: file.size, type: file.type, into: buildSelector(input) },
        source: params.fileUrl ? 'capturedFile' : 'briefing'
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
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

  // Conditional wait: poll every 500 ms until ANY (or ALL) listed
  // conditions are satisfied, or timeout. Supported condition keys:
  //   urlContains, urlMatches, elementVisible, elementGone, textVisible,
  //   downloadComplete { id | filenameContains | urlContains },
  //   networkIdle (ms of no DOM mutations \u2014 lightweight proxy).
  async function executeWaitUntil(params) {
    const conditions = Array.isArray(params?.conditions) ? params.conditions : [];
    if (!conditions.length) {
      return { success: false, reason: 'no_conditions', error: 'waitUntil requires at least one condition.' };
    }
    const mode = params.mode === 'all' ? 'all' : 'any';
    const timeout = Math.min(Math.max(parseInt(params.timeout, 10) || 15000, 500), 60000);
    const start = Date.now();

    const isElVisible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return false;
      return true;
    };

    const checkDownload = (spec) =>
      new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'ge-check-download', spec }, (resp) => resolve(resp || { matched: false }));
        } catch { resolve({ matched: false }); }
      });

    async function evalOne(cond) {
      if (!cond || typeof cond !== 'object') return { ok: false };

      if (typeof cond.urlContains === 'string') {
        return { ok: window.location.href.indexOf(cond.urlContains) !== -1, label: `urlContains:${cond.urlContains}`, context: { currentUrl: window.location.href } };
      }
      if (typeof cond.urlMatches === 'string') {
        try {
          const re = new RegExp(cond.urlMatches);
          return { ok: re.test(window.location.href), label: `urlMatches:${cond.urlMatches}`, context: { currentUrl: window.location.href } };
        } catch { return { ok: false, error: 'bad_regex' }; }
      }
      if (typeof cond.elementVisible === 'string') {
        const el = document.querySelector(cond.elementVisible);
        return { ok: !!(el && isElVisible(el)), label: `elementVisible:${cond.elementVisible}` };
      }
      if (typeof cond.elementGone === 'string') {
        const el = document.querySelector(cond.elementGone);
        return { ok: !el || !isElVisible(el), label: `elementGone:${cond.elementGone}` };
      }
      if (typeof cond.textVisible === 'string') {
        const needle = cond.textVisible.toLowerCase();
        const hay = (document.body?.innerText || '').toLowerCase();
        return { ok: hay.indexOf(needle) !== -1, label: `textVisible:${cond.textVisible.slice(0, 60)}` };
      }
      if (cond.downloadComplete) {
        const r = await checkDownload(cond.downloadComplete);
        return { ok: !!r.matched, label: 'downloadComplete', context: { matchedDownload: r.download || null } };
      }
      if (typeof cond.networkIdle === 'number') {
        const idleMs = Math.max(250, Math.min(cond.networkIdle, 10000));
        const sinceMut = Date.now() - (__geLastMutationAt || 0);
        return { ok: sinceMut >= idleMs, label: `networkIdle:${idleMs}`, context: { msSinceLastMutation: sinceMut } };
      }
      return { ok: false, error: 'unknown_condition_shape' };
    }

    while (true) {
      const evals = [];
      for (const c of conditions) {
        const r = await evalOne(c);
        evals.push(r);
      }
      const satisfied = mode === 'all'
        ? evals.every(e => e.ok)
        : evals.some(e => e.ok);
      if (satisfied) {
        const first = mode === 'all' ? evals[0] : evals.find(e => e.ok);
        const merged = Object.assign({}, ...evals.map(e => e.context || {}));
        return {
          success: true,
          conditionMet: first?.label || 'satisfied',
          mode,
          waited: Date.now() - start,
          context: merged,
          evaluated: evals.map(e => ({ label: e.label, ok: e.ok }))
        };
      }
      if (Date.now() - start >= timeout) {
        return {
          success: false,
          reason: 'timeout',
          mode,
          waited: Date.now() - start,
          evaluated: evals.map(e => ({ label: e.label, ok: e.ok })),
          recovery: 'None of the conditions became true in time. Either extend the timeout, verify the condition spec matches what the page shows, or take a `screenshot` + `readPage` to re-orient.'
        };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
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
      // Invalid selector — silent fail
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
  // readConsole \u2014 Return recent tapped console messages (log/info/warn/
  // error/debug + uncaught errors + unhandled rejections) so the agent
  // can diagnose JS-level problems without F12.
  //
  // Params:
  //   level?: 'all' | 'error' | 'warn' | 'info' | 'log' | 'debug'  (default 'all')
  //   limit?: number  1..100  (default 30)
  //   sinceMs?: number  only return messages newer than Date.now() - sinceMs
  //   grep?: string  only return messages whose text contains this (case-insensitive)
  // ============================================
  function executeReadConsole(params) {
    const p = params || {};
    const limit = Math.min(Math.max(1, Math.floor(p.limit || 30)), 100);
    const cutoff = p.sinceMs ? (Date.now() - Math.max(0, p.sinceMs)) : 0;
    const lvl = (p.level || 'all').toLowerCase();
    const grep = (p.grep || '').toLowerCase();
    let items = __geConsoleBuffer;
    if (lvl !== 'all') items = items.filter(m => m.level === lvl);
    if (cutoff) items = items.filter(m => m.at >= cutoff);
    if (grep) items = items.filter(m => m.message.toLowerCase().includes(grep));
    items = items.slice(-limit);
    const counts = { log: 0, info: 0, warn: 0, error: 0, debug: 0 };
    for (const m of __geConsoleBuffer) counts[m.level] = (counts[m.level] || 0) + 1;
    return {
      success: true,
      messages: items.map(m => ({
        level: m.level,
        message: m.message,
        ageMs: Date.now() - m.at
      })),
      returned: items.length,
      totalBuffered: __geConsoleBuffer.length,
      countsByLevel: counts,
      hint: counts.error > 0 && lvl === 'all'
        ? `There are ${counts.error} error(s) in the buffer \u2014 inspect them if the page is misbehaving.`
        : ''
    };
  }

  // ============================================
  // readClipboard \u2014 Read the user's clipboard text. Requires the
  // "clipboardRead" permission in manifest.json AND, in many contexts, a
  // prior user gesture. Fails gracefully if the browser refuses.
  // ============================================
  async function executeReadClipboard() {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        return { success: false, error: 'Clipboard API unavailable in this context.', recovery: 'Ask the user to paste the value manually via `askUser`, or navigate to a normal https:// page first.' };
      }
      const text = await navigator.clipboard.readText();
      return {
        success: true,
        text: String(text || '').slice(0, 5000),
        length: (text || '').length
      };
    } catch (e) {
      const msg = e && e.message || String(e);
      return {
        success: false,
        error: msg,
        recovery: /denied|not allowed|gesture/i.test(msg)
          ? 'Clipboard read was denied (no user gesture or permission). Ask the user via `askUser` to paste the value, or focus the tab and retry after a click.'
          : 'Clipboard read failed \u2014 fall back to `askUser`.'
      };
    }
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
            result = await executeType(params);
            break;
          case 'scroll':
            result = executeScroll(params);
            break;
          case 'scrollUntil':
            result = await executeScrollUntil(params);
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
          case 'waitUntil':
            result = await executeWaitUntil(params);
            break;
          case 'hover':
            result = executeHover(params);
            break;
          case 'uploadFile':
            result = await executeUploadFile(params);
            break;
          case 'readConsole':
            result = executeReadConsole(params);
            break;
          case 'readClipboard':
            result = await executeReadClipboard(params);
            break;
          default:
            // Structured failure: the agent loop's safety net SHOULD have
            // intercepted server-only actions before they reached the
            // runtime. If we got here, either (a) the server hasn't been
            // updated to rewrite this action, (b) the action is genuinely
            // misspelled, or (c) the runtime is older than the action.
            // Surface enough context for the LLM (and the server's failure
            // classifier) to choose a recovery without guessing.
            result = {
              success: false,
              reason: 'unknown_action',
              error: `Unknown action: "${action}". This action is not implemented in the in-tab runtime.`,
              recovery: 'If you believe this is a server-handled action (setMilestones, webSearch, researchNote, readFile, createTool, useTool, spawnSubAgent), the server normally rewrites it before dispatch — re-emit on the next step. For document actions (captureFile, editPdf, fillPdf, pdfPages), these are handled by the agent panel — they should not reach this runtime. Otherwise pick a known primitive (readPage, click, type, scroll, screenshot, goto, switchTab, extract, waitForElement, waitForStable, waitUntil, hover, pressKey, clear, uploadFile) or a macro (gotoAndRead, clickAndWait, typeAndSubmit, readAndExtract, scrollAndExtract).'
            };
        }
        sendResponse({ success: true, result });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true; // Keep channel open for async response
  });

})();
