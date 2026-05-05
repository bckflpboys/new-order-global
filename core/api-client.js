// New Order Global — API Client
// Handles all communication with the backend server

const NewOrderAPI = (() => {
  // Default cloud API server URL
  const DEFAULT_BASE_URL = 'https://apiv2.global-order.32d.one';
  // For testing (Render):
  // const DEFAULT_BASE_URL = 'https://api.global-order.32d.one';

  // Dynamic BASE_URL — checks chrome.storage.local for a custom server URL
  // (self-hosted / local users can set their own). Falls back to cloud.
  let _cachedBaseUrl = null;

  async function getBaseUrl() {
    if (_cachedBaseUrl) return _cachedBaseUrl;
    return new Promise((resolve) => {
      chrome.storage.local.get(['noServerUrl'], (result) => {
        _cachedBaseUrl = result.noServerUrl || DEFAULT_BASE_URL;
        resolve(_cachedBaseUrl);
      });
    });
  }

  function setBaseUrl(url) {
    _cachedBaseUrl = url || DEFAULT_BASE_URL;
    chrome.storage.local.set({ noServerUrl: _cachedBaseUrl });
  }

  function resetBaseUrl() {
    _cachedBaseUrl = null;
    chrome.storage.local.remove('noServerUrl');
  }

  // Synchronous getter for code that can't await (returns null if not cached yet)
  function getBaseUrlSync() {
    return _cachedBaseUrl || DEFAULT_BASE_URL;
  }

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
  // Status codes worth retrying — transient upstream/gateway problems ONLY.
  // 504 in particular is what Cloudflare returns (as HTML) when the
  // origin took too long to answer (e.g. slow OpenRouter planner call).
  // Notably we do NOT retry on 500: most of our POST endpoints (/step,
  // /answer, /brief) are NOT idempotent — retrying them creates duplicate
  // steps and triggers Mongoose VersionError on concurrent saves.
  const RETRYABLE_STATUS = new Set([408, 425, 429, 502, 503, 504]);
  const DEFAULT_MAX_ATTEMPTS = 3;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Robust body parser: tries JSON, falls back to text. Gateway timeouts
  // (504) and other proxy errors typically return an HTML page, not JSON,
  // which used to crash the client with "Unexpected token '<'".
  async function safeParseBody(response) {
    const ct = (response.headers.get('content-type') || '').toLowerCase();
    let text = '';
    try { text = await response.text(); } catch { /* ignore */ }
    if (ct.includes('application/json') && text) {
      try { return { json: JSON.parse(text), text }; } catch { /* fall through */ }
    }
    // Try JSON anyway in case content-type was wrong
    if (text) {
      try { return { json: JSON.parse(text), text }; } catch { /* not JSON */ }
    }
    return { json: null, text };
  }

  function shortStatusMessage(status, text) {
    if (status === 504) return 'The server took too long to respond (gateway timeout). Please try again.';
    if (status === 502 || status === 503) return 'The server is temporarily unavailable. Please try again.';
    if (status === 429) return 'Rate limited. Please wait a moment and try again.';
    // Strip any HTML so we never leak "<html>..." into the UI
    const clean = (text || '').replace(/<[^>]+>/g, '').trim().substring(0, 200);
    return clean || `Request failed (${status})`;
  }

  async function request(endpoint, options = {}) {
    const token = await getToken();
    const baseUrl = await getBaseUrl();
    const url = `${baseUrl}${endpoint}`;
    const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;

    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    };

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, { ...options, headers });
        const { json, text } = await safeParseBody(response);

        if (!response.ok) {
          // Token expiry (don't retry, don't treat as transient)
          if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register')) {
            await clearToken();
            throw new Error('Session expired. Please sign in again.');
          }

          // Retry transient gateway / overload errors with exponential backoff
          if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
            const delay = Math.min(8000, 800 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 300);
            console.warn(`[NewOrderAPI] ${endpoint} → ${response.status}, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
            await sleep(delay);
            continue;
          }

          const msg = (json && (json.error || json.message)) || shortStatusMessage(response.status, text);
          const err = new Error(msg);
          err.status = response.status;
          err.retryable = RETRYABLE_STATUS.has(response.status);
          throw err;
        }

        // OK but body wasn't JSON — shouldn't normally happen
        if (!json) {
          throw new Error('Server returned an unexpected response. Please try again.');
        }
        return json;
      } catch (error) {
        lastError = error;
        const isNetwork = error.message && (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.name === 'TypeError');
        // Retry network errors too
        if (isNetwork && attempt < maxAttempts) {
          const delay = Math.min(8000, 800 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 300);
          console.warn(`[NewOrderAPI] ${endpoint} network error, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts}): ${error.message}`);
          await sleep(delay);
          continue;
        }
        if (isNetwork) {
          throw new Error('Cannot reach server. Please check your internet connection.');
        }
        throw error;
      }
    }
    throw lastError || new Error('Request failed after retries');
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

  async function updateModelPreferences(builderModel, agentModel) {
    const data = await request('/api/auth/model-preferences', {
      method: 'PUT',
      body: JSON.stringify({ builderModel, agentModel })
    });
    await setUser(data.user);
    return data.user;
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
  // AI Tool Generation — Streaming
  // ============================================
  async function generateToolStream(prompt, context = {}, modelId = 'gemini-2-5-flash', conversationId = null, onChunk = null) {
    const token = await getToken();
    const baseUrl = await getBaseUrl();
    const url = `${baseUrl}/api/ai/generate-stream`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        prompt,
        currentUrl: context.currentUrl || '',
        currentSite: context.currentSite || '',
        pageTitle: context.pageTitle || '',
        modelId,
        conversationId
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return parseSSEStream(response, onChunk);
  }

  async function iterateToolStream(toolId, feedback, currentCode, modelId = 'gemini-2-5-flash', conversationId = null, onChunk = null) {
    const token = await getToken();
    const baseUrl = await getBaseUrl();
    const url = `${baseUrl}/api/ai/iterate-stream`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        toolId,
        feedback,
        currentCode,
        modelId,
        conversationId
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return parseSSEStream(response, onChunk);
  }

  async function parseSSEStream(response, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;
    let currentEvent = '';
    let dataBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
          dataBuffer = '';
        } else if (line.startsWith('data: ')) {
          dataBuffer += line.slice(6);
        } else if (line === '' && currentEvent && dataBuffer) {
          // Empty line = end of SSE event, process it now
          try {
            const data = JSON.parse(dataBuffer);

            if (currentEvent === 'chunk' && onChunk) {
              onChunk(data.content, data);
            } else if (currentEvent === 'start') {
              if (onChunk) onChunk(null, { type: 'start', model: data.model });
            } else if (currentEvent === 'done') {
              finalResult = data;
              if (data.usage?.creditsRemaining !== undefined) {
                const user = await getUser();
                if (user) {
                  user.credits = data.usage.creditsRemaining;
                  await setUser(user);
                }
              }
            } else if (currentEvent === 'error') {
              throw new Error(data.error || 'Streaming error');
            }
          } catch (e) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
          currentEvent = '';
          dataBuffer = '';
        }
      }
    }

    // Process any remaining event in buffer
    if (currentEvent && dataBuffer) {
      try {
        const data = JSON.parse(dataBuffer);
        if (currentEvent === 'done') {
          finalResult = data;
          if (data.usage?.creditsRemaining !== undefined) {
            const user = await getUser();
            if (user) {
              user.credits = data.usage.creditsRemaining;
              await setUser(user);
            }
          }
        } else if (currentEvent === 'error') {
          throw new Error(data.error || 'Streaming error');
        }
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }

    return finalResult;
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
    updateModelPreferences,

    // AI
    generateTool,
    iterateTool,
    generateToolStream,
    iterateToolStream,

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
    getBaseUrl,
    setBaseUrl,
    resetBaseUrl,
    getBaseUrlSync,
    DEFAULT_BASE_URL
  };
})();

// Export for use in other modules
if (typeof globalThis !== 'undefined') {
  globalThis.NewOrderAPI = NewOrderAPI;
}
