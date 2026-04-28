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
        const defaultModel = availableModels.find(m => m.isDefault) || availableModels[0];
        selectedModelId = defaultModel.id;
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
      card.addEventListener('click', () => {
        selectedModelId = card.dataset.id;
        renderModelSelector();
        document.getElementById('model-modal-overlay').classList.remove('active');
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
      btnSend.disabled = isRunning;

      showTaskView(task.title);
      updateTaskStatus(task.status);
      taskStepCounter.textContent = `${task.currentStepNumber}/${task.maxSteps} steps`;
      taskCredits.textContent = task.totalCreditsUsed.toFixed(2) + ' credits';

      stepLog.innerHTML = '';
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
  }

  function updateTaskStatus(status) {
    const badge = taskStatus;
    badge.className = `task-status-badge ${status}`;
    badge.querySelector('.status-text').textContent = status.charAt(0).toUpperCase() + status.slice(1);
    btnStopTask.style.display = ['running', 'planning'].includes(status) ? 'flex' : 'none';
  }

  function renderStep(step) {
    // Special rendering for message actions
    if (step.action === 'message') {
      const msgEl = document.createElement('div');
      msgEl.className = 'step-message';
      msgEl.textContent = step.params?.text || step.thought || '';
      stepLog.appendChild(msgEl);
      scrollToBottom();
      return;
    }

    // Special rendering for think actions
    if (step.action === 'think') {
      const thinkEl = document.createElement('div');
      thinkEl.className = 'step-thinking';
      thinkEl.innerHTML = `
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span>${escapeHtml(step.params?.reasoning || step.thought || 'Thinking...')}</span>
      `;
      stepLog.appendChild(thinkEl);
      scrollToBottom();
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
    }

    entry.innerHTML = `
      <div class="step-number">${step.stepNumber}</div>
      <div class="step-body">
        <div class="step-action"><span class="action-name">${escapeHtml(step.action)}</span></div>
        ${step.thought ? `<div class="step-thought">${escapeHtml(step.thought)}</div>` : ''}
        ${detailText ? `<div class="step-detail">${escapeHtml(detailText)}</div>` : ''}
        ${step.error ? `<div class="step-error">${escapeHtml(step.error)}</div>` : ''}
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
      <p>${escapeHtml(summary)}</p>
    `;
    stepLog.appendChild(doneEl);
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

  // ============================================
  // Agent Loop
  // ============================================
  async function startTask(prompt) {
    if (isRunning) return;
    isRunning = true;

    const trimmed = prompt.trim();
    if (trimmed.length < 10) {
      alert('Please describe the task in more detail.');
      isRunning = false;
      return;
    }

    taskInput.value = '';
    taskInput.style.height = 'auto';
    btnSend.disabled = true;

    showTaskView(trimmed.length > 60 ? trimmed.substring(0, 57) + '...' : trimmed);
    updateTaskStatus('running');
    startKeepAlive();

    try {
      // Get current web tabs (exclude extension pages)
      const { activeTab, allTabs } = await getAgentContext();

      // Call server to start task
      const data = await NewOrderAPI.request('/api/agent/start', {
        method: 'POST',
        body: JSON.stringify({
          prompt: trimmed,
          modelId: selectedModelId,
          tabUrl: activeTab?.url || '',
          tabTitle: activeTab?.title || '',
          allTabs: allTabs.map(t => ({ url: t.url, title: t.title, active: t.active }))
        })
      });

      currentTaskId = data.taskId;
      updateCreditsDisplay(data.usage.creditsRemaining);
      taskCredits.textContent = data.usage.totalTaskCredits.toFixed(2) + ' credits';
      currentTierMaxSteps = data.tier?.maxSteps || 50;
      taskStepCounter.textContent = `Step ${data.step.stepNumber}/${currentTierMaxSteps}`;

      // Render the first step
      renderStep(data.step);

      // Start the execution loop
      await executeLoop(data.step, activeTab?.id);

    } catch (err) {
      console.error('[Global Executive] Start error:', err);

      // If the server says we're at our concurrent-task limit, refresh
      // the history sidebar and open it so the user can stop a task.
      if (err.message?.includes('already have') && err.message?.includes('running')) {
        await loadTaskHistory();
        historySidebar.classList.add('open');
        renderDoneStep('You have running tasks. Stop one in the sidebar (&#10005;) before starting another.');
      } else {
        renderDoneStep('Error: ' + err.message);
      }

      updateTaskStatus('failed');
      isRunning = false;
      btnSend.disabled = false;
      stopKeepAlive();
    }
  }

  async function executeLoop(step, initialTabId) {
    let currentTabId = initialTabId || null;
    let trackedTabs = initialTabId ? [{ tabId: currentTabId, tabIndex: 0 }] : [];
    let activeTabIndex = initialTabId ? 0 : -1;

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
            btnSend.disabled = false;
            stopKeepAlive();
            await loadTaskHistory();
            return;
          }

          if (action === 'think') {
            result = { success: true };
          } else if (action === 'message') {
            result = { success: true };
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
            const targetIndex = params?.tabIndex ?? 0;
            if (targetIndex >= 0 && targetIndex < trackedTabs.length) {
              const targetTabId = trackedTabs[targetIndex].tabId;
              await sendToBackground('ge-switch-tab', { tabId: targetTabId });
              currentTabId = targetTabId;
              activeTabIndex = targetIndex;
              result = { success: true };
              await sleep(500);
            } else {
              error = `Tab index ${targetIndex} out of range (${trackedTabs.length} tabs)`;
            }
          } else if (action === 'closeTab') {
            const targetIndex = params?.tabIndex ?? 0;
            if (targetIndex >= 0 && targetIndex < trackedTabs.length) {
              await sendToBackground('ge-close-tab', { tabId: trackedTabs[targetIndex].tabId });
              trackedTabs[targetIndex].status = 'closed';
              result = { success: true };
            } else {
              error = `Tab index ${targetIndex} out of range`;
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

        // === Send result to server, get next action ===
        try {
          const nextData = await NewOrderAPI.request('/api/agent/step', {
            method: 'POST',
            body: JSON.stringify({
              taskId: currentTaskId,
              stepNumber,
              result: result || null,
              error: error || null,
              pageState: pageState || null,
              modelId: selectedModelId
            })
          });

          if (nextData.usage) {
            updateCreditsDisplay(nextData.usage.creditsRemaining);
            taskCredits.textContent = nextData.usage.totalTaskCredits.toFixed(2) + ' credits';
          }

          if (nextData.done) {
            renderDoneStep(nextData.summary || 'Task completed');
            updateTaskStatus('completed');
            if (nextData.storedData && Object.keys(nextData.storedData).length > 0) {
              showStoredData(nextData.storedData);
            }
            isRunning = false;
            btnSend.disabled = false;
            stopKeepAlive();
            await loadTaskHistory();
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
          console.error('[Global Executive] Server error:', serverErr);
          renderDoneStep('Server error: ' + serverErr.message);
          updateTaskStatus('failed');
          isRunning = false;
          btnSend.disabled = false;
          stopKeepAlive();
          return;
        }
      }
    } catch (loopErr) {
      console.error('[Global Executive] Loop error:', loopErr);
      removeExecutingIndicator();
      renderDoneStep('Error: ' + loopErr.message);
      updateTaskStatus('failed');
      isRunning = false;
      btnSend.disabled = false;
      stopKeepAlive();
    }
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
    btnSend.disabled = false;
    await loadTaskHistory();
    stopKeepAlive();
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
        btnSend.disabled = false;
        currentTaskId = null;
        stopKeepAlive();
      }
    } catch (err) {
      console.error('[Global Executive] Stop by ID error:', err);
      alert('Failed to stop task: ' + err.message);
    }
  }

  // ============================================
  // Communication with background.js
  // ============================================
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
    btnSend.disabled = false;
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
  }

  // ============================================
  // Boot
  // ============================================
  setupAuth();
  setupEventHandlers();
  init();

})();
