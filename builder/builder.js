// New Order Global — AI Tool Builder Logic
// Handles chat interactions, AI generation, tool preview, and management

document.addEventListener('DOMContentLoaded', async () => {
  console.log('New Order Builder: Loaded');

  // State
  let currentTool = null;
  let chatHistory = [];
  let isGenerating = false;
  let availableModels = [];
  let selectedModelId = 'gemini-2-5-flash';
  let totalCreditsUsed = 0;
  let messageQueue = [];
  let conversationId = null;
  let conversations = [];

  // DOM References
  const welcomeScreen = document.getElementById('welcome-screen');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const toolPreview = document.getElementById('tool-preview');
  const toolsSidebar = document.getElementById('tools-sidebar');
  const authModal = document.getElementById('auth-modal');
  const historySidebar = document.getElementById('chat-history-sidebar');
  const historyList = document.getElementById('history-list');

  // ============================================
  // Initialize
  // ============================================
  const loadingOverlay = document.getElementById('initial-loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingSubtext = document.getElementById('loading-subtext');

  function updateLoading(status, sub) {
    if (loadingStatus) loadingStatus.textContent = status;
    if (loadingSubtext) loadingSubtext.textContent = sub;
  }

  try {
    updateLoading('Authenticating', 'Checking session...');
    await initializeAuth();
    
    updateLoading('Loading Tools', 'Syncing your workspace...');
    await loadInstalledTools();
    
    updateLoading('Loading Models', 'Fetching AI brains...');
    await loadModels();
    
    renderSessionCredits();
    
    if (NewOrderAuth.isAuthenticated()) {
      updateLoading('Loading History', 'Restoring conversations...');
      await loadConversations();
    }
  } catch (err) {
    console.error('Initialization error:', err);
  } finally {
    // Small delay for smooth transition
    setTimeout(() => {
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }, 800);
  }

  // Handle URL parameters (loadTool)
  const urlParams = new URLSearchParams(window.location.search);
  const loadToolId = urlParams.get('loadTool');
  if (loadToolId) {
    const tools = await ToolManager.getInstalledTools();
    const toolToEdit = tools.find(t => t.id === loadToolId);
    if (toolToEdit) {
      currentTool = toolToEdit;
      showToolPreview(toolToEdit);
      
      // Look for linked conversation
      if (NewOrderAuth.isAuthenticated()) {
        try {
          const userTools = await NewOrderAPI.getUserTools();
          const cloudT = userTools.find(t => t._id === loadToolId || t.id === loadToolId);
          if (cloudT && cloudT.conversationId) {
            await selectConversation(cloudT.conversationId);
          }
        } catch (e) {}
      }
      
      // Update context badge
      const contextEl = document.getElementById('input-context');
      const badge = document.getElementById('context-badge');
      if (contextEl && badge) {
        contextEl.style.display = 'flex';
        badge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> Editing: <strong>${toolToEdit.name}</strong>`;
        document.getElementById('context-remove').onclick = () => {
          contextEl.style.display = 'none';
          currentTool = null;
          chatInput.placeholder = 'Describe what you want to build...';
        };
      }
      
      chatInput.placeholder = `How should I change "${toolToEdit.name}"?`;
      welcomeScreen.style.display = 'none';
      chatMessages.style.display = 'flex';
    }
  } else {
    // Check if we just want to load a conversation directly
    const loadConversationId = urlParams.get('conversationId');
    if (loadConversationId && NewOrderAuth.isAuthenticated()) {
      await selectConversation(loadConversationId);
    }
  }

  // ============================================
  // Auth Setup
  // ============================================
  async function initializeAuth() {
    try {
      const user = await NewOrderAuth.init();
      if (user) {
        updateUserUI(user);
      }
    } catch (err) {
      console.log('Builder: Not logged in');
    }
  }

  function updateUserUI(user) {
    const userInfo = document.getElementById('user-info');
    const userName = document.getElementById('user-name');
    const userPlan = document.getElementById('user-plan');

    if (user) {
      userInfo.style.display = 'flex';
      userName.textContent = user.displayName || user.email;
      userPlan.textContent = `${(user.credits || 0).toFixed(2)} credits`;
    } else {
      userInfo.style.display = 'none';
    }
  }

  // ============================================
  // Load AI Models
  // ============================================
  async function loadModels() {
    try {
      const result = await NewOrderAPI.request('/api/models');
      if (result.models) {
        availableModels = result.models;

        // Try to load user's saved builder model preference
        let preferredModelId = null;
        if (NewOrderAuth.isAuthenticated()) {
          try {
            const user = await NewOrderAPI.getProfile();
            preferredModelId = user.builderModel;
          } catch (e) {
            console.log('Failed to load user model preference:', e);
          }
        }

        // Use saved preference if it exists and is still available, otherwise use default
        if (preferredModelId) {
          const preferredModel = availableModels.find(m => m.id === preferredModelId);
          if (preferredModel) {
            selectedModelId = preferredModelId;
          } else {
            // Saved model no longer available, fall back to default
            const defaultModel = availableModels.find(m => m.isDefault) || availableModels[0];
            if (defaultModel) selectedModelId = defaultModel.id;
          }
        } else {
          // No saved preference, use default
          const defaultModel = availableModels.find(m => m.isDefault) || availableModels[0];
          if (defaultModel) selectedModelId = defaultModel.id;
        }

        renderModelSelector();
      }
    } catch (err) {
      console.log('Failed to load models:', err);
    }
  }

  function renderModelSelector() {
    const container = document.getElementById('model-selector-pill-container');
    if (!container) return;

    const selectedModel = availableModels.find(m => m.id === selectedModelId) || availableModels[0];
    
    container.innerHTML = `
      <div class="model-pill" id="model-selector-pill">
        <div class="robot-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12,2A10,10,0,0,0,2,12a9.89,9.89,0,0,0,2.26,6.33l-2,2a1,1,0,0,0,1.42,1.42l2-2A9.94,9.94,0,0,0,12,22a10,10,0,0,0,0-20Zm0,18a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z"/>
            <circle cx="8.5" cy="11.5" r="1.5"/><circle cx="15.5" cy="11.5" r="1.5"/><path d="M8,15a4,4,0,0,0,8,0H8Z"/>
          </svg>
        </div>
        <span>${selectedModel ? selectedModel.name : 'Select Model'}</span>
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
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12,2A10,10,0,0,0,2,12a9.89,9.89,0,0,0,2.26,6.33l-2,2a1,1,0,0,0,1.42,1.42l2-2A9.94,9.94,0,0,0,12,22a10,10,0,0,0,0-20Zm0,18a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z"/>
              <circle cx="8.5" cy="11.5" r="1.5"/><circle cx="15.5" cy="11.5" r="1.5"/><path d="M8,15a4,4,0,0,0,8,0H8Z"/>
            </svg>
          </div>
          <div class="model-card-info">
            <div class="model-card-name">${m.name}</div>
            <div class="model-card-tags">${tags.join('')}</div>
            <div class="model-card-pricing"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${m.estimatedToolCost.toFixed(2)} In / ${(m.estimatedToolCost * 2).toFixed(2)} Out / 1K</div>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.model-card').forEach(card => {
      card.addEventListener('click', async () => {
        selectedModelId = card.dataset.id;
        document.getElementById('model-modal-overlay').classList.remove('active');
        renderModelSelector();

        // Save model preference to user profile
        if (NewOrderAuth.isAuthenticated()) {
          try {
            await NewOrderAPI.updateModelPreferences(selectedModelId, null);
          } catch (e) {
            console.log('Failed to save model preference:', e);
          }
        }
      });
    });
  }

  // ============================================
  // Session Credits Display
  // ============================================
  function renderSessionCredits() {
    let el = document.getElementById('session-credits');
    if (!el) {
      el = document.createElement('div');
      el.id = 'session-credits';
      el.style.cssText = 'display:none;font-size:11px;padding:4px 12px;background:rgba(255,179,71,0.05);border:1px solid rgba(255,179,71,0.15);border-radius:8px;color:#ffb347;margin-left:8px;';
      const header = document.querySelector('.builder-header');
      if (header) header.appendChild(el);
    }
  }

  function updateSessionCredits() {
    const el = document.getElementById('session-credits');
    if (el && totalCreditsUsed > 0) {
      el.style.display = 'inline';
      el.textContent = `-${totalCreditsUsed.toFixed(4)} session`;
    }
  }

  // ============================================
  // Auth modal
  // ============================================
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('login-form').style.display = isLogin ? 'block' : 'none';
      document.getElementById('register-form').style.display = isLogin ? 'none' : 'block';
    });
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    try {
      errorEl.style.display = 'none';
      const result = await NewOrderAuth.login(email, password);
      updateUserUI(result.user);
      authModal.style.display = 'none';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    }
  });

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const errorEl = document.getElementById('register-error');

    try {
      errorEl.style.display = 'none';
      const result = await NewOrderAuth.register(email, password, name);
      updateUserUI(result.user);
      authModal.style.display = 'none';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    }
  });

  document.getElementById('auth-modal-close').addEventListener('click', () => {
    authModal.style.display = 'none';
  });

  // ============================================
  // Sidebar Toggle
  // ============================================
  document.getElementById('btn-my-tools').addEventListener('click', () => {
    toolsSidebar.classList.toggle('open');
    loadInstalledTools();
  });

  document.getElementById('sidebar-close').addEventListener('click', () => {
    toolsSidebar.classList.remove('open');
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    window.location.href = '../dashboard/settings.html';
  });

  document.getElementById('btn-toggle-history').addEventListener('click', () => {
    historySidebar.classList.toggle('open');
    if (historySidebar.classList.contains('open')) {
      loadConversations();
    }
  });

  document.getElementById('history-close').addEventListener('click', () => {
    historySidebar.classList.remove('open');
  });

  document.getElementById('btn-new-conversation').addEventListener('click', () => {
    startNewConversation();
    historySidebar.classList.remove('open');
  });

  // ============================================
  // Load Installed Tools
  // ============================================
  async function loadInstalledTools() {
    let tools = await ToolManager.getInstalledTools();
    
    // Sync with cloud tools if authenticated
    if (NewOrderAuth.isAuthenticated()) {
      try {
        const cloudTools = await NewOrderAPI.getUserTools();
        let changed = false;
        for (const ct of cloudTools) {
          const toolId = ct._id || ct.id;
          const exists = tools.find(t => t.id === toolId);
          if (!exists) {
            await ToolManager.installTool({
              id: toolId,
              name: ct.name,
              description: ct.description,
              icon: ct.icon,
              targetSites: ct.targetSites,
              contentScript: ct.contentScript,
              styles: ct.styles,
              config: ct.config,
              dashboardHTML: ct.dashboardHTML || '',
              storageSchema: ct.storageSchema || {},
              conversationId: ct.conversationId || null
            });
            changed = true;
          }
        }
        if (changed) {
          tools = await ToolManager.getInstalledTools();
        }
      } catch (err) {
        console.log('Failed to sync cloud tools:', err);
      }
    }

    const container = document.getElementById('custom-tools-list');

    if (tools.length === 0) {
      container.innerHTML = `
        <div class="empty-tools">
          <div class="empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div>
          <p>No custom tools yet</p>
          <span>Describe what you want below and AI will build it!</span>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    for (const tool of tools) {
      const isActive = await ToolManager.isToolActive(tool.id);
      const card = document.createElement('div');
      card.className = 'tool-card';
      card.innerHTML = `
        <div class="tool-icon">${tool.icon || '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'}</div>
        <div class="tool-info">
          <div class="tool-name">${escapeHtml(tool.name)}</div>
          <div class="tool-desc">${escapeHtml(tool.description || tool.targetSites?.join(', ') || 'Custom tool')}</div>
        </div>
        <div class="tool-status ${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Off'}</div>
      `;

      card.addEventListener('click', async () => {
        if (isActive) {
          await ToolManager.deactivateTool(tool.id);
        } else {
          await ToolManager.activateTool(tool.id);
        }
        loadInstalledTools();
      });

      container.appendChild(card);
    }
  }

  // ============================================
  // Conversations
  // ============================================
  async function loadConversations() {
    try {
      conversations = await NewOrderAPI.getConversations();
      renderConversations();
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }

  function renderConversations() {
    if (conversations.length === 0) {
      historyList.innerHTML = '<div class="empty-history" style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">No conversations yet</div>';
      return;
    }

    historyList.innerHTML = '';
    conversations.forEach(c => {
      const btn = document.createElement('button');
      btn.className = `convo-item ${c.id === conversationId ? 'active' : ''}`;
      btn.innerHTML = `
        <div class="convo-title">${escapeHtml(c.title || 'New Conversation')}</div>
        <div class="convo-meta">
          ${c.toolName ? `<span class="meta-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> ${escapeHtml(c.toolName)}</span>` : ''}
          <span class="meta-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg> ${(c.totalCreditsUsed || 0).toFixed(2)}</span>
          <span class="meta-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> ${c.messageCount || 0}</span>
        </div>
      `;
      btn.addEventListener('click', () => selectConversation(c.id));
      historyList.appendChild(btn);
    });
  }

  function startNewConversation() {
    conversationId = null;
    chatHistory = [];
    currentTool = null;
    totalCreditsUsed = 0;
    
    chatMessages.innerHTML = '';
    chatMessages.style.display = 'none';
    welcomeScreen.style.display = 'flex';
    toolPreview.style.display = 'none';
    updateSessionCredits();
    renderConversations();
  }

  async function selectConversation(id) {
    try {
      const convo = await NewOrderAPI.getConversationById(id);
      conversationId = convo._id;
      chatHistory = convo.messages.map(m => ({ role: m.role, content: m.content }));
      totalCreditsUsed = convo.totalCreditsUsed || 0;
      currentTool = null; // Don't auto load the tool code for now unless we fetched it
      
      welcomeScreen.style.display = 'none';
      chatMessages.style.display = 'flex';
      toolPreview.style.display = 'none';
      
      chatMessages.innerHTML = '';
      convo.messages.forEach(m => {
        addMessage(m.role, m.content, {
          creditsUsed: m.creditsUsed,
          model: m.model
        });
      });
      
      updateSessionCredits();
      renderConversations();
      historySidebar.classList.remove('open');
      
      // Look for a tool connected to this conversation
      try {
        const tools = await ToolManager.getInstalledTools();
        const convoTool = tools.find(t => t.conversationId === conversationId || t.conversationId === id);
        
        // Let's also check cloud tools just in case it's newly synced
        let matchingTool = convoTool;
        if (!matchingTool && NewOrderAuth.isAuthenticated()) {
            const userTools = await NewOrderAPI.getUserTools();
            matchingTool = userTools.find(t => t.conversationId === conversationId || t.conversationId === id);
        }

        if (matchingTool) {
            currentTool = matchingTool;
            showToolPreview(currentTool);
            
            // Reconstruct the context badge
            const contextEl = document.getElementById('input-context');
            const badge = document.getElementById('context-badge');
            if (contextEl && badge) {
                contextEl.style.display = 'flex';
                badge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> Editing: <strong>${currentTool.name.replace(/</g, "&lt;")}</strong>`;
                document.getElementById('context-remove').onclick = () => {
                    contextEl.style.display = 'none';
                    currentTool = null;
                    document.getElementById('chat-input').placeholder = 'Describe what you want to build...';
                };
            }
            document.getElementById('chat-input').placeholder = `How should I change "${currentTool.name.replace(/</g, "&lt;")}"?`;
            
            // Append a synthetic tool card message
            const toolMsg = document.createElement('div');
            toolMsg.className = 'message ai';
            toolMsg.innerHTML = `
                <div class="message-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
                <div class="message-bubble">
                    <div class="message-content">
                        <div style="font-style:italic; font-size:13px; color:var(--text-secondary); margin-bottom:10px;">Tool attached to this chat:</div>
                    </div>
                </div>
            `;
            
            const contentDiv = toolMsg.querySelector('.message-content');
            const btnGroup = document.createElement('div');
            btnGroup.style.cssText = 'margin-top:10px; display:flex; gap:8px; align-items:stretch;';

            const toolStr = encodeURIComponent(JSON.stringify(currentTool));
            
            const btn = document.createElement('div');
            btn.className = 'chat-tool-btn';
            btn.setAttribute('data-tool', toolStr);
            btn.style.cssText = 'flex:1; padding:12px; border:1px solid var(--border-focus); background:var(--bg-card); border-radius:12px; cursor:pointer; display:flex; align-items:center; gap:12px; transition:0.2s;';
            btn.onmouseover = () => btn.style.background = 'var(--bg-card-hover)';
            btn.onmouseout = () => btn.style.background = 'var(--bg-card)';
            
            btn.innerHTML = `
                <div style="font-size:24px; background:rgba(184, 52, 28, 0.1); padding:8px; border-radius:8px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div> 
                <div>
                    <div style="font-weight:700; font-size:14px; color:var(--accent-primary);">${currentTool.name.replace(/</g, "&lt;")}</div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">Click to view files/code or iterate</div>
                </div>
            `;
            
            btn.onclick = () => {
                currentTool = JSON.parse(decodeURIComponent(btn.getAttribute('data-tool')));
                showToolPreview(currentTool);
            };

            const linkBtn = document.createElement('a');
            linkBtn.href = `../dashboard/tool-detail.html?id=${currentTool.id || currentTool._id}`;
            linkBtn.target = '_blank';
            linkBtn.style.cssText = 'display:flex; flex-direction:column; justify-content:center; align-items:center; padding:0 16px; border:1px solid var(--border-focus); background:var(--bg-card); border-radius:12px; color:var(--text-primary); text-decoration:none; transition:0.2s;';
            linkBtn.onmouseover = () => linkBtn.style.background = 'var(--bg-card-hover)';
            linkBtn.onmouseout = () => linkBtn.style.background = 'var(--bg-card)';
            linkBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg><span style="font-size:10px; opacity:0.7; margin-top:4px;">Manage</span>`;

            btnGroup.appendChild(btn);
            btnGroup.appendChild(linkBtn);
            contentDiv.appendChild(btnGroup);
            chatMessages.appendChild(toolMsg);
        }
      } catch (err) {
        console.error('Failed to link convo to tool', err);
      }

      // Scroll to bottom
      chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch (err) {
      console.error('Failed to load conversation details:', err);
    }
  }

  // ============================================
  // Example Prompt Buttons
  // ============================================
  document.querySelectorAll('.example-prompt').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      chatInput.value = prompt;
      sendMessage();
    });
  });

  // ============================================
  // Chat Input Handling
  // ============================================
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });

  btnSend.addEventListener('click', sendMessage);

  // ============================================
  // Send Message (with queue support)
  // ============================================
  function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    // Check auth
    if (!NewOrderAuth.isAuthenticated()) {
      authModal.style.display = 'flex';
      return;
    }

    // Check credits
    const user = NewOrderAuth.getCurrentUser();
    if (!user || (user.credits || 0) <= 0) {
      addMessage('ai', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> You have no credits remaining. Visit global-order.32d.one/dashboard/billing to buy more.');
      return;
    }

    chatInput.value = '';
    chatInput.style.height = 'auto';

    // If AI is busy, queue the message
    if (isGenerating) {
      messageQueue.push(text);
      addMessage('user', text, { queued: true });
      updateSendButton();
      return;
    }

    // Switch to chat view
    welcomeScreen.style.display = 'none';
    chatMessages.style.display = 'flex';

    addMessage('user', text);
    chatHistory.push({ role: 'user', content: text });

    doGenerate(text);
  }

  async function doGenerate(text) {
    isGenerating = true;
    updateSendButton();

    const typingEl = addTypingIndicator();
    let streamMsg = null;
    let streamContent = null;
    let streamCursor = null;
    let accumulated = '';
    let isToolJSON = false;

    try {
      const context = await getCurrentTabContext();
      let result;

      const onChunk = (content, meta) => {
        if (meta?.type === 'start') return;
        if (content === null || content === undefined) return;

        accumulated += content;
        const trimmed = accumulated.trimStart();

        // Detect JSON tool output — keep typing indicator, don't show raw JSON
        if (!isToolJSON && (trimmed.startsWith('{') || trimmed.startsWith('```'))) {
          isToolJSON = true;
        }

        if (isToolJSON) {
          // Tool JSON — keep the typing dots, don't render raw JSON
          return;
        }

        // Conversational text — create a streaming bubble and show text typing in
        if (!streamMsg) {
          typingEl.remove();
          streamMsg = addStreamingMessage();
          streamContent = streamMsg.querySelector('.stream-content');
          streamCursor = streamMsg.querySelector('.stream-cursor');
        }

        streamContent.innerHTML = formatMessage(accumulated);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      };

      if (currentTool) {
        result = await NewOrderAPI.iterateToolStream(currentTool.id || currentTool._id, text, currentTool.contentScript, selectedModelId, conversationId, onChunk);
      } else {
        result = await NewOrderAPI.generateToolStream(text, context, selectedModelId, conversationId, onChunk);
      }

      if (!result) {
        throw new Error('Stream ended without a result');
      }

      // Clean up: remove typing indicator or streaming bubble
      if (streamMsg) {
        // Conversational — remove cursor, keep the streamed text
        if (streamCursor) streamCursor.remove();
        streamMsg.classList.remove('streaming');
      } else {
        // Tool JSON — remove typing indicator
        typingEl.remove();
      }

      if (result.conversationId) {
        conversationId = result.conversationId;
      }

      if (result.tool) {
        currentTool = result.tool;
        currentTool.conversationId = conversationId;
        const creditsUsed = result.usage?.creditsUsed || 0;
        totalCreditsUsed += creditsUsed;

        // Use the original addMessage for the final tool display
        addMessage('ai', `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg> I've created **"${result.tool.name}"** for you!\n\n${result.tool.description}\n\n<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> **Target:** ${result.tool.targetSites?.join(', ') || 'All websites'}\n\nCheck the preview below.`, {
          creditsUsed,
          model: result.usage?.model || selectedModelId,
          tool: currentTool
        });

        showToolPreview(result.tool);
      } else if (result.message) {
        const creditsUsed = result.usage?.creditsUsed || 0;
        totalCreditsUsed += creditsUsed;

        if (streamMsg) {
          // Text was already streamed live — just add credits meta
          addCreditsMetaToMessage(streamMsg, creditsUsed, result.usage?.model || selectedModelId);
        } else {
          // Fallback: add as a normal message
          addMessage('ai', result.message, {
            creditsUsed,
            model: result.usage?.model || selectedModelId
          });
        }
        chatHistory.push({ role: 'assistant', content: result.message });
      }

      updateCreditsDisplay();
      updateSessionCredits();
      loadConversations();

    } catch (err) {
      typingEl.remove();
      if (streamMsg) streamMsg.remove();
      addMessage('ai', `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Error: ${err.message}`);
    } finally {
      isGenerating = false;
      updateSendButton();

      // Process queued messages
      if (messageQueue.length > 0) {
        const next = messageQueue.shift();
        const queuedMsgs = chatMessages.querySelectorAll('.message-queued');
        if (queuedMsgs.length > 0) {
          queuedMsgs[0].classList.remove('message-queued');
          const queueLabel = queuedMsgs[0].querySelector('.queue-label');
          if (queueLabel) queueLabel.remove();
        }

        welcomeScreen.style.display = 'none';
        chatMessages.style.display = 'flex';
        chatHistory.push({ role: 'user', content: next });
        doGenerate(next);
      }
    }
  }

  function addStreamingMessage() {
    const msg = document.createElement('div');
    msg.className = 'message ai streaming';
    msg.innerHTML = `
      <div class="message-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
      <div class="message-bubble">
        <div class="message-content">
          <span class="stream-content"></span><span class="stream-cursor"></span>
        </div>
      </div>
    `;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msg;
  }

  function addCreditsMetaToMessage(msgEl, creditsUsed, model) {
    const bubble = msgEl.querySelector('.message-bubble');
    if (!bubble || !creditsUsed || creditsUsed <= 0) return;

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:middle;"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg> <span class="meta-credits">${creditsUsed.toFixed(4)}</span> credits`;
    if (model) meta.innerHTML += ` · <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:4px;margin-right:4px;vertical-align:middle;"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg> ${model}`;
    bubble.appendChild(meta);
  }

  function updateSendButton() {
    if (isGenerating) {
      btnSend.classList.add('queuing');
      btnSend.title = 'Message will be queued';
      chatInput.placeholder = 'Queuing next message...';
    } else {
      btnSend.classList.remove('queuing');
      btnSend.title = 'Send';
      chatInput.placeholder = 'Type...';
    }
  }

  // ============================================
  // Get Current Tab Context
  // ============================================
  async function getCurrentTabContext() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab) {
          resolve({
            currentUrl: tab.url || '',
            currentSite: tab.url ? new URL(tab.url).hostname : '',
            pageTitle: tab.title || ''
          });
        } else {
          resolve({});
        }
      });
    });
  }

  // ============================================
  // Chat UI Helpers
  // ============================================
  function addMessage(type, text, opts = {}) {
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    if (opts.queued) msg.classList.add('message-queued');

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';

    if (type === 'user') {
      const user = NewOrderAuth.getCurrentUser();
      avatar.textContent = user?.displayName?.[0]?.toUpperCase() || 'U';
    } else {
      avatar.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
    }

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    // Queue label
    if (opts.queued) {
      const queueLabel = document.createElement('div');
      queueLabel.className = 'queue-label';
      queueLabel.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Queued — will send when AI is ready';
      bubble.appendChild(queueLabel);
    }

    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = formatMessage(text);
    
    // Check if we need to embed a mini interactive tool card inside the message
    if (opts.tool) {
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = 'margin-top:12px; display:flex; gap:8px; align-items:stretch;';

        const toolStr = encodeURIComponent(JSON.stringify(opts.tool));
        const btn = document.createElement('div');
        btn.className = 'chat-tool-btn';
        btn.setAttribute('data-tool', toolStr);
        btn.style.cssText = 'flex:1; padding:12px; border:1px solid var(--border-focus); background:var(--bg-card); border-radius:12px; cursor:pointer; display:flex; align-items:center; gap:12px; transition:0.2s;';
        btn.onmouseover = () => btn.style.background = 'var(--bg-card-hover)';
        btn.onmouseout = () => btn.style.background = 'var(--bg-card)';
        
        btn.innerHTML = `
            <div style="font-size:24px; background:rgba(184, 52, 28, 0.1); padding:8px; border-radius:8px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div> 
            <div>
                <div style="font-weight:700; font-size:14px; color:var(--accent-primary);">${opts.tool.name.replace(/</g, "&lt;")}</div>
                <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">Click to view files/code or iterate</div>
            </div>
        `;
        
        btn.onclick = () => {
            currentTool = JSON.parse(decodeURIComponent(btn.getAttribute('data-tool')));
            showToolPreview(currentTool);
            
            // Set context for iteration
            const contextEl = document.getElementById('input-context');
            const badge = document.getElementById('context-badge');
            if (contextEl && badge) {
                contextEl.style.display = 'flex';
                badge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> Editing: <strong>${currentTool.name.replace(/</g, "&lt;")}</strong>`;
                document.getElementById('context-remove').onclick = () => {
                    contextEl.style.display = 'none';
                    currentTool = null;
                    document.getElementById('chat-input').placeholder = 'Describe what you want to build...';
                };
            }
            document.getElementById('chat-input').placeholder = `How should I change "${currentTool.name.replace(/</g, "&lt;")}"?`;
        };
        
        const linkBtn = document.createElement('a');
        linkBtn.href = `../dashboard/tool-detail.html?id=${opts.tool.id || opts.tool._id}`;
        linkBtn.target = '_blank';
        linkBtn.style.cssText = 'display:flex; flex-direction:column; justify-content:center; align-items:center; padding:0 16px; border:1px solid var(--border-focus); background:var(--bg-card); border-radius:12px; color:var(--text-primary); text-decoration:none; transition:0.2s;';
        linkBtn.onmouseover = () => linkBtn.style.background = 'var(--bg-card-hover)';
        linkBtn.onmouseout = () => linkBtn.style.background = 'var(--bg-card)';
        linkBtn.innerHTML = `<span style="font-size:20px;">↗️</span><span style="font-size:10px; opacity:0.7; margin-top:4px;">Manage</span>`;

        btnGroup.appendChild(btn);
        btnGroup.appendChild(linkBtn);
        content.appendChild(btnGroup);
    }
    
    bubble.appendChild(content);

    // Credits + model info
    if (opts.creditsUsed && opts.creditsUsed > 0) {
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:middle;"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg> <span class="meta-credits">${opts.creditsUsed.toFixed(4)}</span> credits`;
      if (opts.model) meta.innerHTML += ` · <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:4px;margin-right:4px;vertical-align:middle;"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg> ${opts.model}`;
      bubble.appendChild(meta);
    }

    msg.appendChild(avatar);
    msg.appendChild(bubble);
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msg;
  }

  function addTypingIndicator() {
    const msg = document.createElement('div');
    msg.className = 'message ai';
    msg.innerHTML = `
      <div class="message-avatar">⚡</div>
      <div class="message-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msg;
  }

  function formatMessage(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  // ============================================
  // Tool Preview
  // ============================================
  function showToolPreview(tool) {
    toolPreview.style.display = 'block';

    document.getElementById('preview-tool-name').textContent = tool.name;

    const metaEl = document.getElementById('preview-meta');
    metaEl.innerHTML = '';
    if (tool.targetSites) {
      tool.targetSites.forEach(site => {
        const tag = document.createElement('span');
        tag.className = 'meta-tag';
        tag.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> ${site}`;
        metaEl.appendChild(tag);
      });
    }

    document.getElementById('preview-code-js').textContent = tool.contentScript || '// No JavaScript generated';
    document.getElementById('preview-code-css').textContent = tool.styles || '/* No CSS generated */';
    document.getElementById('preview-code-config').textContent = JSON.stringify(tool.config || {}, null, 2);
    document.getElementById('preview-code-dashboard').textContent = tool.dashboardHTML || '<!-- No dashboard generated -->';

    document.querySelectorAll('.code-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.getElementById('preview-code-js').style.display = tab.dataset.tab === 'js' ? 'block' : 'none';
        document.getElementById('preview-code-css').style.display = tab.dataset.tab === 'css' ? 'block' : 'none';
        document.getElementById('preview-code-config').style.display = tab.dataset.tab === 'config' ? 'block' : 'none';
        document.getElementById('preview-code-dashboard').style.display = tab.dataset.tab === 'dashboard' ? 'block' : 'none';
      });
    });
  }

  // Accept tool
  document.getElementById('btn-accept-tool').addEventListener('click', async () => {
    if (!currentTool) return;

    try {
      await ToolManager.installTool(currentTool);

      try {
        await NewOrderAPI.saveToolToCloud(currentTool);
      } catch (err) {
        console.log('Cloud save failed (will sync later):', err.message);
      }

      addMessage('ai', `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg> **"${currentTool.name}"** has been saved and activated! It will run on the target site(s).`);

      toolPreview.style.display = 'none'; // Collapse the code preview UI, but keep editing context active
      loadInstalledTools();
    } catch (err) {
      addMessage('ai', `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Error saving tool: ${err.message}`);
    }
  });

  // Reject tool
  document.getElementById('btn-reject-tool').addEventListener('click', () => {
    toolPreview.style.display = 'none';
    currentTool = null;
    addMessage('ai', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Tool discarded. Tell me what to build next!');
  });

  // Test tool — full test panel with console capture
  let testActive = false;
  let testTabId = null;
  let testCounts = { logs: 0, errors: 0, warnings: 0 };

  document.getElementById('btn-test-tool').addEventListener('click', async () => {
    if (!currentTool) return;

    // Find a real web tab (not the builder's own chrome-extension:// tab)
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const webTab = allTabs
      .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

    if (!webTab) {
      addMessage('ai', `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> No website tab found. Open a website in another tab first, then test.`);
      return;
    }

    const tab = webTab;

    // Reset state
    testActive = true;
    testTabId = tab.id;
    testCounts = { logs: 0, errors: 0, warnings: 0 };

    // Show test panel
    const overlay = document.getElementById('test-panel-overlay');
    overlay.style.display = 'flex';
    document.getElementById('test-panel-tool-name').textContent = `Testing: ${currentTool.name}`;
    document.getElementById('test-status-text').textContent = 'Running';
    document.getElementById('test-status').className = 'test-status running';
    document.getElementById('btn-test-accept').style.display = 'none';

    // Clear console
    const consoleEl = document.getElementById('test-console');
    consoleEl.innerHTML = '';

    // Reset summary counts
    updateTestSummary();

    // Add initial entry
    addTestConsoleEntry('info', `Injecting "${currentTool.name}" into ${tab.url ? new URL(tab.url).hostname : 'current tab'}...`);

    try {
      // 1. Inject test listener (ISOLATED world) — forwards console output via chrome.runtime.sendMessage
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (window.__noTestListener) return;
          window.__noTestListener = true;
          window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            const d = event.data;
            if (!d || d.source !== 'no-tool-context' || d.type !== 'test-output') return;
            chrome.runtime.sendMessage({
              type: 'no-test-output',
              toolId: d.toolId,
              level: d.level,
              args: d.args,
              timestamp: d.timestamp
            }).catch(() => {});
          });
          window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            const d = event.data;
            if (!d || d.source !== 'no-tool-context' || d.type !== 'test-done') return;
            chrome.runtime.sendMessage({
              type: 'no-test-done',
              toolId: d.toolId,
              success: d.success,
              error: d.error,
              timestamp: d.timestamp
            }).catch(() => {});
          });
        }
      });

      // 2. Inject styles
      if (currentTool.styles) {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          css: currentTool.styles
        });
      }

      // 3. Inject the tool in test mode (MAIN world)
      const testWrappedCode = ToolManager.buildToolWrapper(currentTool, true);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (code) => {
          try {
            const script = document.createElement('script');
            script.textContent = code;
            (document.head || document.documentElement).appendChild(script);
            script.remove();
          } catch (e) {
            console.error('[New Order] Test injection error:', e);
          }
        },
        args: [testWrappedCode],
        world: 'MAIN'
      });

      addTestConsoleEntry('info', `Tool injected successfully. Watching for output...`);
    } catch (err) {
      addTestConsoleEntry('error', `Injection failed: ${err.message}`);
      testActive = false;
      document.getElementById('test-status-text').textContent = 'Failed';
      document.getElementById('test-status').className = 'test-status failed';
    }
  });

  // Listen for test output from background (forwarded from content script)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!testActive || !currentTool) return;

    if (message.type === 'no-test-output' && message.toolId === (currentTool.id || currentTool._id)) {
      const level = message.level || 'log';
      const text = message.args || '';

      addTestConsoleEntry(level, text);

      if (level === 'error') testCounts.errors++;
      else if (level === 'warn') testCounts.warnings++;
      else testCounts.logs++;

      updateTestSummary();
    }

    if (message.type === 'no-test-done' && message.toolId === (currentTool.id || currentTool._id)) {
      testActive = false;

      if (message.success) {
        addTestConsoleEntry('info', `✓ Tool execution completed successfully.`);
        document.getElementById('test-status-text').textContent = 'Passed';
        document.getElementById('test-status').className = 'test-status passed';
      } else {
        addTestConsoleEntry('error', `✗ Tool execution failed: ${message.error || 'Unknown error'}`);
        document.getElementById('test-status-text').textContent = 'Failed';
        document.getElementById('test-status').className = 'test-status failed';
      }

      // Show accept button if no errors (or even with errors, let user decide)
      document.getElementById('btn-test-accept').style.display = 'flex';
      updateTestSummary();
    }
  });

  function addTestConsoleEntry(level, text) {
    const consoleEl = document.getElementById('test-console');
    const entry = document.createElement('div');
    entry.className = `test-console-entry ${level}`;

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

    let iconSvg = '';
    if (level === 'error') {
      iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    } else if (level === 'warn') {
      iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    } else if (level === 'info') {
      iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    } else {
      iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    }

    entry.innerHTML = `
      <span class="test-console-time">${time}</span>
      <span class="test-console-icon">${iconSvg}</span>
      <span class="test-console-msg">${escapeHtml(text)}</span>
    `;

    consoleEl.appendChild(entry);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function updateTestSummary() {
    const logsEl = document.querySelector('#test-summary-logs span');
    const errorsEl = document.querySelector('#test-summary-errors span');
    const warningsEl = document.querySelector('#test-summary-warnings span');
    if (logsEl) logsEl.textContent = testCounts.logs;
    if (errorsEl) errorsEl.textContent = testCounts.errors;
    if (warningsEl) warningsEl.textContent = testCounts.warnings;
  }

  // Stop test button
  document.getElementById('btn-stop-test').addEventListener('click', async () => {
    if (!testActive || !currentTool || !testTabId) return;

    try {
      const toolSlug = (currentTool.id || currentTool._id).replace(/[^a-zA-Z0-9]/g, '_');
      await chrome.scripting.executeScript({
        target: { tabId: testTabId },
        func: (slug, id) => {
          if (typeof window['__noToolCleanup_' + slug] === 'function') {
            window['__noToolCleanup_' + slug]();
          }
          document.querySelectorAll(`[data-no-tool="${id}"]`).forEach(el => el.remove());
          delete window.__noTestListener;
        },
        args: [toolSlug, currentTool.id || currentTool._id],
        world: 'MAIN'
      });
    } catch (err) {
      console.error('Stop test error:', err);
    }

    testActive = false;
    addTestConsoleEntry('info', 'Test stopped by user.');
    document.getElementById('test-status-text').textContent = 'Stopped';
    document.getElementById('test-status').className = 'test-status stopped';
    document.getElementById('btn-test-accept').style.display = 'flex';
  });

  // Close test panel
  document.getElementById('test-panel-close').addEventListener('click', async () => {
    // Stop test if still running
    if (testActive && currentTool && testTabId) {
      try {
        const toolSlug = (currentTool.id || currentTool._id).replace(/[^a-zA-Z0-9]/g, '_');
        await chrome.scripting.executeScript({
          target: { tabId: testTabId },
          func: (slug, id) => {
            if (typeof window['__noToolCleanup_' + slug] === 'function') {
              window['__noToolCleanup_' + slug]();
            }
            document.querySelectorAll(`[data-no-tool="${id}"]`).forEach(el => el.remove());
            delete window.__noTestListener;
          },
          args: [toolSlug, currentTool.id || currentTool._id],
          world: 'MAIN'
        });
      } catch (err) {}
      testActive = false;
    }

    document.getElementById('test-panel-overlay').style.display = 'none';
  });

  // Test accept button — save the tool after successful test
  document.getElementById('btn-test-accept').addEventListener('click', async () => {
    if (!currentTool) return;

    try {
      await ToolManager.installTool(currentTool);

      try {
        await NewOrderAPI.saveToolToCloud(currentTool);
      } catch (err) {
        console.log('Cloud save failed (will sync later):', err.message);
      }

      addMessage('ai', `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg> **"${currentTool.name}"** has been saved and activated! It will run on the target site(s).`);

      toolPreview.style.display = 'none';
      document.getElementById('test-panel-overlay').style.display = 'none';
      loadInstalledTools();
    } catch (err) {
      addMessage('ai', `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Error saving tool: ${err.message}`);
    }
  });

  // Iterate tool
  document.getElementById('btn-iterate-tool').addEventListener('click', () => {
    chatInput.placeholder = `How should I change "${currentTool?.name || 'the tool'}"?`;
    chatInput.focus();
  });

  // ============================================
  // Credits Display
  // ============================================
  async function updateCreditsDisplay() {
    try {
      const profile = await NewOrderAuth.refreshProfile();
      if (profile) {
        updateUserUI(profile);
      }
    } catch {
      // Ignore
    }
  }

  // ============================================
  // Utility
  // ============================================
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
