// Setup page — wires Telegram, WhatsApp, and agent preference controls.

(async function () {
  // Loading overlay
  const loadingOverlay = document.getElementById('initial-loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingSubtext = document.getElementById('loading-subtext');

  function updateLoading(status, sub) {
    if (loadingStatus) loadingStatus.textContent = status;
    if (loadingSubtext) loadingSubtext.textContent = sub;
  }

  function hideLoading() {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
  }

  // Auth gate
  const auth = window.NewOrderAuth || window.Auth;
  if (auth && typeof auth.requireAuth === 'function') {
    updateLoading('Authenticating', 'Checking session...');
    const ok = await auth.requireAuth();
    if (!ok) return;
  }

  const $ = (id) => document.getElementById(id);
  const toast = (msg, level) => {
    const el = $('setup-toast');
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background = level === 'error' ? 'var(--danger-bg, #fee4e2)' : 'var(--success-bg, #d1fadf)';
    el.style.color = level === 'error' ? 'var(--danger, #b42318)' : 'var(--success, #027a48)';
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  };

  async function load() {
    try {
      updateLoading('Loading Integrations', 'Fetching your setup...');
      const data = await NewOrderAPI.request('/api/integrations');
      renderTelegram(data.telegram);
      renderWhatsApp(data.whatsapp);
      renderPrefs(data.preferences);
      hideLoading();
    } catch (e) {
      hideLoading();
      toast('Failed to load integrations: ' + e.message, 'error');
    }
  }

  function renderTelegram(t) {
    const status = $('tg-status');
    const lbl = status.querySelector('.lbl');
    const linkInfo = $('tg-link-info');
    const btnTest = $('btn-tg-test');
    const btnUnlink = $('btn-tg-unlink');
    const storedToken = sessionStorage.getItem('tg_bot_token');

    if (t.chatId) {
      status.className = 'status-pill connected';
      lbl.textContent = 'Linked';
      linkInfo.style.display = 'none';
      btnTest.style.display = 'inline-flex';
      btnUnlink.style.display = 'inline-flex';
    } else if (t.configured && t.linkCode) {
      status.className = 'status-pill disconnected';
      lbl.textContent = 'Awaiting /link';
      linkInfo.style.display = 'block';
      $('tg-bot-handle').textContent = t.botUsername ? '@' + t.botUsername : '(your bot)';
      $('tg-link-cmd').textContent = '/link ' + t.linkCode;

      // Show the full webhook URL - use stored token if available, otherwise placeholder
      if (t.fullSetWebhookUrl) {
        let webhookUrl = t.fullSetWebhookUrl;
        if (storedToken) {
          webhookUrl = t.fullSetWebhookUrl.replace(':BOT_TOKEN', storedToken);
          $('tg-webhook-link').href = webhookUrl;
          $('tg-webhook-link').style.cursor = 'pointer';
          $('tg-webhook-link').style.color = '';
          $('tg-webhook-link').title = 'Click to open in new tab';
        } else {
          $('tg-webhook-link').removeAttribute('href');
          $('tg-webhook-link').style.cursor = 'not-allowed';
          $('tg-webhook-link').style.color = 'var(--on-surface-muted)';
          $('tg-webhook-link').title = 'Re-enter your bot token above and click Save to generate the clickable link';
        }
        $('tg-webhook-link').textContent = webhookUrl;
        $('tg-webhook-link').style.display = 'inline-block';
      }

      // Show cURL with stored token if available, otherwise placeholder
      if (t.webhookUrl) {
        const tokenForCurl = storedToken || ':BOT_TOKEN';
        $('tg-webhook-curl').textContent = 'curl -X POST "https://api.telegram.org/bot' + tokenForCurl + '/setWebhook" \\n  -d "url=' + t.webhookUrl + '"';
      }
      btnUnlink.style.display = 'inline-flex';
    } else {
      status.className = 'status-pill disconnected';
      lbl.textContent = 'Not connected';
      linkInfo.style.display = 'none';
      btnTest.style.display = 'none';
      btnUnlink.style.display = 'none';
    }
  }

  function renderWhatsApp(w) {
    const status = $('wa-status');
    const lbl = status.querySelector('.lbl');
    if (w.verified) {
      status.className = 'status-pill connected';
      lbl.textContent = 'Linked';
      $('btn-wa-test').style.display = 'inline-flex';
      $('btn-wa-unlink').style.display = 'inline-flex';
      $('btn-wa-verify').style.display = 'inline-flex';
    } else if (w.enabled) {
      status.className = 'status-pill disconnected';
      lbl.textContent = 'Awaiting verification';
      $('btn-wa-verify').style.display = 'inline-flex';
      $('btn-wa-unlink').style.display = 'inline-flex';
    } else {
      status.className = 'status-pill disconnected';
      lbl.textContent = 'Not connected';
      $('btn-wa-verify').style.display = 'none';
      $('btn-wa-test').style.display = 'none';
      $('btn-wa-unlink').style.display = 'none';
    }
    if (w.groupName) {
      $('wa-group-name').value = w.groupName;
      $('wa-group-display').textContent = `"${w.groupName}"`;
      $('wa-group-name-tip').textContent = w.groupName;
    }
  }

  function renderPrefs(p) {
    if (!p) return;
    $('pref-notify-channel').value = p.notifyChannel || 'none';
    $('pref-notify-complete').checked = !!p.notifyOnComplete;
    $('pref-notify-awaiting').checked = !!p.notifyOnAwaitingUser;
    $('pref-notify-failure').checked = !!p.notifyOnFailure;
    $('pref-can-close-tabs').checked = !!p.canCloseTabs;
    $('pref-auto-close-limit').checked = !!p.autoCloseExceedingLimit;
    $('pref-prefer-current').checked = !!p.preferCurrentTab;
    $('pref-auto-confirm-low').checked = !!p.autoConfirmLowRisk;
    $('pref-verbose').checked = !!p.verboseLogging;
  }

  // ============================================
  // Telegram handlers
  // ============================================
  $('btn-tg-save').addEventListener('click', async () => {
    const token = $('tg-token').value.trim();
    if (!token) return toast('Enter the bot token first', 'error');
    try {
      const data = await NewOrderAPI.request('/api/integrations/telegram/setup', {
        method: 'POST',
        body: JSON.stringify({ botToken: token })
      });
      // Store token in sessionStorage for persistence across reloads
      sessionStorage.setItem('tg_bot_token', token);
      toast('Token accepted! Send /link in your bot.');
      $('tg-token').value = '';
      // Call load() to re-render - renderTelegram now checks sessionStorage for the token
      await load();
    } catch (e) { toast('Telegram setup failed: ' + e.message, 'error'); }
  });

  $('btn-tg-unlink').addEventListener('click', async () => {
    if (!confirm('Unlink your Telegram bot?')) return;
    try {
      await NewOrderAPI.request('/api/integrations/telegram/unlink', { method: 'POST' });
      sessionStorage.removeItem('tg_bot_token');
      toast('Telegram unlinked.');
      await load();
    } catch (e) { toast('Failed to unlink: ' + e.message, 'error'); }
  });

  $('btn-tg-test').addEventListener('click', async () => {
    try {
      const r = await NewOrderAPI.request('/api/integrations/test', {
        method: 'POST',
        body: JSON.stringify({ channel: 'telegram' })
      });
      toast(r.sent ? 'Test message sent!' : ('Not sent: ' + (r.reason || r.error || 'unknown')), r.sent ? null : 'error');
    } catch (e) { toast('Test failed: ' + e.message, 'error'); }
  });

  // Click-to-copy (exclude webhook link which should open in new tab)
  document.querySelectorAll('.copy-code').forEach(el => {
    if (el.id === 'tg-webhook-link') return; // Skip webhook link - it should navigate
    el.addEventListener('click', () => {
      const text = el.textContent.trim();
      navigator.clipboard.writeText(text).then(() => toast('Copied: ' + text));
    });
  });

  // ============================================
  // WhatsApp handlers
  // ============================================
  $('btn-wa-enable').addEventListener('click', async () => {
    const groupName = ($('wa-group-name').value || 'My Agent').trim();
    try {
      await NewOrderAPI.request('/api/integrations/whatsapp/setup', {
        method: 'POST',
        body: JSON.stringify({ groupName })
      });
      toast('Saved. Now open WhatsApp Web and click Verify.');
      await load();
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  });

  $('btn-wa-verify').addEventListener('click', async () => {
    // Ask the extension to check WhatsApp Web for the group
    try {
      const groupName = $('wa-group-name').value.trim();
      const result = await chrome.runtime.sendMessage({
        type: 'ge-wa-verify',
        groupName
      });
      if (!result?.found) {
        toast(result?.error || 'Group not found in WhatsApp Web. Open web.whatsapp.com first.', 'error');
        return;
      }
      // Server-side mark verified
      await NewOrderAPI.request('/api/integrations/whatsapp/verify', { method: 'POST' });
      toast('WhatsApp linked!');
      await load();
    } catch (e) { toast('Verify failed: ' + e.message, 'error'); }
  });

  $('btn-wa-unlink').addEventListener('click', async () => {
    if (!confirm('Unlink WhatsApp?')) return;
    try {
      await NewOrderAPI.request('/api/integrations/whatsapp/unlink', { method: 'POST' });
      toast('WhatsApp unlinked.');
      await load();
    } catch (e) { toast('Failed to unlink: ' + e.message, 'error'); }
  });

  $('btn-wa-test').addEventListener('click', async () => {
    try {
      const r = await NewOrderAPI.request('/api/integrations/test', {
        method: 'POST',
        body: JSON.stringify({ channel: 'whatsapp' })
      });
      toast(r.sent ? 'Test queued — check WhatsApp.' : ('Not sent: ' + (r.reason || r.error || 'unknown')), r.sent ? null : 'error');
    } catch (e) { toast('Test failed: ' + e.message, 'error'); }
  });

  // ============================================
  // Preferences
  // ============================================
  $('btn-save-prefs').addEventListener('click', async () => {
    const body = {
      notifyChannel: $('pref-notify-channel').value,
      notifyOnComplete: $('pref-notify-complete').checked,
      notifyOnAwaitingUser: $('pref-notify-awaiting').checked,
      notifyOnFailure: $('pref-notify-failure').checked,
      canCloseTabs: $('pref-can-close-tabs').checked,
      autoCloseExceedingLimit: $('pref-auto-close-limit').checked,
      preferCurrentTab: $('pref-prefer-current').checked,
      autoConfirmLowRisk: $('pref-auto-confirm-low').checked,
      verboseLogging: $('pref-verbose').checked
    };
    try {
      await NewOrderAPI.request('/api/integrations/preferences', {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      toast('Preferences saved.');
    } catch (e) { toast('Failed to save: ' + e.message, 'error'); }
  });

  load();
})();
