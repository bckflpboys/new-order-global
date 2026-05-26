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
  function injectedHighlighter(action, params, label, thought, stepNum, totalSteps) {
    try {
      const HOST_ID = '__noglobal_replay_overlay__';
      const old = document.getElementById(HOST_ID);
      if (old) old.remove();

      const host = document.createElement('div');
      host.id = HOST_ID;
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
      (document.body || document.documentElement).appendChild(host);

      const RED = '#b8341c';
      const RED_SOFT = 'rgba(184,52,28,0.12)';
      const FONT = "'Public Sans', 'Inter', system-ui, -apple-system, sans-serif";
      const FONT_HEAD = "'Noto Serif', Georgia, 'Times New Roman', serif";
      const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

      const style = document.createElement('style');
      style.textContent = `
        @keyframes __nogr_pulse { 0% { box-shadow: 0 0 0 0 rgba(184,52,28,0.55); } 70% { box-shadow: 0 0 0 16px rgba(184,52,28,0); } 100% { box-shadow: 0 0 0 0 rgba(184,52,28,0); } }
        @keyframes __nogr_box_in { from { opacity: 0; transform: scale(1.18); } to { opacity: 1; transform: scale(1); } }
        @keyframes __nogr_ripple { 0% { opacity: 0.85; transform: translate(-50%,-50%) scale(0.2); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(2.6); } }
        @keyframes __nogr_badge_in { from { opacity: 0; transform: translateY(-4px) scale(0.92); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes __nogr_toast_in { from { opacity: 0; transform: translate(-50%, -10px) scale(0.96); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
        @keyframes __nogr_card_in { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes __nogr_arrow { 0% { opacity: 0; transform: translate(-50%, var(--from)); } 30% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, var(--to)); } }
        @keyframes __nogr_dot { 0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); } 40% { opacity: 1; transform: scale(1); } }
        @keyframes __nogr_caret { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
        @keyframes __nogr_progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      `;
      host.appendChild(style);

      // ---------- helpers ----------
      function findEl(selector) {
        if (!selector) return null;
        try { const el = document.querySelector(selector); if (el) return el; } catch (_) {}
        if (selector.startsWith('/') || selector.startsWith('(/')) {
          try {
            const r = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return r && r.singleNodeValue;
          } catch (_) {}
        }
        return null;
      }

      function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      }

      // ---------- click ripple ----------
      function ripple(cx, cy) {
        for (let i = 0; i < 2; i++) {
          const r = document.createElement('div');
          r.style.cssText = `
            position: fixed; left: ${cx}px; top: ${cy}px;
            width: 90px; height: 90px; border-radius: 50%;
            background: radial-gradient(circle, ${RED} 0%, ${RED} 30%, transparent 70%);
            transform: translate(-50%,-50%) scale(0.2);
            animation: __nogr_ripple 0.9s ${EASE} ${i * 0.15}s forwards;
            pointer-events: none; mix-blend-mode: multiply;
          `;
          host.appendChild(r);
        }
        // Crosshair dot at exact click point.
        const dot = document.createElement('div');
        dot.style.cssText = `
          position: fixed; left: ${cx}px; top: ${cy}px;
          width: 12px; height: 12px; border-radius: 50%;
          background: ${RED}; transform: translate(-50%,-50%);
          box-shadow: 0 0 0 3px #fff, 0 4px 16px rgba(184,52,28,0.6);
          animation: __nogr_box_in 0.32s ${EASE};
        `;
        host.appendChild(dot);
      }

      // ---------- element outline + badge ----------
      function highlightElement(el, action, badgeText, typeText) {
        if (!el) return false;
        try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch (_) {}
        const rect = el.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) return false;

        const pad = 5;
        const box = document.createElement('div');
        box.style.cssText = `
          position: fixed;
          left: ${rect.left - pad}px; top: ${rect.top - pad}px;
          width: ${rect.width + pad * 2}px; height: ${rect.height + pad * 2}px;
          border: 2px solid ${RED}; border-radius: 8px;
          background: ${RED_SOFT};
          box-shadow: 0 0 0 0 rgba(184,52,28,0.55), 0 8px 28px rgba(184,52,28,0.18);
          animation: __nogr_box_in 0.34s ${EASE}, __nogr_pulse 1.4s ease-out 0.34s infinite;
          pointer-events: none;
          transform-origin: center;
        `;
        host.appendChild(box);

        // Click ripple at element center.
        if (action === 'click' || action === 'pressKey') {
          ripple(rect.left + rect.width / 2, rect.top + rect.height / 2);
        }

        // Hover indicator — soft circle near top-left.
        if (action === 'hover') {
          const c = document.createElement('div');
          c.style.cssText = `
            position: fixed; left: ${rect.left - 14}px; top: ${rect.top - 14}px;
            width: 28px; height: 28px; border-radius: 50%;
            border: 2px solid ${RED}; background: rgba(184,52,28,0.18);
            animation: __nogr_box_in 0.3s ${EASE};
          `;
          host.appendChild(c);
        }

        // Floating badge.
        const badge = document.createElement('div');
        const placeBelow = rect.top < 38;
        const left = Math.max(8, Math.min(rect.left - pad, window.innerWidth - 240));
        badge.style.cssText = `
          position: fixed;
          left: ${left}px;
          ${placeBelow ? `top: ${rect.bottom + pad + 8}px;` : `top: ${rect.top - pad - 30}px;`}
          background: linear-gradient(135deg, ${RED} 0%, #d94734 100%);
          color: #fff; font-family: ${FONT}; font-size: 11px; font-weight: 700;
          letter-spacing: 0.08em; text-transform: uppercase;
          padding: 5px 11px; border-radius: 7px;
          box-shadow: 0 6px 18px rgba(184,52,28,0.45), 0 0 0 1px rgba(255,255,255,0.15) inset;
          animation: __nogr_badge_in 0.28s ${EASE};
          display: inline-flex; align-items: center; gap: 6px;
          max-width: 60vw; overflow: hidden;
        `;

        // Type action: animate characters appearing in the badge.
        if (action === 'type' && typeText) {
          const truncated = String(typeText).slice(0, 50);
          badge.innerHTML = `
            <span style="font-size:10px;opacity:0.85;">TYPE</span>
            <span style="opacity:0.6;">›</span>
            <span id="__nogr_typing" style="font-family:ui-monospace,monospace;text-transform:none;letter-spacing:0;font-weight:600;"></span>
            <span style="display:inline-block;width:1px;height:12px;background:#fff;margin-left:1px;animation:__nogr_caret 1s steps(2) infinite;"></span>
          `;
          host.appendChild(badge);
          const span = badge.querySelector('#__nogr_typing');
          let i = 0;
          const total = truncated.length;
          const perChar = Math.max(18, Math.min(60, 900 / Math.max(total, 1)));
          const tick = () => {
            if (i <= total) {
              span.textContent = truncated.slice(0, i);
              i++;
              setTimeout(tick, perChar);
            }
          };
          tick();
        } else {
          badge.textContent = badgeText;
          host.appendChild(badge);
        }

        return true;
      }

      // ---------- toast (top-center) ----------
      function showToast(title, sub) {
        const toast = document.createElement('div');
        toast.style.cssText = `
          position: fixed; top: 28px; left: 50%; transform: translate(-50%, 0);
          background: rgba(18,19,22,0.92); color: #fff;
          font-family: ${FONT}; padding: 14px 22px;
          border-radius: 14px; border: 1px solid rgba(184,52,28,0.4);
          box-shadow: 0 18px 56px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset;
          backdrop-filter: blur(16px) saturate(1.4); -webkit-backdrop-filter: blur(16px) saturate(1.4);
          display: flex; align-items: center; gap: 14px;
          animation: __nogr_toast_in 0.32s ${EASE};
          max-width: 70vw;
        `;
        toast.innerHTML = `
          <span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:${RED};flex-shrink:0;box-shadow:0 0 0 4px rgba(184,52,28,0.18);">
            <span style="width:9px;height:9px;border-radius:50%;background:#fff;"></span>
          </span>
          <span style="display:flex;flex-direction:column;gap:3px;min-width:0;">
            <span style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${RED};">${escapeHtml(title)}</span>
            ${sub ? `<span style="font-size:13.5px;font-weight:500;color:#f0f0f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60vw;">${escapeHtml(sub)}</span>` : ''}
          </span>
        `;
        host.appendChild(toast);
      }

      // ---------- scroll indicator ----------
      function showScrollIndicator(direction, amount) {
        const isUp = direction === 'up';
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;

        // Big translucent panel showing arrow + amount.
        const panel = document.createElement('div');
        panel.style.cssText = `
          position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%);
          display: flex; flex-direction: column; align-items: center; gap: 12px;
          padding: 22px 30px; border-radius: 18px;
          background: rgba(18,19,22,0.78); backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(184,52,28,0.4);
          box-shadow: 0 24px 60px rgba(0,0,0,0.5);
          font-family: ${FONT}; color: #fff;
          animation: __nogr_box_in 0.34s ${EASE};
        `;
        panel.innerHTML = `
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="${RED}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 4px 12px rgba(184,52,28,0.5));transform:rotate(${isUp ? 180 : 0}deg);">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <polyline points="19 12 12 19 5 12"/>
          </svg>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${RED};">Scroll ${isUp ? 'Up' : 'Down'}</div>
          <div style="font-family:${FONT_HEAD};font-size:22px;font-weight:600;">${amount}px</div>
        `;
        host.appendChild(panel);

        // Trailing arrows that fly in the scroll direction.
        for (let i = 0; i < 5; i++) {
          const arrow = document.createElement('div');
          const startY = isUp ? '60vh' : '40vh';
          const endY = isUp ? '20vh' : '80vh';
          arrow.style.cssText = `
            position: fixed; left: ${cx + (i % 2 === 0 ? -180 : 180) + (i * 20 - 40)}px;
            top: 0; transform: translate(-50%, ${startY});
            --from: ${startY}; --to: ${endY};
            opacity: 0; pointer-events: none;
            animation: __nogr_arrow 1.1s ${EASE} ${i * 0.12}s forwards;
          `;
          arrow.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${RED}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7;transform:rotate(${isUp ? 180 : 0}deg);"><polyline points="6 9 12 15 18 9"/></svg>`;
          host.appendChild(arrow);
        }
      }

      // ---------- thought card (bottom-left) ----------
      // Parses [Strategist] [Executor] [Critic] sections and renders as
      // a clean roster card with each role colour-tagged.
      function showThoughtCard(text) {
        if (!text || typeof text !== 'string') return;
        const cleaned = text.trim();
        if (cleaned.length < 8) return;

        // Try to extract [Role] sections.
        const roleRegex = /\[([A-Z][a-zA-Z ]+)\]\s*([^\[]*)/g;
        const sections = [];
        let m;
        while ((m = roleRegex.exec(cleaned)) !== null) {
          const role = m[1].trim();
          const body = m[2].trim().replace(/\s+/g, ' ');
          if (body) sections.push({ role, body });
        }

        const card = document.createElement('div');
        card.style.cssText = `
          position: fixed; left: 22px; bottom: 22px;
          width: 380px; max-width: calc(100vw - 44px);
          max-height: 46vh; overflow: auto;
          background: rgba(18,19,22,0.92); color: #f2f0f1;
          border: 1px solid rgba(184,52,28,0.35);
          border-radius: 14px; padding: 14px 16px 16px;
          font-family: ${FONT};
          box-shadow: 0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset;
          backdrop-filter: blur(18px) saturate(1.4);
          -webkit-backdrop-filter: blur(18px) saturate(1.4);
          animation: __nogr_card_in 0.36s ${EASE};
          pointer-events: auto;
        `;

        const header = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.08);">
            <span style="display:inline-flex;align-items:center;gap:4px;">
              <span style="width:6px;height:6px;border-radius:50%;background:${RED};animation:__nogr_dot 1.2s infinite;"></span>
              <span style="width:6px;height:6px;border-radius:50%;background:${RED};animation:__nogr_dot 1.2s infinite 0.16s;"></span>
              <span style="width:6px;height:6px;border-radius:50%;background:${RED};animation:__nogr_dot 1.2s infinite 0.32s;"></span>
            </span>
            <span style="font-family:${FONT_HEAD};font-size:14px;font-weight:600;">Agent Reasoning</span>
            <span style="margin-left:auto;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);">Step ${stepNum}/${totalSteps}</span>
          </div>
        `;

        let body;
        if (sections.length) {
          const roleColors = {
            Strategist: '#bfab49',
            Executor: RED,
            Critic: '#7a9eb0',
            Planner: '#bfab49',
            Reflector: '#9a7aa8'
          };
          body = sections.map(s => {
            const color = roleColors[s.role] || RED;
            return `
              <div style="margin-bottom:10px;">
                <div style="display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${color};padding:2px 7px;border-radius:4px;background:${color}22;border:1px solid ${color}55;margin-bottom:5px;">${escapeHtml(s.role)}</div>
                <div style="font-size:12.5px;line-height:1.55;color:rgba(255,255,255,0.86);">${escapeHtml(s.body)}</div>
              </div>
            `;
          }).join('');
        } else {
          // Fallback: render raw text, but try to detect numeric/bullet lists.
          const lines = cleaned.split(/\n|(?:\s*[-•*]\s+)|(?:\s*\d+\.\s+)/).map(l => l.trim()).filter(Boolean);
          if (lines.length > 1 && cleaned.length > 120) {
            body = `<ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.6;color:rgba(255,255,255,0.86);">${lines.map(l => `<li style="margin-bottom:4px;">${escapeHtml(l)}</li>`).join('')}</ul>`;
          } else {
            body = `<div style="font-size:12.5px;line-height:1.6;color:rgba(255,255,255,0.86);">${escapeHtml(cleaned)}</div>`;
          }
        }

        // Step progress bar.
        const progress = totalSteps ? `
          <div style="margin-top:12px;height:3px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${(stepNum / totalSteps) * 100}%;background:linear-gradient(90deg, ${RED}, #d94734);border-radius:999px;transition:width 0.4s ${EASE};"></div>
          </div>
        ` : '';

        card.innerHTML = header + body + progress;
        host.appendChild(card);
      }

      // ---------- dispatch ----------
      const sel = params && params.selector;
      const ELEMENT_ACTIONS = new Set(['click', 'type', 'select', 'clear', 'hover', 'waitForElement', 'pressKey', 'extract', 'readElement']);

      let labelText;
      switch (action) {
        case 'click': labelText = 'CLICK'; break;
        case 'type': labelText = 'TYPE'; break;
        case 'select': labelText = `SELECT: ${String(params.value || '').slice(0, 36)}`; break;
        case 'clear': labelText = 'CLEAR'; break;
        case 'hover': labelText = 'HOVER'; break;
        case 'waitForElement': labelText = 'WAIT FOR'; break;
        case 'pressKey': labelText = `KEY · ${params.key || ''}`; break;
        case 'extract': labelText = 'EXTRACT'; break;
        case 'readElement': labelText = 'READ'; break;
        default: labelText = String(action || '').toUpperCase().replace(/_/g, ' ');
      }

      // Scroll → custom indicator.
      if (action === 'scroll') {
        showScrollIndicator(params.direction || 'down', params.amount || 500);
      } else {
        let highlighted = false;
        if (ELEMENT_ACTIONS.has(action) && sel) {
          const el = findEl(sel);
          highlighted = highlightElement(el, action, labelText, params.text);
        }
        if (!highlighted) {
          showToast(labelText, label || '');
        }
      }

      // Always show the thought card if a thought is present.
      if (thought) showThoughtCard(thought);

      // Cleanup: keep visible long enough to read the thought card.
      // Each new step re-injects and wipes the old host anyway.
      setTimeout(() => { try { host.remove(); } catch (_) {} }, 6000);
    } catch (e) {
      console.warn('[ReplayHighlighter]', e);
    }
  }

  async function highlightStep(tabId, step, stepNum, totalSteps) {
    if (!tabId) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: injectedHighlighter,
        args: [
          step.action || '',
          step.params || {},
          describeStep(step) || '',
          step.thought || '',
          stepNum || 0,
          totalSteps || 0
        ]
      });
    } catch (e) {
      // Page not ready / restricted — silently skip the visual cue.
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
      await highlightStep(s.activeTab, step, s.idx + 1, s.steps.length);
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
