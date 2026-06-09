// Chat with Creator logic

(async function () {
  const $ = (id) => document.getElementById(id);
  
  const loadingOverlay = $('chat-loading');
  const messageContainer = $('chat-messages');
  const chatInput = $('chat-input');
  const btnSend = $('btn-send');
  const userList = $('user-list');
  const chatSidebar = $('chat-sidebar');
  const chatContainer = $('chat-container');
  const currentUserEmailEl = $('current-user-email');
  
  let currentUser = null;
  let currentAdminTargetUser = ''; // If admin, who they are talking to
  let pollInterval = null;

  function showLoading(show) {
    if (loadingOverlay) loadingOverlay.style.display = show ? 'flex' : 'none';
  }

  const toast = (msg, level) => {
    // Rely on setup toast logic if available, otherwise fallback
    let el = $('setup-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'setup-toast';
      el.style.position = 'fixed';
      el.style.bottom = '20px';
      el.style.left = '50%';
      el.style.transform = 'translateX(-50%)';
      el.style.padding = '12px 24px';
      el.style.borderRadius = '8px';
      el.style.zIndex = '9999';
      el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      el.style.transition = 'all 0.3s ease';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background = level === 'error' ? 'var(--danger-bg, #fee4e2)' : 'var(--success-bg, #d1fadf)';
    el.style.color = level === 'error' ? 'var(--danger, #b42318)' : 'var(--success, #027a48)';
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  };

  // Escapes HTML to prevent XSS
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatTime(dateString) {
    const d = new Date(dateString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderMessage(msg) {
    const div = document.createElement('div');
    const isMine = (currentUser.role === 'admin' && msg.senderRole === 'admin') || 
                   (currentUser.role !== 'admin' && msg.senderRole === 'user');
    
    div.className = `message ${isMine ? 'message-user' : 'message-admin'}`;
    
    const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Convert newlines to <br> safely so textarea line breaks render properly
    const contentHtml = escapeHtml(msg.content).replace(/\n/g, '<br>');
    
    div.innerHTML = `
      <div class="message-content">${contentHtml}</div>
      <div class="message-time">${time}</div>
    `;
    return div;
  }

  function renderDateDivider(date) {
    const div = document.createElement('div');
    div.className = 'chat-date-divider';
    
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    let text = '';
    if (date.toLocaleDateString() === today.toLocaleDateString()) {
      text = 'Today';
    } else if (date.toLocaleDateString() === yesterday.toLocaleDateString()) {
      text = 'Yesterday';
    } else {
      text = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    }
    
    div.innerHTML = `<span>${text}</span>`;
    return div;
  }

  async function loadMessages() {
    try {
      let url = '/api/chat';
      if (currentUser.role === 'admin' && currentAdminTargetUser) {
        url = `/api/chat/admin/messages/${currentAdminTargetUser}`;
      } else if (currentUser.role === 'admin' && !currentAdminTargetUser) {
        messageContainer.innerHTML = '<div class="chat-empty">Select a user to view their messages</div>';
        return;
      }

      const res = await window.NewOrderAPI.request(url);
      
      const wasAtBottom = messageContainer.scrollHeight - messageContainer.scrollTop <= messageContainer.clientHeight + 10;
      
      messageContainer.innerHTML = '';
      
      if (!res.messages || res.messages.length === 0) {
        if (currentUser.role === 'admin') {
          messageContainer.innerHTML = `
            <div class="chat-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <p>No messages with this user yet.</p>
            </div>
          `;
        } else {
          messageContainer.innerHTML = `
            <div class="chat-empty" style="padding-top: 40px;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary); opacity: 0.8; width: 56px; height: 56px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <h3 style="font-family: var(--font-headline); font-size: 20px; font-weight: 600; color: var(--on-surface); margin: 0 0 12px;">Welcome to Creator Chat!</h3>
              <p style="color: var(--on-surface-variant); font-size: 15px; max-width: 420px; line-height: 1.5; margin: 0 0 20px;">
                This is your direct, private line to me. I'd love to hear your thoughts! Feel free to use this space to:
              </p>
              <ul style="text-align: left; background: var(--surface-container); padding: 20px 20px 20px 40px; border-radius: 16px; border: 1px solid var(--ghost-border); color: var(--on-surface); font-size: 14.5px; line-height: 1.7; max-width: 420px; width: 100%; margin: 0 0 24px;">
                <li>💡 Suggest new extension features</li>
                <li>🤖 Request specific AI models</li>
                <li>🛠 Ask for help or report bugs</li>
                <li>🚀 Share ideas for improvements</li>
              </ul>
              <p style="font-size: 13px; color: var(--on-surface-muted);">Or just say hello! I read every message.</p>
            </div>
          `;
        }
      } else {
        let lastDateString = null;
        res.messages.forEach(msg => {
          const msgDate = new Date(msg.createdAt);
          const dateString = msgDate.toLocaleDateString();
          
          if (dateString !== lastDateString) {
            messageContainer.appendChild(renderDateDivider(msgDate));
            lastDateString = dateString;
          }
          
          messageContainer.appendChild(renderMessage(msg));
        });
      }

      // Mark as read
      if (res.messages && res.messages.length > 0) {
        const body = {};
        if (currentUser.role === 'admin') body.userId = currentAdminTargetUser;
        await window.NewOrderAPI.request('/api/chat/read', {
          method: 'POST',
          body: JSON.stringify(body)
        });

        // Update global sidebar badge if available
        if (window.NewOrderAuth && window.NewOrderAuth.fetchAndUpdateUnreadBadge) {
          window.NewOrderAuth.fetchAndUpdateUnreadBadge();
        }
      }

      if (wasAtBottom || res.messages.length === 0) {
        messageContainer.scrollTop = messageContainer.scrollHeight;
      }
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    if (currentUser.role === 'admin' && !currentAdminTargetUser) {
      toast('Please select a user to message.', 'error');
      return;
    }

    chatInput.disabled = true;
    btnSend.disabled = true;

    try {
      const body = { content: text };
      if (currentUser.role === 'admin') {
        body.userId = currentAdminTargetUser;
      }

      await window.NewOrderAPI.request('/api/chat', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      chatInput.value = '';
      chatInput.style.height = 'auto'; // Reset height
      await loadMessages();
      messageContainer.scrollTop = messageContainer.scrollHeight;
    } catch (e) {
      toast(e.message || 'Failed to send message', 'error');
    } finally {
      chatInput.disabled = false;
      btnSend.disabled = false;
      chatInput.focus();
    }
  }

  async function loadAdminUsers() {
    try {
      const res = await window.NewOrderAPI.request('/api/chat/admin/users');
      
      if (!res.users || res.users.length === 0) {
        userList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--on-surface-muted); font-size: 14px;">No conversations yet</div>';
        return;
      }

      userList.innerHTML = '';
      res.users.forEach(u => {
        const div = document.createElement('div');
        div.className = `chat-user-item ${u.user._id === currentAdminTargetUser ? 'active' : ''}`;
        
        const userName = u.user.displayName || u.user.email || 'Unknown User';
        let html = `<div class="chat-user-email">${escapeHtml(userName)}</div>`;
        if (u.unreadCount > 0) {
          html += `<div class="chat-unread-badge">${u.unreadCount}</div>`;
        }
        
        div.innerHTML = html;
        div.addEventListener('click', () => {
          currentAdminTargetUser = u.user._id;
          currentUserEmailEl.textContent = u.user.displayName || u.user.email || 'Unknown User';
          
          // Update active class
          document.querySelectorAll('.chat-user-item').forEach(el => el.classList.remove('active'));
          div.classList.add('active');
          
          chatInput.disabled = false;
          btnSend.disabled = false;
          loadMessages();
        });
        userList.appendChild(div);
      });
    } catch (e) {
      console.error('Failed to load users for admin', e);
    }
  }

  async function init() {
    showLoading(true);
    
    // Auth gate
    const auth = window.NewOrderAuth || window.Auth;
    if (auth && typeof auth.requireAuth === 'function') {
      const ok = await auth.requireAuth();
      if (!ok) return;
    }

    // Get current user info to check role
    try {
      const res = await window.NewOrderAPI.request('/api/auth/profile');
      currentUser = res.user || res; // depending on API response shape
    } catch (e) {
      toast('Authentication failed', 'error');
      showLoading(false);
      return;
    }

    if (currentUser && currentUser.role === 'admin') {
      chatSidebar.style.display = 'flex';
      chatContainer.classList.add('admin-mode');
      $('chat-title').textContent = 'Admin Mode - Support';
      $('chat-subtitle').textContent = 'Select a conversation from the sidebar to reply.';
      await loadAdminUsers();
    } else {
      chatInput.disabled = false;
      btnSend.disabled = false;
      await loadMessages();
    }

    showLoading(false);

    // Set up events
    btnSend.addEventListener('click', sendMessage);
    
    // Auto-expand textarea
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      const scrollHeight = chatInput.scrollHeight;
      chatInput.style.height = Math.min(scrollHeight, 150) + 'px';
      chatInput.style.overflowY = scrollHeight > 150 ? 'auto' : 'hidden';
    });

    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Polling
    pollInterval = setInterval(() => {
      if ((currentUser.role === 'admin' && currentAdminTargetUser) || currentUser.role !== 'admin') {
        loadMessages();
      }
      if (currentUser.role === 'admin') {
        loadAdminUsers();
      }
    }, 5000);
  }

  // Run init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
