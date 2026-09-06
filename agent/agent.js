// Global Executive â€” Agent UI Controller
// Manages the agent loop: start task -> get action -> execute via background -> report result -> loop

(function () {
  'use strict';

  // ============================================
  // State
  // ============================================
  let currentTaskId = null;
  let isRunning = false;
  let isSubmitting = false; // Lock to prevent duplicate submissions on double-click/double-Enter
  let selectedModelId = null;
  let availableModels = [];
  let currentTierMaxSteps = 50;
  // Cached from /api/auth/profile. When false, typing into a finished task
  // starts a fresh task instead of threading onto it (matches server gate).
  let sessionPersistenceActive = false;
  let keepAlivePort = null; // MV3 SW keep-alive
  let selectedMode = 'copilot'; // 'copilot' | 'autopilot'
  let pendingTaskContext = null; // { taskId, plan, requiredInputs, permissionsRequested, allTabs, activeTab }
  let pendingUserReplyResolver = null; // Promise resolver for askUser/confirmAction modals

  // DOM References
  const welcomeScreen = document.getElementById('welcome-screen');
  const taskView = document.getElementById('task-view');
  const taskInput = document.getElementById('task-input');
  const slashPopup = document.getElementById('slash-commands-popup');
  const btnSend = document.getElementById('btn-send');
  const stepLog = document.getElementById('step-log');
  const taskTitle = document.getElementById('task-title');
  const taskStatus = document.getElementById('task-status');
  const taskStepCounter = document.getElementById('task-step-counter');
  const taskCredits = document.getElementById('task-credits');
  const btnStopTask = document.getElementById('btn-stop-task');
  const tabTracker = document.getElementById('tab-tracker');
  const storedDataPanel = document.getElementById('stored-data-panel');
  const dataPanelBody = document.getElementById('data-panel-body');
  const capturedFilesPanel = document.getElementById('captured-files-panel');
  const capturedPanelBody = document.getElementById('captured-panel-body');
  const historySidebar = document.getElementById('history-sidebar');
  const historyList = document.getElementById('history-list');
  const userInfo = document.getElementById('user-info');
  const userName = document.getElementById('user-name');
  const userPlan = document.getElementById('user-plan');
  const authModal = document.getElementById('auth-modal');
  const loadingOverlay = document.getElementById('initial-loading-overlay');
  const modelSelectorContainer = document.getElementById('model-selector-container');
  const taskIdChip = document.getElementById('task-id-chip');

  // ============================================
  // URL <-> task-id sync
  // The page lives at chrome-extension://.../agent/agent.html. We append
  // ?taskId=<id> so a refresh keeps the user inside the same task instead
  // of dumping them at the welcome screen, and so the URL itself is a
  // shareable pointer to the conversation.
  // ============================================
  function setTaskInUrl(taskId) {
    try {
      const url = new URL(window.location.href);
      if (taskId) url.searchParams.set('taskId', String(taskId));
      else url.searchParams.delete('taskId');
      window.history.replaceState(null, '', url.toString());
    } catch { /* best effort */ }
  }
  function getTaskFromUrl() {
    try { return new URL(window.location.href).searchParams.get('taskId') || ''; }
    catch { return ''; }
  }

  // ============================================
  // handleBuilderHandoff â€” pick up a delegation from the Builder via
  // URL params (?fromBuilder=1&prompt=...&toolId=...&toolName=...&autostart=1).
  // Pre-fills the task input, shows a delegation banner, optionally
  // auto-starts the task, then strips the params so a refresh doesn't
  // double-fire. No-op if no fromBuilder=1 flag.
  // ============================================
  function handleBuilderHandoff() {
    let url;
    try { url = new URL(window.location.href); } catch { return; }
    if (url.searchParams.get('fromBuilder') !== '1') return;

    const prompt = url.searchParams.get('prompt') || '';
    const toolId = url.searchParams.get('toolId') || '';
    const toolName = url.searchParams.get('toolName') || '';
    const autostart = url.searchParams.get('autostart') === '1';

    if (!prompt) {
      // Strip the flag and bail â€” nothing useful to do.
      url.searchParams.delete('fromBuilder');
      window.history.replaceState(null, '', url.toString());
      return;
    }

    // Prefill the input so the user sees what the agent will run.
    if (taskInput) {
      taskInput.value = prompt;
      try { taskInput.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    }

    // Render the delegation banner above the input. Persists until the
    // task starts (or the user clears the input).
    renderDelegateBanner(toolName, toolId);

    // Strip the params now so a refresh doesn't trigger another autostart.
    ['fromBuilder', 'prompt', 'toolId', 'toolName', 'autostart'].forEach(k => url.searchParams.delete(k));
    window.history.replaceState(null, '', url.toString());

    if (autostart) {
      // Small delay so the user sees the banner + prompt populate before
      // the task UI replaces the welcome screen â€” keeps the handoff from
      // feeling abrupt.
      setTimeout(() => { try { handleUserSubmit(prompt); } catch (e) { console.error('[Global Executive] autostart failed', e); } }, 600);
    }
  }

  // ============================================
  // renderDelegateBanner â€” premium ribbon showing "Delegated from Builder"
  // and the tool the agent is expected to use. Inserted into the welcome
  // screen and stays in the task header after start.
  // ============================================
  function renderDelegateBanner(toolName, toolId) {
    const old = document.getElementById('delegate-banner');
    if (old) old.remove();

    const banner = document.createElement('div');
    banner.id = 'delegate-banner';
    banner.className = 'delegate-banner';
    banner.innerHTML = `
      <div class="delegate-banner-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
      </div>
      <div class="delegate-banner-body">
        <div class="delegate-banner-eyebrow">Delegated from Builder</div>
        <div class="delegate-banner-title">${toolName ? `Using your new tool Â· <strong>${escapeHtml(toolName)}</strong>` : 'Using your newly-built tool'}</div>
      </div>
      <button type="button" class="delegate-banner-close" aria-label="Dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    banner.querySelector('.delegate-banner-close').addEventListener('click', () => banner.remove());

    // Try welcome screen first, then fall back to inserting above the
    // input bar in the task view.
    const welcome = document.getElementById('welcome-screen');
    const inputBar = document.querySelector('.task-input-area, .input-area, .task-input-wrap');
    if (welcome && welcome.style.display !== 'none') {
      welcome.insertBefore(banner, welcome.firstChild);
    } else if (inputBar && inputBar.parentNode) {
      inputBar.parentNode.insertBefore(banner, inputBar);
    } else {
      document.body.appendChild(banner);
    }
  }
  function updateTaskIdChip(taskId) {
    if (!taskIdChip) return;
    if (!taskId) { taskIdChip.style.display = 'none'; taskIdChip.textContent = ''; return; }
    const short = String(taskId).slice(-6);
    taskIdChip.style.display = '';
    taskIdChip.textContent = '#' + short;
    taskIdChip.dataset.fullId = String(taskId);
  }
  function setCurrentTaskId(taskId) {
    currentTaskId = taskId || null;
    setTaskInUrl(currentTaskId);
    updateTaskIdChip(currentTaskId);
  }

  // ============================================
  // Initialization
  // ============================================
  async function init() {
    try {
      updateLoadingStatus('Checking authentication...');

      const loggedIn = await NewOrderAPI.isLoggedIn();
      if (!loggedIn) {
        hideLoading();
        showAuthModal();
        return;
      }

      updateLoadingStatus('Loading profile...');
      await loadUserInfo();

      updateLoadingStatus('Loading models...');
      await loadModels();

      updateLoadingStatus('Loading history...');
      await loadTaskHistory();

      setupModalHandlers();
      setupModeToggle();
      setupStageFileButton();
      setupInboxPolling();
      startPanelPresenceHeartbeat();

      // Restore task from ?taskId=... so a refresh keeps the user where
      // they were (running task / viewing an old one). Falls back to the
      // welcome screen if the id is unknown or finished.
      const urlTaskId = getTaskFromUrl();
      if (urlTaskId) {
        try { await viewPastTask(urlTaskId); }
        catch (e) { console.warn('[Global Executive] Failed to restore task from URL:', e?.message); setTaskInUrl(''); }
      }

      hideLoading();

      // ============================================
      // Builder â†’ Executive delegate handoff
      // When the Builder finishes generating a tool and the user picked
      // "Build & delegate", it opens us with these URL params:
      //   ?fromBuilder=1&autostart=1&prompt=<augmented>&toolId=<id>&toolName=<name>
      // We render a delegation banner above the input, prefill the task,
      // and (if autostart=1) kick off startTask() immediately. Params are
      // stripped from the URL on success so a refresh doesn't double-fire.
      // ============================================
      try { handleBuilderHandoff(); } catch (e) { console.warn('[Global Executive] Builder handoff failed:', e?.message); }
    } catch (err) {
      console.error('[Global Executive] Init error:', err);
      hideLoading();
      showAuthModal();
    }
  }

  function updateLoadingStatus(text) {
    const el = document.getElementById('loading-subtext');
    if (el) el.textContent = text;
  }

  function hideLoading() {
    if (loadingOverlay) {
      loadingOverlay.classList.add('hidden');
      setTimeout(() => loadingOverlay.remove(), 500);
    }
  }

  // ============================================
  // Auth
  // ============================================
  function showAuthModal() {
    authModal.style.display = 'flex';
  }

  function hideAuthModal() {
    authModal.style.display = 'none';
  }

  function setupAuth() {
    const tabs = document.querySelectorAll('.auth-tab');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (tab.dataset.tab === 'login') {
          loginForm.style.display = 'block';
          registerForm.style.display = 'none';
        } else {
          loginForm.style.display = 'none';
          registerForm.style.display = 'block';
        }
      });
    });

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const errorEl = document.getElementById('login-error');

      try {
        errorEl.style.display = 'none';
        await NewOrderAPI.login(email, password);
        hideAuthModal();
        await loadUserInfo();
        await loadModels();
        await loadTaskHistory();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      }
    });

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('register-name').value;
      const email = document.getElementById('register-email').value;
      const password = document.getElementById('register-password').value;
      const tosCheckbox = document.getElementById('register-tos');
      const privacyCheckbox = document.getElementById('register-privacy');
      const tosChecked = tosCheckbox ? tosCheckbox.checked : false;
      const privacyChecked = privacyCheckbox ? privacyCheckbox.checked : false;
      const errorEl = document.getElementById('register-error');

      if (!tosChecked || !privacyChecked) {
        errorEl.textContent = 'You must accept both the Terms of Service and Privacy Policy';
        errorEl.style.display = 'block';
        return;
      }

      try {
        errorEl.style.display = 'none';
        await NewOrderAPI.register(email, password, name, { tosAccepted: tosChecked, privacyAccepted: privacyChecked });
        hideAuthModal();
        await loadUserInfo();
        await loadModels();
        await loadTaskHistory();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      }
    });

    document.getElementById('auth-modal-close').addEventListener('click', hideAuthModal);
  }

  // ============================================
  // User Info
  // ============================================
  async function loadUserInfo() {
    try {
      const user = await NewOrderAPI.getProfile();
      if (user) {
        userInfo.style.display = 'flex';
        userName.textContent = user.displayName || user.email.split('@')[0];
        userPlan.textContent = (user.credits || 0).toFixed(2) + ' credits';
        // Store tier info from profile
        if (user.agentTier) {
          currentTierMaxSteps = user.agentTier.maxSteps || 50;
          // Session persistence is "active" only when the tier supports it
          // AND the user has enabled the setting in Setup. Governs whether
          // typing into a finished task chains onto it or starts fresh.
          sessionPersistenceActive =
            !!user.agentTier.canPersistSession &&
            !!user.agentTier.sessionPersistenceEnabled;
        }
      }
    } catch (err) {
      console.error('[Global Executive] Failed to load user:', err);
    }
  }

  function updateCreditsDisplay(credits) {
    userPlan.textContent = credits.toFixed(2) + ' credits';
  }

  // ============================================
  // Models
  // ============================================
  async function loadModels() {
    try {
      // Request only agent-capable models from the server
      const data = await NewOrderAPI.request('/api/models?agent=true');
      availableModels = data.models || [];

      if (availableModels.length > 0) {
        // Try to load user's saved agent model preference
        let preferredModelId = null;
        try {
          const user = await NewOrderAPI.getProfile();
          preferredModelId = user.agentModel;
        } catch (e) {
          console.log('[Global Executive] Failed to load user model preference:', e);
        }

        // Use saved preference if it exists and is still available, otherwise use default
        if (preferredModelId) {
          const preferredModel = availableModels.find(m => m.id === preferredModelId);
          if (preferredModel) {
            selectedModelId = preferredModelId;
          } else {
            // Saved model no longer available, fall back to default
            const defaultModel = availableModels.find(m => m.isDefault) || availableModels[0];
            selectedModelId = defaultModel.id;
          }
        } else {
          // No saved preference, use default
          const defaultModel = availableModels.find(m => m.isDefault) || availableModels[0];
          selectedModelId = defaultModel.id;
        }

        renderModelSelector();
      } else {
        console.warn('[Global Executive] No agent-capable models found');
      }
    } catch (err) {
      console.error('[Global Executive] Failed to load models:', err);
    }
  }

  function renderModelSelector() {
    const selectedModel = availableModels.find(m => m.id === selectedModelId) || availableModels[0];
    if (!selectedModel) return;

    modelSelectorContainer.innerHTML = `
      <div class="model-pill" id="model-selector-pill">
        <div class="robot-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12,2A10,10,0,0,0,2,12a9.89,9.89,0,0,0,2.26,6.33l-2,2a1,1,0,0,0,1.42,1.42l2-2A9.94,9.94,0,0,0,12,22a10,10,0,0,0,0-20Zm0,18a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z"/>
            <circle cx="8.5" cy="11.5" r="1.5"/><circle cx="15.5" cy="11.5" r="1.5"/><path d="M8,15a4,4,0,0,0,8,0H8Z"/>
          </svg>
        </div>
        <span>${selectedModel.name}</span>
      </div>
    `;

    document.getElementById('model-selector-pill')?.addEventListener('click', openModelSelectorModal);
  }

  function openModelSelectorModal() {
    let overlay = document.getElementById('model-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'model-modal-overlay';
      overlay.className = 'model-modal-overlay';
      overlay.innerHTML = `
        <div class="model-modal">
          <div class="model-modal-header">
            <div class="model-tabs">
              <button class="model-tab" data-group="FREE"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Free</button>
              <button class="model-tab active" data-group="STANDARD"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg> Standard</button>
              <button class="model-tab" data-group="PREMIUM"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M6 3h12v4l-6 6-6-6V3zM20 9h-4l-2 2-2-2H8l-2 2-2-2H0l4 4v9h16v-9l4-4h-4z"/><path d="M12 13l-2 2-2-2 2-2 2 2z"/></svg> Premium</button>
            </div>
          </div>
          <div class="model-modal-body" id="model-modal-list"></div>
        </div>
      `;
      document.body.appendChild(overlay);
      
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
      });

      overlay.querySelectorAll('.model-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          overlay.querySelectorAll('.model-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          renderModelList(tab.dataset.group);
        });
      });
    }

    renderModelList('STANDARD');
    overlay.classList.add('active');
  }

  function renderModelList(group) {
    const list = document.getElementById('model-modal-list');
    if (!list) return;

    const filteredModels = availableModels.filter(m => {
      if (group === 'FREE') return m.tier === 'free';
      if (group === 'STANDARD') return m.tier === 'standard';
      if (group === 'PREMIUM') return m.tier === 'premium';
      return true;
    });

    list.innerHTML = filteredModels.map(m => {
      const isSelected = m.id === selectedModelId;
      const tags = [];
      const isFreeModel = !m.creditsPerInputToken && !m.creditsPerOutputToken;
      const canUse = m.canUse !== false;
      if (isFreeModel) tags.push('<span class="model-tag free">Free</span>');
      if (m.isAgentModel || m.name.toLowerCase().includes('reasoning') || m.name.toLowerCase().includes('sonnet')) tags.push('<span class="model-tag reasoning">Agent</span>');
      if (m.isVisionModel || m.name.toLowerCase().includes('vision')) tags.push('<span class="model-tag vision">Vision</span>');
      if (m.tier === 'free') tags.push('<span class="model-tag fast">Fast</span>');
      if (m.tier === 'premium') tags.push('<span class="model-tag full">Full</span>');
      // Provider badge
      const provider = (m.provider || 'openrouter').toUpperCase();
      tags.push(`<span class="model-tag provider">${provider}</span>`);
      
      // Upgrade tag for models user can't access
      if (!canUse && m.allowedPlans && m.allowedPlans.length > 0) {
        const planNames = {
          'monthly': 'Monthly',
          'yearly': 'Yearly',
          'super_agent': 'Super Agent'
        };
        const requiredPlans = m.allowedPlans.map(p => planNames[p] || p).join(' or ');
        tags.push(`<span class="model-tag upgrade">Upgrade to ${requiredPlans}</span>`);
      }

      return `
        <div class="model-card ${isSelected ? 'selected' : ''} ${isFreeModel ? 'free-model' : ''} ${!canUse ? 'locked' : ''}" data-id="${m.id}" data-can-use="${canUse}">
          <div class="model-card-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12,2A10,10,0,0,0,2,12a9.89,9.89,0,0,0,2.26,6.33l-2,2a1,1,0,0,0,1.42,1.42l2-2A9.94,9.94,0,0,0,12,22a10,10,0,0,0,0-20Zm0,18a8,8,1,1,1,8-8A8,8,0,0,1,12,20Z"/>
              <circle cx="8.5" cy="11.5" r="1.5"/><circle cx="15.5" cy="11.5" r="1.5"/><path d="M8,15a4,4,0,0,0,8,0H8Z"/>
            </svg>
          </div>
          <div class="model-card-info">
            <div class="model-card-name">${m.name}</div>
            <div class="model-card-tags">${tags.join('')}</div>
            <div class="model-card-pricing"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${(m.creditsPerInputToken || 0).toFixed(2)} In / ${(m.creditsPerOutputToken || 0).toFixed(2)} Out / 1K</div>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.model-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        if (e.target.closest('.model-tag.upgrade')) {
          window.location.href = '../dashboard/billing.html';
          return;
        }

        const canUse = card.dataset.canUse === 'true';
        
        if (!canUse) {
          // Show upgrade prompt instead of selecting
          alert('This model requires a higher subscription plan. Upgrade to access it.');
          return;
        }
        
        selectedModelId = card.dataset.id;
        renderModelSelector();
        document.getElementById('model-modal-overlay').classList.remove('active');

        // Save model preference to user profile
        try {
          await NewOrderAPI.updateModelPreferences(null, selectedModelId);
        } catch (e) {
          console.log('[Global Executive] Failed to save model preference:', e);
        }
      });
    });
  }

  // ============================================
  // Task History
  // ============================================
  async function loadTaskHistory() {
    try {
      const data = await NewOrderAPI.request('/api/agent/tasks');
      const tasks = data.tasks || [];

      if (tasks.length === 0) {
        historyList.innerHTML = '<div class="empty-history">No tasks yet</div>';
        return;
      }

      historyList.innerHTML = tasks.map(t => {
        const isRunning = ['running', 'planning', 'briefing', 'awaiting_user'].includes(t.status);
        const stopBtn = isRunning
          ? `<button class="history-stop-btn" data-task-id="${t.id}" title="Stop task">&#10005;</button>`
          : '';
        return `
        <div class="history-row">
          <button class="task-history-item" data-task-id="${t.id}">
            <div class="history-title">${escapeHtml(t.title)}</div>
            <div class="history-meta">
              <span class="history-status ${t.status}"></span>
              ${t.status} &mdash; ${t.steps} steps &mdash; ${t.creditsUsed.toFixed(2)} cr
            </div>
          </button>
          ${stopBtn}
        </div>
        `;
      }).join('');

      historyList.querySelectorAll('.task-history-item').forEach(btn => {
        btn.addEventListener('click', () => viewPastTask(btn.dataset.taskId));
      });
      historyList.querySelectorAll('.history-stop-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const tid = btn.dataset.taskId;
          if (tid === currentTaskId) {
            // Already wired up
            await stopTask();
          } else {
            // Stop this specific task directly
            await stopTaskById(tid);
          }
          await loadTaskHistory();
        });
      });
    } catch (err) {
      console.error('[Global Executive] Failed to load history:', err);
    }
  }

  async function viewPastTask(taskId) {
    try {
      const data = await NewOrderAPI.request(`/api/agent/tasks/${taskId}`);
      if (!data.task) return;

      // When session persistence produced a chain of tasks, the server
      // returns `chain: [rootTask, ...children]` (root-first). Render them
      // as one continuous conversation. Wire currentTaskId to the LATEST
      // (tail) task so Stop / chat-nudge target the right place; keep the
      // URL on the session root so refresh stays in-session.
      const chain = Array.isArray(data.chain) && data.chain.length ? data.chain : [data.task];
      const tail = chain[chain.length - 1];
      const root = chain[0];

      // Wire up the latest task (for stop / follow-up routing) and
      // anchor the URL to the session root.
      setCurrentTaskId(tail.id);
      if (root.id !== tail.id) setTaskInUrl(root.id);
      isRunning = ['running', 'planning', 'briefing', 'awaiting_user'].includes(tail.status);
      setSendingState(isRunning);

      showTaskView(tail.title);
      updateTaskStatus(tail.status);
      taskStepCounter.textContent = `${tail.currentStepNumber}/${tail.maxSteps} steps`;
      taskCredits.textContent = tail.totalCreditsUsed.toFixed(2) + ' credits';

      stepLog.innerHTML = '';
      // Replay every member of the chain as a chat thread: user prompt,
      // goal-ledger (if any), steps, summary. A subtle divider separates
      // each member so the conversation reads top-to-bottom.
      chain.forEach((t, idx) => {
        if (idx > 0) {
          const divider = document.createElement('div');
          divider.className = 'session-divider';
          divider.innerHTML = '<span>continuing session</span>';
          stepLog.appendChild(divider);
        }
        if (t.originalPrompt) renderUserPromptBubble(t.originalPrompt);
        if (t.goalLedger) renderGoalLedger(t.goalLedger);
        const hasDoneStep = (t.steps || []).some(s => s.action === 'done');
        (t.steps || []).forEach(step => renderStep(step));
        if (t.summary && !hasDoneStep) renderDoneStep(t.summary);
      });

      // Use the latest task's tab tracker / stored data snapshot \u2014 it is
      // the current state of the session.
      updateTabTracker(tail.trackedTabs, tail.activeTabIndex);
      if (tail.storedData && Object.keys(tail.storedData).length > 0) {
        showStoredData(tail.storedData);
      }
      if (tail.capturedFiles && tail.capturedFiles.length > 0) {
        showCapturedFiles(tail.capturedFiles);
      }

      historySidebar.classList.remove('open');
    } catch (err) {
      console.error('[Global Executive] Failed to load task:', err);
    }
  }

  // ============================================
  // UI Helpers
  // ============================================
  function showTaskView(title) {
    welcomeScreen.style.display = 'none';
    taskView.style.display = 'flex';
    taskTitle.textContent = title;
    stepLog.innerHTML = '';
    storedDataPanel.style.display = 'none';
    if (capturedFilesPanel) capturedFilesPanel.style.display = 'none';
    tabTracker.innerHTML = '';
    hideMilestonesPanel();
  }

  // ============================================
  // Send-button state helper
  //   true  â†’ disabled + animated "sending" appearance + spinner icon
  //   false â†’ idle, ready to accept the next prompt
  // ============================================
  function setSendingState(flag) {
    if (!btnSend) return;
    btnSend.disabled = !!flag;
    btnSend.classList.toggle('sending', !!flag);
    btnSend.title = flag ? 'Workingâ€¦' : 'Start Task';
  }

  // ============================================
  // Goal Ledger / Milestones UI  (Batch 4)
  // ============================================
  // Cached state so we can detect "just-completed" transitions and apply
  // a tick animation. Keyed by milestone id.
  const milestoneStateCache = {};

  function getMilestonesEls() {
    return {
      panel: document.getElementById('milestones-panel'),
      list: document.getElementById('milestones-list'),
      progress: document.getElementById('milestones-progress'),
      header: document.getElementById('milestones-header'),
      toggle: document.getElementById('milestones-toggle')
    };
  }

  function hideMilestonesPanel() {
    const { panel, list } = getMilestonesEls();
    if (!panel) return;
    panel.style.display = 'none';
    if (list) list.innerHTML = '';
    Object.keys(milestoneStateCache).forEach(k => delete milestoneStateCache[k]);
  }

  function renderGoalLedger(ledger) {
    const els = getMilestonesEls();
    if (!els.panel || !ledger || !Array.isArray(ledger.milestones) || !ledger.milestones.length) {
      hideMilestonesPanel();
      return;
    }
    els.panel.style.display = 'block';
    els.progress.textContent = `${ledger.done || 0} / ${ledger.total || ledger.milestones.length}`;

    // Replace the list content but track which items just transitioned to done
    // so we can flash a brief tick animation on them.
    els.list.innerHTML = '';
    ledger.milestones.forEach((m) => {
      const li = document.createElement('li');
      li.className = `milestone-item ${m.status || 'pending'}`;
      li.dataset.id = m.id;
      const wasDone = milestoneStateCache[m.id] === 'done';
      const isDone = m.status === 'done';
      if (isDone && !wasDone) li.classList.add('just-completed');

      const evidenceHtml = (isDone && m.evidence)
        ? `<span class="milestone-evidence">${escapeHtml(m.evidence)}</span>`
        : '';

      li.innerHTML = `
        <span class="milestone-checkbox" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
        <div class="milestone-text">
          <span class="milestone-id">${escapeHtml(m.id)}</span>${escapeHtml(m.text || '')}
          ${evidenceHtml}
        </div>`;
      els.list.appendChild(li);
      milestoneStateCache[m.id] = m.status;
    });

    // Stuck warning banner
    const existingStuck = els.panel.querySelector('.milestones-stuck');
    if (existingStuck) existingStuck.remove();
    if ((ledger.stuckScore || 0) >= 3) {
      const warn = document.createElement('div');
      warn.className = 'milestones-stuck';
      warn.innerHTML = `âš ï¸ Stuck score ${ledger.stuckScore}/5 â€” agent is being nudged to change approach.`;
      els.panel.insertBefore(warn, els.list);
    }
  }

  function bindMilestoneToggle() {
    const { panel, header, toggle } = getMilestonesEls();
    if (!panel || !header) return;
    const flip = (e) => {
      // Only toggle if user clicked header background or the toggle button â€”
      // avoid swallowing clicks on milestone items themselves.
      if (e.target.closest('.milestone-item')) return;
      panel.classList.toggle('collapsed');
    };
    header.addEventListener('click', flip);
    if (toggle) toggle.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('collapsed'); });
  }

  // ============================================
  // User-prompt bubble + typewriter helpers
  // ============================================
  function renderUserPromptBubble(text) {
    if (!text) return;
    const meta = document.createElement('div');
    meta.className = 'user-prompt-meta';
    meta.textContent = 'You';
    const bubble = document.createElement('div');
    bubble.className = 'user-prompt-bubble';
    bubble.textContent = text;
    stepLog.appendChild(meta);
    stepLog.appendChild(bubble);
    scrollToBottom();
  }

  // Progressive word-by-word reveal for AI message/think/done content.
  // Renders into `el` so caller controls the wrapping bubble. Returns a
  // promise that resolves when streaming is done. Cancellable via .cancel().
  function streamMarkdownInto(el, text, opts = {}) {
    const wordsPerTick = opts.wordsPerTick || 2;
    const tickMs = opts.tickMs || 18;
    const words = String(text || '').split(/(\s+)/); // keep whitespace as separate tokens for natural pacing
    let i = 0;
    let cancelled = false;
    el.classList.add('streaming');
    let buf = '';

    return new Promise((resolve) => {
      function tick() {
        if (cancelled) { el.classList.remove('streaming'); return resolve(); }
        for (let n = 0; n < wordsPerTick && i < words.length; n++, i++) {
          buf += words[i];
        }
        // Re-render markdown each tick â€” small enough text for this to be cheap.
        el.innerHTML = formatMarkdown(buf);
        scrollToBottom();
        if (i < words.length) {
          setTimeout(tick, tickMs);
        } else {
          el.classList.remove('streaming');
          resolve();
        }
      }
      tick();
    });
  }

  function updateTaskStatus(status) {
    const badge = taskStatus;
    badge.className = `task-status-badge ${status}`;
    badge.querySelector('.status-text').textContent = status.charAt(0).toUpperCase() + status.slice(1);
    btnStopTask.style.display = ['running', 'planning', 'briefing', 'awaiting_user'].includes(status) ? 'flex' : 'none';
  }

  function renderStep(step) {
    // Special rendering for message actions â€” stream the text in word-by-word
    // so the user sees the agent "typing" rather than a sudden bubble pop.
    if (step.action === 'message') {
      // Check if this message includes a document card (PDF operations)
      const docCard = step.params?._documentCard;
      if (docCard) {
        renderDocumentCard(step, docCard);
        return;
      }
      const msgEl = document.createElement('div');
      msgEl.className = 'step-message';
      stepLog.appendChild(msgEl);
      scrollToBottom();
      streamMarkdownInto(msgEl, step.params?.text || step.thought || '');
      return;
    }

    // Special rendering for think actions â€” bubble + animated dots, with the
    // reasoning text streamed in beside the dots.
    if (step.action === 'think') {
      const thinkEl = document.createElement('div');
      thinkEl.className = 'step-thinking';
      thinkEl.innerHTML = `
        <div class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        <span class="step-thinking-text"></span>
      `;
      stepLog.appendChild(thinkEl);
      scrollToBottom();
      streamMarkdownInto(thinkEl.querySelector('.step-thinking-text'),
        step.params?.reasoning || step.thought || 'Thinking...');
      return;
    }

    // Special rendering for done
    if (step.action === 'done') {
      renderDoneStep(step.params?.summary || 'Task completed');
      return;
    }

    const entry = document.createElement('div');
    entry.className = `step-entry ${step.status || 'pending'}`;

    let detailText = '';
    if (step.params) {
      if (step.action === 'click') detailText = `Clicking: ${step.params.selector || ''}${step.params.text ? ` (text: "${step.params.text}")` : ''}`;
      else if (step.action === 'type') detailText = `Typing "${(step.params.text || '').substring(0, 50)}" into ${step.params.selector || ''}`;
      else if (step.action === 'scroll') detailText = `Scrolling ${step.params.direction || 'down'} ${step.params.amount || 500}px`;
      else if (step.action === 'openTab') detailText = `Opening: ${step.params.url || ''}`;
      else if (step.action === 'switchTab') detailText = `Switching to tab ${step.params.tabIndex}`;
      else if (step.action === 'extract') detailText = `Extracting from: ${step.params.items || ''}`;
      else if (step.action === 'readPage') detailText = 'Reading page content...';
      else if (step.action === 'waitForElement') detailText = `Waiting for: ${step.params.selector || ''}`;
      else if (step.action === 'wait') detailText = `Waiting ${step.params.ms || 0}ms`;
      else if (step.action === 'storeData') detailText = `Storing data as "${step.params.key || ''}"`;
      else if (step.action === 'download') detailText = `Downloading: ${step.params.filename || step.params.url || ''}`;
      else if (step.action === 'pressKey') detailText = `Pressing: ${step.params.key || ''}`;
      else if (step.action === 'select') detailText = `Selecting "${step.params.value}" in ${step.params.selector}`;
      else if (step.action === 'clear') detailText = `Clearing: ${step.params.selector || ''}`;
      else if (step.action === 'rememberThis') detailText = `Remembering: "${(step.params.text || '').substring(0, 80)}"`;
      else if (step.action === 'notifyUser') detailText = `Pinging user: "${(step.params.text || '').substring(0, 80)}"`;
      else if (step.action === 'webSearch') detailText = `Searching the web: "${(step.params.query || step.params.q || '').substring(0, 80)}"`;
      else if (step.action === 'researchNote') detailText = `Recording evidence [${step.params.topic || 'general'}]: "${(step.params.claim || '').substring(0, 80)}" — ${step.params.source || ''}`;
      else if (step.action === 'pdfPages') detailText = `📄 Analyzing PDF: ${step.params.fileRef || ''}`;
      else if (step.action === 'viewPdfPages') detailText = `🔍 Inspecting page ${step.params.page || step.params.pages?.[0] || '?'} of PDF: ${step.params.fileRef || ''}`;
      else if (step.action === 'editPdf') detailText = `✏️ Editing PDF: ${step.params.fileRef || ''}`;
      else if (step.action === 'viewCapturedFile') detailText = `👁️ Viewing file: ${step.params.fileRef || step.params.fileId || ''}`;
      else if (step.action === 'readFile') detailText = `📖 Reading file: ${step.params.fileRef || step.params.fileId || ''}`;
      else if (step.action === 'captureFile') detailText = `📎 Capturing file: ${step.params.filename || step.params.url || ''}`;
    }

    entry.innerHTML = `
      <div class="step-number">${step.stepNumber}</div>
      <div class="step-body">
        <div class="step-action"><span class="action-name">${escapeHtml(step.action)}</span></div>
        ${step.thought ? `<div class="step-thought">${formatMarkdown(step.thought)}</div>` : ''}
        ${detailText ? `<div class="step-detail">${escapeHtml(detailText)}</div>` : ''}
        ${step.error ? `<div class="step-error">${formatMarkdown(step.error)}</div>` : ''}
      </div>
    `;

    stepLog.appendChild(entry);
    scrollToBottom();
  }

  function getLatestStepEntry() {
    const entries = stepLog.querySelectorAll('.step-entry');
    return entries.length ? entries[entries.length - 1] : null;
  }

  function renderDoneStep(summary) {
    const doneEl = document.createElement('div');
    doneEl.className = 'step-done';
    doneEl.innerHTML = `
      <h4>Task Completed</h4>
      <div class="step-done-content"></div>
    `;
    stepLog.appendChild(doneEl);
    scrollToBottom();
    streamMarkdownInto(doneEl.querySelector('.step-done-content'), summary || '', { wordsPerTick: 3, tickMs: 14 });
  }

  // ============================================
  // Document Card — rich UI for PDF/document operations
  // Shows what the agent is doing with a document: editing, viewing,
  // inspecting, creating. Includes download button and operation stats.
  // ============================================
  function renderDocumentCard(step, doc) {
    if (typeof PdfSandbox !== 'undefined') {
      const fieldList = Array.isArray(doc.fields) ? doc.fields : [];
      const sandbox = PdfSandbox.create(stepLog, {
        filename: doc.filename || 'document.pdf',
        pageCount: doc.pageCount || 1,
        fields: fieldList,
        docType: doc.docType || 'pdf'
      });

      const actionMap = {
        editPdf: 'Edited',
        viewPdfPages: 'Inspected',
        pdfPages: 'Analyzed'
      };
      const label = actionMap[doc.action] || 'Processed';

      if (doc.action === 'pdfPages') {
        sandbox.setStatus('Inspected');
        if (fieldList.length) {
          sandbox.setProgress(fieldList.length, fieldList.length);
        }
        if (doc.signedUrl) {
          sandbox.showResultUrl(doc.signedUrl, doc.filename, 'Analyzed', doc.size);
        }
      } else if (doc.action === 'editPdf') {
        const total = (doc.filledFields || 0) + (doc.skippedFields || 0) || (fieldList.length || 1);
        sandbox.setProgress(doc.filledFields || total, total);
        if (doc.signedUrl) {
          sandbox.showResultUrl(doc.signedUrl, doc.filename, 'Edited', doc.size);
        }
      } else if (doc.action === 'viewPdfPages') {
        sandbox.setStatus('Inspected');
        if (doc.signedUrl) {
          sandbox.showResultUrl(doc.signedUrl, doc.filename, 'Inspected', doc.size);
        }
      } else {
        if (doc.signedUrl) {
          sandbox.showResultUrl(doc.signedUrl, doc.filename, label, doc.size);
        }
      }

      const statusText = step.params?.text || '';
      if (statusText) {
        const descEl = document.createElement('div');
        descEl.className = 'psb-doc-summary';
        descEl.style.cssText = 'font-size: 11px; color: var(--on-surface-muted, #888); margin: 6px 12px 10px; line-height: 1.4;';
        sandbox.card.appendChild(descEl);
        streamMarkdownInto(descEl, statusText);
      }
      scrollToBottom();
      return;
    }

    const card = document.createElement('div');
    card.className = 'ge-doc-card';

    // Determine action label and icon
    const actionMap = {
      editPdf: { label: 'Edited', icon: '✏️', verb: 'Editing' },
      viewPdfPages: { label: 'Inspected', icon: '🔍', verb: 'Viewing' },
      pdfPages: { label: 'Analyzed', icon: '📋', verb: 'Analyzing' }
    };
    const actionInfo = actionMap[doc.action] || { label: 'Processed', icon: '📄', verb: 'Processing' };

    // Format file size
    const sizeKB = doc.size ? (doc.size / 1024).toFixed(1) : '?';
    const sizeLabel = doc.size > 1024 * 1024
      ? `${(doc.size / (1024 * 1024)).toFixed(1)} MB`
      : `${sizeKB} KB`;

    // Build stats chips
    const stats = [];
    if (doc.filledFields > 0) stats.push(`<span class="ge-doc-stat filled">✓ ${doc.filledFields} field${doc.filledFields !== 1 ? 's' : ''} filled</span>`);
    if (doc.drawnOverlays > 0) stats.push(`<span class="ge-doc-stat overlay">✎ ${doc.drawnOverlays} overlay${doc.drawnOverlays !== 1 ? 's' : ''} drawn</span>`);
    if (doc.skippedFields > 0) stats.push(`<span class="ge-doc-stat skipped">⚠ ${doc.skippedFields} skipped</span>`);
    if (doc.pageCount) stats.push(`<span class="ge-doc-stat pages">📄 ${doc.pageCount} page${doc.pageCount !== 1 ? 's' : ''}</span>`);

    const statusText = step.params?.text || '';

    card.innerHTML = `
      <div class="ge-doc-card-header">
        <div class="ge-doc-icon-wrap">
          <div class="ge-doc-icon">${actionInfo.icon}</div>
          <div class="ge-doc-badge">${escapeHtml(actionInfo.label)}</div>
        </div>
        <div class="ge-doc-info">
          <div class="ge-doc-filename" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</div>
          <div class="ge-doc-meta">
            <span class="ge-doc-size">${sizeLabel}</span>
            <span class="ge-doc-ref">${escapeHtml(doc.fileRef)}</span>
          </div>
        </div>
      </div>
      ${stats.length ? `<div class="ge-doc-stats">${stats.join('')}</div>` : ''}
      ${statusText ? `<div class="ge-doc-status"></div>` : ''}
      <div class="ge-doc-actions">
        ${doc.signedUrl ? `<button class="ge-doc-download-btn" data-url="${escapeHtml(doc.signedUrl)}" data-filename="${escapeHtml(doc.filename)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download
        </button>` : ''}
        ${doc.signedUrl ? `<button class="ge-doc-open-btn" data-url="${escapeHtml(doc.signedUrl)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Open
        </button>` : ''}
      </div>
    `;

    // Wire up download button
    const dlBtn = card.querySelector('.ge-doc-download-btn');
    if (dlBtn) {
      dlBtn.addEventListener('click', async () => {
        const url = dlBtn.getAttribute('data-url');
        const filename = dlBtn.getAttribute('data-filename');
        dlBtn.disabled = true;
        dlBtn.textContent = 'Downloading…';
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename || 'document.pdf';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Downloaded';
          setTimeout(() => {
            dlBtn.disabled = false;
            dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download';
          }, 3000);
        } catch (e) {
          dlBtn.textContent = 'Failed';
          dlBtn.disabled = false;
        }
      });
    }
    // Wire up open button
    const openBtn = card.querySelector('.ge-doc-open-btn');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        window.open(openBtn.getAttribute('data-url'), '_blank');
      });
    }

    stepLog.appendChild(card);
    // Stream the status text if present
    if (statusText) {
      const statusEl = card.querySelector('.ge-doc-status');
      if (statusEl) streamMarkdownInto(statusEl, statusText);
    }
    scrollToBottom();
  }

  function renderExecutingIndicator() {
    const id = 'executing-indicator';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'step-thinking';
      el.innerHTML = `
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span>Executing action...</span>
      `;
      stepLog.appendChild(el);
      scrollToBottom();
    }
    return el;
  }

  function removeExecutingIndicator() {
    const el = document.getElementById('executing-indicator');
    if (el) el.remove();
  }

  function updateTabTracker(tabs, activeIndex) {
    if (!tabs || tabs.length === 0) {
      tabTracker.innerHTML = '';
      return;
    }

    tabTracker.innerHTML = tabs.filter(t => t.status === 'active').map((tab, i) => {
      const isActive = i === activeIndex;
      const hostname = tab.url ? (() => { try { return new URL(tab.url).hostname; } catch { return tab.url; } })() : 'New Tab';
      return `<div class="tracked-tab ${isActive ? 'active' : ''}" title="${escapeHtml(tab.url || '')}">
        <span>${escapeHtml(tab.title || hostname)}</span>
      </div>`;
    }).join('');
  }

  function showStoredData(data) {
    storedDataPanel.style.display = 'block';
    dataPanelBody.textContent = JSON.stringify(data, null, 2);
  }

  function showCapturedFiles(files) {
    if (!capturedFilesPanel || !capturedPanelBody) return;
    capturedFilesPanel.style.display = 'block';
    
    // Build the list
    capturedPanelBody.innerHTML = '<div style="padding: 0 24px 12px; display:flex; flex-direction:column; gap:8px;">' + 
      files.map(f => {
        const sizeStr = (f.size / 1024).toFixed(1) + ' KB';
        const link = f.signedUrl || f.sourceUrl || '#';
        const fileRef = `fileRef="${escapeHtml(f.id)}"`;
        
        return `<div class="captured-file-item">
          <div class="captured-file-info">
            <a href="${escapeHtml(link)}" target="_blank" class="captured-file-title" title="${escapeHtml(f.filename)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
              ${escapeHtml(f.filename)}
            </a>
            <div class="captured-file-meta">
              <span>${sizeStr}</span>
              ${f.description ? `<span>&middot;</span><span>${escapeHtml(f.description)}</span>` : ''}
            </div>
          </div>
          <div class="captured-file-actions">
            <button class="btn-file-action btn-mention-file" data-fileref='${escapeHtml(fileRef)}' title="Mention this file in the chat">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Mention
            </button>
            <a href="${escapeHtml(link)}" target="_blank" class="btn-file-action" title="Download or open">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </a>
          </div>
        </div>`;
      }).join('') + '</div>';

    // Wire up "Mention" buttons
    capturedPanelBody.querySelectorAll('.btn-mention-file').forEach(btn => {
      btn.addEventListener('click', () => {
        const ref = btn.dataset.fileref;
        if (taskInput) {
          const prefix = taskInput.value.trim() ? ' ' : '';
          taskInput.value += prefix + ref + ' ';
          taskInput.focus();
        }
      });
    });
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      stepLog.scrollTop = stepLog.scrollHeight;
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // Convert basic markdown to HTML for AI-generated text
  function formatMarkdown(text) {
    if (!text) return '';

    // Protect fenced code blocks (extract before escaping)
    const codeBlocks = [];
    let processed = text.replace(/```([\s\S]*?)```/g, (match, code) => {
      const escaped = escapeHtml(code);
      codeBlocks.push(`<pre><code>${escaped}</code></pre>`);
      return `__CODEBLOCK_${codeBlocks.length - 1}__`;
    });

    // Escape everything else
    processed = escapeHtml(processed);

    // Inline code (must be after escaping)
    processed = processed.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    processed = processed.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    processed = processed.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Links [text](url)
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Process lists line-by-line
    const lines = processed.split('\n');
    const out = [];
    let listType = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ul = line.match(/^(\s*)[-*]\s+(.*)$/);
      const ol = line.match(/^(\s*)\d+\.\s+(.*)$/);

      if (ul) {
        if (listType !== 'ul') {
          if (listType) out.push(`</${listType}>`);
          listType = 'ul';
          out.push('<ul>');
        }
        out.push(`<li>${ul[2]}</li>`);
      } else if (ol) {
        if (listType !== 'ol') {
          if (listType) out.push(`</${listType}>`);
          listType = 'ol';
          out.push('<ol>');
        }
        out.push(`<li>${ol[2]}</li>`);
      } else {
        if (listType) {
          out.push(`</${listType}>`);
          listType = null;
        }
        if (line.includes('__CODEBLOCK_')) {
          out.push(line);
        } else if (line.trim()) {
          out.push(`<p>${line}</p>`);
        } else {
          out.push('<br>');
        }
      }
    }
    if (listType) out.push(`</${listType}>`);

    processed = out.join('\n');

    // Restore code blocks
    codeBlocks.forEach((block, i) => {
      processed = processed.replace(`__CODEBLOCK_${i}__`, block);
    });

    return processed;
  }

  // ============================================
  // Conversation continuity
  // When the user types into the input while a task is already running,
  // we deliver the message as a chat-nudge to the active task instead of
  // spawning a brand-new task. This mirrors the Telegram / WhatsApp
  // behaviour and lets the in-flight agent see the new instruction on its
  // next /step round (services/agentService.js consumes task.chatNudges).
  // ============================================
  // ============================================
  // Slash Commands Engine & SVG Icons (40 Commands)
  // ============================================
  const AGY_ICONS = {
    help: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    tabs: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="7" x2="22" y2="7"/><polyline points="8 21 12 17 16 21"/></svg>`,
    status: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    credits: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
    mode: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
    copilot: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    autopilot: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    models: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
    model: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z"/></svg>`,
    clear: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    history: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    tools: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    export: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    guide: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    skills: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    stage: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
    settings: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    warning: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    agent: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><path d="M8 15h8"/></svg>`,
    sniff: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    clean: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`,
    storage: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
    diff: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
    timemachine: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 8 14"/></svg>`,
    mirror: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="8" height="18" rx="1"/><rect x="14" y="3" width="8" height="18" rx="1"/></svg>`,
    record: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`,
    bridge: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    hud: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12h5"/><path d="M17 12h5"/><path d="M12 2v5"/><path d="M12 17v5"/><circle cx="12" cy="12" r="7"/></svg>`,
    fakereview: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    find: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    shadow: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    solve: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    pricematch: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`,
    bionic: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    voice: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
    focus: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
    mesh3d: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    acoustics: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>`,
    heatmap: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
    peek: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    heal: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
    jargon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    matrix: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`
  };

  const AGENT_SLASH_COMMANDS = [
    // ----------------------------------------------------
    // Category 1: 10 Essential & Expected Workhorses
    // ----------------------------------------------------
    {
      name: '/help',
      aliases: ['/start', '/?', '/commands'],
      category: 'Essential',
      icon: AGY_ICONS.help,
      desc: 'Show all 40 commands, shortcuts & interactive directory',
      params: '',
      run: async () => renderAgentHelpCard()
    },
    {
      name: '/tabs',
      aliases: ['/tab', '/list-tabs', '/windows'],
      category: 'Essential',
      icon: AGY_ICONS.tabs,
      desc: 'List all open Chrome tabs and active page details',
      params: '',
      run: async () => renderTabsCommand()
    },
    {
      name: '/status',
      aliases: ['/info', '/state'],
      category: 'Essential',
      icon: AGY_ICONS.status,
      desc: 'Show live telemetry, active task ID, mode & model status',
      params: '',
      run: async () => renderStatusCommand()
    },
    {
      name: '/credits',
      aliases: ['/account', '/balance', '/usage'],
      category: 'Essential',
      icon: AGY_ICONS.credits,
      desc: 'Check remaining AI credits, user plan & daily usage limits',
      params: '',
      run: async () => renderCreditsCommand()
    },
    {
      name: '/models',
      aliases: ['/model-list', '/llms'],
      category: 'Essential',
      icon: AGY_ICONS.models,
      desc: 'Browse and switch agent AI model tiers & pricing',
      params: '',
      run: async () => renderModelsCommand()
    },
    {
      name: '/model',
      aliases: ['/set-model', '/switch-model'],
      category: 'Essential',
      icon: AGY_ICONS.model,
      desc: 'Directly switch active AI model (e.g. /model sonnet)',
      params: '<id>',
      run: async (args) => handleModelSwitchCommand(args)
    },
    {
      name: '/clear',
      aliases: ['/reset', '/new'],
      category: 'Essential',
      icon: AGY_ICONS.clear,
      desc: 'Clear current conversation and start fresh session',
      params: '',
      run: async () => {
        resetToWelcome();
        showInlineNotice('Reset to clean workspace', 'info');
      }
    },
    {
      name: '/history',
      aliases: ['/tasks', '/recent'],
      category: 'Essential',
      icon: AGY_ICONS.history,
      desc: 'Open task history sidebar to review and resume past runs',
      params: '',
      run: async () => {
        historySidebar.classList.add('open');
        await loadTaskHistory();
      }
    },
    {
      name: '/tools',
      aliases: ['/my-tools', '/extensions'],
      category: 'Essential',
      icon: AGY_ICONS.tools,
      desc: 'Display installed custom and built-in extension tools',
      params: '',
      run: async () => renderToolsCommand()
    },
    {
      name: '/settings',
      aliases: ['/config', '/options'],
      category: 'Essential',
      icon: AGY_ICONS.settings,
      desc: 'Open Global Executive extension settings dashboard',
      params: '',
      run: async () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/settings.html') });
      }
    },

    // ----------------------------------------------------
    // Category 2: 10 Surprising & Highly-Sought Hidden Gems
    // ----------------------------------------------------
    {
      name: '/export',
      aliases: ['/copy', '/transcript', '/share'],
      category: 'Surprising',
      icon: AGY_ICONS.export,
      desc: 'Copy current session transcript and collected data to clipboard',
      params: '',
      run: async () => exportSessionTranscript()
    },
    {
      name: '/stage',
      aliases: ['/upload', '/file', '/pdf'],
      category: 'Surprising',
      icon: AGY_ICONS.stage,
      desc: 'Stage a file (PDF, CSV, image) for agent processing',
      params: '',
      run: async () => {
        document.getElementById('stage-file-input')?.click();
      }
    },
    {
      name: '/copilot',
      aliases: ['/co-pilot'],
      category: 'Surprising',
      icon: AGY_ICONS.copilot,
      desc: 'Switch to Co-Pilot mode (requests confirmation before executing actions)',
      params: '',
      run: async () => handleModeCommand('copilot')
    },
    {
      name: '/autopilot',
      aliases: ['/auto-pilot'],
      category: 'Surprising',
      icon: AGY_ICONS.autopilot,
      desc: 'Switch to Auto-Pilot mode (executes autonomously at max speed)',
      params: '',
      run: async () => handleModeCommand('autopilot')
    },
    {
      name: '/skills',
      aliases: ['/memory', '/recipes', '/rules'],
      category: 'Surprising',
      icon: AGY_ICONS.skills,
      desc: 'View compounding procedural automation routines & recipes',
      params: '',
      run: async () => renderSkillsCommand()
    },
    {
      name: '/sniff',
      aliases: ['/network', '/api-sniff'],
      category: 'Surprising',
      icon: AGY_ICONS.sniff,
      desc: 'Sniff background AJAX/fetch API responses on the active tab',
      params: '',
      run: async () => handleUserSubmit('Inspect background API network calls on this page and extract the raw JSON data payload.')
    },
    {
      name: '/clean',
      aliases: ['/strip-overlays', '/zap'],
      category: 'Surprising',
      icon: AGY_ICONS.clean,
      desc: 'Instantly strip sticky banners, cookie dialogs, and paywall blurs',
      params: '',
      run: async () => handleUserSubmit('Clean this article of all paywall overlays, newsletter popups, and cookie walls, then present full text.')
    },
    {
      name: '/storage',
      aliases: ['/cookies', '/localstorage'],
      category: 'Surprising',
      icon: AGY_ICONS.storage,
      desc: 'Inspect, edit, export, or clear cookies and LocalStorage for this site',
      params: '',
      run: async () => handleUserSubmit('Inspect all cookies, localStorage, and sessionStorage entries for the active site.')
    },
    {
      name: '/diff',
      aliases: ['/compare', '/dom-diff'],
      category: 'Surprising',
      icon: AGY_ICONS.diff,
      desc: 'Compare visual and DOM diffs across page changes or GitHub PRs',
      params: '',
      run: async () => handleUserSubmit('Review the code diffs or DOM changes on this page, highlighting potential modifications.')
    },
    {
      name: '/guide',
      aliases: ['/tutorial', '/prompting'],
      category: 'Surprising',
      icon: AGY_ICONS.guide,
      desc: 'View comprehensive prompt engineering & agent architecture guide',
      params: '',
      run: async () => renderGuideCommand()
    },

    // ----------------------------------------------------
    // Category 3: 10 Unprecedented & Out-of-the-Box Inventions
    // ----------------------------------------------------
    {
      name: '/timemachine',
      aliases: ['/watch', '/monitor'],
      category: 'Unprecedented',
      icon: AGY_ICONS.timemachine,
      desc: 'Snapshot DOM elements to monitor and alert on price/text changes',
      params: '',
      run: async () => handleUserSubmit('Monitor the inventory and price of this item and notify me if the availability status updates.')
    },
    {
      name: '/mirror',
      aliases: ['/sync-tabs', '/multitab'],
      category: 'Unprecedented',
      icon: AGY_ICONS.mirror,
      desc: 'Broadcast scroll and click actions synchronously across open tabs',
      params: '',
      run: async () => handleUserSubmit('Create a multi-tab mirror that mirrors my scroll and form actions across open tabs.')
    },
    {
      name: '/record',
      aliases: ['/macro', '/bot-record'],
      category: 'Unprecedented',
      icon: AGY_ICONS.record,
      desc: 'Record browser actions and compile them into an autonomous replay macro',
      params: '',
      run: async () => handleUserSubmit('Record my clicks and navigation on this page, generating a reusable autonomous playback script.')
    },
    {
      name: '/bridge',
      aliases: ['/transfer', '/pipe'],
      category: 'Unprecedented',
      icon: AGY_ICONS.bridge,
      desc: 'Pipe selected records or fields from active tab into a target tab',
      params: '',
      run: async () => handleUserSubmit('Copy customer details or data from this tab and pipe them into the destination tab.')
    },
    {
      name: '/hud',
      aliases: ['/summary-hud', '/briefing'],
      category: 'Unprecedented',
      icon: AGY_ICONS.hud,
      desc: 'Inject a floating executive summary HUD with metrics and key dates',
      params: '',
      run: async () => handleUserSubmit('Generate an executive briefing HUD from this page highlighting bottom-line figures and key takeaways.')
    },
    {
      name: '/fakereview',
      aliases: ['/bot-detector', '/reviews'],
      category: 'Unprecedented',
      icon: AGY_ICONS.fakereview,
      desc: 'Scan e-commerce reviews to calculate authenticity score and flag bots',
      params: '',
      run: async () => handleUserSubmit('Analyze reviews on this product page to calculate authenticity score and flag suspicious bot patterns.')
    },
    {
      name: '/find',
      aliases: ['/omni-search', '/search-all'],
      category: 'Unprecedented',
      icon: AGY_ICONS.find,
      desc: 'Deep-search text across all open browser tabs simultaneously',
      params: '<query>',
      run: async (query) => handleUserSubmit(`Search across all open browser tabs for references to "${query || 'query'}" and highlight matches.`)
    },
    {
      name: '/shadow',
      aliases: ['/iframe-pierce', '/pierce'],
      category: 'Unprecedented',
      icon: AGY_ICONS.shadow,
      desc: 'Recursively pierce nested shadow roots and iframes to reveal buried elements',
      params: '',
      run: async () => handleUserSubmit('Locate and interact with the elements inside the embedded shadow root and payment iframe widgets.')
    },
    {
      name: '/solve',
      aliases: ['/captcha-audio', '/audio-verify'],
      category: 'Unprecedented',
      icon: AGY_ICONS.solve,
      desc: 'Trigger audio fallback challenge for verification prompts and assist entry',
      params: '',
      run: async () => handleUserSubmit('Trigger audio challenge fallback for this captcha and assist in verifying.')
    },
    {
      name: '/pricematch',
      aliases: ['/sku-match', '/bestprice'],
      category: 'Unprecedented',
      icon: AGY_ICONS.pricematch,
      desc: 'Scan competitor stores for identical SKUs to find price match savings',
      params: '',
      run: async () => handleUserSubmit('Find identical SKU of this product on competitor stores and calculate potential price match savings.')
    },

    // ----------------------------------------------------
    // Category 4: 10 Wild, Polarizing & Awe-Inspiring Experiments
    // ----------------------------------------------------
    {
      name: '/bionic',
      aliases: ['/speedread', '/flow-read'],
      category: 'Wild',
      icon: AGY_ICONS.bionic,
      desc: 'Convert webpage text into fixation-guided bolding for 3x speed reading',
      params: '',
      run: async () => handleUserSubmit('Convert all article text on this page into bionic reading format with highlighted word fixations.')
    },
    {
      name: '/voice',
      aliases: ['/speech', '/handsfree'],
      category: 'Wild',
      icon: AGY_ICONS.voice,
      desc: 'Activate voice command navigation for hands-free browsing and scrolling',
      params: '',
      run: async () => handleUserSubmit('Enable voice navigation mode for browsing and controlling this page hands-free.')
    },
    {
      name: '/focus',
      aliases: ['/doomscroll', '/detox'],
      category: 'Wild',
      icon: AGY_ICONS.focus,
      desc: 'Add progressive scroll friction and grayscale filters on social feeds',
      params: '',
      run: async () => handleUserSubmit('Activate dopamine friction on this social feed: add scroll resistance and grayscale after 10 mins.')
    },
    {
      name: '/3d',
      aliases: ['/wireframe', '/mesh3d'],
      category: 'Wild',
      icon: AGY_ICONS.mesh3d,
      desc: 'Tilt webpage into a rotatable 3D wireframe mesh displaying z-index layers',
      params: '',
      run: async () => handleUserSubmit('Render this webpage in 3D wireframe perspective showing z-index stacking layers.')
    },
    {
      name: '/acoustics',
      aliases: ['/soundscape', '/mechanical'],
      category: 'Wild',
      icon: AGY_ICONS.acoustics,
      desc: 'Inject mechanical keyboard acoustic clicks and harmonious UI chimes',
      params: '',
      run: async () => handleUserSubmit('Play mechanical keyboard click acoustics on button interactions and typing across the page.')
    },
    {
      name: '/heatmap',
      aliases: ['/attention', '/clickmap'],
      category: 'Wild',
      icon: AGY_ICONS.heatmap,
      desc: 'Overlay a live thermal attention heatmap of clicks and reading dwell time',
      params: '',
      run: async () => handleUserSubmit('Draw a thermal attention heatmap overlay showing where clicks and reading focus landed.')
    },
    {
      name: '/peek',
      aliases: ['/linkpeek', '/hoverpreview'],
      category: 'Wild',
      icon: AGY_ICONS.peek,
      desc: 'Show floating iframe preview cards on link hover without opening tabs',
      params: '',
      run: async () => handleUserSubmit('Preview all outbound links on this page on hover without opening new browser tabs.')
    },
    {
      name: '/heal',
      aliases: ['/rageclick', '/fixbutton'],
      category: 'Wild',
      icon: AGY_ICONS.heal,
      desc: 'Detect repeated clicks on non-responsive buttons and trigger listeners',
      params: '',
      run: async () => handleUserSubmit('Detect broken buttons on this page and simulate click dispatching to unblock the form.')
    },
    {
      name: '/jargon',
      aliases: ['/buzzwords', '/pr-decrypt'],
      category: 'Wild',
      icon: AGY_ICONS.jargon,
      desc: 'Decrypt corporate marketing buzzwords into brutally honest plain English',
      params: '',
      run: async () => handleUserSubmit('Decrypt all corporate buzzwords and PR spin in this announcement into plain honest English.')
    },
    {
      name: '/matrix',
      aliases: ['/terminal', '/hackermode'],
      category: 'Wild',
      icon: AGY_ICONS.matrix,
      desc: 'Transform webpage into a retro phosphor green CRT terminal HUD',
      params: '',
      run: async () => handleUserSubmit('Transform this website layout into a retro Matrix-style green CRT terminal interface.')
    }
  ];

  function renderAgentHelpCard(selectedFilter = 'all') {
    const filtered = selectedFilter === 'all'
      ? AGENT_SLASH_COMMANDS
      : AGENT_SLASH_COMMANDS.filter(c => c.category.toLowerCase() === selectedFilter.toLowerCase());

    const chipsHtml = filtered.map(c => `
      <a class="command-chip" data-cmd="${c.params ? c.name + ' ' : c.name}">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="color:var(--primary);display:inline-flex;">${c.icon}</span>
          <code>${escapeHtml(c.name)}${c.params ? ' ' + escapeHtml(c.params) : ''}</code>
        </div>
        <div class="command-chip-info" style="margin-top:2px;">
          ${escapeHtml(c.desc)}
        </div>
      </a>
    `).join('');

    const card = document.createElement('div');
    card.className = 'command-card';
    card.innerHTML = `
      <div class="command-card-header">
        <span class="command-card-icon">${AGY_ICONS.agent}</span>
        <div>
          <h3>Global Executive · Command Center (${AGENT_SLASH_COMMANDS.length} Commands)</h3>
          <p>Organized 2-by-2. Click any command or type <code>/</code> for quick navigation.</p>
        </div>
      </div>

      <div class="template-tabs">
        <button class="template-tab ${selectedFilter === 'all' ? 'active' : ''}" data-cmd-filter="all">All (${AGENT_SLASH_COMMANDS.length})</button>
        <button class="template-tab ${selectedFilter === 'Essential' ? 'active' : ''}" data-cmd-filter="Essential">Expected &amp; Essential (10)</button>
        <button class="template-tab ${selectedFilter === 'Surprising' ? 'active' : ''}" data-cmd-filter="Surprising">Surprising Gems (10)</button>
        <button class="template-tab ${selectedFilter === 'Unprecedented' ? 'active' : ''}" data-cmd-filter="Unprecedented">New Inventions (10)</button>
        <button class="template-tab ${selectedFilter === 'Wild' ? 'active' : ''}" data-cmd-filter="Wild">Wild &amp; Experimental (10)</button>
      </div>

      <div class="two-col-grid command-grid-container">
        ${chipsHtml}
      </div>
    `;

    stepLog.appendChild(card);
    scrollToBottom();

    // Tab filter listeners
    card.querySelectorAll('.template-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const filter = tab.dataset.cmdFilter;
        card.querySelectorAll('.template-tab').forEach(t => t.classList.toggle('active', t === tab));
        const grid = card.querySelector('.command-grid-container');
        if (grid) {
          const newFiltered = filter === 'all'
            ? AGENT_SLASH_COMMANDS
            : AGENT_SLASH_COMMANDS.filter(c => c.category.toLowerCase() === filter.toLowerCase());
          grid.innerHTML = newFiltered.map(c => `
            <a class="command-chip" data-cmd="${c.params ? c.name + ' ' : c.name}">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="color:var(--primary);display:inline-flex;">${c.icon}</span>
                <code>${escapeHtml(c.name)}${c.params ? ' ' + escapeHtml(c.params) : ''}</code>
              </div>
              <div class="command-chip-info" style="margin-top:2px;">
                ${escapeHtml(c.desc)}
              </div>
            </a>
          `).join('');
        }
      });
    });
  }

  async function renderTabsCommand() {
    const card = document.createElement('div');
    card.className = 'command-card';
    card.innerHTML = `<div class="command-card-header"><span class="command-card-icon">${AGY_ICONS.tabs}</span><h3>Open Chrome Tabs</h3></div><div style="padding:8px 0;font-size:12px;color:var(--on-surface-muted);">Fetching tabs...</div>`;
    stepLog.appendChild(card);
    scrollToBottom();

    try {
      const resp = await sendToBackground('ge-list-tabs', {});
      if (resp?.success && Array.isArray(resp.tabs)) {
        const rows = resp.tabs.map(t => {
          let domain = 'about:blank';
          try { if (t.url) domain = new URL(t.url).hostname; } catch (_) {}
          return `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:6px;background:var(--surface-container-low);margin-bottom:4px;font-size:12px;">
              <div style="display:flex;align-items:center;gap:8px;overflow:hidden;">
                <span style="font-family:var(--font-mono);font-size:11px;font-weight:700;color:var(--primary);background:var(--accent-bg);padding:1px 6px;border-radius:4px;">#${t.index}</span>
                <span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--on-surface);max-width:280px;">${escapeHtml(t.title || 'Untitled Tab')}</span>
                <span style="font-size:10px;color:var(--on-surface-muted);">(${escapeHtml(domain)})</span>
              </div>
              ${t.active ? '<span style="font-size:10px;font-weight:700;color:var(--success);background:rgba(46,125,79,0.15);padding:2px 6px;border-radius:4px;">ACTIVE</span>' : ''}
            </div>
          `;
        }).join('');
        card.innerHTML = `
          <div class="command-card-header">
            <span class="command-card-icon">${AGY_ICONS.tabs}</span>
            <div>
              <h3>Open Chrome Tabs (${resp.tabs.length})</h3>
              <p>These are the browser tabs accessible to the agent during automation.</p>
            </div>
          </div>
          <div style="max-height:240px;overflow-y:auto;">${rows || '<div style="font-size:12px;color:var(--on-surface-muted);">No open tabs found.</div>'}</div>
        `;
      } else {
        card.innerHTML = `<div class="command-card-header"><span class="command-card-icon">${AGY_ICONS.tabs}</span><h3>Open Chrome Tabs</h3></div><div style="color:var(--danger);font-size:12px;">Could not list tabs.</div>`;
      }
    } catch (e) {
      card.innerHTML = `<div class="command-card-header"><span class="command-card-icon">${AGY_ICONS.tabs}</span><h3>Open Chrome Tabs</h3></div><div style="color:var(--danger);font-size:12px;">Error: ${escapeHtml(e.message)}</div>`;
    }
    scrollToBottom();
  }

  function renderStatusCommand() {
    const card = document.createElement('div');
    card.className = 'command-card';
    const activeModel = availableModels.find(m => m.id === selectedModelId);
    card.innerHTML = `
      <div class="command-card-header">
        <span class="command-card-icon">${AGY_ICONS.status}</span>
        <div>
          <h3>Agent Status &amp; Diagnostics</h3>
          <p>Real-time runtime state of Global Executive</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;font-size:12px;">
        <div style="padding:8px 10px;background:var(--surface-container-low);border-radius:8px;">
          <div style="color:var(--on-surface-muted);font-size:10px;text-transform:uppercase;font-weight:700;">Task Status</div>
          <div style="font-weight:700;color:var(--on-surface);margin-top:2px;">${isRunning ? 'Running' : 'Idle'} ${currentTaskId ? `(#${currentTaskId.slice(-6)})` : ''}</div>
        </div>
        <div style="padding:8px 10px;background:var(--surface-container-low);border-radius:8px;">
          <div style="color:var(--on-surface-muted);font-size:10px;text-transform:uppercase;font-weight:700;">Execution Mode</div>
          <div style="font-weight:700;color:var(--primary);margin-top:2px;display:flex;align-items:center;gap:4px;">${selectedMode === 'autopilot' ? AGY_ICONS.autopilot + ' Auto-Pilot' : AGY_ICONS.copilot + ' Co-Pilot'}</div>
        </div>
        <div style="padding:8px 10px;background:var(--surface-container-low);border-radius:8px;">
          <div style="color:var(--on-surface-muted);font-size:10px;text-transform:uppercase;font-weight:700;">Active Model</div>
          <div style="font-weight:700;color:var(--on-surface);margin-top:2px;">${escapeHtml(activeModel?.name || selectedModelId || 'Default')}</div>
        </div>
        <div style="padding:8px 10px;background:var(--surface-container-low);border-radius:8px;">
          <div style="color:var(--on-surface-muted);font-size:10px;text-transform:uppercase;font-weight:700;">Max Steps / Tier</div>
          <div style="font-weight:700;color:var(--on-surface);margin-top:2px;">Up to ${currentTierMaxSteps} steps</div>
        </div>
      </div>
    `;
    stepLog.appendChild(card);
    scrollToBottom();
  }

  async function renderCreditsCommand() {
    const card = document.createElement('div');
    card.className = 'command-card';
    card.innerHTML = `<div class="command-card-header"><span class="command-card-icon">${AGY_ICONS.credits}</span><h3>Account &amp; Credits</h3></div><div style="font-size:12px;color:var(--on-surface-muted);">Fetching balance...</div>`;
    stepLog.appendChild(card);
    scrollToBottom();

    try {
      const data = await NewOrderAPI.request('/api/auth/profile');
      if (data?.user) {
        const u = data.user;
        const sub = u.subscription || {};
        const plan = (sub.status === 'active' && sub.plan && sub.plan !== 'none') ? sub.plan.toUpperCase() : 'FREE';
        const credits = Number(u.credits || 0).toFixed(2);
        updateCreditsDisplay(u.credits);
        card.innerHTML = `
          <div class="command-card-header">
            <span class="command-card-icon">${AGY_ICONS.credits}</span>
            <div>
              <h3>Account &amp; AI Credits</h3>
              <p>${escapeHtml(u.email || '')}</p>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;font-size:12px;">
            <div style="padding:10px;background:var(--surface-container-low);border-radius:8px;">
              <div style="color:var(--on-surface-muted);font-size:10px;font-weight:700;text-transform:uppercase;">Credits Balance</div>
              <div style="font-size:18px;font-weight:800;color:var(--primary);margin-top:2px;">${credits} <span style="font-size:11px;font-weight:600;color:var(--on-surface-muted);">cr</span></div>
            </div>
            <div style="padding:10px;background:var(--surface-container-low);border-radius:8px;">
              <div style="color:var(--on-surface-muted);font-size:10px;font-weight:700;text-transform:uppercase;">Plan Tier</div>
              <div style="font-size:16px;font-weight:700;color:var(--on-surface);margin-top:2px;">${escapeHtml(plan)}</div>
            </div>
          </div>
          <div style="margin-top:10px;text-align:right;">
            <a href="https://global-order.32d.one/pricing" target="_blank" style="font-size:11px;font-weight:700;color:var(--primary);text-decoration:none;">Upgrade or Top Up &rarr;</a>
          </div>
        `;
      }
    } catch (e) {
      card.innerHTML = `<div class="command-card-header"><span class="command-card-icon">${AGY_ICONS.credits}</span><h3>Account &amp; Credits</h3></div><div style="color:var(--danger);font-size:12px;">Failed to load account info: ${escapeHtml(e.message)}</div>`;
    }
    scrollToBottom();
  }

  function handleModeCommand(args) {
    const target = String(args || '').trim().toLowerCase();
    if (target === 'autopilot' || target === 'auto-pilot' || target === 'auto') {
      selectedMode = 'autopilot';
    } else if (target === 'copilot' || target === 'co-pilot') {
      selectedMode = 'copilot';
    } else {
      selectedMode = selectedMode === 'copilot' ? 'autopilot' : 'copilot';
    }

    const toggle = document.getElementById('mode-toggle');
    if (toggle) {
      toggle.dataset.mode = selectedMode;
      toggle.querySelectorAll('.mode-option').forEach(b => b.classList.toggle('active', b.dataset.mode === selectedMode));
    }
    if (selectedMode === 'autopilot') document.body.classList.add('autopilot-mode');
    else document.body.classList.remove('autopilot-mode');

    const card = document.createElement('div');
    card.className = 'command-card';
    card.innerHTML = `
      <div class="command-card-header">
        <span class="command-card-icon">${AGY_ICONS.mode}</span>
        <div>
          <h3>Mode Switched to ${selectedMode === 'autopilot' ? 'Auto-Pilot' : 'Co-Pilot'}</h3>
          <p>${selectedMode === 'autopilot' ? 'The agent will run fully autonomously without prompting for step approval.' : 'The agent will ask for your confirmation before executing sensitive or high-risk actions.'}</p>
        </div>
      </div>
    `;
    stepLog.appendChild(card);
    scrollToBottom();
  }

  function renderModelsCommand() {
    const card = document.createElement('div');
    card.className = 'command-card';
    const rows = availableModels.map(m => {
      const isCurrent = m.id === selectedModelId;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-radius:8px;background:${isCurrent ? 'var(--accent-bg)' : 'var(--surface-container-low)'};margin-bottom:4px;font-size:12px;">
          <div>
            <span style="font-weight:700;color:var(--on-surface);">${escapeHtml(m.name)}</span>
            <span style="font-size:10px;color:var(--on-surface-muted);font-family:var(--font-mono);margin-left:6px;">(${escapeHtml(m.id)})</span>
          </div>
          <button class="command-chip" data-cmd="/model ${escapeHtml(m.id)}" style="padding:3px 8px;font-size:11px;font-weight:700;">
            ${isCurrent ? '✓ Active' : 'Select'}
          </button>
        </div>
      `;
    }).join('');

    card.innerHTML = `
      <div class="command-card-header">
        <span class="command-card-icon">${AGY_ICONS.models}</span>
        <div>
          <h3>Available Agent AI Models</h3>
          <p>Choose the model powering the Global Executive agent reasoning loop.</p>
        </div>
      </div>
      <div style="max-height:260px;overflow-y:auto;">${rows || 'No models loaded.'}</div>
    `;
    stepLog.appendChild(card);
    scrollToBottom();
  }

  function handleModelSwitchCommand(args) {
    const query = String(args || '').trim().toLowerCase();
    if (!query) {
      renderModelsCommand();
      return;
    }
    const match = availableModels.find(m => m.id.toLowerCase() === query || m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query));
    if (match) {
      selectedModelId = match.id;
      renderModelSelector();
      const card = document.createElement('div');
      card.className = 'command-card';
      card.innerHTML = `
        <div class="command-card-header">
          <span class="command-card-icon">${AGY_ICONS.model}</span>
          <div>
            <h3>Active Model Set to: ${escapeHtml(match.name)}</h3>
            <p>Model ID: <code>${escapeHtml(match.id)}</code></p>
          </div>
        </div>
      `;
      stepLog.appendChild(card);
      scrollToBottom();
    } else {
      showInlineNotice(`Model "${query}" not found. Type /models to view all.`, 'warning');
      renderModelsCommand();
    }
  }

  async function renderToolsCommand() {
    const card = document.createElement('div');
    card.className = 'command-card';
    card.innerHTML = `<div class="command-card-header"><span class="command-card-icon">${AGY_ICONS.tools}</span><h3>Extension Tools</h3></div><div style="font-size:12px;color:var(--on-surface-muted);">Loading tools...</div>`;
    stepLog.appendChild(card);
    scrollToBottom();

    try {
      const tools = typeof ToolManager !== 'undefined' ? await ToolManager.getInstalledTools() : [];
      const toolRows = (tools || []).map(t => `
        <div style="padding:8px 10px;background:var(--surface-container-low);border-radius:8px;margin-bottom:6px;font-size:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-weight:700;color:var(--on-surface);">${escapeHtml(t.name || 'Unnamed Tool')}</span>
            <span style="font-size:10px;font-weight:700;color:var(--success);background:rgba(46,125,79,0.15);padding:1px 6px;border-radius:4px;">${t.enabled !== false ? 'ACTIVE' : 'DISABLED'}</span>
          </div>
          <div style="font-size:11px;color:var(--on-surface-muted);margin-top:2px;">${escapeHtml(t.description || 'No description')}</div>
        </div>
      `).join('');

      card.innerHTML = `
        <div class="command-card-header">
          <span class="command-card-icon">${AGY_ICONS.tools}</span>
          <div>
            <h3>Installed Extension Tools (${tools.length})</h3>
            <p>Active custom and built-in automation tools in your browser.</p>
          </div>
        </div>
        <div style="max-height:240px;overflow-y:auto;">${toolRows || '<div style="font-size:12px;color:var(--on-surface-muted);">No custom tools installed yet. Build tools with AI in the Builder page!</div>'}</div>
      `;
    } catch (e) {
      card.innerHTML = `<div class="command-card-header"><span class="command-card-icon">${AGY_ICONS.tools}</span><h3>Extension Tools</h3></div><div style="color:var(--danger);font-size:12px;">Failed to load tools: ${escapeHtml(e.message)}</div>`;
    }
    scrollToBottom();
  }

  async function exportSessionTranscript() {
    const bubbles = Array.from(stepLog.children);
    let md = `# Global Executive Task Transcript\n\nGenerated: ${new Date().toLocaleString()}\nTask ID: ${currentTaskId || 'N/A'}\nMode: ${selectedMode}\n\n---\n\n`;

    bubbles.forEach(b => {
      if (b.classList.contains('user-prompt-bubble')) {
        md += `### User\n${b.textContent.trim()}\n\n`;
      } else if (b.classList.contains('step-message')) {
        md += `### Assistant\n${b.innerText.trim()}\n\n`;
      } else if (b.classList.contains('step-entry')) {
        const action = b.querySelector('.action-name')?.textContent || '';
        const thought = b.querySelector('.step-thought')?.textContent || '';
        const detail = b.querySelector('.step-detail')?.textContent || '';
        md += `**Step (${action})**\n`;
        if (thought) md += `*Thought:* ${thought}\n`;
        if (detail) md += `*Detail:* ${detail}\n`;
        md += `\n`;
      } else if (b.classList.contains('step-done')) {
        md += `### Task Completed\n${b.innerText.trim()}\n\n`;
      }
    });

    try {
      await navigator.clipboard.writeText(md);
      showInlineNotice('Session transcript copied to clipboard as Markdown!', 'info');
    } catch (err) {
      showInlineNotice('Could not copy to clipboard: ' + err.message, 'warning');
    }
  }

  function renderGuideCommand() {
    const card = document.createElement('div');
    card.className = 'command-card';
    card.innerHTML = `
      <div class="command-card-header">
        <span class="command-card-icon">${AGY_ICONS.guide}</span>
        <div>
          <h3>Global Executive · Automation Pro Guide</h3>
          <p>Mastering autonomous browser workflows, prompts &amp; PDF handling</p>
        </div>
      </div>
      <div style="font-size:12.5px;color:var(--on-surface);line-height:1.6;display:flex;flex-direction:column;gap:12px;">
        <div style="background:var(--surface-container-low);padding:10px 12px;border-radius:8px;">
          <strong style="color:var(--primary);">1. Prompt Structure for Maximum Accuracy</strong><br>
          Specify: <em>Goal + Starting URL + Target Fields + Output format</em>.<br>
          <code style="font-size:11px;">"Go to amazon.com, search for mechanical keyboards under $80, extract top 5 ratings and prices into collected data."</code>
        </div>
        <div style="background:var(--surface-container-low);padding:10px 12px;border-radius:8px;">
          <strong style="color:var(--primary);">2. Co-Pilot vs Auto-Pilot</strong><br>
          • <strong>Co-Pilot</strong> is ideal for purchasing, sending emails, or submitting critical forms (asks before executing).<br>
          • <strong>Auto-Pilot</strong> runs unattended at max speed for research, scraping, and repetitive tasks.
        </div>
        <div style="background:var(--surface-container-low);padding:10px 12px;border-radius:8px;">
          <strong style="color:var(--primary);">3. Document &amp; PDF Operations</strong><br>
          Use the <code>/stage</code> command to attach PDFs/CSVs. The agent can inspect specific pages, fill out form fields, merge documents, and export deliverables.
        </div>
        <div style="background:var(--surface-container-low);padding:10px 12px;border-radius:8px;">
          <strong style="color:var(--primary);">4. Multi-Turn Session Continuity</strong><br>
          Send follow-up messages while a task is running to nudge the agent in real time, or after completion to continue refining results.
        </div>
      </div>
    `;
    stepLog.appendChild(card);
    scrollToBottom();
  }

  const AGENT_COMPOUNDING_SKILLS = [
    // Category 1: 10 Essential & Expected Workhorses
    {
      category: 'Essential',
      categoryLabel: 'Workhorse',
      icon: AGY_ICONS.form || AGY_ICONS.tools,
      title: 'Auto-Fill Complex Forms & Portals',
      desc: 'Detects multi-step form fields, selects, and checkboxes, accurately completing them with memory values.',
      prompt: 'Fill out this multi-step form using my standard profile and submit when complete.'
    },
    {
      category: 'Essential',
      categoryLabel: 'Workhorse',
      icon: AGY_ICONS.tools,
      title: 'Table & List Data Extraction',
      desc: 'Navigates through pagination, extracting structured records and prices into collected key-value data.',
      prompt: 'Extract all table records and listings on this page across the next 3 pages into collected data.'
    },
    {
      category: 'Essential',
      categoryLabel: 'Workhorse',
      icon: AGY_ICONS.tabs,
      title: 'Competitive Price & Spec Comparison',
      desc: 'Opens product listings across multiple tabs, comparing warranties, delivery times, and true costs.',
      prompt: 'Compare the price, ratings, and delivery estimates for this product across Amazon, Walmart, and BestBuy.'
    },
    {
      category: 'Essential',
      categoryLabel: 'Workhorse',
      icon: AGY_ICONS.guide,
      title: 'Deep Research & Document Briefing',
      desc: 'Reads articles, whitepapers, or documentation across tabs and synthesizes an executive summary.',
      prompt: 'Research this topic across the current open tabs and synthesize key takeaways with cited sources.'
    },
    {
      category: 'Essential',
      categoryLabel: 'Workhorse',
      icon: AGY_ICONS.stage,
      title: 'PDF Parsing & Key Metric Extraction',
      desc: 'Parses staged invoices, receipts, and PDF reports, extracting financial figures into clean tables.',
      prompt: 'Inspect the staged PDF invoice, extract itemized totals, tax, and due date into collected data.'
    },
    {
      category: 'Essential',
      categoryLabel: 'Workhorse',
      icon: AGY_ICONS.credits,
      title: 'Recurring Invoice & Receipt Downloader',
      desc: 'Logs into billing portals (AWS, Stripe, Google Cloud) and downloads the latest monthly invoices.',
      prompt: 'Navigate to billing history, download the latest 3 invoice PDFs, and summarize amounts.'
    },
    {
      category: 'Essential',
      categoryLabel: 'Workhorse',
      icon: AGY_ICONS.tools,
      title: 'SEO & Metadata Audit',
      desc: 'Inspects title tags, meta descriptions, OpenGraph headers, canonical URLs, and schema JSON-LD.',
      prompt: 'Perform a comprehensive SEO audit of this page: check meta tags, headings hierarchy, and schema markup.'
    },
    {
      category: 'Essential',
      categoryLabel: 'Workhorse',
      icon: AGY_ICONS.clear,
      title: 'Multi-Tab Triage & Workspace Cleanup',
      desc: 'Clusters 30+ open tabs by domain/topic, closing duplicates and organizing your workspace.',
      prompt: 'Inspect all open tabs, list them by topic/category, and identify duplicate or idle tabs.'
    },
    {
      category: 'Essential',
      categoryLabel: 'Workhorse',
      icon: AGY_ICONS.settings,
      title: 'Flight, Hotel & Travel Scraper',
      desc: 'Searches Google Flights, Expedia, or Airbnb for specified departure dates, sorting by value score.',
      prompt: 'Search flights from JFK to LHR for next month under $600 with max 1 layover.'
    },
    {
      category: 'Essential',
      categoryLabel: 'Workhorse',
      icon: AGY_ICONS.models,
      title: 'Email Draft & Inbox Triage',
      desc: 'Inspects webmail threads (Gmail, Outlook) and drafts context-aware responses with action items.',
      prompt: 'Summarize unread emails in the current tab and draft professional follow-ups for review.'
    },

    // Category 2: 10 Surprising & Highly-Sought Hidden Gems
    {
      category: 'Surprising',
      categoryLabel: 'Hidden Gem',
      icon: AGY_ICONS.guide,
      title: 'Paywall & Cookie Wall Bypass Reader',
      desc: 'Removes anti-copy blur backdrops, dismisses cookie walls, and extracts article text directly.',
      prompt: 'Clean this article of all paywall overlays, newsletter popups, and cookie walls, then present full text.'
    },
    {
      category: 'Surprising',
      categoryLabel: 'Hidden Gem',
      icon: AGY_ICONS.models,
      title: 'GitHub PR & Code Diff Reviewer',
      desc: 'Analyzes code diffs across pull requests, identifying security flaws, edge cases, and missing tests.',
      prompt: 'Review the code diffs on this GitHub pull request, highlighting potential edge cases or bugs.'
    },
    {
      category: 'Surprising',
      categoryLabel: 'Hidden Gem',
      icon: AGY_ICONS.test,
      title: 'Auto-Detect 2FA / OTP Verification',
      desc: 'Detects 6-digit confirmation prompts and retrieves verification codes from open inbox tabs.',
      prompt: 'Locate the 2FA input field on this page and help verify the login.'
    },
    {
      category: 'Surprising',
      categoryLabel: 'Hidden Gem',
      icon: AGY_ICONS.export,
      title: 'Interactive PDF Form Auto-Completion',
      desc: 'Fills flat non-interactive web PDFs and converts them into signed deliverables.',
      prompt: 'Inspect the embedded PDF form, fill all required personal details, and verify each field.'
    },
    {
      category: 'Surprising',
      categoryLabel: 'Hidden Gem',
      icon: AGY_ICONS.tools,
      title: 'Automated Job Application Submitter',
      desc: 'Navigates job listings on LinkedIn, Greenhouse, and Lever, tailoring answers to job descriptions.',
      prompt: 'Apply to this job posting using my resume background, customizing answers to required skills.'
    },
    {
      category: 'Surprising',
      categoryLabel: 'Hidden Gem',
      icon: AGY_ICONS.status,
      title: 'Social Media Feed Sentiment Aggregator',
      desc: 'Scrolls Twitter/X or Reddit discussions on a topic and calculates net positive/negative consensus.',
      prompt: 'Scroll through the top 20 comments on this thread and synthesize the general sentiment and key debates.'
    },
    {
      category: 'Surprising',
      categoryLabel: 'Hidden Gem',
      icon: AGY_ICONS.tabs,
      title: 'Cart Discount & Coupon Finder',
      desc: 'Iterates through known promotional codes at e-commerce checkout, finding the lowest final total.',
      prompt: 'At this checkout page, test available coupon codes and apply the highest discount.'
    },
    {
      category: 'Surprising',
      categoryLabel: 'Hidden Gem',
      icon: AGY_ICONS.stage,
      title: 'Receipt to Expense Spreadsheet Mapper',
      desc: 'Extracts line items, vendor names, and sales tax from receipts directly into Google Sheets.',
      prompt: 'Extract vendor, date, category, and total amount from this receipt and structure as a spreadsheet row.'
    },
    {
      category: 'Surprising',
      categoryLabel: 'Hidden Gem',
      icon: AGY_ICONS.settings,
      title: 'Restricted Copy-Paste & Right-Click Unlocker',
      desc: 'Bypasses JavaScript preventDefault handlers and user-select restrictions on protected docs.',
      prompt: 'Unlock right-click context menu and enable text selection on this copy-protected page.'
    },
    {
      category: 'Surprising',
      categoryLabel: 'Hidden Gem',
      icon: AGY_ICONS.models,
      title: 'Terms of Service Red-Flag Scanner',
      desc: 'Scans privacy policies and TOS agreements for mandatory arbitration, data resale, and dark patterns.',
      prompt: 'Scan this Terms of Service agreement for sneaky clauses, data tracking permissions, and cancellation fees.'
    },

    // Category 3: 10 Unprecedented & Out-of-the-Box Inventions
    {
      category: 'Unprecedented',
      categoryLabel: 'New Invention',
      icon: AGY_ICONS.history,
      title: 'DOM Time Machine & Visual Diff Alert',
      desc: 'Monitors specific webpage elements (e.g. stock inventory, ticket drops) and alerts on changes.',
      prompt: 'Monitor the inventory and price of this item and notify me if the availability status updates.'
    },
    {
      category: 'Unprecedented',
      categoryLabel: 'New Invention',
      icon: AGY_ICONS.tabs,
      title: 'Cross-Site Data Bridge & Auto-Pipe',
      desc: 'Extracts data from a source tab (e.g. CRM) and autonomously inputs it into a destination tab.',
      prompt: 'Copy customer details from this CRM tab and create a new contact card in the Notion tab.'
    },
    {
      category: 'Unprecedented',
      categoryLabel: 'New Invention',
      icon: AGY_ICONS.agent,
      title: 'Autonomous Click-Stream Macro Replayer',
      desc: 'Replays a sequence of clicks, navigations, and file downloads with intelligent error recovery.',
      prompt: 'Replay my daily morning sequence: open analytics dashboard, export yesterday report, and verify totals.'
    },
    {
      category: 'Unprecedented',
      categoryLabel: 'New Invention',
      icon: AGY_ICONS.status,
      title: 'Real-Time Executive Summary HUD',
      desc: 'Extracts high-level decision points, financial metrics, and deadlines into a floating briefing.',
      prompt: 'Generate an executive briefing HUD from this 10-page report highlighting bottom-line figures.'
    },
    {
      category: 'Unprecedented',
      categoryLabel: 'New Invention',
      icon: AGY_ICONS.shield,
      title: 'Astroturfing & Bot Review Investigator',
      desc: 'Inspects user profiles and review velocity on products, calculating true authenticity scores.',
      prompt: 'Analyze reviews on this product page to flag suspicious bot patterns or incentivized reviews.'
    },
    {
      category: 'Unprecedented',
      categoryLabel: 'New Invention',
      icon: AGY_ICONS.models,
      title: 'Network API Sniffer & Paywall Inspector',
      desc: 'Inspects underlying JSON fetch responses to view unfiltered data returned from backend servers.',
      prompt: 'Inspect background API network calls on this page and extract the raw JSON data payload.'
    },
    {
      category: 'Unprecedented',
      categoryLabel: 'New Invention',
      icon: AGY_ICONS.help,
      title: 'Universal Multi-Tab Search & Recall',
      desc: 'Searches text across all open tabs simultaneously, jumping directly to the matching sentence.',
      prompt: 'Search across all open tabs for references to "Q3 revenue projection" and show findings.'
    },
    {
      category: 'Unprecedented',
      categoryLabel: 'New Invention',
      icon: AGY_ICONS.warning,
      title: 'Accessible Captcha Audio Transcriber',
      desc: 'Switches inaccessible visual puzzles to audio mode and assists in transcription.',
      prompt: 'Trigger audio challenge fallback for this captcha and assist in entering response.'
    },
    {
      category: 'Unprecedented',
      categoryLabel: 'New Invention',
      icon: AGY_ICONS.tools,
      title: 'Shadow DOM & Nested Iframe Piercer',
      desc: 'Recursively explores nested shadow trees and cross-domain frames to interact with deep UI components.',
      prompt: 'Locate and click the submit button inside the embedded payment iframe widget.'
    },
    {
      category: 'Unprecedented',
      categoryLabel: 'New Invention',
      icon: AGY_ICONS.credits,
      title: 'Autonomous Multi-Store Price Matcher',
      desc: 'Finds identical SKUs across competitor stores, generating price match claim screenshots.',
      prompt: 'Find identical SKU of this product on competitor stores and calculate potential price match savings.'
    },

    // Category 4: 10 Wild, Polarizing & Awe-Inspiring Experiments
    {
      category: 'Wild',
      categoryLabel: 'Experimental',
      icon: AGY_ICONS.guide,
      title: 'Bionic Reading & Cognitive Speed Boost',
      desc: 'Restructures all paragraphs on the page into fixation-guided bolding for 3x speed reading.',
      prompt: 'Convert all article text on this page into bionic reading format with highlighted word fixations.'
    },
    {
      category: 'Wild',
      categoryLabel: 'Experimental',
      icon: AGY_ICONS.autopilot,
      title: 'Natural Voice Command Automation',
      desc: 'Enables hands-free voice instructions to scroll, click, submit, and research without touching a keyboard.',
      prompt: 'Enable voice navigation mode for browsing this page hands-free.'
    },
    {
      category: 'Wild',
      categoryLabel: 'Experimental',
      icon: AGY_ICONS.warning,
      title: 'Doom-Scroll Friction & Dopamine Detangler',
      desc: 'Gradually slows down infinite scroll feeds and applies black-and-white filters after 15 minutes.',
      prompt: 'Activate dopamine friction on this social feed: add scroll resistance and grayscale after 10 mins.'
    },
    {
      category: 'Wild',
      categoryLabel: 'Experimental',
      icon: AGY_ICONS.models,
      title: '3D DOM Depth & Layer Wireframe HUD',
      desc: 'Visualizes the page structure in an interactive 3D spatial view showing stacking contexts.',
      prompt: 'Render this webpage in 3D wireframe perspective showing z-index stacking layers.'
    },
    {
      category: 'Wild',
      categoryLabel: 'Experimental',
      icon: AGY_ICONS.tools,
      title: 'Mechanical Key Soundscape & UI Acoustics',
      desc: 'Plays subtle acoustic clicks and harmonious chimes as the agent and user interact with the page.',
      prompt: 'Play mechanical keyboard click acoustics on button interactions across the page.'
    },
    {
      category: 'Wild',
      categoryLabel: 'Experimental',
      icon: AGY_ICONS.status,
      title: 'Personal Click & Attention Heatmap',
      desc: 'Renders a live thermal overlay showing where your visual attention and cursor focus lingered.',
      prompt: 'Draw a thermal attention heatmap overlay showing where my clicks and reading focus landed.'
    },
    {
      category: 'Wild',
      categoryLabel: 'Experimental',
      icon: AGY_ICONS.tabs,
      title: 'Zero-Click Hover Link Peek Window',
      desc: 'Hovering over hyperlinks opens a non-disruptive floating preview box without leaving the tab.',
      prompt: 'Preview all outbound links on this page on hover without opening new browser tabs.'
    },
    {
      category: 'Wild',
      categoryLabel: 'Experimental',
      icon: AGY_ICONS.test,
      title: 'Rage-Click & Broken Event Listener Healer',
      desc: 'Detects repeated clicking on non-responsive buttons and triggers hidden event handlers.',
      prompt: 'Detect broken buttons on this page and simulate click dispatching to unblock the form.'
    },
    {
      category: 'Wild',
      categoryLabel: 'Experimental',
      icon: AGY_ICONS.help,
      title: 'Corporate Jargon & PR Buzzword Decryptor',
      desc: 'Translates corporate PR releases and marketing double-speak into brutally honest plain English.',
      prompt: 'Decrypt all corporate buzzwords and PR spin in this announcement into plain honest English.'
    },
    {
      category: 'Wild',
      categoryLabel: 'Experimental',
      icon: AGY_ICONS.credits,
      title: 'Matrix Green CRT Terminal Mode',
      desc: 'Transforms modern websites into a nostalgic green phosphor CRT terminal HUD with keyboard shortcuts.',
      prompt: 'Transform this website layout into a retro Matrix-style green CRT terminal interface.'
    }
  ];

  function renderSkillsCommand(selectedFilter = 'all') {
    const filtered = selectedFilter === 'all'
      ? AGENT_COMPOUNDING_SKILLS
      : AGENT_COMPOUNDING_SKILLS.filter(s => s.category.toLowerCase() === selectedFilter.toLowerCase());

    const cardsHtml = filtered.map(s => `
      <div class="template-card" data-category="${escapeHtml(s.category)}">
        <div>
          <div class="template-card-header">
            <span style="display:inline-flex;color:var(--primary);">${s.icon}</span>
            <span>${escapeHtml(s.title)}</span>
            <span class="template-card-badge">${escapeHtml(s.categoryLabel)}</span>
          </div>
          <div style="font-size:11px;color:var(--on-surface-muted);margin-top:6px;line-height:1.4;">${escapeHtml(s.desc)}</div>
        </div>
        <button class="command-chip skill-run-btn" data-skill-prompt="${escapeHtml(s.prompt)}" style="margin-top:4px;padding:6px 10px;font-size:11.5px;font-weight:700;justify-content:center;background:var(--accent-bg);color:var(--primary);border-color:var(--primary);">
          Run Skill &rarr;
        </button>
      </div>
    `).join('');

    const card = document.createElement('div');
    card.className = 'command-card';
    card.innerHTML = `
      <div class="command-card-header">
        <span class="command-card-icon">${AGY_ICONS.skills}</span>
        <div>
          <h3>Compounding Skills &amp; Procedural Memory (${AGENT_COMPOUNDING_SKILLS.length} Routines)</h3>
          <p>Curated automation routines organized 2-by-2. Click any skill to run it with the agent.</p>
        </div>
      </div>

      <div class="template-tabs">
        <button class="template-tab ${selectedFilter === 'all' ? 'active' : ''}" data-skill-filter="all">All (${AGENT_COMPOUNDING_SKILLS.length})</button>
        <button class="template-tab ${selectedFilter === 'Essential' ? 'active' : ''}" data-skill-filter="Essential">Expected &amp; Essential (10)</button>
        <button class="template-tab ${selectedFilter === 'Surprising' ? 'active' : ''}" data-skill-filter="Surprising">Surprising Gems (10)</button>
        <button class="template-tab ${selectedFilter === 'Unprecedented' ? 'active' : ''}" data-skill-filter="Unprecedented">New Inventions (10)</button>
        <button class="template-tab ${selectedFilter === 'Wild' ? 'active' : ''}" data-skill-filter="Wild">Wild &amp; Experimental (10)</button>
      </div>

      <div class="two-col-grid skill-grid-container">
        ${cardsHtml}
      </div>
    `;

    stepLog.appendChild(card);
    scrollToBottom();

    // Attach tab filter listeners within this rendered card
    card.querySelectorAll('.template-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const filter = tab.dataset.skillFilter;
        card.querySelectorAll('.template-tab').forEach(t => t.classList.toggle('active', t === tab));
        const grid = card.querySelector('.skill-grid-container');
        if (grid) {
          const newFiltered = filter === 'all'
            ? AGENT_COMPOUNDING_SKILLS
            : AGENT_COMPOUNDING_SKILLS.filter(s => s.category.toLowerCase() === filter.toLowerCase());
          grid.innerHTML = newFiltered.map(s => `
            <div class="template-card" data-category="${escapeHtml(s.category)}">
              <div>
                <div class="template-card-header">
                  <span style="display:inline-flex;color:var(--primary);">${s.icon}</span>
                  <span>${escapeHtml(s.title)}</span>
                  <span class="template-card-badge">${escapeHtml(s.categoryLabel)}</span>
                </div>
                <div style="font-size:11px;color:var(--on-surface-muted);margin-top:6px;line-height:1.4;">${escapeHtml(s.desc)}</div>
              </div>
              <button class="command-chip skill-run-btn" data-skill-prompt="${escapeHtml(s.prompt)}" style="margin-top:4px;padding:6px 10px;font-size:11.5px;font-weight:700;justify-content:center;background:var(--accent-bg);color:var(--primary);border-color:var(--primary);">
                Run Skill &rarr;
              </button>
            </div>
          `).join('');
        }
      });
    });
  }

  async function handleSlashCommand(raw) {
    const trimmed = raw.trim();
    const parts = trimmed.split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    if (welcomeScreen.style.display !== 'none') {
      showTaskView('Command: ' + cmdName);
    }

    renderUserPromptBubble(trimmed);

    const cmd = AGENT_SLASH_COMMANDS.find(c => c.name.toLowerCase() === cmdName || (c.aliases || []).includes(cmdName));
    if (cmd) {
      await cmd.run(args);
    } else {
      const card = document.createElement('div');
      card.className = 'command-card';
      card.innerHTML = `
        <div class="command-card-header">
          <span class="command-card-icon">${AGY_ICONS.warning}</span>
          <div>
            <h3>Unknown Command: <code>${escapeHtml(cmdName)}</code></h3>
            <p>Type <a class="command-chip" data-cmd="/help" style="display:inline-flex;padding:2px 6px;"><code>/help</code></a> to see all available commands.</p>
          </div>
        </div>
      `;
      stepLog.appendChild(card);
      scrollToBottom();
    }
  }

  function setupSlashCommandsAutocomplete(inputEl, popupEl, commands, onExecute) {
    if (!inputEl || !popupEl) return;
    let selectedIndex = 0;
    let matchingCommands = [];

    function renderPopup(matches) {
      matchingCommands = matches;
      if (!matches.length) {
        popupEl.style.display = 'none';
        return;
      }
      selectedIndex = Math.min(selectedIndex, matches.length - 1);
      popupEl.innerHTML = matches.map((c, i) => `
        <div class="slash-command-item ${i === selectedIndex ? 'active' : ''}" data-index="${i}">
          <span class="slash-command-icon">${c.icon}</span>
          <div class="slash-command-info">
            <div class="slash-command-name">
              ${escapeHtml(c.name)} ${c.params ? `<span class="slash-command-params">${escapeHtml(c.params)}</span>` : ''}
            </div>
            <div class="slash-command-desc">${escapeHtml(c.desc)}</div>
          </div>
          <span class="slash-command-category">${escapeHtml(c.category)}</span>
        </div>
      `).join('');
      popupEl.style.display = 'grid';
    }

    function selectCommand(cmd) {
      popupEl.style.display = 'none';
      if (!cmd) return;
      if (cmd.params) {
        inputEl.value = cmd.name + ' ';
        inputEl.focus();
      } else {
        inputEl.value = '';
        inputEl.style.height = 'auto';
        onExecute(cmd.name);
      }
    }

    function checkAutocomplete() {
      const val = inputEl.value;
      if (val.startsWith('/')) {
        const query = val.slice(1).toLowerCase().trim();
        const matches = commands.filter(c => {
          const nameMatch = c.name.slice(1).toLowerCase().includes(query);
          const aliasMatch = (c.aliases || []).some(a => a.slice(1).toLowerCase().includes(query));
          const descMatch = (c.desc || '').toLowerCase().includes(query);
          return nameMatch || aliasMatch || descMatch;
        });
        renderPopup(matches);
      } else {
        popupEl.style.display = 'none';
      }
    }

    inputEl.addEventListener('input', checkAutocomplete);
    inputEl.addEventListener('keyup', checkAutocomplete);
    inputEl.addEventListener('focus', checkAutocomplete);

    inputEl.addEventListener('keydown', (e) => {
      if (popupEl.style.display === 'none' || !matchingCommands.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % matchingCommands.length;
        renderPopup(matchingCommands);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + matchingCommands.length) % matchingCommands.length;
        renderPopup(matchingCommands);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (matchingCommands[selectedIndex]) {
          e.preventDefault();
          selectCommand(matchingCommands[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        popupEl.style.display = 'none';
      }
    });

    popupEl.addEventListener('click', (e) => {
      const item = e.target.closest('.slash-command-item');
      if (item) {
        const idx = parseInt(item.dataset.index, 10);
        if (!isNaN(idx) && matchingCommands[idx]) {
          selectCommand(matchingCommands[idx]);
        }
      }
    });

    document.addEventListener('click', (e) => {
      if (!popupEl.contains(e.target) && e.target !== inputEl) {
        popupEl.style.display = 'none';
      }
    });
  }

  // ============================================
  // Conversation continuity & Submit Handling
  // ============================================
  function handleUserSubmit(prompt) {
    const trimmed = String(prompt || '').trim();
    if (!trimmed) return;

    // Check for slash commands
    if (trimmed.startsWith('/')) {
      taskInput.value = '';
      taskInput.style.height = 'auto';
      handleSlashCommand(trimmed);
      return;
    }

    if (isSubmitting) return;

    if (isRunning && currentTaskId) {
      // Task is live — deliver as chat nudge.
      sendChatToActiveTask(trimmed);
      return;
    }
    if (currentTaskId && !isRunning && sessionPersistenceActive) {
      // We're viewing a FINISHED task (completed / failed / cancelled)
      // AND session persistence is enabled on the user's tier + Setup.
      // Thread the new prompt onto the existing session.
      taskInput.value = '';
      taskInput.style.height = 'auto';
      startTask(trimmed, { resumeFromTaskId: currentTaskId });
      return;
    }
    // Otherwise (welcome screen, or finished task without persistence),
    // start a brand-new task.
    taskInput.value = '';
    taskInput.style.height = 'auto';
    startTask(trimmed);
  }

  async function sendChatToActiveTask(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || !currentTaskId) return;
    taskInput.value = '';
    taskInput.style.height = 'auto';
    renderUserPromptBubble(trimmed);
    scrollToBottom();
    try {
      const r = await NewOrderAPI.request('/api/agent/chat-nudge', {
        method: 'POST',
        body: JSON.stringify({ taskId: currentTaskId, text: trimmed })
      });
      if (r && r.kind === 'reply') {
        showInlineNotice('Reply delivered to the awaiting question.', 'info');
      }
    } catch (err) {
      console.error('[Global Executive] chat-nudge failed:', err);
      const detail = err?.data || err?.body || {};
      if (detail && detail.sessionLimitReached) {
        showInlineNotice(detail.error || 'Session message limit reached.', 'warning');
      } else {
        showInlineNotice('Could not deliver message: ' + (err.message || err), 'warning');
      }
    }
  }

  // ============================================
  // Agent Loop
  // ============================================
  async function startTask(prompt, opts = {}) {
    if (isRunning || isSubmitting) return;

    const trimmed = prompt.trim();
    if (!trimmed) {
      alert('Please enter a message or task description.');
      return;
    }
    const resumeFromTaskId = opts.resumeFromTaskId || null;

    isSubmitting = true;
    setSendingState(true);

    const newTitle = trimmed.length > 60 ? trimmed.substring(0, 57) + '…' : trimmed;
    const canPreserve =
      resumeFromTaskId &&
      taskView.style.display === 'flex' &&
      String(currentTaskId || '') === String(resumeFromTaskId);
    if (canPreserve) {
      taskTitle.textContent = newTitle;
      const divider = document.createElement('div');
      divider.className = 'session-divider';
      divider.innerHTML = '<span>continuing session</span>';
      stepLog.appendChild(divider);
    } else {
      showTaskView(newTitle);
    }
    renderUserPromptBubble(trimmed);
    // Show a transient "Planning…" thinking bubble while we wait for /plan.
    const planningBubble = document.createElement('div');
    planningBubble.className = 'step-thinking';
    planningBubble.id = 'ge-planning-bubble';
    planningBubble.innerHTML = `
      <div class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></div>
      <span>Planning your task…</span>
    `;
    stepLog.appendChild(planningBubble);
    scrollToBottom();

    try {
      // Get current web tabs (exclude extension pages)
      const { activeTab, allTabs } = await getAgentContext();

      // === Phase 0: ask the planner what's needed ===
      const planData = await NewOrderAPI.request('/api/agent/plan', {
        method: 'POST',
        body: JSON.stringify({
          prompt: trimmed,
          modelId: selectedModelId,
          mode: selectedMode,
          tabUrl: activeTab?.url || '',
          tabTitle: activeTab?.title || '',
          allTabs: allTabs.map(t => ({ url: t.url, title: t.title, active: t.active })),
          resumeFromTaskId,
          ...getBrowserEnv()
        })
      });

      if (planData.usage) updateCreditsDisplay(planData.usage.creditsRemaining);

      const isQuestion = planData.taskType === 'question' || planData.isDirectQuestion || planData.needsPlan === false || Boolean(planData.directAnswer);

      // Plan / Answer ready — dismiss the planning bubble
      const pb = document.getElementById('ge-planning-bubble');
      if (pb) pb.remove();

      if (isQuestion) {
        // Direct Question / Greeting / General conversation:
        // No plan & briefing modal required! Render direct answer immediately.
        setCurrentTaskId(planData.taskId);
        updateTaskStatus('completed');
        isRunning = false;
        setSendingState(false);
        isSubmitting = false;

        const answerText = planData.directAnswer || planData.plan?.summary || 'I am ready to help you.';
        const msgEl = document.createElement('div');
        msgEl.className = 'step-message';
        stepLog.appendChild(msgEl);
        scrollToBottom();
        await streamMarkdownInto(msgEl, answerText, { wordsPerTick: 3, tickMs: 14 });
        return;
      }

      // Save context for tasks that require execution
      pendingTaskContext = {
        taskId: planData.taskId,
        plan: planData.plan,
        taskType: planData.taskType || 'action',
        requiredInputs: planData.requiredInputs || [],
        permissionsRequested: planData.permissionsRequested || {},
        skillMatch: planData.skillMatch || null,
        mode: selectedMode,
        prompt: trimmed,
        activeTab,
        allTabs
      };
      currentTierMaxSteps = planData.tier?.maxSteps || 50;

      // Show plan + briefing modal; user clicks Approve or Cancel
      showPlanModal(pendingTaskContext);
    } catch (err) {
      console.error('[Global Executive] Plan error:', err.code || err.status || 'unknown');
      const pb = document.getElementById('ge-planning-bubble');
      if (pb) pb.remove();
      setSendingState(false);

      if (err.code === 'daily_quota_exceeded') {
        const upgrade = err.upgradeUrl || 'https://global-order.32d.one/pricing';
        showInlineNotice(
          `You've used today's free agent runs. The limit resets at midnight (UTC). Upgrade for more: ${upgrade}`,
          'warning'
        );
      } else if (err.code === 'no_credits' || err.purchaseRequired) {
        const upgrade = err.upgradeUrl || 'https://global-order.32d.one/pricing';
        showInlineNotice(
          `Out of credits. Top up to keep running agent tasks: ${upgrade}`,
          'warning'
        );
      } else if (err.code === 'account_suspended') {
        showInlineNotice('Your account is suspended. Please contact support.', 'error');
      } else if (err.code === 'agent_rate_limit') {
        const perMin = (err.serverBody && err.serverBody.limitPerMinute) || 60;
        showInlineNotice(
          `You're going too fast — hit the per-minute rate limit (${perMin}/min). Wait about a minute, then try again.`,
          'warning'
        );
      } else if (err.message?.includes('already have') && err.message?.includes('running')) {
        await loadTaskHistory();
        historySidebar.classList.add('open');
        showInlineNotice('You have running tasks. Stop one in the sidebar (×) before starting another.', 'warning');
      } else if (err.status === 504 || err.status === 502 || err.status === 503 || err.retryable) {
        showInlineNotice(
          'The planner is overloaded right now (gateway timeout). I retried a few times but the server kept timing out. Please try again in a moment, or pick a faster model.',
          'warning'
        );
      } else if (err.message?.includes('Unexpected token') || err.message?.includes('not valid JSON')) {
        showInlineNotice('The server returned an unexpected response. Please try again.', 'warning');
      } else {
        showInlineNotice('Failed to plan task: ' + err.message, 'error');
      }
    } finally {
      isSubmitting = false;
    }
  }

  // Persistent inline notice (replaces popup alerts so user can read full error details)
  function showInlineNotice(message, level) {
    const existing = document.getElementById('ge-inline-notice');
    if (existing) existing.remove();
    const n = document.createElement('div');
    n.id = 'ge-inline-notice';
    n.className = 'ge-inline-notice ' + (level || 'info');
    n.innerHTML = `
      <span class="ge-inline-notice-msg">${escapeHtml(message)}</span>
      <button class="ge-inline-notice-close" aria-label="Dismiss">&times;</button>
    `;
    n.querySelector('.ge-inline-notice-close').addEventListener('click', () => n.remove());
    // Insert into task view or welcome screen, whichever is visible
    const host = (taskView && taskView.style.display !== 'none') ? taskView : document.body;
    host.prepend(n);
    // Auto-dismiss after 12s for non-error
    if (level !== 'error') setTimeout(() => { if (n.parentNode) n.remove(); }, 12000);
  }

  // ============================================
  // Plan / Briefing / Permissions Modal
  // ============================================
  function showPlanModal(ctx) {
    const modal = document.getElementById('plan-modal');
    if (!modal) { startTaskExecution(ctx, {}, {}); return; }

    // Mode banner is also where we surface the planner's task-type
    // classification. The badge is appended (not replacing) so existing
    // mode text stays in place. Browser-agnostic: works the same in
    // Chrome / Edge / Firefox / Safari since it's just DOM.
    const modeBanner = document.getElementById('plan-mode-banner');
    modeBanner.textContent = (ctx.mode === 'autopilot' ? 'Auto-Pilot' : 'Co-Pilot') + ' mode';
    const tt = String(ctx.taskType || 'action').toLowerCase();
    const badgeMap = {
      research: { icon: 'ðŸ”¬', label: 'Research task', cls: 'tasktype-research', tip: 'The agent will gather and cross-reference sources before reporting. Done is gated until â‰¥2 distinct source domains are recorded.' },
      mixed:    { icon: 'ðŸ”€', label: 'Mixed (research + action)', cls: 'tasktype-mixed', tip: 'The agent will research first, then act. The same source-count gate applies.' },
      action:   { icon: 'âš™ï¸', label: 'Action task', cls: 'tasktype-action', tip: 'The agent will execute on a site. No source-count gate.' }
    };
    const b = badgeMap[tt] || badgeMap.action;
    let badge = document.getElementById('plan-tasktype-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'plan-tasktype-badge';
      badge.className = 'tasktype-badge';
      modeBanner.appendChild(document.createTextNode(' '));
      modeBanner.appendChild(badge);
    }
    badge.className = `tasktype-badge ${b.cls}`;
    badge.title = b.tip;
    badge.textContent = `${b.icon} ${b.label}`;
    document.getElementById('plan-goal').textContent = ctx.plan?.goal || ctx.prompt;
    document.getElementById('plan-summary').textContent = ctx.plan?.summary || '(no summary)';

    // Steps
    const stepsEl = document.getElementById('plan-steps');
    stepsEl.innerHTML = '';
    (ctx.plan?.steps || []).forEach(s => {
      const li = document.createElement('li');
      li.className = `risk-${s.risk || 'low'}`;
      li.innerHTML = `<span class="risk-badge ${s.risk || 'low'}">${(s.risk || 'low')}</span>${escapeHtml(s.description || '')}`;
      stepsEl.appendChild(li);
    });

    // Sites & risks
    const sitesEl = document.getElementById('plan-sites');
    sitesEl.innerHTML = (ctx.plan?.candidateSites || []).map(s =>
      `<div>â€¢ <a href="${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(s)}</a></div>`
    ).join('') || '<em>None identified</em>';
    const risksEl = document.getElementById('plan-risks');
    risksEl.innerHTML = (ctx.plan?.risks || []).length
      ? '<h3>Risks</h3>' + ctx.plan.risks.map(r => `<div>âš  ${escapeHtml(r)}</div>`).join('')
      : '';

    // ---- Phase 3 â€” Skill match banner ----
    // Render a banner above the briefing section if the planner found a
    // match in this user's skill library. Two flavours:
    //   - fast_path: green "Replay" banner with skill name + success stats
    //                + an Auto-fill button that pre-populates briefing
    //                fields from `paramsHint`.
    //   - suggest:   subtle blue "Library match" badge â€” informational
    //                only; the recipe was injected as PRIOR ART so the
    //                plan above already reflects it.
    renderSkillMatchBanner(ctx);

    // Briefing form
    const briefingSection = document.getElementById('briefing-section');
    const briefingForm = document.getElementById('briefing-form');
    briefingForm.innerHTML = '';
    if (ctx.requiredInputs && ctx.requiredInputs.length) {
      briefingSection.style.display = 'block';
      ctx.requiredInputs.forEach(inp => {
        briefingForm.appendChild(buildBriefingField(inp));
      });
      // Pre-fill any field whose name matches a paramsHint key. Done
      // AFTER the inputs are in the DOM so we can target by id.
      if (ctx.skillMatch && ctx.skillMatch.mode === 'fast_path' && ctx.skillMatch.paramsHint) {
        const hints = ctx.skillMatch.paramsHint || {};
        for (const [name, value] of Object.entries(hints)) {
          const el = briefingForm.querySelector(`[data-input="${CSS.escape(name)}"]`);
          if (el && (el.value === '' || el.value == null)) {
            if (el.type === 'checkbox') el.checked = !!value;
            else el.value = String(value);
          }
        }
      }
    } else {
      briefingSection.style.display = 'none';
    }

    // Permissions
    const permsSection = document.getElementById('permissions-section');
    const permsList = document.getElementById('permissions-list');
    const PERM_DEFS = {
      createAccounts: { name: 'Create accounts', desc: 'Sign up for new accounts on third-party services.' },
      sendMessages:   { name: 'Send messages',   desc: 'Send emails, DMs, comments, posts, or replies on your behalf.' },
      postPublicly:   { name: 'Post publicly',   desc: 'Submit publicly visible content (forums, social media).' },
      makePayments:   { name: 'Make payments',   desc: 'Click "Pay" / "Place order" / "Buy" on payment forms.' },
      deleteData:     { name: 'Delete data',     desc: 'Delete, archive, or remove items.' },
      uploadFiles:    { name: 'Upload files',    desc: 'Attach files you have staged into upload inputs.' }
    };
    const requested = Object.entries(ctx.permissionsRequested || {}).filter(([, v]) => v).map(([k]) => k);
    if (requested.length) {
      permsSection.style.display = 'block';
      permsList.innerHTML = '';
      requested.forEach(key => {
        const def = PERM_DEFS[key];
        if (!def) return;
        const lab = document.createElement('label');
        lab.innerHTML = `
          <input type="checkbox" name="perm-${key}" data-perm="${key}">
          <span class="perm-text">
            <span class="perm-name">${escapeHtml(def.name)}</span>
            <span class="perm-desc">${escapeHtml(def.desc)}</span>
          </span>`;
        permsList.appendChild(lab);
      });
    } else {
      permsSection.style.display = 'none';
    }

    document.getElementById('plan-error').style.display = 'none';
    modal.style.display = 'flex';

    // If this task came in remotely (Telegram/WhatsApp) AND has no required inputs,
    // auto-approve so the agent runs without needing the user to click.
    if (window._geNTR && (!ctx.requiredInputs || ctx.requiredInputs.length === 0)) {
      window._geNTR = false;
      showInlineNotice('No briefing needed â€” auto-approving remote task.', 'info');
      setTimeout(() => approvePlanAndStart(), 200);
    } else if (window._geNTR) {
      // Has required inputs â€” the user must come back to the page. Notify them.
      window._geNTR = false;
      showInlineNotice('This task needs briefing inputs. Please fill them in to continue.', 'warning');
    }
  }

  // ============================================
  // Phase 3 â€” Skill-match banner renderer
  // Inserts (or removes) a banner inside the plan modal showing whether
  // the new prompt matched a previously mined skill. Idempotent:
  // re-renders cleanly when the modal is opened a second time.
  // ============================================
  function renderSkillMatchBanner(ctx) {
    // Anchor: insert ABOVE the briefing section so the user sees the
    // match before being asked for inputs.
    const briefingSection = document.getElementById('briefing-section');
    if (!briefingSection || !briefingSection.parentNode) return;

    // Remove any prior banner so a re-render doesn't stack them.
    const old = document.getElementById('ge-skill-banner');
    if (old) old.remove();

    const m = ctx && ctx.skillMatch;
    if (!m || m.mode === 'none' || !m.skill) return;

    const banner = document.createElement('div');
    banner.id = 'ge-skill-banner';
    const fast = m.mode === 'fast_path';
    const accent = fast ? '#22c55e' : '#60a5fa';
    const bg = fast ? 'rgba(34,197,94,0.10)' : 'rgba(96,165,250,0.10)';
    const label = fast ? 'âš¡ Replay this recipe' : 'ðŸ“š Library match';
    const sk = m.skill;
    const stats = `${sk.successCount || 0}Ã— success Â· ~${sk.avgSteps || '?'} steps avg`;
    const score = (m.score || 0).toFixed(2);

    // Fast-path banner is interactive; suggest banner is purely informational.
    banner.style.cssText = `margin: 0 0 14px 0; padding: 12px 14px; border-left: 3px solid ${accent}; background: ${bg}; border-radius: 6px;`;
    banner.innerHTML = `
      <div style="display:flex; gap:10px; align-items:flex-start; justify-content:space-between;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight: 600; font-size: 13px; color: ${accent}; margin-bottom: 4px;">${label}</div>
          <div style="font-size: 13px; color: var(--ge-on-surface, #e6e7ea); margin-bottom: 4px;"><strong>${escapeHtml(sk.name)}</strong> &middot; <span style="opacity:0.75;">${escapeHtml(sk.summary || '(no summary)')}</span></div>
          <div style="font-size: 11px; opacity: 0.65;">${escapeHtml(stats)} &middot; match ${score} &middot; ${escapeHtml(sk.origin || 'private')}</div>
        </div>
        ${fast ? `<button type="button" id="ge-skill-dismiss" style="background:none; border:1px solid ${accent}40; color:${accent}; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer; flex-shrink:0;">Dismiss</button>` : ''}
      </div>`;

    briefingSection.parentNode.insertBefore(banner, briefingSection);

    // Wire the dismiss button (fast-path only). Removes the banner and
    // also clears `skillMatch` from the pending context so a subsequent
    // re-open of the modal doesn't re-show it.
    const dismissBtn = document.getElementById('ge-skill-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        banner.remove();
        if (pendingTaskContext) pendingTaskContext.skillMatch = null;
      });
    }
  }

  function buildBriefingField(inp) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const id = `field-${inp.name}`;
    let inputHtml = '';
    const sensitiveTag = inp.sensitive ? '<span class="sensitive-tag">sensitive</span>' : '';

    switch (inp.type) {
      case 'textarea':
        inputHtml = `<textarea id="${id}" data-input="${inp.name}" ${inp.required ? 'required' : ''}></textarea>`;
        break;
      case 'select':
        inputHtml = `<select id="${id}" data-input="${inp.name}" ${inp.required ? 'required' : ''}>
          <option value="">â€” Select â€”</option>
          ${(inp.options || []).map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
        </select>`;
        break;
      case 'boolean':
        inputHtml = `<div class="checkbox-field">
          <input type="checkbox" id="${id}" data-input="${inp.name}">
          <span>${escapeHtml(inp.label || inp.name)}</span>
        </div>`;
        break;
      case 'file':
        inputHtml = `<input type="file" id="${id}" data-input="${inp.name}" data-input-type="file">`;
        break;
      case 'password':
      case 'email':
      case 'url':
      case 'text':
      default:
        inputHtml = `<input type="${inp.type === 'password' ? 'password' : (inp.type === 'email' ? 'email' : (inp.type === 'url' ? 'url' : 'text'))}" id="${id}" data-input="${inp.name}" ${inp.required ? 'required' : ''}>`;
    }

    if (inp.type !== 'boolean') {
      wrap.innerHTML = `<label for="${id}">${escapeHtml(inp.label || inp.name)}${sensitiveTag}${inp.required ? ' *' : ''}</label>
        ${inp.description ? `<div class="field-desc">${escapeHtml(inp.description)}</div>` : ''}
        ${inputHtml}`;
    } else {
      wrap.innerHTML = `${inputHtml}${inp.description ? `<div class="field-desc">${escapeHtml(inp.description)}</div>` : ''}`;
    }
    return wrap;
  }

  function hidePlanModal() {
    const modal = document.getElementById('plan-modal');
    if (modal) modal.style.display = 'none';
  }

  async function approvePlanAndStart() {
    if (!pendingTaskContext) return;
    const ctx = pendingTaskContext;
    const briefing = {};
    const permissions = {};

    // Collect briefing values
    const formEls = document.querySelectorAll('#briefing-form [data-input]');
    for (const el of formEls) {
      const name = el.getAttribute('data-input');
      if (el.getAttribute('data-input-type') === 'file' && el.files && el.files[0]) {
        // Stage the file via background, store the ref name as the briefing value
        try {
          const file = el.files[0];
          const dataUrl = await readFileAsDataURL(file);
          await sendToBackground('ge-stage-file', {
            ref: name,
            name: file.name,
            mimeType: file.type,
            dataUrl
          });
          briefing[name] = name; // value is the staged ref
        } catch (err) {
          document.getElementById('plan-error').textContent = `Failed to stage file ${name}: ${err.message}`;
          document.getElementById('plan-error').style.display = 'block';
          return;
        }
      } else if (el.type === 'checkbox') {
        briefing[name] = el.checked;
      } else {
        briefing[name] = el.value;
      }
    }

    // Validate required
    const missing = (ctx.requiredInputs || []).filter(inp =>
      inp.required && (briefing[inp.name] === undefined || briefing[inp.name] === '' || briefing[inp.name] === null)
    );
    if (missing.length) {
      document.getElementById('plan-error').textContent = `Required: ${missing.map(m => m.label || m.name).join(', ')}`;
      document.getElementById('plan-error').style.display = 'block';
      return;
    }

    // Collect permissions
    document.querySelectorAll('#permissions-list [data-perm]').forEach(el => {
      permissions[el.getAttribute('data-perm')] = el.checked;
    });

    hidePlanModal();
    startTaskExecution(ctx, briefing, permissions);
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  // Best-effort fetch of the user's agent settings. Cached for the
  // lifetime of the panel so we don't re-hit the server on every task.
  // Returns {} on any error so callers can read flags with `?.` safely.
  let _agentSettingsCache = null;
  async function getAgentSettingsCached() {
    if (_agentSettingsCache) return _agentSettingsCache;
    try {
      const data = await NewOrderAPI.request('/api/agent-settings');
      _agentSettingsCache = data?.settings || {};
    } catch {
      _agentSettingsCache = {};
    }
    return _agentSettingsCache;
  }

  async function startTaskExecution(ctx, briefing, permissions) {
    isRunning = true;
    setSendingState(true);
    const titleText = ctx.prompt.length > 60 ? ctx.prompt.substring(0, 57) + '...' : ctx.prompt;
    // If startTask() already brought us into the task view (and drew the user
    // bubble), DON'T re-call showTaskView \u2014 it would wipe step-log. Just update
    // the title and badge. Otherwise (remote/auto path) initialise the view.
    if (taskView.style.display !== 'flex' || !stepLog.children.length) {
      showTaskView(titleText);
      renderUserPromptBubble(ctx.prompt);
    } else {
      taskTitle.textContent = titleText;
    }
    updateTaskStatus('running');
    startKeepAlive();

    // === Optional: open a fresh browser WINDOW for research/mixed tasks ===
    // Honours the user's "Open a new window for research tasks" setting in
    // Setup. Pure `action` tasks keep running in whatever tab the user had
    // pointed (so "fill this form" still targets the right page). On any
    // failure we silently fall back to the current tab â€” better to run in
    // the user's tab than not at all.
    let initialTabIdOverride = null;
    try {
      const settings = await getAgentSettingsCached();
      const tt = String(ctx.taskType || 'action').toLowerCase();
      const wantsNewWindow = !!settings.newWindowForResearch && (tt === 'research' || tt === 'mixed');
      if (wantsNewWindow) {
        const win = await sendToBackground('ge-open-window', { url: 'about:blank' });
        if (win?.success && typeof win.tabId === 'number') {
          initialTabIdOverride = win.tabId;
          // Patch ctx so the new tab becomes the agent's starting context.
          ctx.activeTab = { id: win.tabId, url: win.url || '', title: win.title || '' };
          showInlineNotice('Opened a new browser window for this research task.', 'info');
        } else if (win?.error) {
          console.warn('[Global Executive] ge-open-window failed:', win.error);
        }
      }
    } catch (e) {
      console.warn('[Global Executive] new-window-for-research check failed:', e.message);
    }

    try {
      const data = await NewOrderAPI.request('/api/agent/brief', {
        method: 'POST',
        body: JSON.stringify({
          taskId: ctx.taskId,
          briefing,
          permissions,
          modelId: selectedModelId,
          allTabs: ctx.allTabs?.map(t => ({ url: t.url, title: t.title, active: t.active })) || [],
          ...getBrowserEnv()
        })
      });

      setCurrentTaskId(data.taskId);
      updateCreditsDisplay(data.usage.creditsRemaining);
      taskCredits.textContent = data.usage.totalTaskCredits.toFixed(2) + ' credits';
      currentTierMaxSteps = data.tier?.maxSteps || currentTierMaxSteps;
      taskStepCounter.textContent = `Step ${data.step.stepNumber}/${currentTierMaxSteps}`;

      // Reflect the initial milestone state if the agent set milestones in step 1.
      if (data.goalLedger) renderGoalLedger(data.goalLedger);
      renderStep(data.step);
      // Premium in-page overlay so the user can watch the agent live on
      // whatever tab it's about to act on. No-op for restricted URLs.
      try { window.AgentOverlay?.highlightStep(ctx.activeTab?.id, data.step, data.step.stepNumber, currentTierMaxSteps, 'live'); } catch {}
      await executeLoop(data.step, ctx.activeTab?.id);
    } catch (err) {
      console.error('[Global Executive] Brief error:', err);
      renderDoneStep('Error: ' + err.message);
      updateTaskStatus('failed');
      isRunning = false;
      setSendingState(false);
      stopKeepAlive();
    } finally {
      pendingTaskContext = null;
    }
  }

  async function executeLoop(step, initialTabId) {
    let currentTabId = initialTabId || null;
    let trackedTabs = initialTabId ? [{ tabId: currentTabId, tabIndex: 0 }] : [];
    let activeTabIndex = initialTabId ? 0 : -1;
    // Consecutive server-error counter. Reset after each successful /step
    // round and incremented by the catch block below. Declared here so it
    // survives across iterations of the while-loop.
    let serverErrorStreak = 0;

    // Actions that REQUIRE a live web tab in the current Chrome window. Used
    // by the pre-action self-healing pass (see ensureLiveTab below).
    const TAB_REQUIRED_ACTIONS = new Set([
      'goto', 'goBack', 'goForward', 'reload', 'screenshot',
      'readPage', 'click', 'type', 'scroll', 'scrollUntil', 'extract',
      'waitForElement', 'waitForStable', 'waitUntil',
      'select', 'pressKey', 'clear', 'hover', 'uploadFile',
      // Compound macro actions â€” see executeLoop dispatch.
      'clickAndWait', 'typeAndSubmit', 'gotoAndRead',
      'readAndExtract', 'scrollAndExtract'
    ]);

    // Actions that INTRINSICALLY change the URL â€” staleness check below
    // skips these because the URL "drift" they cause is intentional.
    const NAVIGATION_ACTIONS = new Set([
      'goto', 'goBack', 'goForward', 'reload', 'openTab', 'switchTab',
      'closeTab', 'gotoAndRead'
    ]);

    // === Self-healing tab recovery ===
    // Verifies `currentTabId` still points at a live Chrome tab. If it's
    // missing or stale (tab closed / crashed / user navigated away), we
    // recover transparently by falling back through:
    //   (1) most-recently-added agent-tracked tab that is still alive
    //   (2) Chrome's currently-active http(s) tab
    //   (3) any open http(s) tab
    //   (4) last resort: open a fresh google.com tab
    // The caller attaches the returned `note` to the action result so the
    // server surfaces it to the LLM on the next /step call (prevents the
    // model from blindly re-issuing switchTab / goto against a dead id).
    function isRestrictedTabUrl(url) {
      if (!url || typeof url !== 'string') return true;
      const u = url.trim().toLowerCase();
      if (!/^https?:\/\//i.test(u)) return true;
      if (u.includes('chromewebstore.google.com') ||
          u.includes('chrome.google.com/webstore') ||
          u.includes('microsoftedge.microsoft.com/addons') ||
          u.includes('addons.mozilla.org')) {
        return true;
      }
      return false;
    }

    async function ensureLiveTab() {
      let tabsResp = null;
      try { tabsResp = await sendToBackground('ge-list-tabs', {}); } catch { /* best effort */ }
      const rawTabs = (tabsResp?.success && Array.isArray(tabsResp.tabs)) ? tabsResp.tabs : [];
      const liveIds = new Set(rawTabs.map(t => t.tabId).filter(id => typeof id === 'number'));

      // Fast path: current tab is alive AND is an unrestricted web page
      const currentTabObj = rawTabs.find(t => t.tabId === currentTabId);
      if (currentTabId && currentTabObj && !isRestrictedTabUrl(currentTabObj.url)) {
        return { healed: false };
      }

      const previousTabId = currentTabId;

      // Mark any tracked tab that no longer exists as closed so later
      // tabIndex-based actions can't pick a zombie.
      for (const tt of trackedTabs) {
        if (tt.status !== 'closed' && (!liveIds.has(tt.tabId) || isRestrictedTabUrl(tt.url))) {
          tt.status = 'closed';
        }
      }

      let chosen = null;
      let reason = '';

      // (1) Most recently added tracked tab that is still alive and unrestricted.
      for (let i = trackedTabs.length - 1; i >= 0; i--) {
        const tt = trackedTabs[i];
        if (tt.status !== 'closed' && liveIds.has(tt.tabId) && !isRestrictedTabUrl(tt.url)) {
          chosen = tt;
          reason = 'recent_tracked_tab';
          activeTabIndex = i;
          break;
        }
      }

      // (2) Chrome's currently-active unrestricted http(s) tab.
      if (!chosen) {
        const a = rawTabs.find(t => t.active && !isRestrictedTabUrl(t.url));
        if (a && typeof a.tabId === 'number') {
          chosen = { tabId: a.tabId, url: a.url || '', title: a.title || '', status: 'active' };
          reason = 'chrome_active_tab';
        }
      }

      // (3) Any open unrestricted http(s) tab.
      if (!chosen) {
        const a = rawTabs.find(t => !isRestrictedTabUrl(t.url));
        if (a && typeof a.tabId === 'number') {
          chosen = { tabId: a.tabId, url: a.url || '', title: a.title || '', status: 'active' };
          reason = 'any_open_tab';
        }
      }

      // (4) Last resort: open a fresh neutral tab.
      if (!chosen) {
        try {
          const created = await sendToBackground('ge-open-tab', { url: 'https://www.google.com' });
          if (created?.tabId) {
            chosen = {
              tabId: created.tabId,
              url: created.url || 'https://www.google.com',
              title: created.title || '',
              status: 'active'
            };
            reason = 'opened_fallback_tab';
          }
        } catch { /* ignore */ }
      }

      if (!chosen) {
        return { healed: false, failed: true, reason: 'no_recoverable_tab', previousTabId };
      }

      // Register / refresh in trackedTabs so later tabIndex refs line up.
      let idx = trackedTabs.findIndex(t => t.tabId === chosen.tabId);
      if (idx < 0) {
        trackedTabs.push({
          tabId: chosen.tabId,
          tabIndex: trackedTabs.length,
          url: chosen.url || '',
          title: chosen.title || '',
          status: 'active'
        });
        idx = trackedTabs.length - 1;
      } else {
        trackedTabs[idx].status = 'active';
        if (chosen.url) trackedTabs[idx].url = chosen.url;
        if (chosen.title) trackedTabs[idx].title = chosen.title;
      }
      activeTabIndex = idx;
      currentTabId = chosen.tabId;

      const label = (chosen.title || chosen.url || `tab#${chosen.tabId}`).toString().slice(0, 80);
      const prevDesc = previousTabId ? `previous tab (id ${previousTabId}) was closed or crashed` : 'no tab was active';
      const reasonDesc = ({
        recent_tracked_tab: 'fell back to the most recent agent-tracked tab still open',
        chrome_active_tab: "fell back to Chrome's currently-active tab",
        any_open_tab: 'fell back to another open browser tab',
        opened_fallback_tab: 'opened a fresh google.com tab as a last resort'
      })[reason] || 'auto-recovered';
      const note = `AUTO-RECOVERED TAB: ${prevDesc}, so the agent ${reasonDesc} â€” you are now on "${label}". Do not call switchTab for this tab; proceed with your next action (readPage / goto / click / etc.) on it.`;

      return { healed: true, reason, note, previousTabId, newTabId: chosen.tabId };
    }

    // === Page-staleness detection ===
    // The LLM plans its action based on the page state we sent to /step on
    // the LAST round. If the user (or a slow JS redirect, or a meta-refresh)
    // navigated the tab AWAY from that URL while the model was thinking,
    // selectors and text targets the model picked may no longer exist on
    // the live page. Rather than letting the action fail with `no_match`
    // (and the agent waste a step diagnosing it) we detect the drift here
    // and attach a `pageStaleHint` to the action result so the LLM sees
    // "the page changed under you, re-read it" on its next /step.
    //
    // We DO NOT block dispatch â€” many drifts are benign (hash/query change,
    // SPA route within same app). The runtime's own `reason` codes still
    // fire if the action genuinely fails. The hint is purely advisory.
    //
    // Skipped for navigation actions (their whole job is to change the URL).
    async function checkPageStaleness(action) {
      if (NAVIGATION_ACTIONS.has(action)) return null;
      if (!currentTabId) return null;
      const expectedUrl = trackedTabs[activeTabIndex]?.url || '';
      if (!expectedUrl) return null;
      let liveUrl = '';
      try {
        const resp = await sendToBackground('ge-list-tabs', {});
        if (resp?.success && Array.isArray(resp.tabs)) {
          const live = resp.tabs.find(t => t.tabId === currentTabId);
          if (live) liveUrl = live.url || '';
        }
      } catch { /* best effort */ }
      if (!liveUrl) return null;
      // Compare hostname + pathname only â€” query/hash drift is usually fine
      // (SPAs use them heavily) and would create too much noise.
      let expectedHostPath = '', liveHostPath = '';
      try {
        const a = new URL(expectedUrl); expectedHostPath = a.hostname.replace(/^www\./, '') + a.pathname.replace(/\/$/, '');
        const b = new URL(liveUrl);     liveHostPath     = b.hostname.replace(/^www\./, '') + b.pathname.replace(/\/$/, '');
      } catch { return null; }
      if (expectedHostPath === liveHostPath) return null;
      // Drift detected â€” sync trackedTabs so future steps don't keep firing
      // this hint, and surface a one-shot note to the LLM.
      if (trackedTabs[activeTabIndex]) trackedTabs[activeTabIndex].url = liveUrl;
      return {
        stale: true,
        expectedUrl,
        liveUrl,
        hint: `PAGE-STALE: the tab navigated from "${expectedUrl}" to "${liveUrl}" between the page-state you saw and this action. Selectors / text targets you chose may not exist on the new page. If your action fails or returns unexpected content, call \`readPage\` ONCE to refresh, then retry with new targets â€” do NOT loop on \`readPage\`.`
      };
    }

    try {
      while (isRunning) {
        const { action, params, stepNumber } = step;

        // === Execute the action ===
        let result = null;
        let error = null;
        let pageState = null;

        removeExecutingIndicator();
        renderExecutingIndicator();

        // === Pre-action self-healing ===
        // For any action that needs a live tab, verify currentTabId still
        // maps to a real Chrome tab; recover silently if not. On recovery,
        // we stash a note that gets attached to `result` after the action
        // succeeds, so the server sees it on the next /step call.
        let tabRecoveryNote = null;
        let pageStaleNote = null;
        let skipActionDispatch = false;
        if (TAB_REQUIRED_ACTIONS.has(action)) {
          try {
            const heal = await ensureLiveTab();
            if (heal.healed) {
              tabRecoveryNote = heal.note;
            } else if (heal.failed) {
              error = 'No browser tab available and automatic recovery failed. Use `openTab` with a url to create one, then retry.';
              skipActionDispatch = true;
            }
          } catch (healErr) {
            console.warn('[Global Executive] ensureLiveTab failed:', healErr?.message || healErr);
          }
          // Page-staleness â€” only meaningful if we have a live tab AND the
          // action depends on the current DOM (i.e. NOT a navigation action).
          // If the recovery path just created/switched tabs we skip the check
          // for this iteration (the recovery note already carries that signal).
          if (!skipActionDispatch && !tabRecoveryNote) {
            try {
              const stale = await checkPageStaleness(action);
              if (stale && stale.stale) {
                pageStaleNote = stale.hint;
                console.log(`[Global Executive] page-stale detected: ${stale.expectedUrl} â†’ ${stale.liveUrl}`);
              }
            } catch (staleErr) {
              console.warn('[Global Executive] checkPageStaleness failed:', staleErr?.message || staleErr);
            }
          }
        }

        try {
          if (skipActionDispatch) {
            // Tab recovery failed above; `error` is already set. Fall
            // through to the reporting phase so the server is informed.
          } else if (action === 'done') {
            // Issue 13: Previously returned here, skipping the /step report.
            // Now we render the done UI but FALL THROUGH to the reporting
            // phase so the server receives the final step result (consistent
            // with bg-agent-loop which always reports done to /step).
            removeExecutingIndicator();
            renderDoneStep(params?.summary || 'Task completed');
            updateTaskStatus('completed');
            isRunning = false;
            setSendingState(false);
            stopKeepAlive();
            await loadTaskHistory();
            sendToBackground('ge-clear-staged-files').catch(() => {});
            result = { success: true, summary: params?.summary || 'Task completed' };
            // Fall through â€” the step result will be reported to /step below.
          }

          // === Server-only action safety net ===
          // These actions are executed entirely on the backend; the server
          // is supposed to rewrite them to a `message` (or handle the side
          // effect like ledger update / SERP fetch) BEFORE they reach the
          // extension. If a rewrite slips through, dispatching the raw action
          // to the in-tab runtime would return "Unknown action: X" and fail.
          // NOTE: captureFile, editPdf, fillPdf, pdfPages etc. are NOT in
          // this list â€” they have real client-side handlers below.
          const SERVER_ONLY_ACTIONS = new Set([
            'setMilestones', 'completeMilestone', 'addMilestone',
            'webSearch', 'researchNote',
            'readFile', 'createTool', 'spawnSubAgent'
          ]);
          if (SERVER_ONLY_ACTIONS.has(action)) {
            result = {
              success: true,
              serverOnly: true,
              note: `Server-only action "${action}" was acknowledged on the client. The server handles its side effect; on your next step the relevant state (ledger / research notes / etc.) will be reflected in your context.`
            };

          // ============================================
          // captureFile â€” fetch a URL with the user's cookies and store it.
          // Routes to background.js runCaptureFile() which already handles
          // the full fetch + OBS upload flow. This was previously a fake
          // no-op in SERVER_ONLY_ACTIONS â€” now it executes for real.
          // ============================================
          } else if (action === 'captureFile') {
            result = await (async () => {
              const url = (params?.url || '').trim();
              if (!url || !/^https?:\/\//i.test(url)) {
                return { success: false, error: 'captureFile: url param is required and must be an absolute https:// URL.' };
              }
              // Inject taskId so background.js can include it in the OBS upload.
              const cf = await sendToBackground('ge-execute-in-tab', {
                tabId: currentTabId,
                action: 'captureFile',
                params: { ...params, taskId: currentTaskId }
              });
              if (cf?.success && cf.result) return cf.result;
              return cf?.result || cf || { success: false, error: 'captureFile failed' };
            })();

          // ============================================
          // viewCapturedFile â€” used after captureFile to get a signed URL
          // for a previously stored file. Server handles this; we forward.
          // ============================================
          } else if (action === 'viewCapturedFile') {
            // This is legitimately server-handled (just a signed URL lookup).
            result = {
              success: true,
              serverOnly: true,
              note: 'viewCapturedFile: Server will resolve the signed URL on the next step.'
            };

          // ============================================
          // useTool — Invoke a user's installed AI tool on the active tab
          // ============================================
          } else if (action === 'useTool') {
            result = await (async () => {
              const res = await sendToBackground('ge-execute-in-tab', {
                tabId: currentTabId,
                action: 'useTool',
                params: params || {}
              });
              if (res?.success && res.result) return res.result;
              return res || { success: false, error: 'useTool failed' };
            })();

          // ============================================
          // pdfPages / viewPdfPages â€” extract page metadata + field list
          // from a PDF using DocEngine (pdf-lib) in the browser.
          // ============================================
          } else if (action === 'pdfPages' || action === 'viewPdfPages') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') {
                return { success: false, error: 'DocEngine not loaded. pdf-lib may not have initialised yet.' };
              }
              let fileUrl = params?.url || params?.fileUrl || params?.signedUrl || params?.src || (/^https?:\/\//i.test(params?.fileRef) ? params.fileRef : null);
              if (!fileUrl && params?.fileRef && currentTask?.capturedFiles) {
                const cap = currentTask.capturedFiles.find(f => f.id === params.fileRef);
                if (cap?.signedUrl) fileUrl = cap.signedUrl;
              }
              if (!fileUrl && currentTask?.url && /\.pdf(\?|$)/i.test(currentTask.url)) {
                fileUrl = currentTask.url;
              }
              if (!fileUrl) {
                return { success: false, error: 'pdfPages: provide url (the PDF URL to inspect).' };
              }

              const filename = params?.filename || fileUrl.split('/').pop().split('?')[0] || 'document.pdf';
              let sandbox = null;
              const lastEntry = getLatestStepEntry();
              if (lastEntry && typeof PdfSandbox !== 'undefined') {
                sandbox = PdfSandbox.create(lastEntry.querySelector('.step-body') || lastEntry, {
                  filename,
                  pageCount: 0,
                  fields: [],
                  docType: 'pdf'
                });
                sandbox.setReading();
              }

              const meta = await DocEngine.loadPdf(fileUrl);
              if (!meta.ok) {
                if (sandbox) sandbox.setError(meta.error);
                return { success: false, error: meta.error };
              }

              if (sandbox) {
                if (meta.bytes) {
                  sandbox.showResult(meta.bytes, filename, 'Analyzed');
                } else {
                  sandbox.setStatus('Analyzed');
                }
              }

              return {
                success: true,
                pageCount: meta.pageCount,
                fields: meta.fields,
                hasAcroForm: meta.hasAcroForm,
                title: meta.title,
                author: meta.author,
                bytes: meta.bytes,
                hint: meta.fields.length > 0
                  ? `PDF has ${meta.fields.length} AcroForm field(s). Call editPdf with formFields to fill them.`
                  : 'PDF has no AcroForm fields — use overlays to draw text at coordinates.'
              };
            })();

          // ============================================
          // editPdf / fillPdf â€” fill AcroForm fields and/or draw text
          // overlays using pdf-lib in the browser. Shows a live sandbox
          // card in the chat view as fields are filled.
          // ============================================
          } else if (action === 'editPdf' || action === 'fillPdf') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') {
                return { success: false, error: 'DocEngine not loaded. pdf-lib may not have initialised yet.' };
              }
              let fileUrl = params?.url || params?.fileUrl || params?.signedUrl || params?.src || (/^https?:\/\//i.test(params?.fileRef) ? params.fileRef : null);
              if (!fileUrl && params?.fileRef && currentTask?.capturedFiles) {
                const cap = currentTask.capturedFiles.find(f => f.id === params.fileRef);
                if (cap?.signedUrl) fileUrl = cap.signedUrl;
              }
              if (!fileUrl && currentTask?.url && /\.pdf(\?|$)/i.test(currentTask.url)) {
                fileUrl = currentTask.url;
              }
              if (!fileUrl) {
                return { success: false, error: 'editPdf: provide url (the source PDF URL).' };
              }

              const edits = {
                formFields:  params?.formFields || params?.fields || {},
                overlays:    params?.overlays   || [],
                flattenForm: params?.flattenForm || false
              };

              const fieldEntries = Object.entries(edits.formFields);
              const filename = params?.filename || params?.outputFilename
                || fileUrl.split('/').pop().split('?')[0] || 'edited.pdf';

              // --- Create sandbox card in the current step entry ---
              let sandbox = null;
              const lastEntry = getLatestStepEntry();
              if (lastEntry && typeof PdfSandbox !== 'undefined') {
                // First get field list for the sandbox UI
                let fieldList = [];
                try {
                  const meta = await DocEngine.loadPdf(fileUrl);
                  if (meta.ok) fieldList = meta.fields;
                } catch { /* use empty list */ }

                sandbox = PdfSandbox.create(lastEntry.querySelector('.step-body') || lastEntry, {
                  filename,
                  pageCount: 0, // updated after load
                  fields: fieldList.length ? fieldList : fieldEntries.map(([n]) => ({ name: n, type: 'text' })),
                  docType: 'pdf'
                });
                sandbox.setReading();
              }

              // Mark each field as "filling" sequentially with a short delay
              // so the user can watch the agent work in real-time.
              const animateFields = async (fields, getStatus) => {
                let filled = 0;
                const total = fields.length;
                for (const [name, value] of fields) {
                  if (sandbox) {
                    sandbox.setFieldStatus(name, 'filling');
                    sandbox.setProgress(filled, total);
                    await sleep(80); // brief visual pause per field
                  }
                  const status = getStatus ? getStatus(name) : 'done';
                  if (sandbox) sandbox.setFieldStatus(name, status, String(value).slice(0, 40));
                  filled++;
                  if (sandbox) sandbox.setProgress(filled, total);
                }
              };

              if (sandbox) sandbox.setFilling();

              // Run the actual edit
              const editResult = await DocEngine.editPdf(fileUrl, edits);

              if (!editResult.ok) {
                if (sandbox) sandbox.setError(editResult.error);
                return { success: false, error: editResult.error };
              }

              // Animate field completion based on actual results
              const skippedSet = new Set((editResult.skippedFields || []).map(s => s.field));
              await animateFields(fieldEntries, (name) => skippedSet.has(name) ? 'skipped' : 'done');

              // Show the finished PDF in the sandbox embed
              if (sandbox) sandbox.showResult(editResult.pdfBytes, filename, 'Edited');

              // Also auto-download the result so the user has it immediately.
              // The agent can still upload it separately if needed.
              DocEngine.downloadFile(editResult.pdfBytes, filename, 'application/pdf');

              // Convert to base64 so the server can attach it to the task context
              // for follow-up actions (uploadFile, notifyUser, etc.)
              const b64 = DocEngine.bytesToBase64(editResult.pdfBytes);

              return {
                success: true,
                filledFields: editResult.filledFields,
                skippedFields: editResult.skippedFields,
                drawnOverlays: editResult.drawnOverlays,
                pageCount: editResult.pageCount,
                filename,
                pdfBase64: b64.slice(0, 100) + '…', // truncated for prompt — don't flood context
                pdfSize: editResult.pdfBytes.length,
                hint: `PDF edited client-side and downloaded as "${filename}". ${editResult.filledFields.length} fields filled. ${editResult.skippedFields.length} skipped. If you need to upload it, tell the user to use the file from their Downloads folder.`
              };
            })();

          // ============================================
          // createPdf — build a new PDF from scratch
          // ============================================
          } else if (action === 'createPdf') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') return { success: false, error: 'DocEngine not loaded.' };
              if (!DocEngine.isPdfLibReady()) return { success: false, error: 'pdf-lib not loaded. Make sure libs/pdf-lib.min.js is included.' };

              const filename = params?.filename || params?.outputFilename || (params?.title ? params.title.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim() + '.pdf' : 'document.pdf');
              const textBlocks = params?.textBlocks || params?.blocks || params?.paragraphs || [];
              const r = await DocEngine.createPdf(textBlocks, params);
              if (!r.ok) return { success: false, error: r.error };

              DocEngine.downloadFile(r.pdfBytes, filename, 'application/pdf');
              return {
                success: true,
                filename,
                pdfSize: r.pdfBytes.length,
                hint: `PDF created and downloaded as "${filename}".`
              };
            })();

          // ============================================
          // readDocx — extract text, HTML, headings, and tables from a .docx
          // Uses mammoth.js for faithful extraction.
          // ============================================
          } else if (action === 'readDocx') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') return { success: false, error: 'DocEngine not loaded.' };
              const fileUrl = params?.url || params?.fileUrl || params?.signedUrl || params?.src;
              if (!fileUrl) return { success: false, error: 'readDocx: provide url (the .docx file URL).' };
              if (!DocEngine.isMammothReady()) return { success: false, error: 'mammoth.js not loaded. Make sure libs/mammoth.browser.min.js is included.' };

              const r = await DocEngine.readDocx(fileUrl);
              if (!r.ok) return { success: false, error: r.error };
              return {
                success: true,
                text: r.text,
                html: r.html,
                headings: r.headings,
                tables: r.tables,
                wordCount: r.wordCount,
                warnings: r.warnings,
                hint: `Word document read. ${r.wordCount} words, ${r.headings.length} heading(s), ${r.tables.length} table(s). Use editDocx to modify it.`
              };
            })();

          // ============================================
          // editDocx â€” fill a Word document template OR find-and-replace text.
          //
          // TEMPLATE mode (doc has {placeholder} tags):
          //   { action: "editDocx", params: { url: "...", data: { "name": "John" }, mode: "template" } }
          //
          // FIND & REPLACE mode (any .docx, no special tags needed):
          //   { action: "editDocx", params: { url: "...", replacements: [ { find: "OLD", replace: "NEW" } ] } }
          //
          // Shows a live sandbox card in chat as substitutions are applied.
          // ============================================
          } else if (action === 'editDocx') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') return { success: false, error: 'DocEngine not loaded.' };
              const fileUrl = params?.url || params?.fileUrl || params?.signedUrl || params?.src;
              if (!fileUrl) return { success: false, error: 'editDocx: provide url (the .docx file URL).' };
              if (!DocEngine.isPizZipReady()) return { success: false, error: 'PizZip not loaded. Make sure libs/pizzip.min.js is included.' };

              const filename = params?.filename || params?.outputFilename
                || fileUrl.split('/').pop().split('?')[0].replace(/\.docx$/i, '') + '-edited.docx' || 'edited.docx';

              const hasData         = params?.data && Object.keys(params.data).length > 0;
              const hasReplacements = Array.isArray(params?.replacements) && params.replacements.length > 0;
              const items = hasData
                ? Object.entries(params.data)
                : (params?.replacements || []).map(r => [r.find, r.replace]);

              // --- Sandbox card ---
              let sandbox = null;
              const lastEntry = getLatestStepEntry();
              if (lastEntry && typeof PdfSandbox !== 'undefined' && items.length > 0) {
                sandbox = PdfSandbox.create(lastEntry.querySelector('.step-body') || lastEntry, {
                  filename,
                  pageCount: 1,
                  fields: items.map(([k]) => ({ name: String(k), type: 'text' })),
                  docType: 'docx'
                });
                sandbox.setReading();
              }

              const editResult = await DocEngine.editDocx(fileUrl, params);

              if (!editResult.ok) {
                if (sandbox) sandbox.setError(editResult.error);
                return { success: false, error: editResult.error };
              }

              // Animate replacements
              if (sandbox) {
                sandbox.setFilling();
                let done = 0;
                for (const [key, val] of items) {
                  sandbox.setFieldStatus(String(key), 'filling');
                  sandbox.setProgress(done, items.length);
                  await sleep(60);
                  sandbox.setFieldStatus(String(key), 'done', String(val ?? '').slice(0, 40));
                  done++;
                  sandbox.setProgress(done, items.length);
                }
                // Show download for docx (no embed — browser can't preview docx inline)
                sandbox.showResult(editResult.docxBytes, filename, 'Edited');
              }

              // Download the finished .docx
              const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
              DocEngine.downloadFile(editResult.docxBytes, filename, DOCX_MIME);

              return {
                success: true,
                mode: editResult.mode,
                replaced: editResult.replaced,
                filename,
                docxSize: editResult.docxBytes.length,
                hint: editResult.hint + ` Downloaded as "${filename}".`
              };
            })();

          // ============================================
          // createDocx â€” build a new Word document from scratch.
          // { action: "createDocx", params: { title, paragraphs: [ { text, bold?, italic?, fontSize? } ], tables?: [...] } }
          // ============================================
          } else if (action === 'createDocx') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') return { success: false, error: 'DocEngine not loaded.' };
              if (!DocEngine.isPizZipReady()) return { success: false, error: 'PizZip not loaded.' };

              const filename = params?.filename || (params?.title || 'document').replace(/[^a-zA-Z0-9\-_ ]/g, '').trim() + '.docx';
              const content = {
                title:      params?.title || 'New Document',
                paragraphs: params?.paragraphs || params?.content || [],
                tables:     params?.tables || []
              };

              // Sandbox
              let sandbox = null;
              const lastEntry = getLatestStepEntry();
              if (lastEntry && typeof PdfSandbox !== 'undefined') {
                sandbox = PdfSandbox.create(lastEntry.querySelector('.step-body') || lastEntry, {
                  filename,
                  pageCount: 1,
                  fields: content.paragraphs.slice(0, 5).map(p => ({ name: (p.text || '').slice(0, 40), type: 'text' })),
                  docType: 'docx'
                });
                sandbox.setStatus('Creatingâ€¦');
              }

              const r = await DocEngine.createDocx(content, params);
              if (!r.ok) {
                if (sandbox) sandbox.setError(r.error);
                return { success: false, error: r.error };
              }

              const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
              if (sandbox) sandbox.showResult(r.docxBytes, filename, 'Created');
              DocEngine.downloadFile(r.docxBytes, filename, DOCX_MIME);

              return {
                success: true,
                filename,
                paragraphCount: r.paragraphCount,
                docxSize: r.docxBytes.length,
                hint: `Word document created with ${r.paragraphCount} paragraph(s) and downloaded as "${filename}".`
              };
            })();

          // ============================================
          // loadSheet â€” read a spreadsheet and return sheet names + preview
          // { action: "loadSheet", params: { url } }
          // ============================================
          } else if (action === 'loadSheet' || action === 'readSheet') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') return { success: false, error: 'DocEngine not loaded.' };
              if (!DocEngine.isXlsxReady()) return { success: false, error: 'SheetJS not loaded.' };
              const fileUrl = params?.url || params?.fileUrl || params?.signedUrl || params?.src;
              if (!fileUrl) return { success: false, error: 'loadSheet: provide url (the spreadsheet URL).' };
              const r = await DocEngine.loadSheet(fileUrl);
              if (!r.ok) return { success: false, error: r.error };
              return {
                success: true,
                sheetNames: r.sheetNames,
                sheets: r.sheets,
                hint: `Spreadsheet loaded: ${r.sheetNames.length} sheet(s). Use editSheet to modify cells.`
              };
            })();

          // ============================================
          // editSheet â€” fill cells in a spreadsheet
          // { action: "editSheet", params: { url, sheetName?, cells: [ { ref: 'A1', value: 'x' } ], rows?: [...] } }
          // ============================================
          } else if (action === 'editSheet') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') return { success: false, error: 'DocEngine not loaded.' };
              if (!DocEngine.isXlsxReady()) return { success: false, error: 'SheetJS not loaded.' };
              const fileUrl = params?.url || params?.fileUrl || params?.signedUrl || params?.src;
              if (!fileUrl) return { success: false, error: 'editSheet: provide url (the .xlsx file URL).' };

              const filename = params?.filename || params?.outputFilename
                || fileUrl.split('/').pop().split('?')[0].replace(/\.(xlsx|xls|csv)$/i, '') + '-edited.xlsx' || 'edited.xlsx';

              const cells = params?.cells || [];
              const rows  = params?.rows  || [];

              // Sandbox
              let sandbox = null;
              const lastEntry = getLatestStepEntry();
              if (lastEntry && typeof PdfSandbox !== 'undefined' && cells.length > 0) {
                sandbox = PdfSandbox.create(lastEntry.querySelector('.step-body') || lastEntry, {
                  filename,
                  pageCount: 1,
                  fields: cells.slice(0, 20).map(c => ({ name: c.ref, type: 'text' })),
                  docType: 'xlsx'
                });
                sandbox.setReading();
              }

              const r = await DocEngine.editSheet(fileUrl, params);
              if (!r.ok) {
                if (sandbox) sandbox.setError(r.error);
                return { success: false, error: r.error };
              }

              // Animate cells
              if (sandbox) {
                sandbox.setFilling();
                let done = 0;
                for (const cell of cells.slice(0, 20)) {
                  sandbox.setFieldStatus(cell.ref, 'filling');
                  sandbox.setProgress(done, cells.length);
                  await sleep(60);
                  sandbox.setFieldStatus(cell.ref, 'done', String(cell.value ?? '').slice(0, 30));
                  done++;
                  sandbox.setProgress(done, cells.length);
                }
                sandbox.showResult(r.xlsxBytes, filename, 'Edited');
              }

              const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
              DocEngine.downloadFile(r.xlsxBytes, filename, XLSX_MIME);

              return {
                success: true,
                edited: r.edited,
                sheetName: r.sheetName,
                filename,
                xlsxSize: r.xlsxBytes.length,
                hint: `Spreadsheet updated — ${r.edited.length} cell(s) changed in sheet "${r.sheetName}". Downloaded as "${filename}".`
              };
            })();

          // ============================================
          // readPptx — extract slide count and text from a .pptx
          // ============================================
          } else if (action === 'readPptx') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') return { success: false, error: 'DocEngine not loaded.' };
              const fileUrl = params?.url || params?.fileUrl || params?.signedUrl || params?.src;
              if (!fileUrl) return { success: false, error: 'readPptx: provide url (the .pptx file URL).' };
              if (!DocEngine.isPizZipReady()) return { success: false, error: 'PizZip not loaded. Make sure libs/pizzip.min.js is included.' };

              const r = await DocEngine.readPptx(fileUrl);
              if (!r.ok) return { success: false, error: r.error };
              return {
                success: true,
                text: r.text,
                slides: r.slides,
                slideCount: r.slideCount,
                wordCount: r.wordCount,
                hint: `PowerPoint presentation read. ${r.slideCount} slide(s), ${r.wordCount} words. Use editPptx to modify it.`
              };
            })();

          // ============================================
          // editPptx — fill a PowerPoint template OR find-and-replace text
          // ============================================
          } else if (action === 'editPptx') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') return { success: false, error: 'DocEngine not loaded.' };
              const fileUrl = params?.url || params?.fileUrl || params?.signedUrl || params?.src;
              if (!fileUrl) return { success: false, error: 'editPptx: provide url (the .pptx file URL).' };
              if (!DocEngine.isPizZipReady()) return { success: false, error: 'PizZip not loaded. Make sure libs/pizzip.min.js is included.' };

              const filename = params?.filename || params?.outputFilename
                || fileUrl.split('/').pop().split('?')[0].replace(/\.pptx$/i, '') + '-edited.pptx' || 'edited.pptx';

              const hasData         = params?.data && Object.keys(params.data).length > 0;
              const hasReplacements = Array.isArray(params?.replacements) && params.replacements.length > 0;
              const items = hasData
                ? Object.entries(params.data)
                : (params?.replacements || []).map(r => [r.find, r.replace]);

              // --- Sandbox card ---
              let sandbox = null;
              const lastEntry = getLatestStepEntry();
              if (lastEntry && typeof PdfSandbox !== 'undefined' && items.length > 0) {
                sandbox = PdfSandbox.create(lastEntry.querySelector('.step-body') || lastEntry, {
                  filename,
                  pageCount: 1,
                  fields: items.map(([k]) => ({ name: String(k), type: 'text' })),
                  docType: 'pptx'
                });
                sandbox.setReading();
              }

              const editResult = await DocEngine.editPptx(fileUrl, params);

              if (!editResult.ok) {
                if (sandbox) sandbox.setError(editResult.error);
                return { success: false, error: editResult.error };
              }

              // Animate replacements
              if (sandbox) {
                sandbox.setFilling();
                let done = 0;
                for (const [key, val] of items) {
                  sandbox.setFieldStatus(String(key), 'filling');
                  sandbox.setProgress(done, items.length);
                  await sleep(60);
                  sandbox.setFieldStatus(String(key), 'done', String(val ?? '').slice(0, 40));
                  done++;
                  sandbox.setProgress(done, items.length);
                }
                sandbox.showResult(editResult.pptxBytes, filename, 'Edited');
              }

              // Download the finished .pptx
              const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
              DocEngine.downloadFile(editResult.pptxBytes, filename, PPTX_MIME);

              return {
                success: true,
                mode: editResult.mode,
                replaced: editResult.replaced,
                filename,
                pptxSize: editResult.pptxBytes.length,
                hint: editResult.hint + ` Downloaded as "${filename}".`
              };
            })();

          // ============================================
          // createSheet — build a new Excel document from scratch
          // ============================================
          } else if (action === 'createSheet') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') return { success: false, error: 'DocEngine not loaded.' };
              if (!DocEngine.isXlsxReady()) return { success: false, error: 'SheetJS (xlsx) not loaded.' };

              const filename = params?.filename || params?.outputFilename || 'spreadsheet.xlsx';
              const r = await DocEngine.createSheet(params);
              if (!r.ok) return { success: false, error: r.error };

              DocEngine.downloadFile(r.xlsxBytes, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
              return {
                success: true,
                filename,
                xlsxSize: r.xlsxBytes.length,
                hint: `Spreadsheet created and downloaded as "${filename}".`
              };
            })();

          // ============================================
          // createPptx — build a new PowerPoint presentation
          // ============================================
          } else if (action === 'createPptx') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') return { success: false, error: 'DocEngine not loaded.' };
              if (!DocEngine.isPptxGenReady()) return { success: false, error: 'PptxGenJS not loaded.' };

              const filename = params?.filename || params?.outputFilename || 'presentation.pptx';
              const r = await DocEngine.createPptx(params);
              if (!r.ok) return { success: false, error: r.error };

              DocEngine.downloadFile(r.pptxBytes, filename, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
              return {
                success: true,
                filename,
                pptxSize: r.pptxBytes.length,
                hint: `PowerPoint presentation created and downloaded as "${filename}".`
              };
            })();

          // ============================================
          // createTextFile — build a plain text, CSV, or JSON file
          // ============================================
          } else if (action === 'createTextFile') {
            result = await (async () => {
              if (typeof DocEngine === 'undefined') return { success: false, error: 'DocEngine not loaded.' };

              const filename = params?.filename || params?.outputFilename || 'file.txt';
              const text = params?.text || params?.content || '';
              const r = await DocEngine.createTextFile(text);
              if (!r.ok) return { success: false, error: r.error };

              DocEngine.downloadFile(r.textBytes, filename, DocEngine.mimeForFilename(filename));
              return {
                success: true,
                filename,
                size: r.textBytes.length,
                hint: `File created and downloaded as "${filename}".`
              };
            })();

          } else if (action === 'think') {
            result = { success: true };
          } else if (action === 'message') {
            result = { success: true };
          } else if (action === 'rememberThis') {
            // Server handled the actual memory write â€” this is just a
            // rendered step on the client. Nothing to do in the tab.
            result = { success: true, remembered: params?.text || '' };
          } else if (action === 'notifyUser') {
            // Server handled the actual push (Telegram / WhatsApp). The
            // result of that push is stamped onto the step on the server;
            // we just acknowledge here.
            result = { success: true, notified: params?.text || '' };
          } else if (action === 'webSearch') {
            // Server-side action: the SERP fetch ran on the backend and
            // the result was rewritten to a `message` before we got here.
            // This branch is a safety net in case the rewrite didn't fire
            // (shouldn't happen, but we never want to bounce a no-op
            // action down to `ge-execute-in-tab`).
            result = { success: true, query: params?.query || '' };
          } else if (action === 'researchNote') {
            // Server-side: the note was persisted on the task server-side.
            // Same safety-net rationale as webSearch above.
            result = { success: true, recorded: params?.claim || '' };
          } else if (action === 'wait') {
            await sleep(Math.min(params?.ms || 1000, 10000));

            result = { success: true };
          } else if (action === 'openTab') {
            const newTab = await sendToBackground('ge-open-tab', { url: params.url });
            if (newTab?.tabId) {
              trackedTabs.push({ tabId: newTab.tabId, tabIndex: trackedTabs.length, url: newTab.url, title: newTab.title, status: 'active' });
              currentTabId = newTab.tabId;
              activeTabIndex = trackedTabs.length - 1;
              result = { success: true, tabId: newTab.tabId, url: newTab.url || '', title: newTab.title || '' };
              // Layered wait for full page readiness so the next action sees
              // a settled DOM. waitForStable returns as soon as mutations
              // quiet for ~600ms (or 4s timeout as a hard cap).
              try {
                await sendToBackground('ge-execute-in-tab', { tabId: currentTabId, action: 'waitForStable', params: { timeout: 4000, quietMs: 600 } });
              } catch { /* best effort */ }
            } else {
              error = 'Failed to open tab';
            }
          } else if (action === 'switchTab') {
            // Targeting priority: explicit url/title > tracked-tab index > chrome window index.
            // Background.js resolves all of these against live chrome.tabs.query.
            const hasUrlOrTitle = !!(params?.url || params?.title);
            let payload = {};
            if (hasUrlOrTitle) {
              payload = { url: params.url, title: params.title };
            } else if (typeof params?.tabIndex === 'number'
                       && params.tabIndex >= 0 && params.tabIndex < trackedTabs.length
                       && trackedTabs[params.tabIndex].status !== 'closed') {
              // Legacy: index into agent-tracked tabs.
              payload = { tabId: trackedTabs[params.tabIndex].tabId };
            } else if (typeof params?.browserIndex === 'number') {
              payload = { browserIndex: params.browserIndex };
            } else if (typeof params?.tabIndex === 'number') {
              // Fallback: agent gave an index from the "Available Browser Tabs" list.
              payload = { tabIndex: params.tabIndex };
            } else {
              error = 'switchTab requires one of: url, title, tabIndex, or browserIndex';
            }
            if (!error) {
              const r = await sendToBackground('ge-switch-tab', payload);
              if (r?.success) {
                currentTabId = r.tabId;
                // Track this tab if not already in trackedTabs
                let idx = trackedTabs.findIndex(t => t.tabId === r.tabId);
                if (idx < 0) {
                  trackedTabs.push({ tabId: r.tabId, tabIndex: trackedTabs.length, url: r.url, title: r.title, status: 'active' });
                  idx = trackedTabs.length - 1;
                }
                activeTabIndex = idx;
                result = { success: true, tabId: r.tabId, url: r.url, title: r.title };
                // Stable-wait the newly-foregrounded tab so the next action
                // sees a settled DOM (some sites lazy-render on focus).
                try {
                  await sendToBackground('ge-execute-in-tab', { tabId: r.tabId, action: 'waitForStable', params: { timeout: 2500, quietMs: 500 } });
                } catch { /* best effort */ }
              } else {
                error = r?.error || 'switchTab failed';
                if (r?.candidates) {
                  error += ' Candidates: ' + r.candidates.map(c => `[${c.index}] ${c.title || ''} (${c.url || ''})`).join('; ');
                }
              }
            }
          } else if (action === 'closeTab') {
            // Same resolution strategy as switchTab. Refuses to close on ambiguity.
            const hasUrlOrTitle = !!(params?.url || params?.title);
            let payload = {};
            if (hasUrlOrTitle) {
              payload = { url: params.url, title: params.title };
            } else if (typeof params?.tabIndex === 'number'
                       && params.tabIndex >= 0 && params.tabIndex < trackedTabs.length
                       && trackedTabs[params.tabIndex].status !== 'closed') {
              payload = { tabId: trackedTabs[params.tabIndex].tabId };
            } else if (typeof params?.browserIndex === 'number') {
              payload = { browserIndex: params.browserIndex };
            } else if (typeof params?.tabIndex === 'number') {
              payload = { tabIndex: params.tabIndex };
            } else {
              error = 'closeTab requires one of: url, title, tabIndex, or browserIndex';
            }
            if (!error) {
              const r = await sendToBackground('ge-close-tab', payload);
              if (r?.success) {
                // If the closed tab was tracked, mark it closed
                const idx = trackedTabs.findIndex(t => t.tabId === r.closedTabId);
                if (idx >= 0) trackedTabs[idx].status = 'closed';
                result = { success: true, closedTabId: r.closedTabId, url: r.url, title: r.title };
              } else {
                error = r?.error || 'closeTab failed';
                if (r?.candidates) {
                  error += ' Candidates: ' + r.candidates.map(c => `[${c.index}] ${c.title || ''} (${c.url || ''})`).join('; ');
                }
              }
            }
          } else if (action === 'download') {
            let downloadUrl = params?.url;
            let downloadFilename = params?.filename;
            if (!downloadUrl && params?.fileRef && currentTask?.capturedFiles) {
              const cap = currentTask.capturedFiles.find(f => f.id === params.fileRef);
              if (cap?.signedUrl) {
                downloadUrl = cap.signedUrl;
                if (!downloadFilename && cap.filename) downloadFilename = cap.filename;
              }
            }
            if (params?.content) {
              // Download generated content
              await sendToBackground('ge-download-content', {
                content: params.content,
                filename: downloadFilename || 'download.txt',
                mimeType: params.mimeType || 'text/plain'
              });
            } else if (downloadUrl) {
              await sendToBackground('ge-download', {
                url: downloadUrl,
                filename: downloadFilename
              });
            }
            result = { success: true };
          } else if (action === 'storeData') {
            // Data stored server-side, nothing to do client-side
            result = { success: true, key: params?.key, itemCount: Array.isArray(params?.data) ? params.data.length : 1 };
          } else if (action === 'goto') {
            if (!params?.url) {
              error = "goto requires params.url (e.g. 'https://google.com'). Retry with the url field.";
            } else {
              const r = await sendToBackground('ge-goto', { tabId: currentTabId, url: params.url });
              if (r?.success) {
                result = { success: true, url: r.url, title: r.title };
                // If background opened a new tab (no tracked tab existed), adopt it
                if (r.openedNew && r.tabId) {
                  trackedTabs.push({ tabId: r.tabId, tabIndex: trackedTabs.length, url: r.url, status: 'active' });
                  currentTabId = r.tabId;
                  activeTabIndex = trackedTabs.length - 1;
                } else if (trackedTabs[activeTabIndex]) {
                  trackedTabs[activeTabIndex].url = r.url;
                }
                // Layered wait for SPA paints after status='complete'.
                try {
                  await sendToBackground('ge-execute-in-tab', { tabId: currentTabId, action: 'waitForStable', params: { timeout: 4000, quietMs: 600 } });
                } catch { /* best effort */ }
              } else {
                error = r?.error || 'Navigation failed';
              }
            }
          } else if (action === 'goBack' || action === 'goForward' || action === 'reload') {
            const r = await sendToBackground('ge-' + action.replace('go', 'go-').toLowerCase(), { tabId: currentTabId });
            if (r?.success) {
              result = { success: true, url: r.url, title: r.title };
              try {
                await sendToBackground('ge-execute-in-tab', { tabId: currentTabId, action: 'waitForStable', params: { timeout: 3000, quietMs: 500 } });
              } catch { /* best effort */ }
            } else {
              error = r?.error || `${action} failed`;
            }
          } else if (action === 'screenshot') {
            const r = await sendToBackground('ge-screenshot', { tabId: currentTabId });
            if (r?.success && r.dataUrl) {
              // Upload the captured image to the server, which stores it in
              // Huawei OBS and hands the pre-signed URL to the LLM on the
              // next /step call. Server enforces tier gating + per-task cap.
              try {
                const uploadResp = await NewOrderAPI.request('/api/agent/screenshot', {
                  method: 'POST',
                  body: JSON.stringify({
                    taskId: currentTaskId,
                    stepNumber,
                    dataUrl: r.dataUrl
                  })
                });
                result = {
                  success: true,
                  captured: true,
                  url: r.url,
                  title: r.title,
                  ttlMinutes: uploadResp.ttlMinutes,
                  screenshotsUsed: uploadResp.screenshotsUsed,
                  screenshotsMax: uploadResp.screenshotsMax,
                  note: 'The AI will see this screenshot on its next step.'
                };
              } catch (upErr) {
                // Common cases: 403 (free tier), 429 (cap hit), 503 (OBS down).
                // Surface the server's own message so the LLM can adapt.
                error = upErr.message || 'Failed to upload screenshot to server';
              }
            } else {
              error = r?.error || 'Screenshot failed';
            }
          } else if (action === 'gotoAndRead' || action === 'clickAndWait' || action === 'typeAndSubmit') {
            // ============================================
            // === Compound action macros ===
            // ============================================
            // Halve the round-trip cost on the three most common 2-step
            // patterns the agent emits. Each macro runs its primitives
            // sequentially through the SAME extension paths the LLM would
            // use individually (so all the existing reason codes / health
            // checks / auto-adopt logic still applies), and returns a
            // single combined result. Sub-results are surfaced under
            // `macroSubResults` so debugging and the LLM's next-step
            // context stay accurate.
            //
            // Tunable timings â€” kept short (waitForStable defaults to
            // 2000 ms, post-goto sleep 800 ms) because the macro is meant
            // to save a round-trip, not to be a bulletproof flow runner.
            // If a site needs longer waits, the LLM should fall back to
            // explicit primitive sequences.
            const subResults = {};
            try {
              if (action === 'gotoAndRead') {
                // Goto first (uses background-relayed handler so all the
                // "openedNew" / tab-tracking logic from regular `goto`
                // applies). On failure we abort and surface the error
                // â€” no point reading a page we never reached.
                if (!params?.url) {
                  error = "gotoAndRead requires params.url. Retry with the url field.";
                } else {
                  const g = await sendToBackground('ge-goto', { tabId: currentTabId, url: params.url });
                  if (!g?.success) {
                    error = g?.error || 'gotoAndRead: navigation failed';
                  } else {
                    subResults.goto = { success: true, url: g.url, title: g.title };
                    if (g.openedNew && g.tabId) {
                      trackedTabs.push({ tabId: g.tabId, tabIndex: trackedTabs.length, url: g.url, status: 'active' });
                      currentTabId = g.tabId;
                      activeTabIndex = trackedTabs.length - 1;
                    } else if (trackedTabs[activeTabIndex]) {
                      trackedTabs[activeTabIndex].url = g.url;
                    }
                    // Wait for the page to actually settle before reading.
                    // ge-goto already awaited waitForTabLoad (status=='complete'),
                    // but many SPAs paint after that â€” Tripadvisor, Google,
                    // Amazon all show "loading: true, mutationCount: 1" if
                    // we readPage immediately. We layer two waits:
                    //   1. waitForStable (MutationObserver-based) â€” returns
                    //      as soon as the DOM goes quiet for ~600ms.
                    //   2. If the resulting readPage STILL reports loading,
                    //      sleep + re-read once.
                    try {
                      await sendToBackground('ge-execute-in-tab', {
                        tabId: currentTabId,
                        action: 'waitForStable',
                        params: { timeout: 4000, quietMs: 600 }
                      });
                    } catch { /* best effort â€” fall through to readPage */ }
                    let r = await sendToBackground('ge-execute-in-tab', { tabId: currentTabId, action: 'readPage', params: {} });
                    if (r?.success && r.result && r.result.loading === true) {
                      // Partial DOM â€” give the page another moment then re-read.
                      await sleep(1500);
                      const r2 = await sendToBackground('ge-execute-in-tab', { tabId: currentTabId, action: 'readPage', params: {} });
                      if (r2?.success) r = r2;
                    }
                    if (r?.success) {
                      subResults.readPage = r.result;
                      result = {
                        success: true,
                        macro: 'gotoAndRead',
                        url: g.url,
                        title: g.title,
                        readPage: r.result,
                        macroSubResults: subResults,
                        hint: 'Macro: navigated AND read page in one step. Inspect `readPage` for the next interactive target.'
                      };
                    } else {
                      // Navigation succeeded but readPage failed â€” still report
                      // a partial success so the agent doesn't think the goto
                      // was rejected. It can readPage explicitly next step.
                      result = {
                        success: true,
                        macro: 'gotoAndRead',
                        url: g.url,
                        title: g.title,
                        readPageFailed: true,
                        readPageError: r?.error || 'unknown',
                        macroSubResults: subResults,
                        hint: 'Macro partial: goto succeeded but readPage failed. Call `readPage` explicitly next step.'
                      };
                    }
                  }
                }
              } else if (action === 'clickAndWait') {
                // Click then wait for DOM to settle (waitForStable). If the
                // caller supplied a `waitFor` selector, prefer waitForElement.
                const c = await sendToBackground('ge-execute-in-tab', { tabId: currentTabId, action: 'click', params });
                if (!c?.success) {
                  error = c?.error || 'clickAndWait: click rejected by runtime';
                } else if (c.result && c.result.success === false) {
                  // Click reached the runtime but failed (no_match, hidden, etc.)
                  // â€” surface the structured failure as the macro's outcome
                  // so the LLM sees the same `reason`/`recovery` it would
                  // have on a plain click.
                  result = { success: false, macro: 'clickAndWait', ...c.result, macroSubResults: { click: c.result } };
                  error = c.result.error || 'click failed';
                } else {
                  subResults.click = c.result;
                  // Wait phase. If `waitFor` selector provided â†’ waitForElement
                  // (deterministic). Otherwise â†’ waitForStable (DOM settles).
                  const waitForSel = params?.waitFor || params?.waitForSelector;
                  let w;
                  if (waitForSel) {
                    w = await sendToBackground('ge-execute-in-tab', {
                      tabId: currentTabId,
                      action: 'waitForElement',
                      params: { selector: waitForSel, timeout: params?.waitTimeout || 5000 }
                    });
                  } else {
                    w = await sendToBackground('ge-execute-in-tab', {
                      tabId: currentTabId,
                      action: 'waitForStable',
                      params: { timeout: params?.waitTimeout || 2500 }
                    });
                  }
                  subResults.wait = w?.result || { success: false, error: w?.error || 'wait failed' };
                  result = {
                    success: true,
                    macro: 'clickAndWait',
                    ...c.result,
                    waited: subResults.wait,
                    macroSubResults: subResults,
                    hint: 'Macro: clicked AND waited for the page to settle. Proceed to your next planned action without `wait`/`waitForElement`.'
                  };
                }
              } else if (action === 'typeAndSubmit') {
                // Type with pressEnter forced true, then wait for stability.
                // Common form-submit pattern compressed into one round-trip.
                const typeParams = { ...(params || {}), pressEnter: true };
                const t = await sendToBackground('ge-execute-in-tab', { tabId: currentTabId, action: 'type', params: typeParams });
                if (!t?.success) {
                  error = t?.error || 'typeAndSubmit: type rejected by runtime';
                } else if (t.result && t.result.success === false) {
                  result = { success: false, macro: 'typeAndSubmit', ...t.result, macroSubResults: { type: t.result } };
                  error = t.result.error || 'type failed';
                } else {
                  subResults.type = t.result;
                  const w = await sendToBackground('ge-execute-in-tab', {
                    tabId: currentTabId,
                    action: 'waitForStable',
                    params: { timeout: params?.waitTimeout || 3000 }
                  });
                  subResults.wait = w?.result || { success: false, error: w?.error || 'wait failed' };
                  result = {
                    success: true,
                    macro: 'typeAndSubmit',
                    ...t.result,
                    waited: subResults.wait,
                    macroSubResults: subResults,
                    hint: 'Macro: typed + pressed Enter + waited for the page to settle. If a navigation was expected, the new page should now be loaded.'
                  };
                }
              }
            } catch (macroErr) {
              error = `${action} macro failed: ${macroErr?.message || macroErr}`;
            }
          } else if (action === 'readAndExtract') {
            // Macro: readPage + extract in one round-trip. The agent already
            // knows the repeating selector, so we save the round-trip cost
            // of a separate `readPage` followed by a separate `extract`.
            try {
              const itemsSel = params?.items || params?.selector;
              const extractParams = {
                items: itemsSel,
                fields: params?.fields || params?.selectors || {},
                limit: typeof params?.limit === 'number' ? params.limit : 50
              };
              const r = await sendToBackground('ge-execute-in-tab', { tabId: currentTabId, action: 'readPage', params: {} });
              const subResults = {};
              if (!r?.success) {
                error = r?.error || 'readAndExtract: readPage failed';
              } else {
                subResults.readPage = r.result;
                const e = await sendToBackground('ge-execute-in-tab', { tabId: currentTabId, action: 'extract', params: extractParams });
                subResults.extract = e?.success ? e.result : { success: false, error: e?.error || 'extract failed' };
                result = {
                  success: true,
                  macro: 'readAndExtract',
                  readPage: r.result,
                  extract: subResults.extract,
                  macroSubResults: subResults,
                  hint: 'Macro: read page AND extracted in one step. Inspect `extract.items` for the data array.'
                };
              }
            } catch (macroErr) {
              error = `readAndExtract macro failed: ${macroErr?.message || macroErr}`;
            }
          } else if (action === 'scrollAndExtract') {
            // Macro: scroll N times, extract on each pass, dedupe.
            // Collapses the typical 6-12 step infinite-scroll harvesting
            // pattern into ONE call. Hard-cap passes at 8 to bound credits.
            try {
              const itemsSel = params?.items || params?.selector;
              const fields = params?.fields || params?.selectors || {};
              const direction = (params?.direction === 'up') ? 'up' : 'down';
              const amount = Math.max(100, Math.min(parseInt(params?.amount, 10) || 1000, 5000));
              const passesReq = parseInt(params?.passes, 10);
              const passes = Math.max(1, Math.min(Number.isFinite(passesReq) ? passesReq : 3, 8));
              const dedupBy = String(params?.dedupBy || Object.keys(fields)[0] || '').trim();

              const collected = [];
              const seenKeys = new Set();
              const subResults = { perPass: [] };
              for (let i = 0; i < passes; i++) {
                // Extract first (so pass 0 captures what's already on screen),
                // then scroll to load more for the next pass.
                const e = await sendToBackground('ge-execute-in-tab', {
                  tabId: currentTabId,
                  action: 'extract',
                  params: { items: itemsSel, fields, limit: 200 }
                });
                const passItems = (e?.success && e.result && Array.isArray(e.result.items)) ? e.result.items : [];
                let added = 0;
                for (const it of passItems) {
                  const key = dedupBy ? String(it?.[dedupBy] ?? '').trim() : JSON.stringify(it);
                  if (!key) continue;
                  if (seenKeys.has(key)) continue;
                  seenKeys.add(key);
                  collected.push(it);
                  added++;
                }
                subResults.perPass.push({ pass: i, extracted: passItems.length, newItems: added });
                // Don't scroll on the last pass â€” we already extracted everything we'll see.
                if (i < passes - 1) {
                  await sendToBackground('ge-execute-in-tab', {
                    tabId: currentTabId,
                    action: 'scroll',
                    params: { direction, amount }
                  });
                  // Brief settle for lazy-loaded content. Keep short so the
                  // macro doesn't drift toward becoming a sleep.
                  await sleep(500);
                }
              }
              result = {
                success: true,
                macro: 'scrollAndExtract',
                passes,
                totalExtracted: collected.length,
                items: collected,
                dedupBy: dedupBy || null,
                macroSubResults: subResults,
                hint: `Macro: scrolled ${passes} time(s) and harvested ${collected.length} unique item(s). If you need more, call again â€” the page is already scrolled past what you've seen.`
              };
            } catch (macroErr) {
              error = `scrollAndExtract macro failed: ${macroErr?.message || macroErr}`;
            }
          } else if (action === 'askUser' || action === 'confirmAction') {
            // Server set status='awaiting_user' and persisted the question. Show modal.
            const reply = action === 'askUser'
              ? await showAskUserModal(params?.question || 'The agent has a question.', params?.choices || [])
              : await showConfirmModal(params?.summary || 'Approve this action?', params?.pendingAction || null);
            if (reply === '__stopped__') {
              await stopTask();
              return;
            }
            // Submit reply to server, get next step, replace current step and continue
            try {
              const answerData = await NewOrderAPI.request('/api/agent/answer', {
                method: 'POST',
                body: JSON.stringify({ taskId: currentTaskId, reply })
              });
              if (answerData.usage) {
                updateCreditsDisplay(answerData.usage.creditsRemaining);
                taskCredits.textContent = answerData.usage.totalTaskCredits.toFixed(2) + ' credits';
              }
              if (answerData.done) {
                renderDoneStep(answerData.summary || 'Task ended');
                updateTaskStatus(answerData.status || 'completed');
                isRunning = false;
                setSendingState(false);
                stopKeepAlive();
                await loadTaskHistory();
                return;
              }
              // Mark current entry completed and jump to the next step (no /step round-trip)
              const lastEntry2 = getLatestStepEntry();
              if (lastEntry2) lastEntry2.classList.add('completed');
              if (answerData.goalLedger) renderGoalLedger(answerData.goalLedger);
              step = answerData.step;
              taskStepCounter.textContent = `Step ${step.stepNumber}/${currentTierMaxSteps}`;
              renderStep(step);
              continue; // outer while loop with new step
            } catch (ansErr) {
              console.error('[Global Executive] Answer error:', ansErr);
              error = ansErr.message || 'Failed to send reply';
            }
          } else {
            // Actions that run in the content script: readPage, click, type, scroll, select, pressKey, clear, extract, waitForElement
            // === Humanization jitter ===
            // Bot-detection systems (Cloudflare, PerimeterX, DataDome,
            // TripAdvisor, etc.) flag automation when DOM events arrive in
            // sub-100ms bursts with no variance. We add a randomized sleep
            // BEFORE every interactive action so the timing distribution
            // looks more like a human operator. Skipped for "readPage" and
            // "extract" (pure DOM reads â€” no event fingerprint) to save
            // credits, and capped so long-running tasks don't drag.
            const INTERACTIVE = new Set(['click', 'type', 'scroll', 'select', 'pressKey', 'clear', 'hover', 'uploadFile']);
            if (INTERACTIVE.has(action)) {
              // 400-1200ms jitter with a bias toward the middle of the range.
              const jitter = 400 + Math.floor(Math.random() * 400) + Math.floor(Math.random() * 400);
              await sleep(jitter);
            }
            // Snapshot the timestamp just BEFORE dispatching a click so the
            // auto-adopt logic (below) can filter the recent-tabs map to
            // tabs created as a side-effect of THIS click. Minus 300 ms to
            // tolerate clock skew between the renderer and the background.
            const preActionAt = (action === 'click') ? (Date.now() - 300) : 0;

            const response = await sendToBackground('ge-execute-in-tab', {
              tabId: currentTabId,
              action,
              params
            });

            if (response?.success) {
              result = response.result;

              // === Universal post-click new-tab check (auto-adopt) ===
              // We run this after EVERY successful click, not just ones the
              // content script flagged `openedNewTab: true`. That flag is
              // set only when the anchor has `target=_blank`; but plenty of
              // sites open tabs via JS (`window.open`) or middle-click
              // handlers, and those used to be invisible to the agent.
              // Background implements a fast-path: if NO tab was created
              // in our window, it returns in ~150ms with reason='no_new_tab'
              // so latency on the common case is negligible.
              if (action === 'click') {
                try {
                  const hrefHint = (result?.clicked?.href || '').toString();
                  // Longer wait when we have a strong signal a tab is
                  // coming; short opportunistic wait otherwise.
                  const timeout = result?.openedNewTab ? 5000 : 700;
                  const newest = await sendToBackground('ge-get-newest-tab', {
                    sinceMs: preActionAt,
                    openerTabId: currentTabId,
                    hrefHint,
                    timeout
                  });
                  if (newest?.success && typeof newest.tabId === 'number' && newest.tabId !== currentTabId) {
                    // Record the adopted tab in trackedTabs so subsequent
                    // tabIndex-based actions (closeTab, switchTab) can reach it.
                    const existingIdx = trackedTabs.findIndex(t => t.tabId === newest.tabId);
                    if (existingIdx >= 0) {
                      trackedTabs[existingIdx].url = newest.url || trackedTabs[existingIdx].url;
                      trackedTabs[existingIdx].title = newest.title || trackedTabs[existingIdx].title;
                      trackedTabs[existingIdx].status = 'active';
                      activeTabIndex = existingIdx;
                    } else {
                      trackedTabs.push({
                        tabId: newest.tabId,
                        tabIndex: trackedTabs.length,
                        url: newest.url || '',
                        title: newest.title || '',
                        openedByAgent: true,
                        status: 'active'
                      });
                      activeTabIndex = trackedTabs.length - 1;
                    }
                    currentTabId = newest.tabId;

                    // Bring the new tab to the foreground so the user can
                    // watch what the agent is doing, and so any content-
                    // script actions route correctly.
                    try { await sendToBackground('ge-switch-tab', { tabId: newest.tabId }); } catch { /* best-effort */ }

                    // Enrich the action result â€” the server injects this
                    // into the next prompt so the LLM knows it's ALREADY
                    // on the new tab and must not call switchTab again.
                    result.autoAdoptedTab = {
                      tabId: newest.tabId,
                      url: newest.url || '',
                      title: newest.title || ''
                    };
                    result.hint = `New tab opened by this click was AUTO-ADOPTED. You are now on tab "${(newest.title || newest.url || '').slice(0, 80)}". Do NOT call \`switchTab\` for this tab. Proceed directly with your next action (readPage / extract / click / etc.) on this tab.`;
                  } else if (newest?.success === false && newest.reason === 'blank_or_blocked') {
                    // A new tab was created but never navigated away from
                    // about:blank â€” popup blocker, failed window.open, or
                    // the target page died instantly. Close the empty
                    // shell so it doesn't clutter trackedTabs, and tell
                    // the LLM to recover via `goto` on the current tab.
                    if (typeof newest.staleTabId === 'number') {
                      try { await sendToBackground('ge-close-tab', { tabId: newest.staleTabId }); } catch { /* best-effort */ }
                    }
                    result.autoAdoptFailed = true;
                    result.autoAdoptFailReason = 'blank_or_blocked';
                    result.hint = `The click opened a new tab but it never navigated (popup blocker or failed window.open). The empty tab was closed automatically. To reach the destination, use \`goto\` with \`${(hrefHint || '<the link URL>').slice(0, 120)}\` on the current tab, or try \`click\` again with a different targeting strategy.`;
                  } else if (result?.openedNewTab && newest?.success === false) {
                    // The content script was sure a tab opened, but
                    // background couldn't find one â€” very rare race.
                    result.autoAdoptFailed = true;
                    result.autoAdoptFailReason = newest.reason || 'unknown';
                  }
                  // reason === 'no_new_tab' on a click without
                  // `openedNewTab` is the COMMON silent case â€” no tab
                  // opened, no annotation needed.
                } catch (adoptErr) {
                  console.warn('[Global Executive] Auto-adopt new tab failed:', adoptErr?.message || adoptErr);
                  if (result?.openedNewTab) {
                    result.autoAdoptFailed = true;
                    result.autoAdoptFailReason = 'exception';
                  }
                }
              }
            } else {
              error = response?.error || 'Action failed';
            }
          }

          // If we silently recovered from a dead tab earlier in this step,
          // annotate the result so the server can inject the note into the
          // next LLM prompt. Skipped if the action itself failed.
          if (tabRecoveryNote && !error && result && typeof result === 'object') {
            result.tabRecovered = true;
            result.recoveryNote = tabRecoveryNote;
            result.hint = (result.hint ? result.hint + ' ' : '') + tabRecoveryNote;
          }

          // Same channel for page-staleness drift. Always attach (even if
          // the action itself succeeded) â€” the LLM still benefits from
          // knowing the live URL differs from what it planned against.
          if (pageStaleNote && result && typeof result === 'object') {
            result.pageStale = true;
            result.pageStaleHint = pageStaleNote;
            result.hint = (result.hint ? result.hint + ' ' : '') + pageStaleNote;
          }
        } catch (actionErr) {
          error = actionErr.message || 'Action execution error';
          console.error('[Global Executive] Action error:', actionErr);
        }

        removeExecutingIndicator();

        // Update the last step's UI with result
        const lastEntry = getLatestStepEntry();
        if (lastEntry) {
          if (error) {
            lastEntry.classList.add('failed');
            const errEl = document.createElement('div');
            errEl.className = 'step-error';
            errEl.textContent = error;
            lastEntry.querySelector('.step-body').appendChild(errEl);
          } else {
            lastEntry.classList.add('completed');
          }
        }

        // Get current page state for context
        if (currentTabId && ['readPage', 'click', 'type', 'scroll', 'extract', 'waitForElement', 'select', 'pressKey', 'clear'].includes(action)) {
          try {
            const pageResult = await sendToBackground('ge-execute-in-tab', {
              tabId: currentTabId,
              action: 'readPage',
              params: {}
            });
            if (pageResult?.success) {
              pageState = pageResult.result;
            }
          } catch { /* ignore - page state is optional context */ }
        }

        // Truncate page state client-side to avoid body-too-large errors
        pageState = truncatePageState(pageState, 100000); // ~100KB safety margin

        // === Send result to server, get next action (with internal retry) ===
        try {
          let nextData;
          let attempt = 0;
          let lastErr = null;
          const MAX_STEP_ATTEMPTS = 4; // 1 initial + 3 retries (30s, 30s, 60s)
          while (attempt < MAX_STEP_ATTEMPTS && !nextData) {
            attempt++;
            try {
              // Get a fresh snapshot of all browser tabs so the agent always
              // sees the current Chrome window state (not just the stale list
              // from task start). This is what `closeTab`/`switchTab` target.
              let liveTabs = [];
              let liveTabIds = null; // Set<number> — null if lookup failed
              let tabsResp = null;
              try {
                tabsResp = await sendToBackground('ge-list-tabs', {});
                if (tabsResp?.success && Array.isArray(tabsResp.tabs)) {
                  liveTabs = tabsResp.tabs.map(t => ({
                    index: t.index,
                    url: t.url,
                    title: t.title,
                    active: t.active
                  }));
                  liveTabIds = new Set(tabsResp.tabs.map(t => t.tabId).filter(id => typeof id === 'number'));
                }
              } catch { /* best effort */ }

              // === TrackedTabs audit ===
              // Mark any tracked tab that no longer exists in Chrome as
              // 'closed'. This prevents the LLM from picking a stale
              // tabIndex on later switchTab/closeTab calls. We also
              // recover `currentTabId` if it points at a dead tab by
              // falling back to the active Chrome tab.
              if (liveTabIds) {
                for (const tt of trackedTabs) {
                  if (tt.status !== 'closed' && !liveTabIds.has(tt.tabId)) {
                    tt.status = 'closed';
                  }
                }
                if (currentTabId && !liveTabIds.has(currentTabId)) {
                  // Current tab is gone — fall back to Chrome's active tab.
                  const active = liveTabs.find(t => t.active);
                  if (active) {
                    // Find or push the active tab into trackedTabs so
                    // subsequent actions have a consistent index.
                    const activeRaw = tabsResp?.tabs?.find(t => t.active);
                    if (activeRaw && typeof activeRaw.tabId === 'number') {
                      let idx = trackedTabs.findIndex(t => t.tabId === activeRaw.tabId);
                      if (idx < 0) {
                        trackedTabs.push({
                          tabId: activeRaw.tabId,
                          tabIndex: trackedTabs.length,
                          url: activeRaw.url || '',
                          title: activeRaw.title || '',
                          status: 'active'
                        });
                        idx = trackedTabs.length - 1;
                      } else {
                        trackedTabs[idx].status = 'active';
                      }
                      activeTabIndex = idx;
                      currentTabId = activeRaw.tabId;
                    }
                  }
                }
              }

              // Forward the 5 most recent downloads so the server can
              // surface them in the ENVIRONMENT block. The agent uses
              // this to know when a "Download" click has produced a URL
              // it can pass to captureFile, and whether the download
              // has actually finished.
              let recentDownloads = [];
              try {
                if (chrome?.downloads?.search) {
                  const dls = await new Promise((resolve) => {
                    try {
                      chrome.downloads.search(
                        { orderBy: ['-startTime'], limit: 5 },
                        (items) => resolve(Array.isArray(items) ? items : [])
                      );
                    } catch { resolve([]); }
                  });
                  recentDownloads = dls.map(d => ({
                    id: d.id,
                    url: d.finalUrl || d.url || '',
                    filename: (d.filename || '').split(/[\\/]/).pop() || '',
                    state: d.state || 'unknown',              // "in_progress" | "complete" | "interrupted"
                    bytesReceived: d.bytesReceived || 0,
                    totalBytes: d.totalBytes || 0,
                    mime: d.mime || ''
                  }));
                }
              } catch { /* permission not granted / API unavailable */ }

              nextData = await NewOrderAPI.request('/api/agent/step', {
                method: 'POST',
                callerHandlesRetry: true,
                body: JSON.stringify({
                  taskId: currentTaskId,
                  stepNumber,
                  result: result || null,
                  error: error || null,
                  pageState: pageState || null,
                  allTabs: liveTabs,
                  recentDownloads,
                  modelId: selectedModelId,
                  ...getBrowserEnv()
                })
              });
            } catch (stepErr) {
              lastErr = stepErr;
              const m = stepErr.message || '';
              // Server-typed, non-retryable mid-task errors (daily quota,
              // no credits, account suspended). Re-throw immediately so
              // the outer task loop terminates the run with a clear
              // message instead of burning retries here.
              if (stepErr.retryable === false || stepErr.code === 'daily_quota_exceeded'
                  || stepErr.code === 'no_credits' || stepErr.code === 'account_suspended') {
                throw stepErr;
              }
              // Body too large: aggressively truncate and retry once
              if (m.includes('too large') || m.includes('413')) {
                pageState = truncatePageState(pageState, 30000);
                error = (error ? error + ' | ' : '') + 'Page state was heavily truncated due to size limits.';
                continue;
              }
              // 429 (rate-limited): pause briefly and retry, with a friendlier label.
              // The agentLimiter window is 60s; retrying a few seconds later usually frees a slot.
              if (m.match(/\b429\b/) || /rate limit/i.test(m)) {
                if (attempt >= MAX_STEP_ATTEMPTS) throw stepErr;
                const errEntry = document.createElement('div');
                errEntry.className = 'step-entry failed';
                errEntry.innerHTML = `<div class="step-number">⏳</div><div class="step-body"><div class="step-action">Rate limit reached (retry ${attempt}/3)</div><div class="step-error">Too many steps in a short time. Pausing briefly…</div></div>`;
                stepLog.appendChild(errEntry);
                stepLog.scrollTop = stepLog.scrollHeight;
                // Backoff longer on 429 so we don't make it worse: 6s, 15s, 30s
                const waitMs = [6000, 15000, 30000][Math.min(attempt - 1, 2)];
                await sleep(waitMs);
                continue;
              }
              // 4xx (other than 413/429) are not retriable
              if (m.match(/\b(400|401|403|404)\b/)) throw stepErr;

              // If we reached max attempts, break out to let the error surface
              if (attempt >= MAX_STEP_ATTEMPTS) {
                break;
              }

              // Network disconnect / slow network / 504 gateway timeout / server 5xx:
              // Per user requirement: retry 3 times (attempt 1: wait 30s, attempt 2: wait 30s, attempt 3: wait 60s).
              const waitSec = attempt === 3 ? 60 : 30;
              const isNet = stepErr.isNetworkError || !navigator.onLine || m.includes('Failed to fetch') || m.includes('Network') || m.includes('connection') || m.includes('504') || m.includes('timeout');
              const errEntry = document.createElement('div');
              errEntry.className = 'step-entry failed network-retry-banner';
              errEntry.innerHTML = `<div class="step-number">${isNet ? '🌐' : '!'}</div><div class="step-body"><div class="step-action">${isNet ? 'Network slow or disconnected' : 'Server temporary error'} (reconnect attempt ${attempt}/3)</div><div class="step-error">Waiting <span class="net-countdown-val">${waitSec}</span>s before reconnecting…</div></div>`;
              stepLog.appendChild(errEntry);
              stepLog.scrollTop = stepLog.scrollHeight;

              // Countdown timer loop with early break if network comes back online
              let onlineResolved = false;
              const onlineHandler = () => { onlineResolved = true; };
              window.addEventListener('online', onlineHandler);

              for (let remaining = waitSec; remaining > 0; remaining--) {
                if (!isRunning || onlineResolved) break;
                const span = errEntry.querySelector('.net-countdown-val');
                if (span) span.textContent = remaining;
                await sleep(1000);
              }
              window.removeEventListener('online', onlineHandler);

              if (errEntry && errEntry.parentNode) {
                errEntry.remove();
              }
            }
          }
          if (!nextData) throw lastErr || new Error('Failed to get next step after retries');
          serverErrorStreak = 0; // reset on success

          // The agent just persisted a Tool (origin=agent) on the server.
          // Force ToolManager to resync so a follow-up `useTool` in this same
          // task can find the new content script locally without waiting for
          // the next periodic poll.
          if (nextData.toolCreated) {
            try {
              await sendToBackground('ge-sync-tools', { force: true });
            } catch (syncErr) {
              console.warn('[Global Executive] tool resync after createTool failed');
            }
          }

          if (nextData.usage) {
            updateCreditsDisplay(nextData.usage.creditsRemaining);
            taskCredits.textContent = nextData.usage.totalTaskCredits.toFixed(2) + ' credits';
          }

          // Refresh the milestones panel from the authoritative server state.
          if (nextData.goalLedger) renderGoalLedger(nextData.goalLedger);

          if (nextData.done) {
            renderDoneStep(nextData.summary || 'Task completed');
            updateTaskStatus('completed');
            if (nextData.storedData && Object.keys(nextData.storedData).length > 0) {
              showStoredData(nextData.storedData);
            }
            isRunning = false;
            setSendingState(false);
            stopKeepAlive();
            await loadTaskHistory();
            sendToBackground('ge-clear-staged-files').catch(() => {});
            return;
          }

          // Render the next step
          step = nextData.step;
          taskStepCounter.textContent = `Step ${step.stepNumber}/${currentTierMaxSteps}`;
          renderStep(step);
          try { window.AgentOverlay?.highlightStep(currentTabId, step, step.stepNumber, currentTierMaxSteps, 'live'); } catch {}

          // Update tab tracker
          updateTabTracker(
            trackedTabs.map((t, i) => ({
              url: pageState?.url || '', title: pageState?.title || '', status: t.status || 'active'
            })),
            activeTabIndex
          );

        } catch (serverErr) {
          console.error('[Global Executive] Server error after retries:', serverErr);
          let msg = serverErr.message || 'Unknown server error';
          if (msg.match(/\b429\b/) || /rate limit/i.test(msg)) {
            msg = 'Step rate limit reached for your plan. Wait ~1 minute and resume, or upgrade your plan for a higher steps-per-minute cap.';
          }
          renderDoneStep('Stopped: ' + msg);
          updateTaskStatus('failed');
          isRunning = false;
          setSendingState(false);
          stopKeepAlive();
          sendToBackground('ge-clear-staged-files').catch(() => {});
          return;
        }
      }
    } catch (loopErr) {
      console.error('[Global Executive] Loop error:', loopErr);
      removeExecutingIndicator();
      renderDoneStep('Error: ' + loopErr.message);
      updateTaskStatus('failed');
      isRunning = false;
      setSendingState(false);
      stopKeepAlive();
      sendToBackground('ge-clear-staged-files').catch(() => {});
    }
  }

  // ============================================
  // AskUser / Confirm Modals (returns Promise<string> resolving to reply or '__stopped__')
  // ============================================
  // Poll for remote (Telegram/WhatsApp) replies while a modal is open
  let remoteReplyPoller = null;
  function startRemoteReplyPolling(onReply) {
    stopRemoteReplyPolling();
    if (!currentTaskId) return;
    remoteReplyPoller = setInterval(async () => {
      try {
        const data = await NewOrderAPI.request(`/api/agent/pending-reply/${currentTaskId}`);
        if (data?.reply) {
          stopRemoteReplyPolling();
          onReply(data.reply, data.source);
        }
      } catch { /* keep polling */ }
    }, 4000);
  }
  function stopRemoteReplyPolling() {
    if (remoteReplyPoller) clearInterval(remoteReplyPoller);
    remoteReplyPoller = null;
  }

  function showAskUserModal(question, choices) {
    return new Promise((resolve) => {
      pendingUserReplyResolver = resolve;
      const modal = document.getElementById('askuser-modal');
      const qEl = document.getElementById('askuser-question');
      const choicesEl = document.getElementById('askuser-choices');
      const replyEl = document.getElementById('askuser-reply');
      qEl.textContent = question;
      replyEl.value = '';
      choicesEl.innerHTML = '';
      (choices || []).forEach(choice => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = choice;
        btn.addEventListener('click', () => {
          stopRemoteReplyPolling();
          modal.style.display = 'none';
          if (pendingUserReplyResolver) { const r = pendingUserReplyResolver; pendingUserReplyResolver = null; r(choice); }
        });
        choicesEl.appendChild(btn);
      });
      modal.style.display = 'flex';
      setTimeout(() => replyEl.focus(), 50);
      // Auto-resolve via remote reply
      startRemoteReplyPolling((reply, source) => {
        modal.style.display = 'none';
        if (pendingUserReplyResolver) {
          const r = pendingUserReplyResolver; pendingUserReplyResolver = null;
          showInlineNotice(`Reply received via ${source}: "${reply.substring(0, 80)}"`, 'info');
          r(reply);
        }
      });
    });
  }

  function showConfirmModal(summary, pendingAction) {
    return new Promise((resolve) => {
      pendingUserReplyResolver = resolve;
      const modal = document.getElementById('confirm-modal');
      document.getElementById('confirm-summary').textContent = summary;
      document.getElementById('confirm-action-detail').textContent = pendingAction
        ? JSON.stringify(pendingAction, null, 2)
        : '';
      modal.style.display = 'flex';
      // Remote replies of "approve" / "reject" / "yes" / "no" auto-resolve
      const handleRemote = (reply, source) => {
        const norm = reply.trim().toLowerCase();
        const decision = (['approve', 'approved', 'yes', 'y', 'ok', 'confirm'].includes(norm)) ? 'approve'
                       : (['reject', 'rejected', 'no', 'n', 'cancel', 'deny'].includes(norm)) ? 'reject'
                       : null;
        if (!decision) {
          showInlineNotice(`${source} reply unclear: "${reply}". Reply approve/reject.`, 'warning');
          startRemoteReplyPolling(handleRemote);
          return;
        }
        modal.style.display = 'none';
        if (pendingUserReplyResolver) {
          const r = pendingUserReplyResolver; pendingUserReplyResolver = null;
          showInlineNotice(`Decision via ${source}: ${decision}`, 'info');
          r(decision);
        }
      };
      startRemoteReplyPolling(handleRemote);
    });
  }

  function setupModalHandlers() {
    // Plan modal
    document.getElementById('btn-approve-plan')?.addEventListener('click', approvePlanAndStart);
    document.getElementById('btn-cancel-plan')?.addEventListener('click', () => {
      hidePlanModal();
      setSendingState(false);
      // Cancel the pending task on the server
      if (pendingTaskContext?.taskId) {
        NewOrderAPI.request('/api/agent/stop', {
          method: 'POST',
          body: JSON.stringify({ taskId: pendingTaskContext.taskId })
        }).catch(() => { /* ignore */ });
      }
      pendingTaskContext = null;
      // Return to welcome screen so the half-rendered user bubble doesn't
      // linger as if the task had started.
      taskView.style.display = 'none';
      welcomeScreen.style.display = 'flex';
      stepLog.innerHTML = '';
      hideMilestonesPanel();
    });

    // AskUser modal
    document.getElementById('btn-askuser-send')?.addEventListener('click', () => {
      const reply = document.getElementById('askuser-reply').value.trim();
      if (!reply) return;
      stopRemoteReplyPolling();
      document.getElementById('askuser-modal').style.display = 'none';
      if (pendingUserReplyResolver) { const r = pendingUserReplyResolver; pendingUserReplyResolver = null; r(reply); }
    });
    document.getElementById('btn-askuser-stop')?.addEventListener('click', () => {
      stopRemoteReplyPolling();
      document.getElementById('askuser-modal').style.display = 'none';
      if (pendingUserReplyResolver) { const r = pendingUserReplyResolver; pendingUserReplyResolver = null; r('__stopped__'); }
    });

    // Confirm modal
    document.getElementById('btn-confirm-approve')?.addEventListener('click', () => {
      stopRemoteReplyPolling();
      document.getElementById('confirm-modal').style.display = 'none';
      if (pendingUserReplyResolver) { const r = pendingUserReplyResolver; pendingUserReplyResolver = null; r('approve'); }
    });
    document.getElementById('btn-confirm-reject')?.addEventListener('click', () => {
      stopRemoteReplyPolling();
      document.getElementById('confirm-modal').style.display = 'none';
      if (pendingUserReplyResolver) { const r = pendingUserReplyResolver; pendingUserReplyResolver = null; r('reject'); }
    });
  }

  // Polls /api/integrations/inbox every 20s while agent page is idle.
  // If a queued prompt arrives from Telegram/WhatsApp, drop it into the textarea
  // ============================================
  // Panel-presence heartbeat
  // --------------------------------------------
  // Writes `ge_panel_active_at` to chrome.storage.session every 5s while the
  // panel is open. The background service worker's agent-loop reads this
  // value; if it's fresh (<15s old) the worker skips its tick entirely so
  // we don't double-drive the same task. The key lives in session storage
  // so it is automatically cleared when the browser restarts (no stale
  // locks after a crash).
  // ============================================
  function startPanelPresenceHeartbeat() {
    const write = () => {
      try {
        if (chrome?.storage?.session) {
          chrome.storage.session.set({ ge_panel_active_at: Date.now() });
        }
      } catch { /* ignore */ }
    };
    write();
    setInterval(write, 5000);
    // Best-effort clear on tab unload (not guaranteed to fire, but helpful).
    window.addEventListener('beforeunload', () => {
      try { chrome?.storage?.session?.remove?.('ge_panel_active_at'); } catch {}
    });
  }

  // and auto-start (auto-pilot, since the user is remote).
  function setupInboxPolling() {
    let lastChecked = 0;
    let backoffUntil = 0; // pauses polling after 429s
    const POLL_MS = 20000;
    const tick = async () => {
      // Don't poll while a task is running or modal is open
      if (isRunning || pendingTaskContext) return;
      if (Date.now() < backoffUntil) return;
      if (Date.now() - lastChecked < POLL_MS - 500) return;
      lastChecked = Date.now();
      try {
        const data = await NewOrderAPI.request('/api/integrations/inbox');
        if (data?.queuedPrompt) {
          const prompt = data.queuedPrompt;
          showInlineNotice(`Task received from ${data.source || 'remote'}: starting in auto-pilotâ€¦`, 'info');
          // Force auto-pilot for remote-triggered tasks (user isn't watching)
          selectedMode = 'autopilot';
          const toggle = document.getElementById('mode-toggle');
          if (toggle) {
            toggle.dataset.mode = 'autopilot';
            toggle.querySelectorAll('.mode-option').forEach(b => b.classList.toggle('active', b.dataset.mode === 'autopilot'));
          }
          // Mark as remote-triggered so plan modal can auto-approve when possible
          window._geNTR = true;
          // If the server flagged a resume pointer (session persistence on
          // the paid tier), thread the new prompt onto that prior session.
          startTask(prompt, data.resumeFromTaskId ? { resumeFromTaskId: data.resumeFromTaskId } : {});
        }
      } catch (err) {
        const m = err?.message || '';
        if (m.match(/\b429\b/) || /rate limit/i.test(m)) {
          // Stop polling for 2 minutes to give the limiter time to drain.
          backoffUntil = Date.now() + 120000;
          console.warn('[Inbox poll] rate limited, backing off 2m');
        }
        /* otherwise ignore */
      }
    };
    setInterval(tick, POLL_MS);
    // Run once shortly after init
    setTimeout(tick, 3000);
  }

  function setupStageFileButton() {
    const btn = document.getElementById('btn-stage-file');
    const input = document.getElementById('stage-file-input');
    if (!btn || !input) return;
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataURL(file);
        const ref = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        await sendToBackground('ge-stage-file', {
          ref,
          name: file.name,
          mimeType: file.type,
          dataUrl
        });
        alert(`Staged "${file.name}" as ref:${ref}\nThe agent can now use uploadFile with ref="${ref}".`);
      } catch (err) {
        alert('Failed to stage file: ' + (err.message || err));
      } finally {
        input.value = '';
      }
    });
  }

  function setupModeToggle() {
    const toggle = document.getElementById('mode-toggle');
    if (!toggle) return;

    const slider = toggle.querySelector('.slider');
    const options = toggle.querySelectorAll('.mode-option');
    const tooltip = document.getElementById('mode-tooltip');

    function updateSlider() {
      const activeBtn = toggle.querySelector('.mode-option.active');
      if (!activeBtn || !slider) return;

      const toggleRect = toggle.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();

      const offsetLeft = btnRect.left - toggleRect.left;
      const width = btnRect.width;

      slider.style.width = width + 'px';
      slider.style.transform = `translateX(${offsetLeft}px)`;
    }

    // Set initial position
    setTimeout(updateSlider, 0);

    // Update on window resize
    window.addEventListener('resize', updateSlider);

    // Tooltip handling
    options.forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        const tooltipText = btn.dataset.tooltip;
        if (tooltipText && tooltip) {
          tooltip.textContent = tooltipText;
          tooltip.classList.add('visible');
        }
      });

      btn.addEventListener('mouseleave', () => {
        if (tooltip) {
          tooltip.classList.remove('visible');
        }
      });
    });

    options.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (!mode) return;
        selectedMode = mode;
        toggle.dataset.mode = mode;
        toggle.querySelectorAll('.mode-option').forEach(b => b.classList.toggle('active', b === btn));
        updateSlider();

        // Toggle autopilot background
        if (mode === 'autopilot') {
          document.body.classList.add('autopilot-mode');
        } else {
          document.body.classList.remove('autopilot-mode');
        }
      });
    });
  }

  // ============================================
  // Stop Task
  // ============================================
  async function stopTask() {
    if (!currentTaskId) return;
    const taskId = currentTaskId;

    // ============================================
    // "Cancelled but actually done" detector.
    // Before we cancel the task, ask the server whether the agent's last
    // thoughts indicate it was about to call `done` but never quite got
    // there (a common failure mode that otherwise loses the task to the
    // skill-mining pipeline). If the heuristic fires, we offer the user
    // a one-click "save as completed" instead of cancelling.
    // ============================================
    let detection = null;
    try {
      detection = await NewOrderAPI.request(`/api/agent/tasks/${taskId}/finalize-if-done`, {
        method: 'POST',
        body: JSON.stringify({ dryRun: true })
      });
    } catch (err) {
      // Non-fatal â€” fall through to a normal cancel.
      console.warn('[Global Executive] finalize-if-done check failed:', err.message);
    }

    if (detection && detection.detected && !detection.alreadyFinal) {
      const confirmFinalize = window.confirm(
        'It looks like the agent finished this task but didn\'t mark it complete.\n\n' +
        'Inferred summary:\n' +
        (detection.inferredSummary || '(none)') +
        '\n\nClick OK to save as âœ… Completed, or Cancel to cancel the task as usual.'
      );
      if (confirmFinalize) {
        try {
          isRunning = false;
          await NewOrderAPI.request(`/api/agent/tasks/${taskId}/finalize-if-done`, {
            method: 'POST',
            body: JSON.stringify({ confirm: true })
          });
          removeExecutingIndicator();
          updateTaskStatus('completed');
          renderDoneStep('Task marked as completed (auto-finalized).');
          setSendingState(false);
          await loadTaskHistory();
          stopKeepAlive();
          sendToBackground('ge-clear-staged-files').catch(() => {});
          return;
        } catch (err) {
          console.error('[Global Executive] auto-finalize failed:', err);
          // Fall through to plain cancel below.
        }
      }
    }

    isRunning = false;
    try {
      await NewOrderAPI.request('/api/agent/stop', {
        method: 'POST',
        body: JSON.stringify({ taskId })
      });
    } catch (err) {
      console.error('[Global Executive] Stop error:', err);
    }

    removeExecutingIndicator();
    updateTaskStatus('cancelled');
    renderDoneStep('Task cancelled by user');
    setSendingState(false);
    await loadTaskHistory();
    stopKeepAlive();
    // Clean up staged files
    sendToBackground('ge-clear-staged-files').catch(() => {});
  }

  async function stopTaskById(taskId) {
    try {
      await NewOrderAPI.request('/api/agent/stop', {
        method: 'POST',
        body: JSON.stringify({ taskId })
      });
      // If we stopped the currently-wired task, clear state
      if (taskId === currentTaskId) {
        isRunning = false;
        removeExecutingIndicator();
        updateTaskStatus('cancelled');
        renderDoneStep('Task cancelled by user');
        setSendingState(false);
        setCurrentTaskId(null);
        stopKeepAlive();
        sendToBackground('ge-clear-staged-files').catch(() => {});
      }
    } catch (err) {
      console.error('[Global Executive] Stop by ID error:', err);
      alert('Failed to stop task: ' + err.message);
    }
  }

  // ============================================
  // Communication with background.js
  // ============================================
  // Snapshot of the user's browser environment to send with every agent
  // request. The server uses this to render the ENVIRONMENT block in the
  // system prompt so the AI knows the OS, browser version, locale and
  // timezone. Cheap to compute; safe to call on every step.
  function getBrowserEnv() {
    let timezone = '';
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
    // Viewport: best-effort. The agent panel runs in a side panel, so window
    // here reflects the panel â€” but we want the actual browsing viewport.
    // Fall back to screen.avail* which approximates the visible browser area.
    let viewport;
    try {
      const w = (typeof window !== 'undefined' && (window.screen?.availWidth || window.innerWidth)) || 0;
      const h = (typeof window !== 'undefined' && (window.screen?.availHeight || window.innerHeight)) || 0;
      if (w > 0 && h > 0) viewport = { width: w, height: h };
    } catch {}
    return {
      userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
      locale: (typeof navigator !== 'undefined' && (navigator.language || (navigator.languages && navigator.languages[0]))) || '',
      timezone,
      online: (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') ? navigator.onLine : undefined,
      ...(viewport ? { viewport } : {})
    };
  }

  function sendToBackground(type, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function isRestrictedContextUrl(url) {
    if (!url || typeof url !== 'string') return true;
    const u = url.trim().toLowerCase();
    if (!/^https?:\/\//i.test(u)) return true;
    if (u.includes('chromewebstore.google.com') ||
        u.includes('chrome.google.com/webstore') ||
        u.includes('microsoftedge.microsoft.com/addons') ||
        u.includes('addons.mozilla.org')) {
      return true;
    }
    return false;
  }

  async function getAgentContext() {
    const allTabs = await chrome.tabs.query({});
    const webTabs = allTabs.filter(t => t.url && !isRestrictedContextUrl(t.url));

    // Prefer any active web tab, then the first available web tab.
    const activeTab =
      webTabs.find(t => t.active) ||
      webTabs[0] ||
      null;

    return { activeTab, allTabs: webTabs };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Truncate page state client-side to prevent body-too-large errors
  function truncatePageState(pageState, maxChars) {
    if (!pageState) return pageState;
    const str = JSON.stringify(pageState);
    if (str.length <= maxChars) return pageState;

    // Aggressively trim fields while preserving structure
    const trimmed = {
      url: pageState.url || '',
      title: pageState.title || ''
    };

    if (pageState.visibleText) {
      trimmed.visibleText = pageState.visibleText.substring(0, Math.floor(maxChars * 0.4));
    }
    if (pageState.links && Array.isArray(pageState.links)) {
      trimmed.links = pageState.links.slice(0, 20);
    }
    if (pageState.buttons && Array.isArray(pageState.buttons)) {
      trimmed.buttons = pageState.buttons.slice(0, 10);
    }
    if (pageState.inputs && Array.isArray(pageState.inputs)) {
      trimmed.inputs = pageState.inputs.slice(0, 10);
    }
    if (pageState.forms && Array.isArray(pageState.forms)) {
      trimmed.forms = pageState.forms.slice(0, 3);
    }
    if (pageState.images && Array.isArray(pageState.images)) {
      trimmed.images = pageState.images.slice(0, 5);
    }
    if (pageState.tables && Array.isArray(pageState.tables)) {
      trimmed.tables = pageState.tables.slice(0, 2);
    }
    if (pageState.headings && Array.isArray(pageState.headings)) {
      trimmed.headings = pageState.headings.slice(0, 10);
    }
    trimmed._truncated = true;

    // If still too large, keep only URL, title, and a tiny text snippet
    if (JSON.stringify(trimmed).length > maxChars) {
      return {
        url: trimmed.url,
        title: trimmed.title,
        visibleText: (trimmed.visibleText || '').substring(0, Math.floor(maxChars * 0.3)),
        _truncated: true
      };
    }
    return trimmed;
  }

  // MV3 Service Worker keep-alive: open a long-lived port so the SW doesn't idle-die mid-task
  function startKeepAlive() {
    if (keepAlivePort) return;
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'ge-keep-alive' });
      keepAlivePort.onDisconnect.addListener(() => {
        keepAlivePort = null;
      });
    } catch (e) {
      console.warn('[Global Executive] Keep-alive port failed:', e.message);
    }
  }

  function stopKeepAlive() {
    if (keepAlivePort) {
      try { keepAlivePort.disconnect(); } catch (e) { /* ignore */ }
      keepAlivePort = null;
    }
  }

  // ============================================
  // Reset to Welcome Screen
  // ============================================
  async function resetToWelcome() {
    // Stop current task if running
    if (isRunning && currentTaskId) {
      await stopTask();
    }
    setCurrentTaskId(null);
    isRunning = false;
    setSendingState(false);
    removeExecutingIndicator();

    taskView.style.display = 'none';
    welcomeScreen.style.display = 'flex';
    stepLog.innerHTML = '';
    taskInput.value = '';
    taskInput.style.height = 'auto';
    tabTracker.innerHTML = '';
    storedDataPanel.style.display = 'none';
  }

  // ============================================
  // Event Handlers
  // ============================================
  function setupEventHandlers() {
    // Slash commands autocomplete
    setupSlashCommandsAutocomplete(taskInput, slashPopup, AGENT_SLASH_COMMANDS, (cmd) => handleSlashCommand(cmd));

    // Delegate click on command chips & skill prompts
    document.addEventListener('click', (e) => {
      const skillBtn = e.target.closest('[data-skill-prompt]');
      if (skillBtn) {
        e.preventDefault();
        const prompt = skillBtn.dataset.skillPrompt;
        if (prompt) {
          taskInput.value = prompt;
          taskInput.style.height = 'auto';
          taskInput.style.height = Math.min(taskInput.scrollHeight, 120) + 'px';
          handleUserSubmit(prompt);
        }
        return;
      }

      const chip = e.target.closest('[data-cmd]');
      if (chip) {
        e.preventDefault();
        const cmd = chip.dataset.cmd;
        if (cmd) {
          if (cmd.startsWith('/')) {
            if (cmd.includes('<') || cmd.endsWith(' ')) {
              taskInput.value = cmd.replace(/<[^>]+>/g, '').trim() + ' ';
              taskInput.focus();
            } else {
              handleSlashCommand(cmd);
            }
          } else {
            taskInput.value = cmd;
            handleUserSubmit(cmd);
          }
        }
      }
    });

    // Send button
    btnSend.addEventListener('click', () => {
      const prompt = taskInput.value.trim();
      if (prompt) handleUserSubmit(prompt);
    });

    // Enter to send (Shift+Enter for newline)
    taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        // If autocomplete popup is active, keydown is handled by setupSlashCommandsAutocomplete
        if (slashPopup && slashPopup.style.display === 'flex') return;
        e.preventDefault();
        const prompt = taskInput.value.trim();
        if (prompt) handleUserSubmit(prompt);
      }
    });

    // Task-id chip: click to copy full ObjectId.
    taskIdChip?.addEventListener('click', async () => {
      const full = taskIdChip.dataset.fullId || '';
      if (!full) return;
      try {
        await navigator.clipboard.writeText(full);
        taskIdChip.classList.add('copied');
        setTimeout(() => taskIdChip.classList.remove('copied'), 900);
      } catch { /* clipboard may be denied; no-op */ }
    });

    // Auto-resize textarea
    taskInput.addEventListener('input', () => {
      taskInput.style.height = 'auto';
      taskInput.style.height = Math.min(taskInput.scrollHeight, 120) + 'px';
    });

    // Stop button
    btnStopTask.addEventListener('click', stopTask);

    // New Task button (task header)
    document.getElementById('btn-new-task')?.addEventListener('click', resetToWelcome);

    // New Task button (navbar)
    document.getElementById('btn-new-task-nav')?.addEventListener('click', resetToWelcome);

    // New Task button (sidebar)
    document.getElementById('sidebar-new-task')?.addEventListener('click', () => {
      historySidebar.classList.remove('open');
      resetToWelcome();
    });

    // Example prompts
    document.querySelectorAll('.example-prompt').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt;
        if (prompt) {
          taskInput.value = prompt;
          taskInput.style.height = 'auto';
          taskInput.style.height = Math.min(taskInput.scrollHeight, 120) + 'px';
          taskInput.focus();
        }
      });
    });

    // History sidebar toggle
    document.getElementById('btn-toggle-history').addEventListener('click', () => {
      historySidebar.classList.toggle('open');
    });
    document.getElementById('history-close').addEventListener('click', () => {
      historySidebar.classList.remove('open');
    });

    // Stored data panel toggle
    document.getElementById('btn-toggle-data')?.addEventListener('click', () => {
      dataPanelBody.style.display = dataPanelBody.style.display === 'none' ? 'block' : 'none';
    });

    // Captured files panel toggle
    document.getElementById('btn-toggle-captured')?.addEventListener('click', () => {
      if (capturedPanelBody) capturedPanelBody.style.display = capturedPanelBody.style.display === 'none' ? 'block' : 'none';
    });

    // Settings button - navigate to settings page
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/settings.html') });
    });

    // User info (credits/name) - navigate to billing page
    userInfo?.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/billing.html') });
    });
  }

  // ============================================
  // Boot
  // ============================================
  setupAuth();
  setupEventHandlers();
  bindMilestoneToggle();
  init();

})();

