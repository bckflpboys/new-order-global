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

    // Research-depth fields. Defaults match the server-side
    // RESEARCH_DEFAULTS so an existing user who never opened this card
    // sees the same numbers the agent is already using.
    const r = (p.research && typeof p.research === 'object') ? p.research : {};
    const setNum = (id, val, fallback) => {
      const el = $(id);
      if (!el) return;
      el.value = (typeof val === 'number' && Number.isFinite(val)) ? val : fallback;
    };
    setNum('pref-research-min-domains',   r.minDistinctDomains, 2);
    setNum('pref-research-max-pages',     r.maxSearchPages,     1);
    setNum('pref-research-min-sites',     r.minWebsitesToVisit, 2);
    setNum('pref-research-max-links',     r.maxLinksPerWebsite, 1);
    setNum('pref-research-max-paginated', r.maxPaginatedPages,  1);
    setNum('pref-research-scroll',        r.scrollPasses,       1);
    const verifyEl = $('pref-research-verify');
    if (verifyEl) verifyEl.checked = (typeof r.verifySources === 'boolean') ? r.verifySources : true;
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

  // ============================================
  // Research depth — saved through the same /preferences endpoint but
  // grouped into a `research` sub-object the server clamps to safe ranges.
  // ============================================
  const _resBtn = $('btn-save-research-depth');
  if (_resBtn) {
    _resBtn.addEventListener('click', async () => {
      const num = (id, fallback) => {
        const v = parseInt($(id)?.value, 10);
        return Number.isFinite(v) ? v : fallback;
      };
      const body = {
        research: {
          minDistinctDomains: num('pref-research-min-domains', 2),
          maxSearchPages:     num('pref-research-max-pages', 1),
          minWebsitesToVisit: num('pref-research-min-sites', 2),
          maxLinksPerWebsite: num('pref-research-max-links', 1),
          maxPaginatedPages:  num('pref-research-max-paginated', 1),
          scrollPasses:       num('pref-research-scroll', 1),
          verifySources:      !!$('pref-research-verify')?.checked
        }
      };
      try {
        const data = await NewOrderAPI.request('/api/integrations/preferences', {
          method: 'PUT',
          body: JSON.stringify(body)
        });
        if (data?.preferences) renderPrefs(data.preferences); // re-render to show clamped values
        toast('Research settings saved.');
      } catch (e) { toast('Failed to save: ' + e.message, 'error'); }
    });
  }

  // ============================================
  // Agent Settings (limits + behaviour + memory toggles)
  // ============================================
  let _ceilings = null;

  async function loadAgentSettings() {
    try {
      const data = await NewOrderAPI.request('/api/agent-settings');
      _ceilings = data.ceilings || {};
      const tierKey = data.tierKey || 'free';

      // Tier pill
      const pill = $('as-tier-pill');
      pill.querySelector('.lbl').textContent = 'Tier: ' + tierKey;
      pill.className = 'status-pill ' + (tierKey === 'free' ? 'disconnected' : 'connected');

      // Show ceilings
      $('as-max-steps-ceiling').textContent = _ceilings.maxSteps ?? '—';
      $('as-max-ss-task-ceiling').textContent = _ceilings.maxScreenshotsPerTask ?? '—';
      $('as-max-ss-step-ceiling').textContent = _ceilings.maxScreenshotsPerStep ?? '—';
      $('as-max-steps').max = _ceilings.maxSteps || 500;
      $('as-max-screenshots-task').max = _ceilings.maxScreenshotsPerTask || 10;
      $('as-max-screenshots-step').max = _ceilings.maxScreenshotsPerStep || 3;

      // Memory toggles only meaningful when tier supports memory
      const memBlock = $('as-memory-toggles');
      if (!_ceilings.canUseMemory) {
        memBlock.style.opacity = '0.4';
        memBlock.title = 'Memory is a paid-tier feature.';
        $('as-memory-enabled').disabled = true;
        $('as-auto-extract').disabled = true;
        $('card-memory').style.display = 'none';
      } else {
        $('card-memory').style.display = '';
      }

      // Super-only block
      $('as-superonly-block').style.display = (_ceilings.canUseSubAgents || _ceilings.canPersistSession) ? '' : 'none';

      // Scheduled card visibility
      $('card-scheduled').style.display = _ceilings.canScheduleTasks ? '' : 'none';

      // Fill values
      const s = data.settings || {};
      $('as-max-steps').value = s.maxSteps || '';
      $('as-max-screenshots-task').value = s.maxScreenshotsPerTask || '';
      $('as-max-screenshots-step').value = s.maxScreenshotsPerStep || '';
      $('as-temperature').value = (typeof s.temperature === 'number') ? s.temperature : '';
      $('as-custom-rules').value = s.customRules || '';
      $('as-memory-enabled').checked = s.memoryEnabled !== false;
      $('as-auto-extract').checked = s.autoExtractMemories !== false;
      $('as-max-sub-agents').value = s.maxSubAgents || 3;
      $('as-session-persistence').checked = !!s.sessionPersistenceEnabled;

      // Council role dropdowns — only meaningful for tiers with the
      // council prompt. Otherwise hide the whole block.
      const councilBlock = document.getElementById('as-council-block');
      if (councilBlock) {
        if (!_ceilings.useCouncilPrompt) {
          councilBlock.style.display = 'none';
        } else {
          councilBlock.style.display = '';
          await populateCouncilRoles(s.councilRoles || {});
        }
      }
    } catch (e) {
      toast('Failed to load agent settings: ' + e.message, 'error');
    }
  }

  // Populate the 4 role dropdowns with the user's available agent-capable
  // AI models. Selection value = openRouterId so the server can identify
  // the model regardless of display-name changes.
  let _availableModels = null;
  async function populateCouncilRoles(currentRoles) {
    if (!_availableModels) {
      try {
        const data = await NewOrderAPI.request('/api/models');
        _availableModels = (data.models || []).filter(m => m.isAgentModel !== false);
      } catch { _availableModels = []; }
    }
    for (const role of ['strategist', 'executor', 'critic', 'optimizer']) {
      const sel = $('as-role-' + role);
      if (!sel) continue;
      sel.innerHTML = '<option value="">Default (use task model)</option>';
      for (const m of _availableModels) {
        const opt = document.createElement('option');
        opt.value = m.openRouterId || m.id || m.name;
        opt.textContent = m.name + (m.tier ? ` — ${m.tier}` : '');
        sel.appendChild(opt);
      }
      sel.value = currentRoles[role] || '';
    }
  }

  $('btn-save-agent-settings').addEventListener('click', async () => {
    const num = (id) => {
      const v = $(id).value;
      if (v === '' || v === null) return 0;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const tempVal = $('as-temperature').value;
    const body = {
      maxSteps: num('as-max-steps'),
      maxScreenshotsPerTask: num('as-max-screenshots-task'),
      maxScreenshotsPerStep: num('as-max-screenshots-step'),
      temperature: tempVal === '' ? null : parseFloat(tempVal),
      customRules: $('as-custom-rules').value,
      memoryEnabled: $('as-memory-enabled').checked,
      autoExtractMemories: $('as-auto-extract').checked,
      maxSubAgents: num('as-max-sub-agents') || 3,
      sessionPersistenceEnabled: $('as-session-persistence').checked,
      councilRoles: {
        strategist: $('as-role-strategist')?.value || '',
        executor:   $('as-role-executor')?.value   || '',
        critic:     $('as-role-critic')?.value     || '',
        optimizer:  $('as-role-optimizer')?.value  || ''
      }
    };
    try {
      await NewOrderAPI.request('/api/agent-settings', { method: 'PUT', body: JSON.stringify(body) });
      toast('Agent settings saved.');
      loadAgentSettings();
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  });

  // ============================================
  // Per-Domain Rules
  // ============================================
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function loadDomainRules() {
    const list = $('domain-rules-list');
    list.innerHTML = '<div style="color: var(--on-surface-muted); font-size: 13px;">Loading…</div>';
    try {
      const data = await NewOrderAPI.request('/api/domain-rules');
      const rules = data.rules || [];
      if (!rules.length) {
        list.innerHTML = '<div style="color: var(--on-surface-muted); font-size: 13px; padding: 8px;">No domain rules yet. Add one above to constrain the agent on specific sites.</div>';
        return;
      }
      list.innerHTML = '';
      for (const r of rules) {
        const sevColor = r.severity === 'must' ? 'var(--error, #b42318)' : r.severity === 'should' ? 'var(--primary)' : 'var(--on-surface-muted)';
        const row = document.createElement('div');
        row.style.cssText = 'display: grid; grid-template-columns: 1fr 2fr 100px auto auto; gap: 8px; align-items: center; padding: 10px; background: var(--surface-container-low); border-radius: 6px; ' + (r.enabled ? '' : 'opacity: 0.5;');
        row.innerHTML = `
          <code style="font-size: 13px; font-weight: 600;">${escapeHtml(r.domain)}</code>
          <span style="font-size: 13px;">${escapeHtml(r.rule)}</span>
          <span style="font-size: 12px; font-weight: 600; color: ${sevColor}; text-transform: uppercase;">${escapeHtml(r.severity)}</span>
          <button class="btn-secondary" data-toggle="${r._id}" style="font-size: 12px; padding: 4px 8px;">${r.enabled ? 'Disable' : 'Enable'}</button>
          <button class="btn-danger" data-del="${r._id}" style="font-size: 12px; padding: 4px 8px;">Delete</button>
        `;
        list.appendChild(row);
      }
      list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this domain rule?')) return;
        try { await NewOrderAPI.request('/api/domain-rules/' + b.dataset.del, { method: 'DELETE' }); loadDomainRules(); }
        catch (e) { toast('Delete failed: ' + e.message, 'error'); }
      }));
      list.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
        const wasEnabled = b.textContent === 'Disable';
        try {
          await NewOrderAPI.request('/api/domain-rules/' + b.dataset.toggle, {
            method: 'PUT', body: JSON.stringify({ enabled: !wasEnabled })
          });
          loadDomainRules();
        } catch (e) { toast('Toggle failed: ' + e.message, 'error'); }
      }));
    } catch (e) {
      list.innerHTML = '<div style="color: var(--error); font-size: 13px;">Failed to load: ' + escapeHtml(e.message) + '</div>';
    }
  }

  $('btn-add-domain-rule').addEventListener('click', async () => {
    const domain = $('dr-domain').value.trim();
    const rule = $('dr-rule').value.trim();
    const severity = $('dr-severity').value;
    if (!domain || !rule) return toast('Domain and rule are both required', 'error');
    try {
      await NewOrderAPI.request('/api/domain-rules', {
        method: 'POST', body: JSON.stringify({ domain, rule, severity })
      });
      $('dr-domain').value = '';
      $('dr-rule').value = '';
      toast('Rule added.');
      loadDomainRules();
    } catch (e) { toast('Add failed: ' + e.message, 'error'); }
  });

  // ============================================
  // Memory Browser
  // ============================================
  async function loadMemory() {
    const list = $('memory-list');
    list.innerHTML = '<div style="color: var(--on-surface-muted); font-size: 13px;">Loading…</div>';
    try {
      const data = await NewOrderAPI.request('/api/memory');
      const mems = data.memories || [];
      if (!mems.length) {
        list.innerHTML = '<div style="color: var(--on-surface-muted); font-size: 13px; padding: 8px;">No memories yet. The agent will start saving facts as you complete tasks (auto-extract enabled).</div>';
        return;
      }
      list.innerHTML = '';
      for (const m of mems) {
        const row = document.createElement('div');
        const statusColor = m.status === 'active' ? 'var(--success, #027a48)' : m.status === 'pending' ? 'var(--warning, #b54708)' : 'var(--on-surface-muted)';
        const dom = m.domain ? `<code style="font-size: 11px; background: var(--surface); padding: 1px 5px; border-radius: 3px;">${escapeHtml(m.domain)}</code>` : '';
        const cat = `<span style="font-size: 11px; text-transform: uppercase; font-weight: 600; color: var(--on-surface-muted);">${escapeHtml(m.category)}</span>`;
        const statusBadge = `<span style="font-size: 11px; font-weight: 600; color: ${statusColor}; text-transform: uppercase;">${escapeHtml(m.status)}</span>`;
        row.style.cssText = 'padding: 10px; background: var(--surface-container-low); border-radius: 6px; ' + (m.status === 'archived' ? 'opacity: 0.5;' : '');
        row.innerHTML = `
          <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap;">
            ${cat} ${dom} ${statusBadge}
            ${m.createdByAgent ? '<span style="font-size: 11px; color: var(--on-surface-muted);">(auto-saved)</span>' : ''}
          </div>
          <div style="font-size: 13px; margin-bottom: 6px;">${escapeHtml(m.text)}</div>
          <div style="display: flex; gap: 6px;">
            ${m.status === 'pending' ? `<button class="btn-primary" data-confirm="${m._id}" style="font-size: 12px; padding: 4px 10px;">Confirm</button>` : ''}
            <button class="btn-secondary" data-archive="${m._id}" data-status="${m.status === 'archived' ? 'active' : 'archived'}" style="font-size: 12px; padding: 4px 10px;">${m.status === 'archived' ? 'Restore' : 'Archive'}</button>
            <button class="btn-danger" data-mem-del="${m._id}" style="font-size: 12px; padding: 4px 10px;">Delete</button>
          </div>
        `;
        list.appendChild(row);
      }
      list.querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', async () => {
        try { await NewOrderAPI.request('/api/memory/' + b.dataset.confirm + '/confirm', { method: 'POST' }); loadMemory(); }
        catch (e) { toast('Confirm failed: ' + e.message, 'error'); }
      }));
      list.querySelectorAll('[data-archive]').forEach(b => b.addEventListener('click', async () => {
        try { await NewOrderAPI.request('/api/memory/' + b.dataset.archive, { method: 'PUT', body: JSON.stringify({ status: b.dataset.status }) }); loadMemory(); }
        catch (e) { toast('Update failed: ' + e.message, 'error'); }
      }));
      list.querySelectorAll('[data-mem-del]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this memory?')) return;
        try { await NewOrderAPI.request('/api/memory/' + b.dataset.memDel, { method: 'DELETE' }); loadMemory(); }
        catch (e) { toast('Delete failed: ' + e.message, 'error'); }
      }));
    } catch (e) {
      list.innerHTML = '<div style="color: var(--error); font-size: 13px;">Failed to load: ' + escapeHtml(e.message) + '</div>';
    }
  }

  $('btn-add-memory').addEventListener('click', async () => {
    const text = $('mem-text').value.trim();
    if (!text) return toast('Memory text is required', 'error');
    try {
      await NewOrderAPI.request('/api/memory', {
        method: 'POST',
        body: JSON.stringify({
          text,
          domain: $('mem-domain').value.trim(),
          category: $('mem-category').value
        })
      });
      $('mem-text').value = '';
      $('mem-domain').value = '';
      toast('Memory saved.');
      loadMemory();
    } catch (e) { toast('Add failed: ' + e.message, 'error'); }
  });

  $('btn-refresh-memory').addEventListener('click', loadMemory);
  $('btn-wipe-memory').addEventListener('click', async () => {
    if (!confirm('DELETE ALL MEMORIES? This cannot be undone.')) return;
    try { await NewOrderAPI.request('/api/memory', { method: 'DELETE' }); loadMemory(); toast('Memory wiped.'); }
    catch (e) { toast('Wipe failed: ' + e.message, 'error'); }
  });

  // ============================================
  // Scheduled Tasks
  // ============================================
  async function loadScheduled() {
    if (!_ceilings || !_ceilings.canScheduleTasks) return;
    const list = $('scheduled-list');
    try {
      const data = await NewOrderAPI.request('/api/scheduled-tasks');
      const tasks = data.tasks || [];
      if (!tasks.length) {
        list.innerHTML = '<div style="color: var(--on-surface-muted); font-size: 13px;">No scheduled tasks yet.</div>';
        return;
      }
      list.innerHTML = '';
      for (const t of tasks) {
        const row = document.createElement('div');
        row.style.cssText = 'padding: 10px; background: var(--surface-container-low); border-radius: 6px; ' + (t.enabled ? '' : 'opacity: 0.5;');
        row.innerHTML = `
          <div style="display:flex; justify-content: space-between; align-items: start; gap: 8px;">
            <div style="flex:1;">
              <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${escapeHtml(t.name)}</div>
              <div style="font-size: 13px; color: var(--on-surface-variant); margin-bottom: 4px;">${escapeHtml(t.prompt)}</div>
              <div style="font-size: 12px; color: var(--on-surface-muted);">
                <code>${escapeHtml(t.cron)}</code> (${escapeHtml(t.timezone || 'UTC')}) • mode: ${escapeHtml(t.mode)} • runs: ${t.runCount || 0}
              </div>
            </div>
            <div style="display:flex; gap: 6px;">
              <button class="btn-secondary" data-st-toggle="${t._id}" data-enabled="${t.enabled}" style="font-size: 12px; padding: 4px 10px;">${t.enabled ? 'Disable' : 'Enable'}</button>
              <button class="btn-danger" data-st-del="${t._id}" style="font-size: 12px; padding: 4px 10px;">Delete</button>
            </div>
          </div>
        `;
        list.appendChild(row);
      }
      list.querySelectorAll('[data-st-del]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this scheduled task?')) return;
        try { await NewOrderAPI.request('/api/scheduled-tasks/' + b.dataset.stDel, { method: 'DELETE' }); loadScheduled(); }
        catch (e) { toast('Delete failed: ' + e.message, 'error'); }
      }));
      list.querySelectorAll('[data-st-toggle]').forEach(b => b.addEventListener('click', async () => {
        const wasEnabled = b.dataset.enabled === 'true';
        try {
          await NewOrderAPI.request('/api/scheduled-tasks/' + b.dataset.stToggle, {
            method: 'PUT', body: JSON.stringify({ enabled: !wasEnabled })
          });
          loadScheduled();
        } catch (e) { toast('Toggle failed: ' + e.message, 'error'); }
      }));
    } catch (e) {
      list.innerHTML = '<div style="color: var(--error); font-size: 13px;">Failed: ' + escapeHtml(e.message) + '</div>';
    }
  }

  $('btn-add-scheduled').addEventListener('click', async () => {
    const name = $('st-name').value.trim();
    const cron = $('st-cron').value.trim();
    const prompt = $('st-prompt').value.trim();
    if (!name || !cron || !prompt) return toast('Name, cron, and prompt are required', 'error');
    try {
      await NewOrderAPI.request('/api/scheduled-tasks', {
        method: 'POST',
        body: JSON.stringify({ name, cron, prompt, mode: 'autopilot' })
      });
      $('st-name').value = ''; $('st-cron').value = ''; $('st-prompt').value = '';
      toast('Scheduled task saved.');
      loadScheduled();
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  });

  // Kick off all loaders in parallel after the integrations data is in.
  load().then(() => {
    loadAgentSettings().then(() => {
      loadScheduled();
    });
    loadDomainRules();
    loadMemory();
  });
})();
