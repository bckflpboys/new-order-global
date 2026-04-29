// New Order Global — API Client
// Handles all communication with the backend server

const NewOrderAPI = (() => {
  // Backend API server URL 
  const BASE_URL = 'https://apiv2.global-order.32d.one';
  // For testing (Render):
  // const BASE_URL = 'https://api.global-order.32d.one';
  // For local development:
  // const BASE_URL = 'http://localhost:3001';

  let _authToken = null;
  let _user = null;

  // ============================================
  // Token Management
  // ============================================
  async function getToken() {
    if (_authToken) return _authToken;

    return new Promise((resolve) => {
      chrome.storage.local.get(['noAuthToken'], (result) => {
        _authToken = result.noAuthToken || null;
        resolve(_authToken);
      });
    });
  }

  async function setToken(token) {
    _authToken = token;
    return new Promise((resolve) => {
      chrome.storage.local.set({ noAuthToken: token }, resolve);
    });
  }

  async function clearToken() {
    _authToken = null;
    _user = null;
    return new Promise((resolve) => {
      chrome.storage.local.remove(['noAuthToken', 'noUser'], resolve);
    });
  }

  async function getUser() {
    if (_user) return _user;

    return new Promise((resolve) => {
      chrome.storage.local.get(['noUser'], (result) => {
        _user = result.noUser || null;
        resolve(_user);
      });
    });
  }

  async function setUser(user) {
    _user = user;
    return new Promise((resolve) => {
      chrome.storage.local.set({ noUser: user }, resolve);
    });
  }

  // ============================================
  // HTTP Helpers
  // ============================================
  async function request(endpoint, options = {}) {
    const token = await getToken();
    const url = `${BASE_URL}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle token expiry, EXCEPT for login/register where 401 means invalid credentials
        if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register')) {
          await clearToken();
          throw new Error('Session expired. Please sign in again.');
        }
        throw new Error(data.error || data.message || `Request failed (${response.status})`);
      }

      return data;
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Cannot reach server. Please check your internet connection.');
      }
      throw error;
    }
  }

  // ============================================
  // Auth Endpoints
  // ============================================
  async function login(email, password) {
    const data = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    await setToken(data.token);
    await setUser(data.user);
    return data;
  }

  async function register(email, password, displayName, extras = {}) {
    const data = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        displayName,
        tosAccepted: !!extras.tosAccepted,
        privacyAccepted: !!extras.privacyAccepted
      })
    });
    await setToken(data.token);
    await setUser(data.user);
    return data;
  }

  async function logout() {
    await clearToken();
  }

  async function getProfile() {
    const data = await request('/api/auth/profile');
    await setUser(data.user);
    return data.user;
  }

  async function isLoggedIn() {
    const token = await getToken();
    if (!token) return false;

    try {
      await getProfile();
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // AI Tool Generation
  // ============================================
  async function generateTool(prompt, context = {}, modelId = 'gemini-2-5-flash', conversationId = null) {
    const data = await request('/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        currentUrl: context.currentUrl || '',
        currentSite: context.currentSite || '',
        pageTitle: context.pageTitle || '',
        modelId,
        conversationId
      })
    });

    // Update local user credits
    if (data.usage?.creditsRemaining !== undefined) {
      const user = await getUser();
      if (user) {
        user.credits = data.usage.creditsRemaining;
        await setUser(user);
      }
    }

    return data;
  }

  async function iterateTool(toolId, feedback, currentCode, modelId = 'gemini-2-5-flash', conversationId = null) {
    const data = await request('/api/ai/iterate', {
      method: 'POST',
      body: JSON.stringify({
        toolId,
        feedback,
        currentCode,
        modelId,
        conversationId
      })
    });

    if (data.usage?.creditsRemaining !== undefined) {
      const user = await getUser();
      if (user) {
        user.credits = data.usage.creditsRemaining;
        await setUser(user);
      }
    }

    return data;
  }

  // ============================================
  // Tool CRUD
  // ============================================
  async function saveToolToCloud(tool) {
    const data = await request('/api/tools', {
      method: 'POST',
      body: JSON.stringify(tool)
    });
    return data;
  }

  async function getUserTools() {
    const data = await request('/api/tools');
    return data.tools || [];
  }

  async function getToolById(toolId) {
    const data = await request(`/api/tools/${toolId}`);
    return data.tool;
  }

  async function updateTool(toolId, updates) {
    const data = await request(`/api/tools/${toolId}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    return data;
  }

  async function deleteTool(toolId) {
    const data = await request(`/api/tools/${toolId}`, {
      method: 'DELETE'
    });
    return data;
  }

  // ============================================
  // Subscription / Billing
  // ============================================
  async function getCredits() {
    const data = await request('/api/billing/credits');
    return data;
  }

  async function getPurchases() {
    const data = await request('/api/billing/purchases');
    return data;
  }

  async function createCheckout(packageId) {
    const data = await request('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ packageId })
    });
    return data;
  }

  async function createSubscription(planId) {
    const data = await request('/api/billing/subscribe', {
      method: 'POST',
      body: JSON.stringify({ planId })
    });
    return data;
  }

  async function cancelSubscription() {
    const data = await request('/api/billing/cancel-subscription', {
      method: 'POST'
    });
    return data;
  }

  // ============================================
  // Conversations
  // ============================================
  async function getConversations() {
    const data = await request('/api/conversations');
    return data.conversations || [];
  }

  async function getConversationById(id) {
    const data = await request(`/api/conversations/${id}`);
    return data.conversation;
  }

  // ============================================
  // Onboarding
  // ============================================
  async function getOnboarding() {
    const data = await request('/api/onboarding');
    return data;
  }

  async function updateOnboarding(updates) {
    const data = await request('/api/onboarding', {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    return data;
  }

  async function completeOnboarding() {
    const data = await request('/api/onboarding/complete', {
      method: 'POST'
    });
    return data;
  }

  // ============================================
  // Public API
  // ============================================
  return {
    // Auth
    login,
    register,
    logout,
    getProfile,
    isLoggedIn,
    getUser,
    getToken,

    // AI
    generateTool,
    iterateTool,

    // Tools
    saveToolToCloud,
    getUserTools,
    getToolById,
    updateTool,
    deleteTool,

    // Conversations
    getConversations,
    getConversationById,

    // Onboarding
    getOnboarding,
    updateOnboarding,
    completeOnboarding,

    // Billing
    getCredits,
    getPurchases,
    createCheckout,
    createSubscription,
    cancelSubscription,

    // Generic request (for model loading etc)
    request,

    // Config
    BASE_URL
  };
})();

// Export for use in other modules
if (typeof globalThis !== 'undefined') {
  globalThis.NewOrderAPI = NewOrderAPI;
}
