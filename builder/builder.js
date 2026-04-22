// New Order Global — AI Tool Builder Logic
// Handles chat interactions, AI generation, tool preview, and management

document.addEventListener('DOMContentLoaded', async () => {
  console.log('New Order Builder: Loaded');

  // State
  let currentTool = null; // The tool currently being built/previewed
  let chatHistory = [];
  let isGenerating = false;

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
      userPlan.textContent = (user.plan || 'free').toUpperCase();
    } else {
      userInfo.style.display = 'none';
    }
  }

  // Auth modal
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

  // Settings button → opens extension settings page
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // ============================================
  // Load Installed Tools into Sidebar
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

      // Toggle activation on click
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

  // Auto-resize textarea
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });

  btnSend.addEventListener('click', sendMessage);

  // ============================================
  // Send Message
  // ============================================
  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || isGenerating) return;

    // Check auth
    if (!NewOrderAuth.isAuthenticated()) {
      authModal.style.display = 'flex';
      return;
    }

    // Check plan
    if (!NewOrderAuth.canUseAI()) {
      addMessage('ai', '⚠️ You need a Pro or Unlimited plan to use the AI tool builder. Visit global-order.32d.one to upgrade your plan.');
      return;
    }

    // Switch to chat view
    welcomeScreen.style.display = 'none';
    chatMessages.style.display = 'flex';

    // Add user message
    addMessage('user', text);
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Add to history
    chatHistory.push({ role: 'user', content: text });

    // Show typing indicator
    isGenerating = true;
    btnSend.disabled = true;
    const typingEl = addTypingIndicator();

    try {
      // Get current tab context
      const context = await getCurrentTabContext();

      // Call AI
      const result = await NewOrderAPI.generateTool(text, context);

      // Remove typing indicator
      typingEl.remove();

      if (result.tool) {
        currentTool = result.tool;

        // Add AI response
        addMessage('ai', `✅ I've created **"${result.tool.name}"** for you!\n\n${result.tool.description}\n\n📍 **Target sites:** ${result.tool.targetSites?.join(', ') || 'All websites'}\n\nCheck the preview below to test it, iterate, or accept it.`);

        // Show tool preview
        showToolPreview(result.tool);
      } else if (result.message) {
        addMessage('ai', result.message);
      }

      // Update AI credits
      updateCreditsDisplay();

    } catch (err) {
      typingEl.remove();
      addMessage('ai', `❌ Error: ${err.message}`);
    } finally {
      isGenerating = false;
      btnSend.disabled = false;
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
  function addMessage(type, text) {
    const msg = document.createElement('div');
    msg.className = `message ${type}`;

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
    bubble.innerHTML = formatMessage(text);

    msg.appendChild(avatar);
    msg.appendChild(bubble);
    chatMessages.appendChild(msg);

    // Scroll to bottom
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
    // Simple markdown-like formatting
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

    // Meta tags
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

    // Code tabs
    document.getElementById('preview-code-js').textContent = tool.contentScript || '// No JavaScript generated';
    document.getElementById('preview-code-css').textContent = tool.styles || '/* No CSS generated */';
    document.getElementById('preview-code-config').textContent = JSON.stringify(tool.config || {}, null, 2);

    // Tab switching
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
      // Install locally
      await ToolManager.installTool(currentTool);

      // Save to cloud
      try {
        await NewOrderAPI.saveToolToCloud(currentTool);
      } catch (err) {
        console.log('Cloud save failed (will sync later):', err.message);
      }

      addMessage('ai', `🎉 **"${currentTool.name}"** has been saved and activated! It will run automatically when you visit the target site(s).`);

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
    addMessage('ai', '🗑️ Tool discarded. Tell me if you want to try again or build something different!');
  });

  // Test tool
  document.getElementById('btn-test-tool').addEventListener('click', async () => {
    if (!currentTool) return;

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await ToolManager.injectToolIntoTab(tabs[0].id, currentTool);
        addMessage('ai', `🧪 Testing **"${currentTool.name}"** on the current tab. Switch to the tab to see it in action!`);
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
      const remaining = NewOrderAuth.getAIRequestsRemaining();
      const creditsEl = document.getElementById('ai-credits');
      const countEl = document.getElementById('credits-count');

      if (NewOrderAuth.isAuthenticated() && NewOrderAuth.getPlan() !== 'unlimited') {
        creditsEl.style.display = 'inline';
        countEl.textContent = remaining;
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
