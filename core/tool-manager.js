// New Order Global — Tool Manager
// Manages installed tools, activation, and content script injection

const ToolManager = (() => {
  const TOOLS_STORAGE_KEY = 'noInstalledTools';
  const ACTIVE_TOOLS_KEY = 'noActiveTools';
  const LAST_SYNC_KEY = 'noLastSync';

  // ============================================
  // Storage Helpers
  // ============================================
  async function getInstalledTools() {
    return new Promise((resolve) => {
      chrome.storage.local.get([TOOLS_STORAGE_KEY], (result) => {
        resolve(result[TOOLS_STORAGE_KEY] || []);
      });
    });
  }

  async function saveInstalledTools(tools) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [TOOLS_STORAGE_KEY]: tools }, resolve);
    });
  }

  async function getActiveToolIds() {
    return new Promise((resolve) => {
      chrome.storage.local.get([ACTIVE_TOOLS_KEY], (result) => {
        resolve(result[ACTIVE_TOOLS_KEY] || []);
      });
    });
  }

  async function setActiveToolIds(ids) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [ACTIVE_TOOLS_KEY]: ids }, resolve);
    });
  }

  // ============================================
  // Tool Installation
  // ============================================
  async function installTool(tool) {
    const tools = await getInstalledTools();

    // Validate tool structure
    if (!tool.id || !tool.name || !tool.contentScript) {
      throw new Error('Invalid tool: missing required fields (id, name, contentScript)');
    }

    // Check for duplicate
    const existingIndex = tools.findIndex(t => t.id === tool.id);
    if (existingIndex >= 0) {
      // Update existing
      tools[existingIndex] = {
        ...tools[existingIndex],
        ...tool,
        updatedAt: Date.now()
      };
    } else {
      // Add new
      tools.push({
        ...tool,
        installedAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    await saveInstalledTools(tools);

    // Auto-activate
    const activeIds = await getActiveToolIds();
    if (!activeIds.includes(tool.id)) {
      activeIds.push(tool.id);
      await setActiveToolIds(activeIds);
    }

    // Register content script for this tool
    await registerToolScript(tool);

    console.log(`New Order Global: Tool "${tool.name}" installed successfully`);
    return tool;
  }

  async function uninstallTool(toolId) {
    let tools = await getInstalledTools();
    tools = tools.filter(t => t.id !== toolId);
    await saveInstalledTools(tools);

    // Deactivate
    let activeIds = await getActiveToolIds();
    activeIds = activeIds.filter(id => id !== toolId);
    await setActiveToolIds(activeIds);

    // Unregister content script
    await unregisterToolScript(toolId);

    console.log(`New Order Global: Tool "${toolId}" uninstalled`);
  }

  // ============================================
  // Tool Activation / Deactivation
  // ============================================
  async function activateTool(toolId) {
    const activeIds = await getActiveToolIds();
    if (!activeIds.includes(toolId)) {
      activeIds.push(toolId);
      await setActiveToolIds(activeIds);
    }

    const tools = await getInstalledTools();
    const tool = tools.find(t => t.id === toolId);
    if (tool) {
      await registerToolScript(tool);
    }
  }

  async function deactivateTool(toolId) {
    let activeIds = await getActiveToolIds();
    activeIds = activeIds.filter(id => id !== toolId);
    await setActiveToolIds(activeIds);

    await unregisterToolScript(toolId);
  }

  async function isToolActive(toolId) {
    const activeIds = await getActiveToolIds();
    return activeIds.includes(toolId);
  }

  // ============================================
  // Content Script Registration
  // ============================================
  async function registerToolScript(tool) {
    const scriptId = `no-tool-${tool.id}`;

    try {
      // Unregister first to avoid duplicates
      try {
        await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
      } catch (e) {
        // Script wasn't registered — fine
      }

      // Build the wrapper code that runs the tool's content script
      const wrappedCode = buildToolWrapper(tool);

      // Store the wrapped code so we can inject it
      await new Promise((resolve) => {
        chrome.storage.local.set({ [`toolCode_${tool.id}`]: wrappedCode }, resolve);
      });

      console.log(`New Order Global: Tool script registered for "${tool.name}" on ${tool.targetSites?.join(', ')}`);
    } catch (err) {
      console.error(`New Order Global: Failed to register tool script:`, err);
    }
  }

  async function unregisterToolScript(toolId) {
    const scriptId = `no-tool-${toolId}`;
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
    } catch (e) {
      // Not registered — fine
    }

    // Clean up stored code
    await new Promise((resolve) => {
      chrome.storage.local.remove([`toolCode_${toolId}`], resolve);
    });
  }

  function buildToolWrapper(tool) {
    // Wraps the AI-generated code in a safe IIFE with:
    // - Guard against double-injection
    // - Bridge-based storage (works in MAIN world)
    // - A cleanup function
    // - Console namespacing
    return `
(function() {
  'use strict';

  const toolSlug = '${tool.id.replace(/[^a-zA-Z0-9]/g, '_')}';
  if (window['__noTool_' + toolSlug]) return;
  window['__noTool_' + toolSlug] = true;

  const TOOL_ID = '${tool.id}';
  const TOOL_NAME = '${tool.name.replace(/'/g, "\\'")}';

  console.log('[New Order] Tool active: ' + TOOL_NAME);

  // Storage Bridge implementation
  const ToolStorage = (() => {
    const prefix = 'toolData_' + TOOL_ID + '_';
    const pendingRequests = new Map();

    window.addEventListener('message', (event) => {
      if (event.data && event.data.source === 'no-runtime-bridge') {
        const { requestId, value, success, error } = event.data;
        if (pendingRequests.has(requestId)) {
          const { resolve, reject } = pendingRequests.get(requestId);
          pendingRequests.delete(requestId);
          if (error) reject(new Error(error));
          else resolve(value !== undefined ? value : success);
        }
      }
    });

    function request(action, params = {}) {
      const requestId = Math.random().toString(36).substr(2, 9);
      return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });
        window.postMessage({
          source: 'no-tool-context',
          type: 'storage-request',
          requestId,
          action,
          prefix,
          ...params
        }, '*');
        
        // Timeout
        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            reject(new Error('Storage request timed out. Make sure the extension is active.'));
          }
        }, 5000);
      });
    }

    return {
      get: (key) => request('get', { key }),
      set: (key, value) => request('set', { key, value }),
      remove: (key) => request('remove', { key }),
      getAll: () => request('getAll'),
      clear: () => request('clear')
    };
  })();

  // Download helper
  function downloadData(data, filename, type = 'application/json') {
    const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Toast notification
  function showToolToast(message) {
    const existing = document.querySelector('.no-tool-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'no-tool-toast';
    toast.setAttribute('data-no-tool', TOOL_ID);
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;bottom:30px;right:30px;background:#b8341c;color:white;padding:14px 24px;border-radius:12px;font-size:14px;font-weight:600;box-shadow:0 8px 28px rgba(184,52,28,0.3);z-index:999999;font-family:system-ui,-apple-system,Inter,sans-serif;pointer-events:none;transition:0.3s;';

    if (!document.getElementById('no-toast-style')) {
      const style = document.createElement('style');
      style.id = 'no-toast-style';
      style.textContent = '@keyframes noIn { from { transform:translateY(20px);opacity:0; } } .no-tool-toast { animation:noIn 0.3s ease; }';
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Cleanup handler
  window[\'__noToolCleanup_\' + toolSlug] = function() {
    document.querySelectorAll(\'[data-no-tool="\' + TOOL_ID + \'"]\').forEach(el => el.remove());
    window[\'__noTool_\' + toolSlug] = false;
    console.log(\'[New Order] Tool deactivated: \' + TOOL_NAME);
  };

  // ============ USER TOOL CODE START ============
  try {
    ${tool.contentScript}
  } catch (err) {
    console.error(\'[New Order] Tool error in \' + TOOL_NAME + \':\', err);
    showToolToast(\'Tool error: \' + err.message);
  }
  // ============ USER TOOL CODE END ============

})();
`;
  }

  // ============================================
  // Inject tool into a specific tab
  // ============================================
  async function injectToolIntoTab(tabId, tool) {
    try {
      // Inject styles first
      if (tool.styles) {
        await chrome.scripting.insertCSS({
          target: { tabId },
          css: tool.styles
        });
      }

      // Build and inject the wrapped code
      const wrappedCode = buildToolWrapper(tool);
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (code) => {
          try {
            const script = document.createElement('script');
            script.textContent = code;
            (document.head || document.documentElement).appendChild(script);
            script.remove();
          } catch (e) {
            console.error('[New Order] Script injection failed:', e);
          }
        },
        args: [wrappedCode],
        world: 'MAIN'
      });

      console.log(`New Order Global: Injected "${tool.name}" into tab ${tabId}`);
    } catch (err) {
      console.error(`New Order Global: Failed to inject tool into tab ${tabId}:`, err);
    }
  }

  // ============================================
  // Check if a URL matches any tool's target sites
  // ============================================
  function urlMatchesTool(url, tool) {
    if (!tool.targetSites || tool.targetSites.length === 0) {
      // If no sites specified, default to false (manual run Only)
      // UNLESS the tool was designed to be global.
      // But for security/UX, we usually want explicit sites.
      // However, if the tool is active and we want total automation, we should check a flag.
      return false; 
    }

    return tool.targetSites.some(pattern => {
      if (pattern === '*' || pattern === '<all_urls>' || pattern === '*://*/*') return true;
      
      // Convert Chrome match pattern to regex
      const regexStr = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
        .replace(/\\\*/g, '.*')                  // * → .*
        .replace(/^\\\*:/, '(https?|ftp):');     // *: at start → protocol
      
      try {
        return new RegExp(`^${regexStr}$`).test(url);
      } catch {
        return false;
      }
    });
  }

  // ============================================
  // Get tools that should run on a given URL
  // ============================================
  async function getToolsForUrl(url) {
    const tools = await getInstalledTools();
    const activeIds = await getActiveToolIds();

    return tools.filter(tool =>
      activeIds.includes(tool.id) && urlMatchesTool(url, tool)
    );
  }

  // ============================================
  // Inject all matching tools into a tab
  // ============================================
  async function injectToolsIntoTab(tabId, url) {
    const matchingTools = await getToolsForUrl(url);

    for (const tool of matchingTools) {
      await injectToolIntoTab(tabId, tool);
    }

    return matchingTools.length;
  }

  // ============================================
  // Get tool stats
  // ============================================
  async function getStats() {
    const tools = await getInstalledTools();
    const activeIds = await getActiveToolIds();

    return {
      total: tools.length,
      active: activeIds.length,
      tools: tools.map(t => ({
        ...t,
        isActive: activeIds.includes(t.id),
        // Don't expose full code in stats
        contentScript: undefined,
        styles: undefined
      }))
    };
  }

  // ============================================
  // Sync tools from Cloud
  // ============================================
  async function syncTools(force = false) {
    // Check if we need to sync
    if (!force) {
      const lastSync = await new Promise((resolve) => {
        chrome.storage.local.get([LAST_SYNC_KEY], (result) => {
          resolve(result[LAST_SYNC_KEY] || 0);
        });
      });

      // Sync only once every 5 minutes unless forced
      if (Date.now() - lastSync < 5 * 60 * 1000) {
        console.log('New Order Global: Tools already synced recently');
        return await getStats();
      }
    }

    try {
      console.log('New Order Global: Syncing tools from cloud...');
      const cloudTools = await NewOrderAPI.getUserTools();
      
      if (!Array.isArray(cloudTools)) return await getStats();

      // Save each tool locally — map _id to id for local storage compatibility
      for (const ct of cloudTools) {
        const tool = {
          ...ct,
          id: ct._id || ct.id,
          dashboardHTML: ct.dashboardHTML || '',
          storageSchema: ct.storageSchema || {},
          conversationId: ct.conversationId || null
        };
        await installTool(tool);
      }

      // Update last sync time
      await new Promise((resolve) => {
        chrome.storage.local.set({ [LAST_SYNC_KEY]: Date.now() }, resolve);
      });

      return await getStats();
    } catch (err) {
      console.error('New Order Global: Failed to sync tools:', err);
      // Return local tools even if sync failed
      return await getStats();
    }
  }

  // ============================================
  // Local Wipe (used on user switch / sign out)
  // ============================================
  // Clears tools + per-tool wrapped code from chrome.storage.local.
  // If includeData is true, ALSO clears each tool's collected data (toolData_*).
  // If includeData is false, the tool data stays so subscribers can keep it
  // around for when they sign back in.
  async function clearAllLocal(options = {}) {
    const { includeData = true } = options;

    // Best-effort: unregister any registered content scripts so nothing keeps
    // running on the previous account's behalf.
    try {
      const tools = await getInstalledTools();
      for (const t of tools) {
        try { await chrome.scripting.unregisterContentScripts({ ids: [`no-tool-${t.id}`] }); } catch (_) {}
      }
    } catch (_) {}

    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const keys = Object.keys(items).filter(k =>
          k === TOOLS_STORAGE_KEY ||
          k === ACTIVE_TOOLS_KEY ||
          k === LAST_SYNC_KEY ||
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
  // Public API
  // ============================================
  return {
    getInstalledTools,
    installTool,
    uninstallTool,
    activateTool,
    deactivateTool,
    isToolActive,
    injectToolIntoTab,
    injectToolsIntoTab,
    getToolsForUrl,
    getStats,
    getTools: getStats, // Alias for convenience
    syncTools,
    buildToolWrapper,
    clearAllLocal
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.ToolManager = ToolManager;
}
