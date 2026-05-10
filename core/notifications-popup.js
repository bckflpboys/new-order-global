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
  if (window.__ngoNotificationsPopupLoaded) return;
  window.__ngoNotificationsPopupLoaded = true;

  // -----------------------------------------------------------------
  // Auth helpers — keep self-contained to avoid coupling with whatever
  // auth shape popup.js happens to have at runtime.
  // -----------------------------------------------------------------
  async function getToken() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['authToken'], (r) => resolve(r?.authToken || ''));
    });
  }
  async function getBaseUrl() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['serverUrl'], (r) => {
        const url = (r?.serverUrl || 'https://api.newordr.io').replace(/\/$/, '');
        resolve(url);
      });
    });
  }
  async function api(path, options = {}) {
    const token = await getToken();
    const base = await getBaseUrl();
    const res = await fetch(base + path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: options.body || undefined
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json().catch(() => ({}));
  }

  // -----------------------------------------------------------------
  // Styles — injected once on first show so empty popups stay clean.
  // -----------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('ngo-notif-styles')) return;
    const css = `
      .ngo-notif-overlay {
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(0,0,0,0.55); backdrop-filter: blur(2px);
        display: flex; align-items: flex-end; justify-content: center;
        padding: 16px; box-sizing: border-box;
        animation: ngoFade 0.18s ease-out;
      }
      @keyframes ngoFade { from { opacity: 0 } to { opacity: 1 } }
      .ngo-notif-card {
        width: 100%; max-width: 400px;
        background: #1c1d22; color: #f0f0f0;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 16px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.5);
        padding: 18px 20px 16px; box-sizing: border-box;
        font-family: var(--font-body, system-ui, -apple-system, sans-serif);
        animation: ngoSlide 0.22s ease-out;
      }
      @keyframes ngoSlide { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      .ngo-notif-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .ngo-notif-icon {
        width: 32px; height: 32px; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; font-size: 18px;
      }
      .ngo-notif-icon.info     { background: rgba(91, 108, 255, 0.18); color: #9aa6ff; }
      .ngo-notif-icon.success  { background: rgba(80, 200, 120, 0.18); color: #6fd693; }
      .ngo-notif-icon.warning  { background: rgba(255, 180, 60, 0.18); color: #ffc55a; }
      .ngo-notif-icon.critical { background: rgba(255, 80, 80, 0.18); color: #ff7e7e; }
      .ngo-notif-title { font-size: 15px; font-weight: 700; line-height: 1.25; }
      .ngo-notif-body {
        font-size: 13px; line-height: 1.5; opacity: 0.92;
        white-space: pre-wrap; max-height: 240px; overflow-y: auto;
        margin-bottom: 14px;
      }
      .ngo-notif-meta { font-size: 10px; opacity: 0.5; margin-bottom: 12px; }
      .ngo-notif-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
      .ngo-notif-btn {
        padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.04); color: #f0f0f0; font-family: inherit;
        font-size: 13px; font-weight: 600; cursor: pointer;
        transition: background 0.12s ease, transform 0.08s ease;
      }
      .ngo-notif-btn:hover { background: rgba(255,255,255,0.1); }
      .ngo-notif-btn:active { transform: scale(0.97); }
      .ngo-notif-btn.primary { background: linear-gradient(135deg, #5b6cff, #b066ff); border-color: transparent; }
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
    card.className = 'ngo-notif-card';
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
      console.debug('[Notifications] poll failed:', e?.message);
    }
  }

  window.NgoNotifications = { pollAndShow };
})();
