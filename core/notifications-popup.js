// =====================================================================
// Admin notifications dialog renderer (popup-side).
// =====================================================================
// Loaded by popup.html. On popup open, fetches /api/notifications/unread
// from the API server and, if any are returned, shows them as a chain of
// modal dialogs over the popup. The user dismisses each by clicking OK
// (or its CTA button) which POSTs /api/notifications/:id/read so the
// server stops returning it for this user.
//
// The dialog appears ABOVE the existing popup content (z-index 10000)
// and is created lazily, so the markup stays out of popup.html and out
// of the way of users who never get notifications.
//
// Severities (info | success | warning | critical) drive the accent
// colour and icon. CTA buttons open a new tab and ALSO mark the
// notification as read.

(function () {
  'use strict';

  // Already wired? Bail.
  if (window[Symbol.for('_ngo_np')]) return;
  window[Symbol.for('_ngo_np')] = true;

  // -----------------------------------------------------------------
  // Auth + base-URL helpers. We delegate to the shared NewOrderAPI
  // module (loaded by popup.html immediately before this script) so
  // that we use the correct storage keys (`noAuthToken`) and the same
  // configured server URL the rest of the extension hits. Falling back
  // to ad-hoc keys here was the bug that prevented notifications from
  // appearing — every request 401'd silently.
  // -----------------------------------------------------------------
  function ngo() {
    return (typeof globalThis !== 'undefined' && globalThis.NewOrderAPI) || null;
  }
  async function api(path, options = {}) {
    const API = ngo();
    if (!API) throw new Error('NewOrderAPI not loaded');
    const token = await API.getToken();
    const base = (await API.getBaseUrl()).replace(/\/$/, '');
    const res = await fetch(base + path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: options.body || undefined
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('HTTP ' + res.status + (txt ? ' — ' + txt.slice(0, 200) : ''));
    }
    return res.json().catch(() => ({}));
  }

  // -----------------------------------------------------------------
  // Styles — injected once on first show so empty popups stay clean.
  // -----------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('ngo-notif-styles')) return;
    // Theme matches dashboard.css (agent + builder pages):
    //   --background  #ecebec       --on-surface           #1b1c1d
    //   --surface     #ecebec       --on-surface-variant   #434653
    //   --surface-container-lowest  #ffffff
    //   --primary     #b8341c (editorial red)
    //   --ghost-border rgba(60,64,75,0.32)
    // Values are hardcoded as fallbacks so the dialog renders correctly
    // inside popup.html which does not import dashboard.css.
    const css = `
      .ngo-notif-overlay {
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(27, 28, 29, 0.42);
        backdrop-filter: blur(3px);
        display: flex; align-items: center; justify-content: center;
        padding: 16px; box-sizing: border-box;
        animation: ngoFade 0.18s ease-out;
        font-family: var(--font-body, "Inter", system-ui, -apple-system, "Segoe UI", sans-serif);
      }
      @keyframes ngoFade { from { opacity: 0 } to { opacity: 1 } }
      .ngo-notif-card {
        width: 100%; max-width: 400px;
        background: var(--surface-container-lowest, #ffffff);
        color: var(--on-surface, #1b1c1d);
        border: 1px solid var(--ghost-border, rgba(60, 64, 75, 0.32));
        border-radius: 16px;
        box-shadow: 0 18px 48px rgba(27, 28, 29, 0.22), 0 2px 6px rgba(27, 28, 29, 0.08);
        padding: 22px 22px 18px;
        box-sizing: border-box;
        animation: ngoSlide 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
        position: relative;
        overflow: hidden;
      }
      /* Accent stripe along the top edge in the editorial-red primary. */
      .ngo-notif-card::before {
        content: "";
        position: absolute; top: 0; left: 0; right: 0; height: 3px;
        background: var(--primary, #b8341c);
      }
      .ngo-notif-card.sev-success::before  { background: var(--success, #2e7d4f); }
      .ngo-notif-card.sev-warning::before  { background: var(--warning, #8a6d00); }
      .ngo-notif-card.sev-critical::before { background: var(--danger, #ba1a1a); }

      @keyframes ngoSlide {
        from { transform: translateY(12px) scale(0.98); opacity: 0 }
        to   { transform: translateY(0)    scale(1);    opacity: 1 }
      }

      .ngo-notif-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
      .ngo-notif-icon {
        width: 36px; height: 36px;
        border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        font-size: 18px; font-weight: 700;
        font-family: ui-serif, "Source Serif Pro", Georgia, serif;
      }
      .ngo-notif-icon.info     { background: rgba(184, 52, 28, 0.10); color: var(--primary, #b8341c); }
      .ngo-notif-icon.success  { background: rgba(46, 125, 79, 0.12); color: var(--success, #2e7d4f); }
      .ngo-notif-icon.warning  { background: rgba(138, 109, 0, 0.14); color: var(--warning, #8a6d00); }
      .ngo-notif-icon.critical { background: rgba(186, 26, 26, 0.10); color: var(--danger, #ba1a1a); }

      .ngo-notif-title {
        font-size: 16px; font-weight: 700; line-height: 1.3;
        letter-spacing: -0.005em;
        color: var(--on-surface, #1b1c1d);
      }
      .ngo-notif-body {
        font-size: 14px; line-height: 1.55;
        color: var(--on-surface-variant, #434653);
        white-space: pre-wrap; word-wrap: break-word;
        max-height: 260px; overflow-y: auto;
        margin-bottom: 14px;
        padding-right: 4px;
      }
      .ngo-notif-body::-webkit-scrollbar { width: 6px; }
      .ngo-notif-body::-webkit-scrollbar-thumb {
        background: var(--ghost-border, rgba(60, 64, 75, 0.32));
        border-radius: 999px;
      }
      .ngo-notif-meta {
        font-size: 11px;
        color: var(--on-surface-muted, #737784);
        margin-bottom: 16px;
        letter-spacing: 0.01em;
        text-transform: uppercase;
        font-weight: 600;
      }
      .ngo-notif-actions {
        display: flex; gap: 8px; flex-wrap: wrap;
        justify-content: flex-end;
        padding-top: 14px;
        border-top: 1px solid var(--ghost-border, rgba(60, 64, 75, 0.32));
      }
      .ngo-notif-btn {
        padding: 9px 18px;
        border-radius: 8px;
        border: 1px solid var(--ghost-border, rgba(60, 64, 75, 0.32));
        background: transparent;
        color: var(--on-surface, #1b1c1d);
        font-family: inherit;
        font-size: 13px; font-weight: 600;
        letter-spacing: 0.005em;
        cursor: pointer;
        transition: background 0.12s ease, border-color 0.12s ease, transform 0.08s ease;
      }
      .ngo-notif-btn:hover  { background: var(--surface-container-low, #e4e2e3); border-color: var(--ghost-border-strong, rgba(60, 64, 75, 0.5)); }
      .ngo-notif-btn:active { transform: translateY(1px); }
      .ngo-notif-btn.primary {
        background: var(--primary, #b8341c);
        border-color: var(--primary, #b8341c);
        color: var(--on-primary, #ffffff);
      }
      .ngo-notif-btn.primary:hover {
        background: var(--primary-container, #d94734);
        border-color: var(--primary-container, #d94734);
      }
    `;
    const tag = document.createElement('style');
    tag.id = 'ngo-notif-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function iconFor(severity) {
    switch (severity) {
      case 'success':  return '✓';
      case 'warning':  return '!';
      case 'critical': return '⚠';
      default:         return 'i';
    }
  }

  // -----------------------------------------------------------------
  // Show one notification at a time. The next-in-queue is shown after
  // the current one's read receipt POSTs. Bailing on errors keeps the
  // popup usable even if the server is unreachable.
  // -----------------------------------------------------------------
  let queue = [];
  let activeOverlay = null;

  function showNext() {
    if (activeOverlay || !queue.length) return;
    const n = queue.shift();
    activeOverlay = renderDialog(n);
  }

  function renderDialog(n) {
    injectStyles();
    const overlay = document.createElement('div');
    overlay.className = 'ngo-notif-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const sev = n.severity || 'info';
    const card = document.createElement('div');
    card.className = 'ngo-notif-card sev-' + sev;
    card.innerHTML = `
      <div class="ngo-notif-head">
        <div class="ngo-notif-icon ${sev}">${iconFor(sev)}</div>
        <div class="ngo-notif-title"></div>
      </div>
      <div class="ngo-notif-body"></div>
      <div class="ngo-notif-meta"></div>
      <div class="ngo-notif-actions">
        ${n.ctaLabel && n.ctaUrl ? '<button class="ngo-notif-btn primary" data-act="cta"></button>' : ''}
        <button class="ngo-notif-btn" data-act="ok">OK</button>
      </div>
    `;
    // Use textContent to keep admin-supplied strings safe from injection.
    card.querySelector('.ngo-notif-title').textContent = n.title || '';
    card.querySelector('.ngo-notif-body').textContent = n.body || '';
    const meta = card.querySelector('.ngo-notif-meta');
    if (meta) {
      try {
        meta.textContent = new Date(n.createdAt).toLocaleString();
      } catch { meta.textContent = ''; }
    }

    if (n.ctaLabel && n.ctaUrl) {
      const btn = card.querySelector('[data-act="cta"]');
      if (btn) {
        btn.textContent = n.ctaLabel;
        btn.addEventListener('click', () => {
          // Open the CTA in a new tab AND mark read in one go.
          try { chrome.tabs.create({ url: n.ctaUrl }); } catch { window.open(n.ctaUrl, '_blank'); }
          dismiss(n.id);
        });
      }
    }
    card.querySelector('[data-act="ok"]').addEventListener('click', () => dismiss(n.id));

    overlay.appendChild(card);
    // Clicking the dimmed background does NOT dismiss; admin messages
    // shouldn't be too easy to swipe away. Users must press OK / CTA.

    document.body.appendChild(overlay);
    return overlay;
  }

  async function dismiss(id) {
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
    try {
      await api('/api/notifications/' + encodeURIComponent(id) + '/read', { method: 'POST' });
    } catch (e) {
      console.warn('[Notifications] mark-read failed:', e?.message);
    }
    showNext();
  }

  // -----------------------------------------------------------------
  // Public entry point. Called by popup.js on DOMContentLoaded.
  // -----------------------------------------------------------------
  async function pollAndShow() {
    try {
      const data = await api('/api/notifications/unread');
      const list = Array.isArray(data?.notifications) ? data.notifications : [];
      if (!list.length) return;
      queue = list;
      showNext();
    } catch (e) {
      // Silent: not having notifications shouldn't block the popup UX.
      console.warn('[Notifications] poll failed:', e?.message);
    }
  }

  window.NgoNotifications = { pollAndShow };
})();
