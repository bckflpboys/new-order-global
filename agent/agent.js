// Global Executive — Agent UI Controller
// Manages the agent loop: start task -> get action -> execute via background -> report result -> loop

(function () {
  'use strict';

  // ============================================
  // State
  // ============================================
  let currentTaskId = null;
  let isRunning = false;
  let selectedModelId = null;
  let availableModels = [];
  let currentTierMaxSteps = 50;
  let keepAlivePort = null; // MV3 SW keep-alive
  let selectedMode = 'copilot'; // 'copilot' | 'autopilot'
  let pendingTaskContext = null; // { taskId, plan, requiredInputs, permissionsRequested, allTabs, activeTab }
  let pendingUserReplyResolver = null; // Promise resolver for askUser/confirmAction modals

  // DOM References
  const welcomeScreen = document.getElementById('welcome-screen');
  const taskView = document.getElementById('task-view');
  const taskInput = document.getElementById('task-input');
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
  const historySidebar = document.getElementById('history-sidebar');
  const historyList = document.getElementById('history-list');
  const userInfo = document.getElementById('user-info');
  const userName = document.getElementById('user-name');
  const userPlan = document.getElementById('user-plan');
  const authModal = document.getElementById('auth-modal');
  const loadingOverlay = document.getElementById('initial-loading-overlay');
  const modelSelectorContainer = document.getElementById('model-selector-container');

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

      hideLoading();
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
      const errorEl = document.getElementById('register-error');

      try {
        errorEl.style.display = 'none';
        await NewOrderAPI.register(email, password, name);
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
      if (m.name.toLowerCase().includes('reasoning') || m.name.toLowerCase().includes('sonnet')) tags.push('<span class="model-tag reasoning">Reasoning</span>');
      if (m.name.toLowerCase().includes('vision')) tags.push('<span class="model-tag vision">Vision</span>');
      if (m.tier === 'free') tags.push('<span class="model-tag fast">Fast</span>');
      if (m.tier === 'premium') tags.push('<span class="model-tag full">Full</span>');

      return `
        <div class="model-card ${isSelected ? 'selected' : ''}" data-id="${m.id}">
          <div class="model-card-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M12,2A10,10,0,0,0,2,12a9.89,9.89,0,0,0,2.26,6.33l-2,2a1,1,0,0,0,1.42,1.42l2-2A9.94,9.94,0,0,0,12,22a10,10,0,0,0,0-20Zm0,18a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z"/>
              <circle cx="8.5" cy="11.5" r="1.5"/><circle cx="15.5" cy="11.5" r="1.5"/><path d="M8,15a4,4,0,0,0,8,0H8Z"/>
            </svg>
          </div>
          <div class="model-card-info">
            <div class="model-card-name">${m.name}</div>
            <div class="model-card-tags">${tags.join('')}</div>
          </div>
          ${isSelected ? '<div class="model-card-check"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div>' : ''}
        </div>
      `;
    }).join('');

    list.querySelectorAll('.model-card').forEach(card => {
      card.addEventListener('click', async () => {
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
        const isRunning = ['running', 'planning'].includes(t.status);
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

      const task = data.task;

      // Wire up the viewed task so stop works on it
      currentTaskId = task.id;
      isRunning = ['running', 'planning'].includes(task.status);
      setSendingState(isRunning);

      showTaskView(task.title);
      updateTaskStatus(task.status);
      taskStepCounter.textContent = `${task.currentStepNumber}/${task.maxSteps} steps`;
      taskCredits.textContent = task.totalCreditsUsed.toFixed(2) + ' credits';

      stepLog.innerHTML = '';
      // Show original prompt as a user bubble so the replay reads as a chat thread.
      if (task.originalPrompt) renderUserPromptBubble(task.originalPrompt);
      // Restore milestone state BEFORE step replay so per-step milestone updates
      // animate naturally as we walk forward.
      if (task.goalLedger) renderGoalLedger(task.goalLedger);
      task.steps.forEach(step => {
        renderStep(step);
      });

      if (task.summary) {
        renderDoneStep(task.summary);
      }

      updateTabTracker(task.trackedTabs, task.activeTabIndex);

      if (task.storedData && Object.keys(task.storedData).length > 0) {
        showStoredData(task.storedData);
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
    tabTracker.innerHTML = '';
    hideMilestonesPanel();
  }

  // ============================================
  // Send-button state helper
  //   true  → disabled + animated "sending" appearance + spinner icon
  //   false → idle, ready to accept the next prompt
  // ============================================
  function setSendingState(flag) {
    if (!btnSend) return;
    btnSend.disabled = !!flag;
    btnSend.classList.toggle('sending', !!flag);
    btnSend.title = flag ? 'Working…' : 'Start Task';
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
      warn.innerHTML = `⚠️ Stuck score ${ledger.stuckScore}/5 — agent is being nudged to change approach.`;
      els.panel.insertBefore(warn, els.list);
    }
  }

  function bindMilestoneToggle() {
    const { panel, header, toggle } = getMilestonesEls();
    if (!panel || !header) return;
    const flip = (e) => {
      // Only toggle if user clicked header background or the toggle button —
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
        // Re-render markdown each tick — small enough text for this to be cheap.
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
    btnStopTask.style.display = ['running', 'planning'].includes(status) ? 'flex' : 'none';
  }

  function renderStep(step) {
    // Special rendering for message actions — stream the text in word-by-word
    // so the user sees the agent "typing" rather than a sudden bubble pop.
    if (step.action === 'message') {
      const msgEl = document.createElement('div');
      msgEl.className = 'step-message';
      stepLog.appendChild(msgEl);
      scrollToBottom();
      streamMarkdownInto(msgEl, step.params?.text || step.thought || '');
      return;
    }

    // Special rendering for think actions — bubble + animated dots, with the
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
  // Agent Loop
  // ============================================
  async function startTask(prompt) {
    if (isRunning) return;

    const trimmed = prompt.trim();
    if (trimmed.length < 10) {
      alert('Please describe the task in more detail.');
      return;
    }

    setSendingState(true);
    // Show the user's prompt as a chat bubble immediately so they get instant
    // feedback that their message landed. We swap to the task view first so
    // the bubble lands in step-log even if the welcome screen is still up.
    showTaskView(trimmed.length > 60 ? trimmed.substring(0, 57) + '…' : trimmed);
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
          ...getBrowserEnv()
        })
      });

      if (planData.usage) updateCreditsDisplay(planData.usage.creditsRemaining);

      // Save context for later submission
      pendingTaskContext = {
        taskId: planData.taskId,
        plan: planData.plan,
        taskType: planData.taskType || 'action',
        requiredInputs: planData.requiredInputs || [],
        permissionsRequested: planData.permissionsRequested || {},
        mode: selectedMode,
        prompt: trimmed,
        activeTab,
        allTabs
      };
      currentTierMaxSteps = planData.tier?.maxSteps || 50;

      // Plan ready — dismiss the planning bubble before showing the modal.
      const pb = document.getElementById('ge-planning-bubble');
      if (pb) pb.remove();
      // Show plan + briefing modal; user clicks Approve or Cancel
      showPlanModal(pendingTaskContext);
    } catch (err) {
      console.error('[Global Executive] Plan error:', err);
      const pb = document.getElementById('ge-planning-bubble');
      if (pb) pb.remove();
      setSendingState(false);
      if (err.message?.includes('already have') && err.message?.includes('running')) {
        await loadTaskHistory();
        historySidebar.classList.add('open');
        showInlineNotice('You have running tasks. Stop one in the sidebar (×) before starting another.', 'warning');
      } else if (err.status === 504 || err.status === 502 || err.status === 503 || err.retryable) {
        // The api-client already retried up to 3 times — upstream is genuinely
        // overloaded. Tell the user it's transient and let them retry.
        showInlineNotice(
          'The planner is overloaded right now (gateway timeout). I retried a few times but the server kept timing out. Please try again in a moment, or pick a faster model.',
          'warning'
        );
      } else if (err.message?.includes('Unexpected token') || err.message?.includes('not valid JSON')) {
        // Defensive: should no longer happen now that api-client parses
        // non-JSON bodies safely, but keep a friendly fallback.
        showInlineNotice('The server returned an unexpected response. Please try again.', 'warning');
      } else {
        showInlineNotice('Failed to plan task: ' + err.message, 'error');
      }
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
      research: { icon: '🔬', label: 'Research task', cls: 'tasktype-research', tip: 'The agent will gather and cross-reference sources before reporting. Done is gated until ≥2 distinct source domains are recorded.' },
      mixed:    { icon: '🔀', label: 'Mixed (research + action)', cls: 'tasktype-mixed', tip: 'The agent will research first, then act. The same source-count gate applies.' },
      action:   { icon: '⚙️', label: 'Action task', cls: 'tasktype-action', tip: 'The agent will execute on a site. No source-count gate.' }
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
      `<div>• <a href="${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(s)}</a></div>`
    ).join('') || '<em>None identified</em>';
    const risksEl = document.getElementById('plan-risks');
    risksEl.innerHTML = (ctx.plan?.risks || []).length
      ? '<h3>Risks</h3>' + ctx.plan.risks.map(r => `<div>⚠ ${escapeHtml(r)}</div>`).join('')
      : '';

    // Briefing form
    const briefingSection = document.getElementById('briefing-section');
    const briefingForm = document.getElementById('briefing-form');
    briefingForm.innerHTML = '';
    if (ctx.requiredInputs && ctx.requiredInputs.length) {
      briefingSection.style.display = 'block';
      ctx.requiredInputs.forEach(inp => {
        briefingForm.appendChild(buildBriefingField(inp));
      });
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
    if (window.__geNextTaskIsRemote && (!ctx.requiredInputs || ctx.requiredInputs.length === 0)) {
      window.__geNextTaskIsRemote = false;
      showInlineNotice('No briefing needed — auto-approving remote task.', 'info');
      setTimeout(() => approvePlanAndStart(), 200);
    } else if (window.__geNextTaskIsRemote) {
      // Has required inputs — the user must come back to the page. Notify them.
      window.__geNextTaskIsRemote = false;
      showInlineNotice('This task needs briefing inputs. Please fill them in to continue.', 'warning');
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
          <option value="">— Select —</option>
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

      currentTaskId = data.taskId;
      updateCreditsDisplay(data.usage.creditsRemaining);
      taskCredits.textContent = data.usage.totalTaskCredits.toFixed(2) + ' credits';
      currentTierMaxSteps = data.tier?.maxSteps || currentTierMaxSteps;
      taskStepCounter.textContent = `Step ${data.step.stepNumber}/${currentTierMaxSteps}`;

      // Reflect the initial milestone state if the agent set milestones in step 1.
      if (data.goalLedger) renderGoalLedger(data.goalLedger);
      renderStep(data.step);
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

    try {
      while (isRunning) {
        const { action, params, stepNumber } = step;

        // === Execute the action ===
        let result = null;
        let error = null;
        let pageState = null;

        removeExecutingIndicator();
        renderExecutingIndicator();

        try {
          if (action === 'done') {
            // Task complete
            removeExecutingIndicator();
            renderDoneStep(params?.summary || 'Task completed');
            updateTaskStatus('completed');
            isRunning = false;
            setSendingState(false);
            stopKeepAlive();
            await loadTaskHistory();
            sendToBackground('ge-clear-staged-files').catch(() => {});
            return;
          }

          if (action === 'think') {
            result = { success: true };
          } else if (action === 'message') {
            result = { success: true };
          } else if (action === 'rememberThis') {
            // Server handled the actual memory write — this is just a
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
              trackedTabs.push({ tabId: newTab.tabId, tabIndex: trackedTabs.length });
              currentTabId = newTab.tabId;
              activeTabIndex = trackedTabs.length - 1;
              result = { success: true, tabId: newTab.tabId, title: newTab.title || '' };
              // Wait for page load
              await sleep(2000);
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
                await sleep(500);
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
            if (params?.content) {
              // Download generated content
              await sendToBackground('ge-download-content', {
                content: params.content,
                filename: params.filename || 'download.txt',
                mimeType: params.mimeType || 'text/plain'
              });
            } else if (params?.url) {
              await sendToBackground('ge-download', {
                url: params.url,
                filename: params.filename
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
                await sleep(800);
              } else {
                error = r?.error || 'Navigation failed';
              }
            }
          } else if (action === 'goBack' || action === 'goForward' || action === 'reload') {
            const r = await sendToBackground('ge-' + action.replace('go', 'go-').toLowerCase(), { tabId: currentTabId });
            if (r?.success) {
              result = { success: true, url: r.url, title: r.title };
              await sleep(600);
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
              const lastEntry2 = stepLog.querySelector('.step-entry:last-of-type');
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
            const response = await sendToBackground('ge-execute-in-tab', {
              tabId: currentTabId,
              action,
              params
            });

            if (response?.success) {
              result = response.result;
            } else {
              error = response?.error || 'Action failed';
            }
          }
        } catch (actionErr) {
          error = actionErr.message || 'Action execution error';
          console.error('[Global Executive] Action error:', actionErr);
        }

        removeExecutingIndicator();

        // Update the last step's UI with result
        const lastEntry = stepLog.querySelector('.step-entry:last-of-type');
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
        if (['readPage', 'click', 'type', 'scroll', 'extract', 'waitForElement', 'select', 'pressKey', 'clear'].includes(action)) {
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
          while (attempt < 3 && !nextData) {
            attempt++;
            try {
              // Get a fresh snapshot of all browser tabs so the agent always
              // sees the current Chrome window state (not just the stale list
              // from task start). This is what `closeTab`/`switchTab` target.
              let liveTabs = [];
              try {
                const tabsResp = await sendToBackground('ge-list-tabs', {});
                if (tabsResp?.success && Array.isArray(tabsResp.tabs)) {
                  liveTabs = tabsResp.tabs.map(t => ({
                    index: t.index,
                    url: t.url,
                    title: t.title,
                    active: t.active
                  }));
                }
              } catch { /* best effort */ }

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
              // Body too large: aggressively truncate and retry once
              if (m.includes('too large') || m.includes('413')) {
                pageState = truncatePageState(pageState, 30000);
                error = (error ? error + ' | ' : '') + 'Page state was heavily truncated due to size limits.';
                continue;
              }
              // 429 (rate-limited): pause briefly and retry, with a friendlier label.
              // The agentLimiter window is 60s; retrying a few seconds later usually frees a slot.
              if (m.match(/\b429\b/) || /rate limit/i.test(m)) {
                const friendly = /rate limit/i.test(m)
                  ? m.replace(/^[^:]*:\s*/, '')
                  : 'Too many agent steps in a short time. Pausing briefly…';
                const errEntry = document.createElement('div');
                errEntry.className = 'step-entry failed';
                errEntry.innerHTML = `<div class="step-number">⏳</div><div class="step-body"><div class="step-action">Rate limit reached (attempt ${attempt}/3)</div><div class="step-error">${escapeHtml(friendly)}</div></div>`;
                stepLog.appendChild(errEntry);
                stepLog.scrollTop = stepLog.scrollHeight;
                // Backoff longer on 429 so we don't make it worse: 6s, 15s, 30s
                const waitMs = [6000, 15000, 30000][Math.min(attempt - 1, 2)];
                await sleep(waitMs);
                continue;
              }
              // 4xx (other than 413/429) are not retriable
              if (m.match(/\b(400|401|403|404)\b/)) throw stepErr;
              // 5xx / network: surface inline and retry up to 3 times
              const errEntry = document.createElement('div');
              errEntry.className = 'step-entry failed';
              errEntry.innerHTML = `<div class="step-number">!</div><div class="step-body"><div class="step-action">Server error (attempt ${attempt}/3)</div><div class="step-error">${escapeHtml(m)}</div></div>`;
              stepLog.appendChild(errEntry);
              await sleep(1000 * attempt); // backoff
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
              console.warn('[Global Executive] tool resync after createTool failed:', syncErr.message);
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
          showInlineNotice(`Task received from ${data.source || 'remote'}: starting in auto-pilot…`, 'info');
          // Force auto-pilot for remote-triggered tasks (user isn't watching)
          selectedMode = 'autopilot';
          const toggle = document.getElementById('mode-toggle');
          if (toggle) {
            toggle.dataset.mode = 'autopilot';
            toggle.querySelectorAll('.mode-option').forEach(b => b.classList.toggle('active', b.dataset.mode === 'autopilot'));
          }
          // Mark as remote-triggered so plan modal can auto-approve when possible
          window.__geNextTaskIsRemote = true;
          startTask(prompt);
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
    isRunning = false;

    try {
      await NewOrderAPI.request('/api/agent/stop', {
        method: 'POST',
        body: JSON.stringify({ taskId: currentTaskId })
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
        currentTaskId = null;
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
    // here reflects the panel — but we want the actual browsing viewport.
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

  async function getAgentContext() {
    const allTabs = await chrome.tabs.query({});
    const webTabs = allTabs.filter(t =>
      t.url &&
      !t.url.startsWith('chrome-extension://') &&
      !t.url.startsWith('chrome://') &&
      !t.url.startsWith('devtools://') &&
      !t.url.startsWith('edge://') &&
      !t.url.startsWith('brave://') &&
      !t.url.startsWith('about:')
    );

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
    currentTaskId = null;
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
    // Send button
    btnSend.addEventListener('click', () => {
      const prompt = taskInput.value.trim();
      if (prompt) startTask(prompt);
    });

    // Enter to send (Shift+Enter for newline)
    taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const prompt = taskInput.value.trim();
        if (prompt) startTask(prompt);
      }
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
