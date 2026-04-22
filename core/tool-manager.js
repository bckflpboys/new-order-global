// New Order Global — Tool Manager
// Manages installed tools, activation, and content script injection

const ToolManager = (() => {
  const TOOLS_STORAGE_KEY = 'noInstalledTools';
  const ACTIVE_TOOLS_KEY = 'noActiveTools';

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

  // ============================================
  // Tool Code Wrapper
  // ============================================
  function buildToolWrapper(tool) {
    // Wraps the AI-generated code in a safe IIFE with:
    // - Guard against double-injection
    // - Access to chrome.storage for data persistence
    // - A cleanup function
    // - Console namespacing
    return `
(function() {
  'use strict';

  // Guard against double-injection
  if (window.__noTool_${tool.id.replace(/[^a-zA-Z0-9]/g, '_')}) return;
  window.__noTool_${tool.id.replace(/[^a-zA-Z0-9]/g, '_')} = true;

  const TOOL_ID = '${tool.id}';
  const TOOL_NAME = '${tool.name.replace(/'/g, "\\'")}';

  console.log('[New Order] Tool active: ' + TOOL_NAME);

  // Storage helpers for this tool
  const ToolStorage = {
    async get(key) {
      return new Promise((resolve) => {
        const storageKey = 'toolData_' + TOOL_ID + '_' + key;
        chrome.storage.local.get([storageKey], (result) => {
          resolve(result[storageKey] || null);
        });
      });
    },
    async set(key, value) {
      return new Promise((resolve) => {
        const storageKey = 'toolData_' + TOOL_ID + '_' + key;
        chrome.storage.local.set({ [storageKey]: value }, resolve);
      });
    },
    async getAll() {
      return new Promise((resolve) => {
        chrome.storage.local.get(null, (result) => {
          const prefix = 'toolData_' + TOOL_ID + '_';
          const data = {};
          Object.keys(result).forEach(key => {
            if (key.startsWith(prefix)) {
              data[key.replace(prefix, '')] = result[key];
            }
          });
          resolve(data);
        });
      });
    },
    async clear() {
      return new Promise((resolve) => {
        chrome.storage.local.get(null, (result) => {
          const prefix = 'toolData_' + TOOL_ID + '_';
          const keysToRemove = Object.keys(result).filter(k => k.startsWith(prefix));
          chrome.storage.local.remove(keysToRemove, resolve);
        });
      });
    }
  };

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
    toast.textContent = message;
    toast.style.cssText = \`
      position: fixed;
      bottom: 30px;
      right: 30px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      padding: 14px 24px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 8px 32px rgba(102, 126, 234, 0.4);
      z-index: 999999;
      animation: noToastIn 0.3s ease;
      font-family: 'Inter', system-ui, sans-serif;
    \`;

    const style = document.createElement('style');
    style.textContent = \`
      @keyframes noToastIn { from { transform: translateY(20px); opacity: 0; } }
      @keyframes noToastOut { to { transform: translateY(20px); opacity: 0; } }
    \`;
    document.head.appendChild(style);
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'noToastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Cleanup function — called when tool is deactivated
  window.__noToolCleanup_${tool.id.replace(/[^a-zA-Z0-9]/g, '_')} = function() {
    // Remove all elements injected by this tool
    document.querySelectorAll('[data-no-tool="${tool.id}"]').forEach(el => el.remove());
    window.__noTool_${tool.id.replace(/[^a-zA-Z0-9]/g, '_')} = false;
    console.log('[New Order] Tool deactivated: ' + TOOL_NAME);
  };

  // ============ USER TOOL CODE START ============
  try {
    ${tool.contentScript}
  } catch (err) {
    console.error('[New Order] Tool error in ' + TOOL_NAME + ':', err);
    showToolToast('Tool error: ' + err.message);
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
          const script = document.createElement('script');
          script.textContent = code;
          document.documentElement.appendChild(script);
          script.remove();
        },
        args: [wrappedCode],
        world: 'MAIN'
      });

      // Fallback: inject directly in the isolated world
      await chrome.scripting.executeScript({
        target: { tabId },
        func: new Function(wrappedCode),
        world: 'ISOLATED'
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
    if (!tool.targetSites || tool.targetSites.length === 0) return false;

    return tool.targetSites.some(pattern => {
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
    buildToolWrapper
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.ToolManager = ToolManager;
}
