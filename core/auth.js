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
  // Login
  // ============================================
  async function login(email, password) {
    const result = await NewOrderAPI.login(email, password);
    _currentUser = result.user;
    notifyAuthChange('login');
    return result;
  }

  // ============================================
  // Register
  // ============================================
  async function register(email, password, displayName) {
    const result = await NewOrderAPI.register(email, password, displayName);
    _currentUser = result.user;
    notifyAuthChange('register');
    return result;
  }

  // ============================================
  // Logout
  // ============================================
  async function logout() {
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
    }
  });

  return {
    init,
    login,
    register,
    logout,
    getCurrentUser,
    isAuthenticated,
    getPlan,
    canUseAI,
    getAIRequestsRemaining
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.NewOrderAuth = NewOrderAuth;
}
