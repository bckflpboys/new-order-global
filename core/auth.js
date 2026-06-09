// New Order Global — Auth Module
// Manages user authentication state within the extension

const NewOrderAuth = (() => {
  let _currentUser = null;
  let _isInitialized = false;

  // ============================================
  // Initialize auth state
  // ============================================
  async function init() {
    if (_isInitialized) return _currentUser;

    try {
      _currentUser = await NewOrderAPI.getUser();
      if (_currentUser) {
        // Verify token is still valid
        const isValid = await NewOrderAPI.isLoggedIn();
        if (!isValid) {
          _currentUser = null;
        } else {
          fetchAndUpdateUnreadBadge();
        }
      }
    } catch (err) {
      console.log('New Order Auth: Init check failed:', err.message);
      _currentUser = null;
    }

    _isInitialized = true;
    return _currentUser;
  }

  // ============================================
  // Local cleanup helper
  // ============================================
  async function _wipeLocalTools(includeData = true) {
    try {
      if (typeof ToolManager !== 'undefined' && ToolManager.clearAllLocal) {
        await ToolManager.clearAllLocal({ includeData });
        return;
      }
    } catch (_) {}
    // Fallback brute-clear if ToolManager isn't loaded on this page
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const keys = Object.keys(items).filter(k =>
          k === 'noInstalledTools' ||
          k === 'noActiveTools' ||
          k === 'noLastSync' ||
          k.startsWith('toolCode_') ||
          k.startsWith('toolRunning_') ||
          (includeData && k.startsWith('toolData_'))
        );
        if (keys.length === 0) return resolve();
        chrome.storage.local.remove(keys, resolve);
      });
    });
  }

  // ============================================
  // Login
  // ============================================
  async function login(email, password) {
    // Capture previously cached user (if any) BEFORE login overwrites it
    const previousUser = await NewOrderAPI.getUser();

    const result = await NewOrderAPI.login(email, password);

    // If a different user signed in on this device, wipe the previous
    // account's tools + tool data so the UI doesn't show the old account's
    // info. Same user signing back in: keep cache so subscribers don't
    // lose their data.
    const prevId = previousUser && (previousUser.id || previousUser._id);
    const newId = result.user && (result.user.id || result.user._id);
    if (prevId && newId && String(prevId) !== String(newId)) {
      await _wipeLocalTools(true);
    } else if (!prevId) {
      // No previous user record but stale tool storage might still exist
      // from a prior install/session — clear lightly without nuking data
      // so first-time signins are clean.
      await _wipeLocalTools(false);
    }

    _currentUser = result.user;
    notifyAuthChange('login');
    return result;
  }

  // ============================================
  // Register
  // ============================================
  async function register(email, password, displayName, extras = {}) {
    // Failsafe: if extras is empty or missing, try to read from DOM
    // (popup, agent, and builder all use slightly different IDs)
    if (!extras || (!extras.tosAccepted && !extras.privacyAccepted)) {
      try {
        const tosCb = document.getElementById('popup-register-tos')
                   || document.getElementById('register-tos');
        const privacyCb = document.getElementById('popup-register-privacy')
                       || document.getElementById('register-privacy');
        if (tosCb || privacyCb) {
          extras = {
            tosAccepted: !!(tosCb && tosCb.checked),
            privacyAccepted: !!(privacyCb && privacyCb.checked)
          };
        }
      } catch (e) { /* not in DOM context */ }
    }
    
    // Brand-new account → always wipe any stale local tool state
    await _wipeLocalTools(true);

    const result = await NewOrderAPI.register(email, password, displayName, extras);
    _currentUser = result.user;
    notifyAuthChange('register');
    return result;
  }

  // ============================================
  // Logout
  // ============================================
  // options:
  //   clearTools:    remove cached tool list/code (default: true)
  //   clearToolData: remove per-tool collected data (default: true)
  // Subscribers can choose to keep their tools cached locally by passing
  // { clearTools: false, clearToolData: false }.
  async function logout(options = {}) {
    const { clearTools = true, clearToolData = true } = options;

    if (clearTools || clearToolData) {
      // If user wants to keep tools but drop data, still call wipe with
      // includeData=clearToolData. If keeping both, skip entirely.
      if (clearTools) {
        await _wipeLocalTools(clearToolData);
      } else if (clearToolData) {
        // Keep tool list + code but clear data only
        await new Promise((resolve) => {
          chrome.storage.local.get(null, (items) => {
            const keys = Object.keys(items).filter(k => k.startsWith('toolData_'));
            if (keys.length === 0) return resolve();
            chrome.storage.local.remove(keys, resolve);
          });
        });
      }
    }

    await NewOrderAPI.logout();
    _currentUser = null;
    _isInitialized = false;
    notifyAuthChange('logout');
  }

  // ============================================
  // Get current user
  // ============================================
  function getCurrentUser() {
    return _currentUser;
  }

  function isAuthenticated() {
    return _currentUser !== null;
  }

  // ============================================
  // Get user's plan info
  // ============================================
  function getPlan() {
    if (!_currentUser) return 'free';
    return _currentUser.plan || 'free';
  }

  function canUseAI() {
    const plan = getPlan();
    return plan !== 'free';
  }

  function getAIRequestsRemaining() {
    if (!_currentUser) return 0;
    const limit = _currentUser.aiRequestsLimit || 0;
    const used = _currentUser.aiRequestsUsed || 0;
    return Math.max(0, limit - used);
  }

  // ============================================
  // Notify extension of auth changes
  // ============================================
  function notifyAuthChange(action) {
    // Broadcast to all extension pages
    chrome.runtime.sendMessage({
      type: 'noAuthChanged',
      action: action,
      user: _currentUser
    }).catch(() => {
      // No listeners — fine
    });
  }

  // ============================================
  // Listen for auth changes from other parts
  // ============================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'noAuthChanged') {
      _currentUser = message.user;
      _isInitialized = true;
      if (_currentUser) fetchAndUpdateUnreadBadge();
    }
  });

  // ============================================
  // Chat Unread Badge
  // ============================================
  async function fetchAndUpdateUnreadBadge() {
    try {
      const res = await window.NewOrderAPI.request('/api/chat/unread-count');
      const count = res.unreadCount || 0;
      updateSidebarBadge(count);
    } catch(e) { /* ignore */ }
  }

  function updateSidebarBadge(count) {
    const chatLink = document.querySelector('a.nav-link[href*="chat.html"]');
    if (!chatLink) return;
    
    let badge = chatLink.querySelector('.chat-global-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'chat-global-badge';
        badge.style.cssText = 'background: var(--primary, #b8341c); color: white; font-size: 11px; font-weight: bold; padding: 2px 6px; border-radius: 10px; margin-left: auto;';
        chatLink.style.display = 'flex'; // Ensure flex layout to push badge to right
        chatLink.appendChild(badge);
      }
      badge.textContent = count;
    } else if (badge) {
      badge.remove();
    }
  }

  return {
    init,
    login,
    register,
    logout,
    getCurrentUser,
    isAuthenticated,
    getPlan,
    canUseAI,
    getAIRequestsRemaining,
    fetchAndUpdateUnreadBadge
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.NewOrderAuth = NewOrderAuth;
}
