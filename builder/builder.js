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

  // DOM References
  const welcomeScreen = document.getElementById('welcome-screen');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const toolPreview = document.getElementById('tool-preview');
  const toolsSidebar = document.getElementById('tools-sidebar');
  const authModal = document.getElementById('auth-modal');

  // ============================================
  // Initialize
  // ============================================
  await initializeAuth();
  await loadInstalledTools();
  await loadModels();
  renderSessionCredits();

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
    let selector = document.getElementById('model-selector');
    if (!selector) {
      selector = document.createElement('div');
      selector.id = 'model-selector';
      selector.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 16px;border-top:1px solid rgba(255,255,255,0.05);background:rgba(255,255,255,0.02);';
      const inputArea = document.querySelector('.chat-input-area');
      if (inputArea) inputArea.parentNode.insertBefore(selector, inputArea);
    }

    selector.innerHTML = `
      <span style="font-size:11px;color:#5a6070;white-space:nowrap;">Model:</span>
      <select id="model-select" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:white;font-size:12px;padding:6px 10px;outline:none;cursor:pointer;">
        ${availableModels.map(m => `<option value="${m.id}" ${m.id === selectedModelId ? 'selected' : ''} style="background:#1a1a25;">${m.name} — ~${m.estimatedToolCost.toFixed(2)} cr</option>`).join('')}
      </select>
      <span id="model-cost" style="font-size:11px;color:#7c5cfc;white-space:nowrap;font-weight:600;"></span>
    `;

    document.getElementById('model-select')?.addEventListener('change', (e) => {
      selectedModelId = e.target.value;
      updateModelCost();
    });
    updateModelCost();
  }

  function updateModelCost() {
    const model = availableModels.find(m => m.id === selectedModelId);
    const costEl = document.getElementById('model-cost');
    if (model && costEl) {
      costEl.textContent = `~${model.estimatedToolCost.toFixed(2)} cr`;
    }
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
    chrome.runtime.openOptionsPage();
  });

  // ============================================
  // Load Installed Tools
  // ============================================
  async function loadInstalledTools() {
    const tools = await ToolManager.getInstalledTools();
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
      const result = await NewOrderAPI.generateTool(text, context, selectedModelId);

      typingEl.remove();

      if (result.tool) {
        currentTool = result.tool;
        const creditsUsed = result.usage?.creditsUsed || 0;
        totalCreditsUsed += creditsUsed;

        addMessage('ai', `✅ I've created **"${result.tool.name}"** for you!\n\n${result.tool.description}\n\n📍 **Target:** ${result.tool.targetSites?.join(', ') || 'All websites'}\n\nCheck the preview below.`, {
          creditsUsed,
          model: result.usage?.model || selectedModelId,
        });

        showToolPreview(result.tool);
      } else if (result.message) {
        addMessage('ai', result.message);
      }

      updateCreditsDisplay();
      updateSessionCredits();

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
      chatInput.placeholder = 'Type to queue next message...';
    } else {
      btnSend.classList.remove('queuing');
      btnSend.title = 'Send';
      chatInput.placeholder = currentTool ? `How should I change "${currentTool.name}"?` : 'Describe what you want to build...';
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

      toolPreview.style.display = 'none';
      currentTool = null;
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
