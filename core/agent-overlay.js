// New Order Global — Agent Overlay
// Premium in-page visual overlay for the live agent AND the replay.
// Injects a self-contained DOM overlay into the target tab via
// chrome.scripting.executeScript so users can see clicks, types, scrolls,
// reasoning, and pending questions in real time on whatever page the
// agent is acting on.
//
// Public API (window.AgentOverlay):
//   highlightStep(tabId, step, stepNum, totalSteps)
//   describeStep(step)
//   clear(tabId)
//
// The injected function is fully self-contained — no closures from this
// file, since chrome.scripting.executeScript serialises `func` across realms.

(function () {
  'use strict';

  // ============================================
  // describeStep — short one-liner used as the toast sub-text. Mirrors
  // (and shares with) browser-replay's older inline version.
  // ============================================
  function describeStep(step) {
    if (!step) return '';
    const p = step.params || {};
    switch (step.action) {
      case 'goto': return `→ ${p.url || ''}`;
      case 'openTab': return `Open: ${p.url || ''}`;
      case 'switchTab': {
        if (p.url) return `Switch to ${p.url}`;
        if (p.title) return `Switch to "${p.title}"`;
        return `Switch to tab ${p.tabIndex ?? p.browserIndex ?? ''}`;
      }
      case 'closeTab': return `Close tab ${p.tabIndex ?? ''}`;
      case 'click': return `Click: ${p.selector || p.text || ''}`;
      case 'type': return `Type "${(p.text || '').substring(0, 60)}" into ${p.selector || ''}`;
      case 'scroll': return `Scroll ${p.direction || 'down'} ${p.amount || 500}px`;
      case 'select': return `Select "${p.value}" in ${p.selector || ''}`;
      case 'clear': return `Clear: ${p.selector || ''}`;
      case 'pressKey': return `Press: ${p.key || ''}`;
      case 'waitForElement': return `Wait for: ${p.selector || ''}`;
      case 'wait': return `Wait ${p.ms || 0}ms`;
      case 'extract': return `Extract: ${p.items || p.selector || ''}`;
      case 'readPage': return 'Reading page content…';
      case 'readElement': return `Read: ${p.selector || ''}`;
      case 'screenshot': return 'Capturing screenshot';
      case 'download': return `Download: ${p.filename || p.url || ''}`;
      case 'storeData': return `Store as "${p.key || ''}"`;
      case 'rememberThis': return `Remember: "${(p.text || '').substring(0, 80)}"`;
      case 'notifyUser': return p.text || '';
      case 'webSearch': return `Web search: "${(p.query || p.q || '').substring(0, 80)}"`;
      case 'researchNote': return `Note [${p.topic || 'general'}]: ${(p.claim || '').substring(0, 80)}`;
      case 'askUser': return p.question || 'Agent needs your input';
      case 'confirmAction': return p.summary || 'Awaiting your approval';
      case 'think': return (p.reasoning || step.thought || 'Thinking…').substring(0, 120);
      case 'message': return (p.text || step.thought || '').substring(0, 120);
      case 'done': return p.summary || 'Task complete';
      case 'reload': case 'goBack': case 'goForward': return step.action;
      default: {
        try { return JSON.stringify(p).substring(0, 140); } catch { return ''; }
      }
    }
  }

  // ============================================
  // Injected function — runs in the target tab's page context.
  // ============================================
  /* eslint-disable */
  function injectedHighlighter(action, params, label, thought, stepNum, totalSteps, mode) {
    try {
      const old = document.querySelector('[data-ext-ui]');
      if (old) old.remove();

      const host = document.createElement('div');
      host.setAttribute('data-ext-ui', '1');
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
      (document.body || document.documentElement).appendChild(host);

      const RED = '#b8341c';
      const RED_DIM = '#d94734';
      const RED_SOFT = 'rgba(184,52,28,0.12)';
      const GOLD = '#bfab49';
      const BLUE = '#7a9eb0';
      const MAUVE = '#9a7aa8';
      const GREEN = '#2e7d4f';
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
        @keyframes __nogr_attention { 0%, 100% { transform: translate(-50%, 0); } 25% { transform: translate(calc(-50% - 4px), 0); } 75% { transform: translate(calc(-50% + 4px), 0); } }
      `;
      host.appendChild(style);

      function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      }

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

      function highlightElement(el, act, badgeText, typeText) {
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

        if (act === 'click' || act === 'pressKey') {
          ripple(rect.left + rect.width / 2, rect.top + rect.height / 2);
        }
        if (act === 'hover') {
          const c = document.createElement('div');
          c.style.cssText = `
            position: fixed; left: ${rect.left - 14}px; top: ${rect.top - 14}px;
            width: 28px; height: 28px; border-radius: 50%;
            border: 2px solid ${RED}; background: rgba(184,52,28,0.18);
            animation: __nogr_box_in 0.3s ${EASE};
          `;
          host.appendChild(c);
        }

        const badge = document.createElement('div');
        const placeBelow = rect.top < 38;
        const left = Math.max(8, Math.min(rect.left - pad, window.innerWidth - 240));
        badge.style.cssText = `
          position: fixed;
          left: ${left}px;
          ${placeBelow ? `top: ${rect.bottom + pad + 8}px;` : `top: ${rect.top - pad - 30}px;`}
          background: linear-gradient(135deg, ${RED} 0%, ${RED_DIM} 100%);
          color: #fff; font-family: ${FONT}; font-size: 11px; font-weight: 700;
          letter-spacing: 0.08em; text-transform: uppercase;
          padding: 5px 11px; border-radius: 7px;
          box-shadow: 0 6px 18px rgba(184,52,28,0.45), 0 0 0 1px rgba(255,255,255,0.15) inset;
          animation: __nogr_badge_in 0.28s ${EASE};
          display: inline-flex; align-items: center; gap: 6px;
          max-width: 60vw; overflow: hidden;
        `;

        if (act === 'type' && typeText) {
          const truncated = String(typeText).slice(0, 50);
          badge.innerHTML = `
            <span style="font-size:10px;opacity:0.85;">TYPE</span>
            <span style="opacity:0.6;">›</span>
            <span data-nogr-typing style="font-family:ui-monospace,monospace;text-transform:none;letter-spacing:0;font-weight:600;"></span>
            <span style="display:inline-block;width:1px;height:12px;background:#fff;margin-left:1px;animation:__nogr_caret 1s steps(2) infinite;"></span>
          `;
          host.appendChild(badge);
          const span = badge.querySelector('[data-nogr-typing]');
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
      function showToast(title, sub, opts) {
        opts = opts || {};
        const accent = opts.accent || RED;
        const icon = opts.icon || `
          <span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:${accent};flex-shrink:0;box-shadow:0 0 0 4px ${accent}2e;">
            <span style="width:9px;height:9px;border-radius:50%;background:#fff;"></span>
          </span>`;
        const toast = document.createElement('div');
        toast.style.cssText = `
          position: fixed; top: 28px; left: 50%; transform: translate(-50%, 0);
          background: rgba(18,19,22,0.92); color: #fff;
          font-family: ${FONT}; padding: 14px 22px;
          border-radius: 14px; border: 1px solid ${accent}66;
          box-shadow: 0 18px 56px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset;
          backdrop-filter: blur(16px) saturate(1.4); -webkit-backdrop-filter: blur(16px) saturate(1.4);
          display: flex; align-items: center; gap: 14px;
          animation: __nogr_toast_in 0.32s ${EASE} ${opts.shake ? ', __nogr_attention 0.45s ' + EASE + ' 0.4s' : ''};
          max-width: 72vw;
        `;
        toast.innerHTML = `
          ${icon}
          <span style="display:flex;flex-direction:column;gap:3px;min-width:0;">
            <span style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${accent};">${escapeHtml(title)}</span>
            ${sub ? `<span style="font-size:13.5px;font-weight:500;color:#f0f0f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:64vw;">${escapeHtml(sub)}</span>` : ''}
          </span>
        `;
        host.appendChild(toast);
      }

      // ---------- attention banner (askUser / confirmAction) ----------
      function showAttentionBanner(title, body, hint) {
        const banner = document.createElement('div');
        banner.style.cssText = `
          position: fixed; top: 32px; left: 50%; transform: translate(-50%, 0);
          width: min(540px, 80vw);
          background: linear-gradient(135deg, rgba(184,52,28,0.96) 0%, rgba(217,71,52,0.96) 100%);
          color: #fff; font-family: ${FONT};
          padding: 18px 22px; border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.15);
          box-shadow: 0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08) inset, 0 0 60px rgba(184,52,28,0.4);
          animation: __nogr_toast_in 0.4s ${EASE}, __nogr_attention 0.5s ${EASE} 0.5s;
          pointer-events: auto;
        `;
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;animation:__nogr_dot 1.4s infinite;">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span style="font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;">${escapeHtml(title)}</span>
          </div>
          <div style="font-family:${FONT_HEAD};font-size:17px;font-weight:600;line-height:1.4;margin-bottom:10px;">${escapeHtml(body)}</div>
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;opacity:0.92;padding-top:10px;border-top:1px solid rgba(255,255,255,0.18);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            ${escapeHtml(hint)}
          </div>
        `;
        host.appendChild(banner);
      }

      // ---------- scroll indicator ----------
      function showScrollIndicator(direction, amount) {
        const isUp = direction === 'up';
        const cx = window.innerWidth / 2;

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
            <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
          </svg>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${RED};">Scroll ${isUp ? 'Up' : 'Down'}</div>
          <div style="font-family:${FONT_HEAD};font-size:22px;font-weight:600;">${amount}px</div>
        `;
        host.appendChild(panel);

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

      // ---------- thought / reasoning card ----------
      function showThoughtCard(text, headerLabel) {
        if (!text || typeof text !== 'string') return;
        const cleaned = text.trim();
        if (cleaned.length < 4) return;

        // Try [Role] section parsing first.
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

        const stepBadge = totalSteps ? `<span style="margin-left:auto;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);">Step ${stepNum}/${totalSteps}</span>` : '';
        const header = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.08);">
            <span style="display:inline-flex;align-items:center;gap:4px;">
              <span style="width:6px;height:6px;border-radius:50%;background:${RED};animation:__nogr_dot 1.2s infinite;"></span>
              <span style="width:6px;height:6px;border-radius:50%;background:${RED};animation:__nogr_dot 1.2s infinite 0.16s;"></span>
              <span style="width:6px;height:6px;border-radius:50%;background:${RED};animation:__nogr_dot 1.2s infinite 0.32s;"></span>
            </span>
            <span style="font-family:${FONT_HEAD};font-size:14px;font-weight:600;">${escapeHtml(headerLabel || 'Agent Reasoning')}</span>
            ${stepBadge}
          </div>
        `;

        let body;
        if (sections.length) {
          const roleColors = {
            Strategist: GOLD, Planner: GOLD,
            Executor: RED,
            Critic: BLUE, Reviewer: BLUE,
            Reflector: MAUVE
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
          const lines = cleaned.split(/\n|(?:\s*[-•*]\s+)|(?:\s*\d+\.\s+)/).map(l => l.trim()).filter(Boolean);
          if (lines.length > 1 && cleaned.length > 120) {
            body = `<ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.6;color:rgba(255,255,255,0.86);">${lines.map(l => `<li style="margin-bottom:4px;">${escapeHtml(l)}</li>`).join('')}</ul>`;
          } else {
            body = `<div style="font-size:12.5px;line-height:1.6;color:rgba(255,255,255,0.86);">${escapeHtml(cleaned)}</div>`;
          }
        }

        const progress = totalSteps ? `
          <div style="margin-top:12px;height:3px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${Math.min(100, (stepNum / totalSteps) * 100)}%;background:linear-gradient(90deg, ${RED}, ${RED_DIM});border-radius:999px;transition:width 0.4s ${EASE};"></div>
          </div>
        ` : '';

        card.innerHTML = header + body + progress;
        host.appendChild(card);
      }

      // ---------- dispatch ----------
      const sel = params && params.selector;
      const ELEMENT_ACTIONS = new Set(['click', 'type', 'select', 'clear', 'hover', 'waitForElement', 'pressKey', 'extract', 'readElement']);
      const PURE_THOUGHT_ACTIONS = new Set(['think', 'message', 'storeData', 'rememberThis', 'researchNote', 'webSearch', 'readPage', 'done']);

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
        case 'readPage': labelText = 'READ PAGE'; break;
        case 'screenshot': labelText = 'SCREENSHOT'; break;
        case 'webSearch': labelText = 'WEB SEARCH'; break;
        case 'storeData': labelText = 'STORE DATA'; break;
        case 'rememberThis': labelText = 'REMEMBER'; break;
        case 'researchNote': labelText = 'RESEARCH NOTE'; break;
        case 'message': labelText = 'MESSAGE'; break;
        case 'think': labelText = 'THINKING'; break;
        case 'done': labelText = 'DONE'; break;
        case 'goto': labelText = 'NAVIGATE'; break;
        case 'openTab': labelText = 'OPEN TAB'; break;
        case 'switchTab': labelText = 'SWITCH TAB'; break;
        case 'closeTab': labelText = 'CLOSE TAB'; break;
        default: labelText = String(action || '').toUpperCase().replace(/_/g, ' ');
      }

      // ---------- special-case interactive actions ----------
      if (action === 'askUser') {
        showAttentionBanner(
          'Agent needs your input',
          params.question || 'The agent has a question.',
          'Switch to the Global Executive side panel to answer'
        );
      } else if (action === 'confirmAction') {
        showAttentionBanner(
          'Approval required',
          params.summary || 'Agent is awaiting your approval',
          'Switch to the Global Executive side panel to approve or reject'
        );
      } else if (action === 'notifyUser') {
        showToast('Ping', params.text || '', { accent: GOLD });
      } else if (action === 'done') {
        showToast('Task complete', params.summary || '', {
          accent: GREEN,
          icon: `<span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:${GREEN};flex-shrink:0;box-shadow:0 0 0 4px ${GREEN}2e;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>`
        });
      } else if (action === 'scroll') {
        showScrollIndicator(params.direction || 'down', params.amount || 500);
      } else if (PURE_THOUGHT_ACTIONS.has(action)) {
        // No element + no scroll → just thought card + small contextual toast.
        showToast(labelText, label || '');
      } else {
        // Try element highlight; fall back to toast if no element / no match.
        let highlighted = false;
        if (ELEMENT_ACTIONS.has(action) && sel) {
          const el = findEl(sel);
          highlighted = highlightElement(el, action, labelText, params.text);
        }
        if (!highlighted) {
          showToast(labelText, label || '');
        }
      }

      // Reasoning card — always shown if thought present.
      if (thought) {
        const header = (action === 'think' || action === 'message')
          ? (action === 'think' ? 'Agent Thinking' : 'Agent Message')
          : 'Agent Reasoning';
        showThoughtCard(thought, header);
      }

      // Lifecycle. Live mode keeps overlays longer than replay mode since
      // the user is reading along; the next step will wipe it anyway.
      const ttl = mode === 'replay' ? 6000 : 9000;
      setTimeout(() => { try { host.remove(); } catch (_) {} }, ttl);
    } catch (e) {
      console.warn('[AgentOverlay]', e);
    }
  }
  /* eslint-enable */

  function injectedClear() {
    const el = document.querySelector('[data-ext-ui]');
    if (el) el.remove();
  }

  // ============================================
  // Public dispatch
  // ============================================
  async function highlightStep(tabId, step, stepNum, totalSteps, mode) {
    if (!tabId || !step || typeof chrome === 'undefined' || !chrome.scripting) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: injectedHighlighter,
        args: [
          step.action || '',
          step.params || {},
          describeStep(step) || '',
          step.thought || (step.params && (step.params.reasoning || step.params.text)) || '',
          stepNum || 0,
          totalSteps || 0,
          mode || 'live'
        ]
      });
    } catch (_) {
      // Page may be a restricted URL (chrome://, about:blank during nav,
      // edge:// etc.) — silently skip; the action itself still runs.
    }
  }

  async function clear(tabId) {
    if (!tabId || typeof chrome === 'undefined' || !chrome.scripting) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: injectedClear });
    } catch (_) { /* ignore */ }
  }

  window.AgentOverlay = { highlightStep, describeStep, clear };
})();
