document.addEventListener('DOMContentLoaded', async () => {
  const user = await NewOrderAuth.init();
  if (!user) {
    window.location.href = '../builder/builder.html';
    return;
  }

  // Populate user data
  document.getElementById('user-email').value = user.email;
  if (user.displayName) {
    document.getElementById('display-name').value = user.displayName;
  }

  // ============================================
  // Server URL (Self-Hosted / Local)
  // ============================================
  const serverUrlInput = document.getElementById('server-url');
  const serverStatusBadge = document.getElementById('server-status-badge');
  const serverStatusText = document.getElementById('server-status-text');

  // Load current server URL
  async function loadServerUrl() {
    const baseUrl = await NewOrderAPI.getBaseUrl();
    if (baseUrl !== NewOrderAPI.DEFAULT_BASE_URL) {
      serverUrlInput.value = baseUrl;
    } else {
      serverUrlInput.value = '';
    }
    await checkServerStatus(baseUrl);
  }

  async function checkServerStatus(url) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${url}/api/models`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${await NewOrderAPI.getToken()}` }
      });
      clearTimeout(timeout);
      if (resp.ok) {
        serverStatusBadge.className = 'status-badge connected';
        serverStatusBadge.querySelector('svg').innerHTML = '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>';
        const isLocal = url !== NewOrderAPI.DEFAULT_BASE_URL;
        serverStatusText.textContent = isLocal ? `Connected to ${url}` : 'Connected (cloud)';
      } else {
        serverStatusBadge.className = 'status-badge';
        serverStatusBadge.querySelector('svg').innerHTML = '<circle cx="12" cy="12" r="10"/>';
        serverStatusText.textContent = `Server responded with error (${resp.status})`;
      }
    } catch (e) {
      serverStatusBadge.className = 'status-badge';
      serverStatusBadge.querySelector('svg').innerHTML = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
      serverStatusText.textContent = 'Cannot reach server';
    }
  }

  loadServerUrl();

  document.getElementById('server-url-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = serverUrlInput.value.trim();

    if (url) {
      // Validate URL format
      try {
        new URL(url);
      } catch {
        alert('Please enter a valid URL (e.g. http://localhost:3001)');
        return;
      }
      NewOrderAPI.setBaseUrl(url.replace(/\/+$/, ''));
    } else {
      NewOrderAPI.resetBaseUrl();
    }

    const newUrl = await NewOrderAPI.getBaseUrl();
    await checkServerStatus(newUrl);
    alert(url ? `Server URL set to ${newUrl}. Reload any open New Order tabs for the change to take effect.` : 'Reset to cloud server. Reload any open New Order tabs for the change to take effect.');
  });

  document.getElementById('btn-reset-server').addEventListener('click', () => {
    NewOrderAPI.resetBaseUrl();
    serverUrlInput.value = '';
    checkServerStatus(NewOrderAPI.DEFAULT_BASE_URL);
    alert('Reset to cloud server. Reload any open New Order tabs for the change to take effect.');
  });

  // Profile form handler
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = document.getElementById('display-name').value.trim();
    
    if (!displayName) {
      alert('Display name is required');
      return;
    }

    try {
      const baseUrl = await NewOrderAPI.getBaseUrl();
      const response = await fetch(`${baseUrl}/api/user/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({ displayName })
      });

      if (response.ok) {
        alert('Profile updated successfully');
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to update profile');
      }
    } catch (error) {
      console.error('Profile update error:', error);
      alert('Failed to update profile. Please try again.');
    }
  });

  // Password form handler
  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;

    if (!currentPassword || !newPassword) {
      alert('Please fill in all password fields');
      return;
    }

    if (newPassword.length < 8) {
      alert('New password must be at least 8 characters');
      return;
    }

    try {
      const baseUrl = await NewOrderAPI.getBaseUrl();
      const response = await fetch(`${baseUrl}/api/user/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      if (response.ok) {
        alert('Password updated successfully');
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to update password');
      }
    } catch (error) {
      console.error('Password update error:', error);
      alert('Failed to update password. Please try again.');
    }
  });

  // Delete account handler
  document.getElementById('btn-delete-account').addEventListener('click', async () => {
    const confirmed = confirm('Are you sure you want to delete your account? This action cannot be undone and will permanently delete all your data including saved tools.');
    
    if (!confirmed) return;

    const secondConfirmed = confirm('This is your last chance. Are you absolutely sure you want to delete your account?');
    
    if (!secondConfirmed) return;

    try {
      const baseUrl = await NewOrderAPI.getBaseUrl();
      const response = await fetch(`${baseUrl}/api/user/account`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${user.token}`
        }
      });

      if (response.ok) {
        alert('Account deleted successfully');
        NewOrderAuth.logout();
        window.location.href = '../builder/builder.html';
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to delete account');
      }
    } catch (error) {
      console.error('Account deletion error:', error);
      alert('Failed to delete account. Please try again.');
    }
  });

  // Logout handler — themed modal, plan-aware
  document.getElementById('btn-logout').addEventListener('click', () => {
    showSignOutModal(user);
  });
});

// ============================================
// Sign-Out Modal (themed, plan-aware)
// ============================================
function isSubscriberUser(u) {
  if (!u) return false;
  if (u.subscription && u.subscription.status === 'active') return true;
  if (u.plan && u.plan !== 'free' && u.plan !== 'none') return true;
  return false;
}

function ensureSignOutModalStyles() {
  if (document.getElementById('no-signout-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'no-signout-modal-styles';
  style.textContent = `
    .no-modal-overlay {
      position: fixed; inset: 0;
      background: rgba(27, 28, 29, 0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999;
      animation: noModalFadeIn 0.2s ease;
      font-family: var(--font-body, 'Inter', system-ui, sans-serif);
    }
    @keyframes noModalFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes noModalSlideIn {
      from { transform: translateY(12px) scale(0.98); opacity: 0; }
      to   { transform: translateY(0) scale(1); opacity: 1; }
    }
    .no-modal-card {
      width: min(92vw, 520px);
      max-height: 90vh;
      overflow-y: auto;
      background: var(--surface-container-lowest, #ffffff);
      border: 1px solid var(--ghost-border, rgba(60,64,75,0.32));
      border-radius: var(--radius-xl, 1rem);
      box-shadow: var(--shadow-lg, 0 24px 48px rgba(27,28,29,0.20));
      padding: 28px 28px 24px;
      animation: noModalSlideIn 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .no-modal-eyebrow {
      display: inline-flex; align-items: center; gap: 8px;
      font-family: var(--font-label, 'Public Sans', sans-serif);
      font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--primary, #b8341c);
      margin-bottom: 10px;
    }
    .no-modal-eyebrow::before {
      content: ''; width: 6px; height: 6px; border-radius: 50%;
      background: var(--primary, #b8341c);
      box-shadow: 0 0 0 4px rgba(184,52,28,0.12);
    }
    .no-modal-title {
      font-family: var(--font-headline, 'Noto Serif', Georgia, serif);
      font-size: 24px; font-weight: 600; letter-spacing: -0.01em;
      color: var(--on-surface, #1b1c1d);
      margin: 0 0 6px;
    }
    .no-modal-subtitle {
      font-size: 14px; line-height: 1.55;
      color: var(--on-surface-variant, #434653);
      margin: 0 0 20px;
    }
    .no-modal-callout {
      background: rgba(184, 52, 28, 0.06);
      border: 1px solid rgba(184, 52, 28, 0.18);
      border-radius: var(--radius-md, 0.5rem);
      padding: 12px 14px;
      font-size: 13px; line-height: 1.55;
      color: var(--on-surface, #1b1c1d);
      margin-bottom: 18px;
    }
    .no-modal-callout strong { color: var(--primary, #b8341c); }
    .no-modal-options { display: flex; flex-direction: column; gap: 10px; margin-bottom: 22px; }
    .no-modal-option {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 14px 16px;
      background: var(--surface-container-low, #e4e2e3);
      border: 1.5px solid transparent;
      border-radius: var(--radius-lg, 0.75rem);
      cursor: pointer;
      transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
    }
    .no-modal-option:hover { transform: translateY(-1px); background: var(--surface-container, #d8d6d7); }
    .no-modal-option.selected {
      border-color: var(--primary, #b8341c);
      background: var(--surface-container-lowest, #ffffff);
      box-shadow: 0 0 0 4px rgba(184,52,28,0.08);
    }
    .no-modal-radio {
      width: 18px; height: 18px; flex-shrink: 0; margin-top: 2px;
      border: 2px solid var(--ghost-border-strong, rgba(60,64,75,0.5));
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      transition: border-color 0.18s ease;
    }
    .no-modal-option.selected .no-modal-radio { border-color: var(--primary, #b8341c); }
    .no-modal-option.selected .no-modal-radio::after {
      content: ''; width: 8px; height: 8px; border-radius: 50%;
      background: var(--primary, #b8341c);
    }
    .no-modal-option-body { flex: 1; min-width: 0; }
    .no-modal-option-title {
      font-weight: 600; font-size: 14px;
      color: var(--on-surface, #1b1c1d);
      margin-bottom: 3px;
    }
    .no-modal-option-desc {
      font-size: 12px; line-height: 1.5;
      color: var(--on-surface-muted, #737784);
    }
    .no-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
    .no-modal-btn {
      padding: 11px 20px;
      border-radius: var(--radius-md, 0.5rem);
      font-family: var(--font-label, 'Public Sans', sans-serif);
      font-size: 13px; font-weight: 700; letter-spacing: 0.04em;
      cursor: pointer;
      transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
      border: 1px solid transparent;
    }
    .no-modal-btn-ghost {
      background: transparent;
      color: var(--on-surface, #1b1c1d);
      border-color: var(--ghost-border-strong, rgba(60,64,75,0.5));
    }
    .no-modal-btn-ghost:hover { background: var(--surface-container, #d8d6d7); }
    .no-modal-btn-primary {
      background: linear-gradient(135deg, var(--primary, #b8341c) 0%, var(--primary-container, #d94734) 100%);
      color: var(--on-primary, #ffffff);
      box-shadow: var(--shadow-xs, 0 1px 2px rgba(27,28,29,0.08));
    }
    .no-modal-btn-primary:hover { transform: translateY(-1px); }
    .no-modal-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
  `;
  document.head.appendChild(style);
}

function showSignOutModal(user) {
  ensureSignOutModalStyles();

  const subscriber = isSubscriberUser(user);

  const overlay = document.createElement('div');
  overlay.className = 'no-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const card = document.createElement('div');
  card.className = 'no-modal-card';

  if (subscriber) {
    card.innerHTML = `
      <div class="no-modal-eyebrow">Sign out</div>
      <h2 class="no-modal-title">Before you go</h2>
      <p class="no-modal-subtitle">
        You're on a paid plan. Choose how you want to handle your locally cached
        tools and tool data on this device.
      </p>

      <div class="no-modal-options" id="no-signout-options">
        <div class="no-modal-option selected" data-mode="keep">
          <div class="no-modal-radio"></div>
          <div class="no-modal-option-body">
            <div class="no-modal-option-title">Keep tools cached on this device</div>
            <div class="no-modal-option-desc">
              Tools and the data they've collected stay on this browser. Signing
              back in is instant, and nothing is lost.
            </div>
          </div>
        </div>
        <div class="no-modal-option" data-mode="reset">
          <div class="no-modal-radio"></div>
          <div class="no-modal-option-body">
            <div class="no-modal-option-title">Reset and re-download next sign-in</div>
            <div class="no-modal-option-desc">
              Tools are removed from this device and freshly re-downloaded when
              you sign back in. <strong>Tool data on this device will be permanently
              lost</strong> — only the tools themselves are restored from your account.
            </div>
          </div>
        </div>
      </div>

      <div class="no-modal-actions">
        <button class="no-modal-btn no-modal-btn-ghost" data-action="cancel">Cancel</button>
        <button class="no-modal-btn no-modal-btn-primary" data-action="confirm">Sign Out</button>
      </div>
    `;
  } else {
    card.innerHTML = `
      <div class="no-modal-eyebrow">Sign out</div>
      <h2 class="no-modal-title">Heads up before signing out</h2>
      <p class="no-modal-subtitle">
        You're on the <strong>Free</strong> plan. Your tools live in your account
        and will sync back in when you return — but anything stored on this
        device by those tools will be cleared.
      </p>

      <div class="no-modal-callout">
        <strong>You'll lose:</strong> the data your tools have collected on this
        browser (saved entries, preferences, history, etc.).<br>
        <strong>You'll keep:</strong> the tools themselves — they re-download
        automatically when you sign back in.
      </div>

      <div class="no-modal-actions">
        <button class="no-modal-btn no-modal-btn-ghost" data-action="cancel">Cancel</button>
        <button class="no-modal-btn no-modal-btn-primary" data-action="confirm">Sign Out</button>
      </div>
    `;
  }

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Selection state for subscriber options
  let selectedMode = subscriber ? 'keep' : 'reset';

  if (subscriber) {
    const options = card.querySelectorAll('.no-modal-option');
    options.forEach(opt => {
      opt.addEventListener('click', () => {
        options.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedMode = opt.dataset.mode;
      });
    });
  }

  // Close helpers
  const close = () => {
    overlay.style.animation = 'noModalFadeIn 0.18s ease reverse';
    setTimeout(() => overlay.remove(), 160);
  };

  card.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  });

  // Confirm handler
  const confirmBtn = card.querySelector('[data-action="confirm"]');
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Signing out…';

    // Free users: always wipe both. Subscribers: based on selection.
    const opts = subscriber && selectedMode === 'keep'
      ? { clearTools: false, clearToolData: false }
      : { clearTools: true, clearToolData: true };

    try {
      await NewOrderAuth.logout(opts);
    } catch (err) {
      console.error('Sign-out error:', err);
    }
    window.location.href = '../builder/builder.html';
  });
}

// ============================================
// Extension Updates section — wires the toggle + "Check now" button.
// Defined as a separate IIFE so it can co-exist with the existing
// DOMContentLoaded handler at the top of this file. We wait for the
// next tick so all DOM ids the handler reads are present.
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('auto-extension-updates');
  const checkBtn = document.getElementById('btn-check-updates');
  const versionBadge = document.getElementById('ext-version-badge');
  const versionText = document.getElementById('ext-version-text');
  const resultEl = document.getElementById('update-result');
  if (!toggle || !checkBtn || !versionText) return;

  // Show the currently installed version from the manifest.
  try {
    const v = chrome.runtime.getManifest().version;
    versionText.textContent = `Installed: v${v}`;
  } catch {
    versionText.textContent = 'Installed: unknown';
  }

  // Hydrate the toggle from /api/agent-settings.
  (async function loadAutoUpdatesPref() {
    try {
      const data = await NewOrderAPI.request('/api/agent-settings');
      // Default ON when settings missing or the field is undefined.
      const auto = !data?.settings || data.settings.autoExtensionUpdates !== false;
      toggle.checked = auto;
    } catch (err) {
      console.warn('[Settings] Failed to load auto-update pref:', err);
    }
  })();

  // Persist the toggle. We send the autoExtensionUpdates flag alone; the
  // /agent-settings PUT route preserves other fields it doesn't see.
  toggle.addEventListener('change', async () => {
    try {
      await NewOrderAPI.request('/api/agent-settings', {
        method: 'PUT',
        body: JSON.stringify({ autoExtensionUpdates: toggle.checked })
      });
    } catch (err) {
      console.error('[Settings] Failed to save auto-update pref:', err);
      // Roll back the visual on error so the UI matches the server.
      toggle.checked = !toggle.checked;
      alert('Could not save: ' + (err.message || err));
    }
  });

  // Manual check — hits the same endpoint the bg worker uses, but reports
  // the result inline regardless of the toggle (so users can verify their
  // setup even with auto-checks off).
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    resultEl.textContent = 'Checking…';
    try {
      const installed = chrome.runtime.getManifest().version;
      const data = await NewOrderAPI.request(
        `/api/extension/latest-release?currentVersion=${encodeURIComponent(installed)}`
      );
      if (!data.release) {
        resultEl.textContent = 'No releases published yet.';
      } else if (data.hasUpdate) {
        resultEl.innerHTML =
          `<strong>New version available:</strong> v${data.release.version} \u2014 ` +
          `<a href="${data.release.githubReleaseUrl}" target="_blank" rel="noopener">Open release page</a>`;
        // Forward to the bg worker so it surfaces the standard popup
        // dialog with the full changelog (re-uses the same UI users get
        // automatically).
        chrome.runtime.sendMessage({
          type: 'EXT_UPDATE_FORCE_SHOW',
          release: data.release
        });
      } else {
        resultEl.textContent = `You're on the latest version (v${data.release.version}).`;
      }
    } catch (err) {
      console.error('[Settings] check-updates failed:', err);
      resultEl.textContent = 'Check failed: ' + (err.message || err);
    } finally {
      checkBtn.disabled = false;
    }
  });
});
