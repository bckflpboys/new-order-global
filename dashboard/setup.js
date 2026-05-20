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

  // ============================================
  // Gated-section helper.
  //
  // Any element marked `data-gated-by="<checkboxId>"` is dimmed (via the
  // `.is-gated` CSS class) and made non-interactive whenever the named
  // checkbox is unchecked. This lets the page declare "this whole block
  // depends on that toggle" purely in HTML — no per-section JS needed.
  //
  // Wired once on script load; we additionally call applyGatedSections()
  // again after each settings load (since renderPrefs / loadAgentSettings
  // mutate checkbox state directly via `.checked = ...`, which does NOT
  // fire a `change` event).
  // ============================================
  function applyGatedSections(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-gated-by]').forEach(wrap => {
      const trigger = document.getElementById(wrap.dataset.gatedBy);
      if (!trigger) return;
      wrap.classList.toggle('is-gated', !trigger.checked);
    });
  }
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || t.type !== 'checkbox' || !t.id) return;
    document.querySelectorAll(`[data-gated-by="${t.id}"]`).forEach(wrap => {
      wrap.classList.toggle('is-gated', !t.checked);
    });
  });

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
      // After programmatic .checked = ... assignments, re-apply the
      // gated-section dim states (change events don't fire from JS sets).
      applyGatedSections();
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
    if (verifyEl) verifyEl.checked = (typeof r.verifySources === 'boolean') ? r.verifySources : false;
    const enabledEl = $('pref-research-enabled');
    if (enabledEl) enabledEl.checked = (typeof r.enabled === 'boolean') ? r.enabled : false;
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
  // Manual "Save Preferences" button — kept for users who prefer batched
  // saves, but every individual control below is also auto-saved on
  // change so refreshing the page no longer reverts un-saved toggles.
  function _allPrefsBody() {
    return {
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
  }
  async function _putPrefsPatch(patch, successMsg) {
    try {
      await NewOrderAPI.request('/api/integrations/preferences', {
        method: 'PUT',
        body: JSON.stringify(patch)
      });
      if (successMsg) toast(successMsg);
    } catch (e) {
      toast('Failed to save: ' + e.message, 'error');
      throw e;
    }
  }
  $('btn-save-prefs').addEventListener('click', async () => {
    try { await _putPrefsPatch(_allPrefsBody(), 'Preferences saved.'); }
    catch { /* already toasted */ }
  });

  // Auto-save individual preference controls on change. Sends ONLY the
  // changed field so concurrent edits to other controls aren't clobbered.
  // The whole control set is also covered by the Save button above.
  const _autosaveMap = {
    'pref-notify-channel':       { key: 'notifyChannel',           type: 'value' },
    'pref-notify-complete':      { key: 'notifyOnComplete',        type: 'checked' },
    'pref-notify-awaiting':      { key: 'notifyOnAwaitingUser',    type: 'checked' },
    'pref-notify-failure':       { key: 'notifyOnFailure',         type: 'checked' },
    'pref-can-close-tabs':       { key: 'canCloseTabs',            type: 'checked' },
    'pref-auto-close-limit':     { key: 'autoCloseExceedingLimit', type: 'checked' },
    'pref-prefer-current':       { key: 'preferCurrentTab',        type: 'checked' },
    'pref-auto-confirm-low':     { key: 'autoConfirmLowRisk',      type: 'checked' },
    'pref-verbose':              { key: 'verboseLogging',          type: 'checked' }
  };
  for (const [elId, { key, type }] of Object.entries(_autosaveMap)) {
    const el = $(elId);
    if (!el) continue;
    el.addEventListener('change', async () => {
      const value = type === 'checked' ? !!el.checked : el.value;
      try { await _putPrefsPatch({ [key]: value }, 'Saved.'); }
      catch {
        // Roll back the visual toggle so the UI matches server state.
        if (type === 'checked') el.checked = !el.checked;
      }
    });
  }

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
          enabled:            !!$('pref-research-enabled')?.checked,
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

  // Auto-save the master "Enable research mode" toggle the moment the
  // user flips it — no need to also click "Save Research Settings".
  // Sends ONLY the `enabled` flag so we don't clobber the numeric fields
  // the user may be in the middle of editing.
  const _resEnabledEl = $('pref-research-enabled');
  if (_resEnabledEl) {
    _resEnabledEl.addEventListener('change', async () => {
      const enabled = !!_resEnabledEl.checked;
      try {
        const data = await NewOrderAPI.request('/api/integrations/preferences', {
          method: 'PUT',
          body: JSON.stringify({ research: { enabled } })
        });
        // Do NOT call renderPrefs here. The PUT response can omit
        // `research.enabled` for legacy documents that predate the field,
        // which makes the renderer's `(typeof r.enabled === 'boolean')`
        // guard fall back to `false` and the checkbox visibly snaps off.
        // Optimistic UI: trust the user's intent — the server returned 2xx
        // so the value IS persisted. We only force the checkbox to match
        // the server when the response explicitly carries an `enabled`
        // boolean (i.e. confirmed round-trip).
        const serverVal = data?.preferences?.research?.enabled;
        if (typeof serverVal === 'boolean') _resEnabledEl.checked = serverVal;
        toast(enabled ? 'Research mode ON — saved.' : 'Research mode OFF — saved.');
      } catch (e) {
        // Roll back the checkbox so the UI matches the unsaved server state.
        _resEnabledEl.checked = !enabled;
        toast('Failed to save: ' + e.message, 'error');
      }
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
      // New-window-for-research — defaults OFF (opt-in).
      const nwr = $('as-new-window-research');
      if (nwr) nwr.checked = !!s.newWindowForResearch;
      $('as-max-sub-agents').value = s.maxSubAgents || 3;
      $('as-session-persistence').checked = !!s.sessionPersistenceEnabled;

      // ---- Phase 2 + 3 skill compounding fields ----
      // Step-pattern hints default ON, so missing field = true.
      const sphEl = $('as-step-pattern-hints');
      if (sphEl) sphEl.checked = s.stepPatternHintsEnabled !== false;
      const share = s.skillSharing || {};
      const setIf = (id, val) => { const el = $(id); if (el) el.checked = !!val; };
      // Defaults ON — undefined / missing field reads as enabled. Mirrors
      // the server-side defaults in models/AgentSettings.js so a brand-new
      // account or a legacy doc missing these fields renders correctly.
      setIf('as-skill-mining',        share.miningEnabled !== false);
      setIf('as-skill-publish',       share.publishToGlobalPool !== false);
      setIf('as-skill-learn',         share.learnFromGlobalPool !== false);
      // Grey toggles stay OFF by default — users must explicitly opt in.
      setIf('as-skill-grey-download', share.allowGreyDownload);
      setIf('as-skill-grey-upload',   share.allowGreyUpload);
      const blockEl = $('as-skill-blocklist');
      if (blockEl) blockEl.value = Array.isArray(share.blockedDomains) ? share.blockedDomains.join('\n') : '';
      // Refresh the live chip preview now that the textarea has its
      // saved value. The function is hoisted within this IIFE.
      try { renderBlocklistChips(); } catch { /* defined later in same scope */ }
      // Kick off a non-blocking load of mined skills so the user sees the
      // list populate while the rest of the page finishes loading.
      try { loadMinedSkills(); } catch { /* no-op if function not ready yet */ }

      // Multi-Agent Council — only meaningful for tiers with the council
      // prompt (Super Agent). Otherwise hide the whole block.
      const councilBlock = document.getElementById('as-council-block');
      if (councilBlock) {
        if (!_ceilings.useCouncilPrompt) {
          councilBlock.style.display = 'none';
        } else {
          councilBlock.style.display = '';
          // The server returns the resolved roster (built-ins + customs)
          // on every GET. If it's missing or empty (e.g. the server
          // hasn't been redeployed with the new endpoint yet, or this
          // is a brand-new account), fall back to the four default
          // built-in members so the user ALWAYS sees Strategist /
          // Executor / Critic / Optimizer.
          const fromServer = Array.isArray(data.councilMembers) ? data.councilMembers : [];
          _councilMembers = fromServer.length > 0
            ? fromServer.map(m => ({ ...m }))
            : COUNCIL_DEFAULTS.map(m => ({ ...m }));

          // Belt-and-braces: ensure all four built-ins are always
          // present, even if the server returned a partial roster.
          for (const def of COUNCIL_DEFAULTS) {
            if (!_councilMembers.some(m => m.id === def.id)) {
              _councilMembers.unshift({ ...def });
            }
          }

          $('as-council-enabled').checked = data.councilEnabled !== false;
          await renderCouncilMembers();
        }
      }
      // Re-sync the dim state of all [data-gated-by] wrappers, since we
      // just programmatically toggled checkboxes without firing events.
      applyGatedSections();
    } catch (e) {
      toast('Failed to load agent settings: ' + e.message, 'error');
    }
  }

  // ============================================
  // Multi-Agent Council UI state + helpers.
  //
  // The roster is held client-side in `_councilMembers` (mutated by the
  // add/remove/edit handlers below) and serialised into the next
  // PUT /api/agent-settings call. The server normalises + persists; on
  // reload the GET response replaces this array wholesale.
  // ============================================
  let _availableModels = null;
  let _councilMembers = [];
  const COUNCIL_BUILT_IN_IDS = new Set(['strategist', 'executor', 'critic', 'optimizer']);
  const COUNCIL_DEFAULTS = [
    { id: 'strategist', name: 'Strategist', description: 'Sees the big picture. Considers the overall task goal, evaluates how far along we are, and whether the current approach is the most efficient path. Suggests course corrections.', model: '', enabled: true, isBuiltIn: true },
    { id: 'executor',   name: 'Executor',   description: 'The hands-on expert. Determines the exact action, selector, and parameters needed. Considers fallback selectors, timing, and edge cases. Focuses on precision.',                          model: '', enabled: true, isBuiltIn: true },
    { id: 'critic',     name: 'Critic',     description: 'The skeptic. Questions assumptions: Is this selector reliable? Could the page have changed? Are we about to overwrite stored data? Identifies risks before they happen.',                model: '', enabled: true, isBuiltIn: true },
    { id: 'optimizer',  name: 'Optimizer',  description: 'The efficiency expert. Looks for shortcuts: Can we combine steps? Is there a faster CSS selector? Can we extract more data in one pass? Minimizes wasted steps.',                         model: '', enabled: true, isBuiltIn: true }
  ];

  async function _ensureModelsLoaded() {
    if (_availableModels) return;
    try {
      const data = await NewOrderAPI.request('/api/models');
      _availableModels = (data.models || []).filter(m => m.isAgentModel !== false);
    } catch { _availableModels = []; }
  }

  function _modelOptionsHtml(selectedId) {
    let html = '<option value="">Default (use task model)</option>';
    for (const m of (_availableModels || [])) {
      const id = m.openRouterId || m.id || m.name;
      const label = (m.name || id) + (m.tier ? ` — ${m.tier}` : '');
      const sel = (id === selectedId) ? ' selected' : '';
      html += `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(label)}</option>`;
    }
    return html;
  }

  async function renderCouncilMembers() {
    await _ensureModelsLoaded();
    const host = $('as-council-members');
    if (!host) return;
    host.innerHTML = '';

    const max = (_ceilings && _ceilings.maxCouncilMembers) || 12;
    $('as-council-count').textContent = `${_councilMembers.length} / ${max} members`;
    $('btn-add-council-member').disabled = _councilMembers.length >= max;

    _councilMembers.forEach((m, idx) => {
      const card = document.createElement('div');
      card.className = 'council-card' + (m.enabled === false ? ' is-disabled' : '');
      card.dataset.idx = String(idx);

      const nameAttrs = m.isBuiltIn
        ? 'disabled title="Built-in role names cannot be changed"'
        : 'placeholder="Member name"';
      const trailing = m.isBuiltIn
        ? `<span class="council-builtin-badge">Built-in</span>`
        : `<button type="button" class="council-remove" title="Remove this member">Remove</button>`;

      card.innerHTML = `
        <div class="council-head">
          <input type="checkbox" class="council-toggle council-enabled" ${m.enabled !== false ? 'checked' : ''} aria-label="Enable member">
          <input type="text" class="council-name" value="${escapeHtml(m.name || '')}" maxlength="40" ${nameAttrs}>
          ${trailing}
        </div>
        <textarea class="council-description" maxlength="300" rows="2" placeholder="One or two sentences describing this member's perspective.">${escapeHtml(m.description || '')}</textarea>
        <div class="council-model-row">
          <span class="council-model-label">Model</span>
          <select class="council-model">${_modelOptionsHtml(m.model || '')}</select>
        </div>
      `;
      host.appendChild(card);
    });

    // Wire row-level handlers (delegated would be fine too, but per-row
    // is cleaner since the list is small and re-rendered after each edit).
    host.querySelectorAll('.council-card').forEach(card => {
      const idx = Number(card.dataset.idx);
      const m = _councilMembers[idx];
      card.querySelector('.council-enabled').addEventListener('change', e => {
        m.enabled = !!e.target.checked;
        // Live visual feedback: fade the card when its member is off.
        card.classList.toggle('is-disabled', !m.enabled);
      });
      const nameEl = card.querySelector('.council-name');
      if (!m.isBuiltIn) {
        nameEl.addEventListener('input', e => { m.name = e.target.value; });
      }
      card.querySelector('.council-description').addEventListener('input', e => {
        m.description = e.target.value;
      });
      card.querySelector('.council-model').addEventListener('change', e => {
        m.model = e.target.value;
      });
      const removeBtn = card.querySelector('.council-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          _councilMembers.splice(idx, 1);
          renderCouncilMembers();
        });
      }
    });
  }

  // Add-member / reset / master-toggle wiring (one-time, on script load).
  $('btn-add-council-member')?.addEventListener('click', () => {
    const max = (_ceilings && _ceilings.maxCouncilMembers) || 12;
    if (_councilMembers.length >= max) {
      toast(`Maximum ${max} council members.`, 'error');
      return;
    }
    _councilMembers.push({
      id: 'custom_' + Math.random().toString(36).slice(2, 10),
      name: 'New Member',
      description: '',
      model: '',
      enabled: true,
      isBuiltIn: false
    });
    renderCouncilMembers();
  });

  $('btn-reset-council-members')?.addEventListener('click', () => {
    if (!confirm('Reset the council to the four default members? Custom members will be removed.')) return;
    _councilMembers = COUNCIL_DEFAULTS.map(m => ({ ...m }));
    $('as-council-enabled').checked = true;
    renderCouncilMembers();
  });

  $('as-council-enabled')?.addEventListener('change', () => {
    // Master switch state is read directly from the checkbox at save
    // time; nothing else to do here. (We avoid auto-saving so the user
    // can still hit Cancel by refreshing the page before clicking Save.)
  });

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
      newWindowForResearch: $('as-new-window-research') ? $('as-new-window-research').checked : false,
      maxSubAgents: num('as-max-sub-agents') || 3,
      sessionPersistenceEnabled: $('as-session-persistence').checked,
      // Skill compounding settings (stepPatternHintsEnabled +
      // skillSharing.*) are saved by their own dedicated card / button —
      // see #btn-save-skill-settings — so they're intentionally NOT in
      // this body. Keeps the two cards independently saveable.
      // New-style council payload. The four built-in members are always
      // included (server enforces this anyway). Custom members appended
      // by the user travel along with their generated `id` so the server
      // can de-dupe across saves.
      councilEnabled: $('as-council-enabled') ? !!$('as-council-enabled').checked : true,
      councilMembers: _councilMembers.map(m => ({
        id: m.id,
        name: m.name,
        description: m.description,
        model: m.model || '',
        enabled: m.enabled !== false,
        isBuiltIn: !!m.isBuiltIn
      }))
    };
    try {
      await NewOrderAPI.request('/api/agent-settings', { method: 'PUT', body: JSON.stringify(body) });
      toast('Agent settings saved.');
      loadAgentSettings();
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  });

  // ============================================
  // Skill compounding card — dedicated save button
  // Hits the same /api/agent-settings PUT endpoint but sends ONLY the
  // skill-related fields. The server merges these into the settings doc
  // alongside whatever the agent-settings card last persisted, so the
  // two cards never clobber each other.
  // ============================================
  const btnSaveSkill = $('btn-save-skill-settings');
  if (btnSaveSkill) {
    btnSaveSkill.addEventListener('click', async () => {
      const body = {
        stepPatternHintsEnabled: $('as-step-pattern-hints') ? !!$('as-step-pattern-hints').checked : true,
        skillSharing: {
          miningEnabled:       $('as-skill-mining')        ? !!$('as-skill-mining').checked        : true,
          publishToGlobalPool: $('as-skill-publish')       ? !!$('as-skill-publish').checked       : false,
          learnFromGlobalPool: $('as-skill-learn')         ? !!$('as-skill-learn').checked         : false,
          allowGreyDownload:   $('as-skill-grey-download') ? !!$('as-skill-grey-download').checked : false,
          allowGreyUpload:     $('as-skill-grey-upload')   ? !!$('as-skill-grey-upload').checked   : false,
          blockedDomains: (($('as-skill-blocklist') && $('as-skill-blocklist').value) || '')
            .split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, 100)
        }
      };
      try {
        await NewOrderAPI.request('/api/agent-settings', { method: 'PUT', body: JSON.stringify(body) });
        toast('Skill settings saved.');
        loadAgentSettings();
      } catch (e) {
        toast('Save failed: ' + e.message, 'error');
      }
    });
  }

  // ============================================
  // Mined skills list (Phase 3)
  // Renders the user's private skills with quick actions: enable/disable,
  // publish/unpublish, delete. The list endpoint already strips the
  // 1536-dim embedding vector so payloads stay small.
  // ============================================
  async function loadMinedSkills() {
    const container = $('as-skills-list');
    if (!container) return;
    try {
      const data = await NewOrderAPI.request('/api/agent/skills');
      const skills = Array.isArray(data && data.skills) ? data.skills : [];
      if (!skills.length) {
        container.innerHTML = '<div class="skills-empty">No skills mined yet. Complete a few tasks (4+ steps each) to build up your library.</div>';
        return;
      }
      container.innerHTML = skills.map(renderSkillRow).join('');
      // Wire action buttons (delegation would be cleaner but the list is
      // small and we re-render after every action anyway).
      container.querySelectorAll('[data-skill-action]').forEach(btn => {
        btn.addEventListener('click', () => handleSkillAction(btn));
      });
    } catch (e) {
      container.innerHTML = `<div style="font-size: 13px; color: var(--error, #f88); padding: 12px;">Failed to load skills: ${escapeHtml(e.message)}</div>`;
    }
  }

  // Render one skill row using the design-system CSS classes (.skill-row,
  // .skill-badge, .btn-secondary, .btn-danger). Inline styles are kept
  // OUT — see dashboard.css "Skill Compounding card components" block.
  function renderSkillRow(skill) {
    const sTag = skill.safetyTag || 'benign';
    const safetyBadge = sTag === 'malicious'
      ? `<span class="skill-badge safety-malicious" title="${escapeHtml(skill.safetyReason || '')}">⚠ malicious</span>`
      : `<span class="skill-badge safety-${sTag}">${escapeHtml(sTag)}</span>`;
    const pubBadge = skill.publishedToGlobal
      ? '<span class="skill-badge status-published">published</span>'
      : '';
    const disabledBadge = skill.disabled
      ? '<span class="skill-badge status-disabled">disabled</span>'
      : '';
    const domains = (skill.domains || []).slice(0, 4).map(d =>
      `<code>${escapeHtml(d)}</code>`
    ).join('');
    const domainsBlock = domains
      ? `<span class="skill-domains">${domains}</span>`
      : '';
    const stats = `${skill.successCount || 0}× success · ~${skill.avgSteps || '?'} steps · ${(skill.steps || []).length}-step recipe`;
    const reason = (sTag !== 'benign' && skill.safetyReason)
      ? `<div class="skill-reason">${escapeHtml(skill.safetyReason)}</div>`
      : '';
    const toggleBtn = `<button type="button" class="btn-secondary btn-sm" data-skill-action="${skill.disabled ? 'enable' : 'disable'}">${skill.disabled ? 'Enable' : 'Disable'}</button>`;
    const publishBtn = sTag !== 'malicious'
      ? `<button type="button" class="btn-secondary btn-sm" data-skill-action="${skill.publishedToGlobal ? 'unpublish' : 'publish'}">${skill.publishedToGlobal ? 'Unpublish' : 'Publish'}</button>`
      : '';
    const deleteBtn = `<button type="button" class="btn-danger btn-sm" data-skill-action="delete">Delete</button>`;
    return `
      <div class="skill-row${skill.disabled ? ' is-disabled' : ''}" data-skill-id="${escapeHtml(skill._id)}">
        <div class="skill-main">
          <div class="skill-title">
            <span class="skill-name">${escapeHtml(skill.name)}</span>
            ${safetyBadge}${pubBadge}${disabledBadge}
          </div>
          <div class="skill-summary">${escapeHtml(skill.summary || '(no summary)')}</div>
          <div class="skill-meta">
            <span>${escapeHtml(stats)}</span>
            ${domainsBlock}
          </div>
          ${reason}
        </div>
        <div class="skill-actions">
          ${toggleBtn}${publishBtn}${deleteBtn}
        </div>
      </div>`;
  }

  // ============================================
  // Domain blocklist — live chip preview
  // Parses the textarea on every input and renders one .domain-chip per
  // unique domain. Each chip has an × button that removes the line from
  // the textarea and re-renders. Purely cosmetic; the actual save still
  // sends the textarea contents (so users can also edit text directly).
  // ============================================
  function parseBlocklist(rawText) {
    if (!rawText) return [];
    const seen = new Set();
    const out = [];
    for (const raw of String(rawText).split(/[\r\n,]+/)) {
      const d = raw.trim().toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '');
      if (!d || seen.has(d)) continue;
      if (!/^[a-z0-9.-]{1,253}$/i.test(d)) continue;
      seen.add(d);
      out.push(d);
      if (out.length >= 100) break;
    }
    return out;
  }
  function renderBlocklistChips() {
    const ta = $('as-skill-blocklist');
    const chipsEl = $('as-skill-blocklist-chips');
    if (!ta || !chipsEl) return;
    const domains = parseBlocklist(ta.value);
    if (!domains.length) {
      chipsEl.innerHTML = '<span class="chip-empty">No domains blocked.</span>';
      return;
    }
    chipsEl.innerHTML = domains.map(d => `
      <span class="domain-chip">
        ${escapeHtml(d)}
        <button type="button" class="chip-remove" data-remove-domain="${escapeHtml(d)}" title="Remove ${escapeHtml(d)}" aria-label="Remove ${escapeHtml(d)}">×</button>
      </span>
    `).join('');
    chipsEl.querySelectorAll('[data-remove-domain]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-remove-domain');
        const remaining = parseBlocklist(ta.value).filter(d => d !== target);
        ta.value = remaining.join('\n');
        renderBlocklistChips();
      });
    });
  }
  // Wire input handler (live render) — gated on element existence so this
  // code stays harmless on pages that don't include the skill card.
  const _blocklistTa = $('as-skill-blocklist');
  if (_blocklistTa) {
    _blocklistTa.addEventListener('input', renderBlocklistChips);
  }

  async function handleSkillAction(btn) {
    const action = btn.getAttribute('data-skill-action');
    const row = btn.closest('[data-skill-id]');
    const id = row && row.getAttribute('data-skill-id');
    if (!id || !action) return;
    try {
      if (action === 'delete') {
        if (!confirm('Delete this skill? Any global-pool copy will also be removed. This cannot be undone.')) return;
        await NewOrderAPI.request(`/api/agent/skills/${id}`, { method: 'DELETE' });
      } else {
        const patch =
          action === 'enable'    ? { disabled: false } :
          action === 'disable'   ? { disabled: true } :
          action === 'publish'   ? { publishedToGlobal: true } :
          action === 'unpublish' ? { publishedToGlobal: false } : null;
        if (!patch) return;
        await NewOrderAPI.request(`/api/agent/skills/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      }
      toast('Skill updated.');
      loadMinedSkills();
    } catch (e) {
      toast('Action failed: ' + e.message, 'error');
    }
  }

  // Manual refresh button + initial load gated on Settings tab visibility
  // already triggered above via loadAgentSettings.
  const refreshBtn = $('btn-refresh-skills');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadMinedSkills());

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
