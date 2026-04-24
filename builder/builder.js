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
  await initializeAuth();
  await loadInstalledTools();
  await loadModels();
  renderSessionCredits();
  if (NewOrderAuth.isAuthenticated()) {
    await loadConversations();
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
        badge.innerHTML = `🔧 Editing: <strong>${toolToEdit.name}</strong>`;
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
        const defaultModel = availableModels.find(m => m.isDefault) || availableModels[0];
        if (defaultModel) selectedModelId = defaultModel.id;
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
              <button class="model-tab active" data-group="BETA">✨ Beta</button>
              <button class="model-tab" data-group="FREE">⚡ Free</button>
              <button class="model-tab" data-group="PREMIUM">💎 Premium</button>
              <button class="model-tab" data-group="BYOK">🔑 BYOK</button>
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

    renderModelList('BETA');
    overlay.classList.add('active');
  }

  function renderModelList(group) {
    const list = document.getElementById('model-modal-list');
    if (!list) return;

    // Filter models by group (assuming the API provides some category or we map them)
    // For now, let's distribute them based on some criteria if category is missing
    const filteredModels = availableModels.filter(m => {
      if (group === 'BETA') return m.id.includes('3.5') || m.id.includes('qwen');
      if (group === 'FREE') return m.id.includes('lite') || m.id.includes('flash');
      if (group === 'PREMIUM') return m.id.includes('pro') || m.id.includes('ultra') || m.id.includes('sonnet');
      if (group === 'BYOK') return false; // Placeholder
      return true;
    });

    list.innerHTML = filteredModels.map(m => {
      const isSelected = m.id === selectedModelId;
      const tags = [];
      if (m.id.includes('reasoning') || m.id.includes('sonnet')) tags.push('<span class="model-tag reasoning">Reasoning</span>');
      if (m.id.includes('vision')) tags.push('<span class="model-tag vision">Vision</span>');
      if (m.id.includes('lite') || m.id.includes('flash')) tags.push('<span class="model-tag fast">Fast</span>');
      if (m.id.includes('pro')) tags.push('<span class="model-tag full">Full</span>');

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
            <div class="model-card-pricing">⚡ ${m.estimatedToolCost.toFixed(2)} In / ${(m.estimatedToolCost * 2).toFixed(2)} Out / 1K</div>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.model-card').forEach(card => {
      card.addEventListener('click', () => {
        selectedModelId = card.dataset.id;
        document.getElementById('model-modal-overlay').classList.remove('active');
        renderModelSelector();
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
              config: ct.config
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
          <div class="empty-icon">✨</div>
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
        <div class="tool-icon">${tool.icon || '🔧'}</div>
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
          ${c.toolName ? `<span>🔧 ${escapeHtml(c.toolName)}</span>` : ''}
          <span>💰 ${(c.totalCreditsUsed || 0).toFixed(2)}</span>
          <span>${c.messageCount || 0} msgs</span>
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
                badge.innerHTML = `🔧 Editing: <strong>${currentTool.name.replace(/</g, "&lt;")}</strong>`;
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
                <div class="message-avatar">⚡</div>
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
                <div style="font-size:24px; background:rgba(124, 92, 252, 0.1); padding:8px; border-radius:8px;">📦</div> 
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
            linkBtn.innerHTML = `<span style="font-size:20px;">↗️</span><span style="font-size:10px; opacity:0.7; margin-top:4px;">Manage</span>`;

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
      addMessage('ai', '⚠️ You have no credits remaining. Visit global-order.32d.one/dashboard/billing to buy more.');
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

    try {
      const context = await getCurrentTabContext();
      let result;
      
      if (currentTool) {
        result = await NewOrderAPI.iterateTool(currentTool.id || currentTool._id, text, currentTool.contentScript, selectedModelId, conversationId);
      } else {
        result = await NewOrderAPI.generateTool(text, context, selectedModelId, conversationId);
      }

      typingEl.remove();
      
      if (result.conversationId) {
        conversationId = result.conversationId;
      }

      if (result.tool) {
        currentTool = result.tool;
        currentTool.conversationId = conversationId;
        const creditsUsed = result.usage?.creditsUsed || 0;
        totalCreditsUsed += creditsUsed;

        addMessage('ai', `✅ I've created **"${result.tool.name}"** for you!\n\n${result.tool.description}\n\n📍 **Target:** ${result.tool.targetSites?.join(', ') || 'All websites'}\n\nCheck the preview below.`, {
          creditsUsed,
          model: result.usage?.model || selectedModelId,
          tool: currentTool
        });

        showToolPreview(result.tool);
      } else if (result.message) {
        addMessage('ai', result.message);
      }

      updateCreditsDisplay();
      updateSessionCredits();
      loadConversations(); // refresh sidebar

    } catch (err) {
      typingEl.remove();
      addMessage('ai', `❌ Error: ${err.message}`);
    } finally {
      isGenerating = false;
      updateSendButton();

      // Process queued messages
      if (messageQueue.length > 0) {
        const next = messageQueue.shift();
        // Remove the queued styling
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
      avatar.textContent = '⚡';
    }

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    // Queue label
    if (opts.queued) {
      const queueLabel = document.createElement('div');
      queueLabel.className = 'queue-label';
      queueLabel.textContent = '⏳ Queued — will send when AI is ready';
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
            <div style="font-size:24px; background:rgba(124, 92, 252, 0.1); padding:8px; border-radius:8px;">📦</div> 
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
                badge.innerHTML = `🔧 Editing: <strong>${currentTool.name.replace(/</g, "&lt;")}</strong>`;
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
      meta.innerHTML = `💰 <span class="meta-credits">${opts.creditsUsed.toFixed(4)}</span> credits`;
      if (opts.model) meta.innerHTML += ` · 🤖 ${opts.model}`;
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
        tag.textContent = `🌐 ${site}`;
        metaEl.appendChild(tag);
      });
    }

    document.getElementById('preview-code-js').textContent = tool.contentScript || '// No JavaScript generated';
    document.getElementById('preview-code-css').textContent = tool.styles || '/* No CSS generated */';
    document.getElementById('preview-code-config').textContent = JSON.stringify(tool.config || {}, null, 2);

    document.querySelectorAll('.code-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.getElementById('preview-code-js').style.display = tab.dataset.tab === 'js' ? 'block' : 'none';
        document.getElementById('preview-code-css').style.display = tab.dataset.tab === 'css' ? 'block' : 'none';
        document.getElementById('preview-code-config').style.display = tab.dataset.tab === 'config' ? 'block' : 'none';
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

      addMessage('ai', `🎉 **"${currentTool.name}"** has been saved and activated! It will run on the target site(s).`);

      toolPreview.style.display = 'none'; // Collapse the code preview UI, but keep editing context active
      loadInstalledTools();
    } catch (err) {
      addMessage('ai', `❌ Error saving tool: ${err.message}`);
    }
  });

  // Reject tool
  document.getElementById('btn-reject-tool').addEventListener('click', () => {
    toolPreview.style.display = 'none';
    currentTool = null;
    addMessage('ai', '🗑️ Tool discarded. Tell me what to build next!');
  });

  // Test tool
  document.getElementById('btn-test-tool').addEventListener('click', async () => {
    if (!currentTool) return;

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await ToolManager.injectToolIntoTab(tabs[0].id, currentTool);
        addMessage('ai', `🧪 Testing **"${currentTool.name}"** on the current tab. Switch to the tab to see it!`);
      }
    } catch (err) {
      addMessage('ai', `❌ Test failed: ${err.message}`);
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
