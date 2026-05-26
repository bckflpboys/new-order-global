// New Order Global — Browser Replay
// Re-executes the recorded browser steps from a past agent task into a fresh
// Chrome window so the user can literally watch the run happen again.
// No LLM calls, no credits — purely the deterministic action log piped
// through the same background handlers the live agent uses.
//
// Caveats: pages may have changed since the original run, so this is best-
// effort fidelity (selectors may miss, captchas/logins may block, etc.).
// For pixel-perfect history-true playback, see the Option 3 design doc on
// the server (docs/BROWSER_REPLAY_DOM_RECORDING.md).

(function () {
  'use strict';

  // ============================================
  // Actions we deliberately skip — non-browser side effects (storing data,
  // sending notifications, calling the LLM, etc.) that don't translate to a
  // visible re-run. Anything not listed here is forwarded to the standard
  // ge-execute-in-tab executor, which means new browser actions automatically
  // "just work" without needing changes here.
  // ============================================
  const SKIP_ACTIONS = new Set([
    'storeData', 'rememberThis', 'notifyUser', 'webSearch', 'researchNote',
    'done', 'askUser', 'setMilestone', 'markGoal',
    'createTool', 'useTool', 'createDashboard',
    'screenshot',          // capturing a screenshot of THIS replay isn't useful
    'readEmail',           // requires the user's real inbox session, skip in replay
    'readDownloads',       // inspection-only
    'captureFile'          // requires a fresh file context
  ]);

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { success: false, error: 'no response' });
          }
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ============================================
  // HUD — floating control panel on the dashboard page (NOT injected into
  // the replay window). The user watches the replay window run, and uses
  // this HUD to pause / stop / change speed and see the current step.
  // ============================================
  function buildHud() {
    let el = document.getElementById('browser-replay-hud');
    if (el) el.remove();

    el = document.createElement('div');
    el.id = 'browser-replay-hud';
    el.innerHTML = `
      <style>
        #browser-replay-hud {
          position: fixed; right: 20px; bottom: 20px; z-index: 9999;
          width: 360px; background: var(--surface, #1a1a1a);
          border: 1px solid var(--ghost-border, #333); border-radius: 14px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.5);
          font-family: var(--font-body, system-ui, sans-serif);
          color: var(--on-surface, #fff); overflow: hidden;
        }
        #browser-replay-hud .hud-head {
          padding: 12px 16px; background: var(--surface-container, #222);
          border-bottom: 1px solid var(--ghost-border, #333);
          display: flex; align-items: center; justify-content: space-between;
        }
        #browser-replay-hud .hud-title {
          font-family: var(--font-headline, system-ui); font-size: 14px;
          font-weight: 700; display: flex; align-items: center; gap: 8px;
        }
        #browser-replay-hud .hud-title .dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--primary, #b8341c); animation: brp-pulse 1.2s ease-in-out infinite;
        }
        @keyframes brp-pulse {
          0%,100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
        #browser-replay-hud .hud-close {
          background: transparent; border: 0; color: var(--on-surface-muted, #999);
          cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 8px;
        }
        #browser-replay-hud .hud-body { padding: 14px 16px; }
        #browser-replay-hud .hud-step-num {
          font-family: var(--font-label, system-ui); font-size: 11px;
          color: var(--on-surface-muted, #999); letter-spacing: 0.04em;
          text-transform: uppercase; margin-bottom: 6px;
        }
        #browser-replay-hud .hud-step-action {
          font-family: ui-monospace, monospace; font-size: 14px; font-weight: 700;
          color: var(--primary, #b8341c); margin-bottom: 6px;
        }
        #browser-replay-hud .hud-step-detail {
          font-size: 12px; color: var(--on-surface-variant, #bbb);
          word-break: break-all; min-height: 32px; max-height: 80px; overflow: auto;
        }
        #browser-replay-hud .hud-progress {
          height: 4px; background: var(--surface-container-high, #2a2a2a);
          border-radius: 999px; overflow: hidden; margin: 10px 0 14px;
        }
        #browser-replay-hud .hud-progress-fill {
          height: 100%; background: var(--primary, #b8341c); width: 0%;
          transition: width 0.3s ease;
        }
        #browser-replay-hud .hud-controls {
          display: flex; gap: 6px; align-items: center;
        }
        #browser-replay-hud .hud-controls button {
          background: var(--surface-container, #2a2a2a);
          border: 1px solid var(--ghost-border, #333);
          color: var(--on-surface, #fff); padding: 6px 12px; border-radius: 8px;
          cursor: pointer; font-size: 12px; font-weight: 600;
          font-family: var(--font-label, system-ui);
        }
        #browser-replay-hud .hud-controls button.primary {
          background: var(--primary, #b8341c); border-color: var(--primary, #b8341c);
          color: #fff;
        }
        #browser-replay-hud .hud-controls button:disabled { opacity: 0.4; cursor: not-allowed; }
        #browser-replay-hud .hud-controls select {
          background: var(--surface-container, #2a2a2a);
          border: 1px solid var(--ghost-border, #333); color: var(--on-surface, #fff);
          padding: 5px 8px; border-radius: 6px; font-size: 12px; margin-left: auto;
        }
      </style>
      <div class="hud-head">
        <div class="hud-title"><span class="dot"></span> Browser Replay</div>
        <button class="hud-close" title="Close">×</button>
      </div>
      <div class="hud-body">
        <div class="hud-step-num">Step <span id="hud-cur">0</span> / <span id="hud-tot">0</span></div>
        <div class="hud-step-action" id="hud-action">Initialising…</div>
        <div class="hud-step-detail" id="hud-detail">Opening replay window…</div>
        <div class="hud-progress"><div class="hud-progress-fill" id="hud-fill"></div></div>
        <div class="hud-controls">
          <button id="hud-pause" class="primary">⏸ Pause</button>
          <button id="hud-stop">⏹ Stop</button>
          <select id="hud-speed" title="Replay speed">
            <option value="0.5">0.5×</option>
            <option value="1" selected>1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </select>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    const api = {
      el,
      update(idx, total, step) {
        el.querySelector('#hud-cur').textContent = String(idx);
        el.querySelector('#hud-tot').textContent = String(total);
        el.querySelector('#hud-action').textContent = step.action || '?';
        el.querySelector('#hud-detail').textContent = describeStep(step);
        el.querySelector('#hud-fill').style.width = (total ? (idx / total) * 100 : 0) + '%';
      },
      setPaused(p) {
        el.querySelector('#hud-pause').textContent = p ? '▶ Resume' : '⏸ Pause';
      },
      finish(msg) {
        el.querySelector('#hud-action').textContent = msg || 'Done';
        el.querySelector('#hud-detail').textContent = '';
        el.querySelector('#hud-pause').disabled = true;
        el.querySelector('.hud-title .dot').style.animation = 'none';
        el.querySelector('.hud-title .dot').style.background = 'var(--success, #2e7d4f)';
      },
      onPause: null, onStop: null, onSpeed: null, onClose: null
    };

    el.querySelector('#hud-pause').addEventListener('click', () => api.onPause && api.onPause());
    el.querySelector('#hud-stop').addEventListener('click', () => api.onStop && api.onStop());
    el.querySelector('.hud-close').addEventListener('click', () => api.onClose && api.onClose());
    el.querySelector('#hud-speed').addEventListener('change', (e) => {
      api.onSpeed && api.onSpeed(parseFloat(e.target.value) || 1);
    });

    return api;
  }

  function describeStep(step) {
    const p = step.params || {};
    switch (step.action) {
      case 'goto': return `→ ${p.url || ''}`;
      case 'openTab': return `Open: ${p.url || ''}`;
      case 'switchTab': return `Switch to tab ${p.tabIndex}`;
      case 'closeTab': return `Close tab ${p.tabIndex}`;
      case 'click': return `Click: ${p.selector || ''}`;
      case 'type': return `Type "${(p.text || '').substring(0, 60)}" into ${p.selector || ''}`;
      case 'scroll': return `Scroll ${p.direction || 'down'} ${p.amount || 500}px`;
      case 'select': return `Select "${p.value}" in ${p.selector || ''}`;
      case 'clear': return `Clear: ${p.selector || ''}`;
      case 'pressKey': return `Press: ${p.key || ''}`;
      case 'waitForElement': return `Wait for: ${p.selector || ''}`;
      case 'wait': return `Wait ${p.ms || 0}ms`;
      case 'reload': case 'goBack': case 'goForward': return step.action;
      default: return JSON.stringify(p).substring(0, 140);
    }
  }

  // ============================================
  // In-page Highlighter — injected into the replay tab to show the user
  // what the agent is doing at each step. Two modes:
  //   1. Element-targeted (selector present): red outline + ripple + label.
  //   2. Non-element / global (switchTab, goto, openTab, wait, scroll w/o
  //      selector, etc.): centered toast banner.
  // The injected function is fully self-contained — no closures from this
  // file, since chrome.scripting.executeScript serialises it across realms.
  // ============================================
  function injectedHighlighter(action, params, label) {
    try {
      const HOST_ID = '__noglobal_replay_overlay__';
      // Wipe previous overlay so successive steps don't stack.
      const old = document.getElementById(HOST_ID);
      if (old) old.remove();

      const host = document.createElement('div');
      host.id = HOST_ID;
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
      (document.body || document.documentElement).appendChild(host);

      // Inject one-shot keyframes (scoped to host via style tag).
      const style = document.createElement('style');
      style.textContent = `
        @keyframes __nogr_pulse { 0% { box-shadow: 0 0 0 0 rgba(184,52,28,0.55), 0 0 0 0 rgba(184,52,28,0.35); } 70% { box-shadow: 0 0 0 14px rgba(184,52,28,0), 0 0 0 28px rgba(184,52,28,0); } 100% { box-shadow: 0 0 0 0 rgba(184,52,28,0), 0 0 0 0 rgba(184,52,28,0); } }
        @keyframes __nogr_fadein { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes __nogr_fadeout { to { opacity: 0; transform: translateY(-6px); } }
        @keyframes __nogr_toastin { from { opacity: 0; transform: translate(-50%, -16px) scale(0.96); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
      `;
      host.appendChild(style);

      // ---------- helpers ----------
      const FONT = "'Public Sans', 'Inter', system-ui, -apple-system, sans-serif";
      const RED = '#b8341c';

      function showToast(text, sub) {
        const toast = document.createElement('div');
        toast.style.cssText = `
          position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
          background: rgba(20,20,22,0.94); color: #fff;
          font-family: ${FONT}; font-size: 14px; font-weight: 600;
          padding: 12px 22px 12px 18px; border-radius: 12px;
          border: 1px solid rgba(184,52,28,0.45);
          box-shadow: 0 16px 48px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset;
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          display: flex; align-items: center; gap: 12px;
          animation: __nogr_toastin 0.22s ease-out;
          max-width: 70vw;
        `;
        toast.innerHTML = `
          <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:${RED};flex-shrink:0;">
            <span style="width:8px;height:8px;border-radius:50%;background:#fff;animation:__nogr_pulse 1.2s infinite;"></span>
          </span>
          <span style="display:flex;flex-direction:column;gap:2px;min-width:0;">
            <span style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${RED};">${text}</span>
            ${sub ? `<span style="font-size:13px;font-weight:500;color:#e8e8e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60vw;">${sub}</span>` : ''}
          </span>
        `;
        host.appendChild(toast);
      }

      function highlightElement(el, badgeText) {
        if (!el) return false;
        try {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        } catch (_) {}
        const rect = el.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) return false;

        const pad = 4;
        const box = document.createElement('div');
        box.style.cssText = `
          position: fixed;
          left: ${rect.left - pad}px; top: ${rect.top - pad}px;
          width: ${rect.width + pad * 2}px; height: ${rect.height + pad * 2}px;
          border: 2px solid ${RED}; border-radius: 6px;
          background: rgba(184,52,28,0.10);
          box-shadow: 0 0 0 0 rgba(184,52,28,0.55);
          animation: __nogr_pulse 1.2s ease-out infinite, __nogr_fadein 0.2s ease-out;
          pointer-events: none;
        `;
        host.appendChild(box);

        // Floating badge — placed above the element if room, else below.
        const badge = document.createElement('div');
        const placeBelow = rect.top < 36;
        badge.style.cssText = `
          position: fixed;
          left: ${Math.max(8, rect.left - pad)}px;
          ${placeBelow
            ? `top: ${rect.bottom + pad + 6}px;`
            : `top: ${rect.top - pad - 28}px;`}
          background: ${RED}; color: #fff;
          font-family: ${FONT}; font-size: 11px; font-weight: 700;
          letter-spacing: 0.06em; text-transform: uppercase;
          padding: 4px 10px; border-radius: 6px;
          box-shadow: 0 4px 14px rgba(184,52,28,0.45);
          animation: __nogr_fadein 0.22s ease-out;
          white-space: nowrap; max-width: 60vw;
          overflow: hidden; text-overflow: ellipsis;
        `;
        badge.textContent = badgeText;
        host.appendChild(badge);
        return true;
      }

      function findEl(selector) {
        if (!selector) return null;
        try {
          // Try CSS first.
          const el = document.querySelector(selector);
          if (el) return el;
        } catch (_) {}
        // Fallback: XPath (the agent sometimes records xpath-style selectors).
        if (selector.startsWith('/') || selector.startsWith('(/')) {
          try {
            const r = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return r && r.singleNodeValue;
          } catch (_) {}
        }
        return null;
      }

      // ---------- dispatch ----------
      const sel = params && params.selector;
      const ELEMENT_ACTIONS = new Set(['click', 'type', 'select', 'clear', 'hover', 'waitForElement', 'pressKey', 'extract', 'readElement']);

      let labelText = '';
      switch (action) {
        case 'click': labelText = 'CLICK'; break;
        case 'type': labelText = `TYPE${params.text ? ': ' + String(params.text).slice(0, 40) : ''}`; break;
        case 'select': labelText = `SELECT: ${String(params.value || '').slice(0, 40)}`; break;
        case 'clear': labelText = 'CLEAR'; break;
        case 'hover': labelText = 'HOVER'; break;
        case 'waitForElement': labelText = 'WAIT FOR'; break;
        case 'pressKey': labelText = `KEY: ${params.key || ''}`; break;
        case 'extract': labelText = 'EXTRACT'; break;
        case 'readElement': labelText = 'READ'; break;
        default: labelText = String(action || '').toUpperCase();
      }

      let highlighted = false;
      if (ELEMENT_ACTIONS.has(action) && sel) {
        const el = findEl(sel);
        highlighted = highlightElement(el, labelText);
      }

      // If we couldn't locate the element OR the action has no selector,
      // fall back to a toast so the user still sees what just happened.
      if (!highlighted) {
        showToast(labelText, label || '');
      }

      // Auto-cleanup after 1.6s — short enough to keep up with replay pace,
      // long enough to read. The next step's inject() will also wipe it.
      setTimeout(() => { try { host.remove(); } catch (_) {} }, 1600);
    } catch (e) {
      // Never let the highlighter break a replay.
      console.warn('[ReplayHighlighter]', e);
    }
  }

  async function highlightStep(tabId, step) {
    if (!tabId) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: injectedHighlighter,
        args: [step.action || '', step.params || {}, describeStep(step) || '']
      });
    } catch (e) {
      // Page may not be ready (e.g. about:blank, chrome:// pages, or still
      // loading after a goto). Silently ignore — the action itself will run
      // normally; only the visual cue is missed.
    }
  }

  // ============================================
  // Core replay loop
  // ============================================
  let _state = null;

  async function start(task) {
    if (_state && _state.running) {
      console.warn('[BrowserReplay] already running');
      return;
    }

    const steps = (task && task.steps) || [];
    if (!steps.length) {
      alert('No steps to replay.');
      return;
    }

    const hud = buildHud();

    // Open a dedicated window for the replay so the user can side-by-side it
    // with the dashboard. Falls back to a new tab if windows API is unavailable.
    let replayTabId;
    try {
      if (chrome.windows && chrome.windows.create) {
        const win = await chrome.windows.create({
          url: 'about:blank', focused: true, width: 1280, height: 820, type: 'normal'
        });
        replayTabId = win.tabs && win.tabs[0] && win.tabs[0].id;
      } else {
        const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
        replayTabId = tab.id;
      }
    } catch (e) {
      alert('Failed to open replay window: ' + e.message);
      hud.el.remove();
      return;
    }

    _state = {
      task, hud, steps,
      tabs: [replayTabId],
      activeTab: replayTabId,
      idx: 0,
      running: true,
      paused: false,
      stopped: false,
      speed: 1
    };

    hud.onPause = () => {
      _state.paused = !_state.paused;
      hud.setPaused(_state.paused);
      if (!_state.paused) tick();
    };
    hud.onStop = () => {
      _state.stopped = true; _state.running = false;
      hud.finish('Stopped');
    };
    hud.onSpeed = (s) => { _state.speed = s; };
    hud.onClose = () => {
      _state.stopped = true; _state.running = false;
      hud.el.remove();
    };

    // Give the new window a beat to settle.
    await sleep(600);
    tick();
  }

  async function tick() {
    const s = _state;
    while (s.running && !s.stopped && !s.paused && s.idx < s.steps.length) {
      const step = s.steps[s.idx];
      s.hud.update(s.idx + 1, s.steps.length, step);
      // Show the visual cue on the active replay tab BEFORE the action fires
      // so the user can see what's about to happen. Delay scales with speed.
      await highlightStep(s.activeTab, step);
      await sleep(450 / s.speed);
      await runStep(step);
      s.idx++;
      // Inter-step pacing, scaled by speed. We keep it generous so users can
      // actually see what's happening — original step durations are in the
      // step record but a uniform pause is more watchable than wall-clock.
      await sleep(700 / s.speed);
    }
    if (!s.stopped && s.idx >= s.steps.length) {
      s.running = false;
      s.hud.finish('Replay complete');
    }
  }

  async function runStep(step) {
    const action = step.action;
    const params = step.params || {};
    if (SKIP_ACTIONS.has(action)) return;

    const s = _state;

    try {
      if (action === 'goto') {
        await send({ type: 'ge-goto', tabId: s.activeTab, url: params.url });
        return;
      }
      if (action === 'openTab') {
        const r = await send({ type: 'ge-open-tab', url: params.url });
        if (r && r.tabId) {
          s.tabs.push(r.tabId);
          s.activeTab = r.tabId;
          await send({ type: 'ge-switch-tab', tabId: r.tabId });
        }
        return;
      }
      if (action === 'switchTab') {
        const i = Number(params.tabIndex);
        if (!Number.isNaN(i) && s.tabs[i]) {
          s.activeTab = s.tabs[i];
          await send({ type: 'ge-switch-tab', tabId: s.activeTab });
        }
        return;
      }
      if (action === 'closeTab') {
        const i = Number(params.tabIndex);
        if (!Number.isNaN(i) && s.tabs[i]) {
          await send({ type: 'ge-close-tab', tabId: s.tabs[i] });
          s.tabs.splice(i, 1);
          if (s.activeTab === s.tabs[i]) s.activeTab = s.tabs[s.tabs.length - 1] || null;
        }
        return;
      }
      if (action === 'reload') {
        await send({ type: 'ge-reload', tabId: s.activeTab });
        return;
      }
      if (action === 'goBack') {
        await send({ type: 'ge-go-back', tabId: s.activeTab });
        return;
      }
      if (action === 'goForward') {
        await send({ type: 'ge-go-forward', tabId: s.activeTab });
        return;
      }

      // Default: forward to the standard executor — this covers click, type,
      // scroll, select, clear, pressKey, waitForElement, wait, hover, extract,
      // readPage, and any future browser action without needing changes here.
      await send({
        type: 'ge-execute-in-tab',
        tabId: s.activeTab,
        action,
        params
      });
    } catch (e) {
      console.warn('[BrowserReplay] step failed:', action, e);
    }
  }

  window.BrowserReplay = { start };
})();
