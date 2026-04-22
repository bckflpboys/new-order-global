// New Order Global — Tool Runtime
// Injected into pages to run AI-generated tool code
// This file runs as a content script and provides the runtime environment

(function () {
  'use strict';

  // Guard against double-injection
  if (window.__noRuntimeLoaded) return;
  window.__noRuntimeLoaded = true;

  console.log('[New Order Global] Runtime loaded');

  // ============================================
  // Listen for tool injection commands from background
  // ============================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'noPing') {
      sendResponse({ pong: true, runtime: true });
      return;
    }

    if (message.type === 'noInjectTool') {
      try {
        executeTool(message.tool);
        sendResponse({ success: true });
      } catch (err) {
        console.error('[New Order Global] Tool injection error:', err);
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (message.type === 'noRemoveTool') {
      try {
        removeTool(message.toolId);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (message.type === 'noGetActiveTools') {
      sendResponse({ tools: Object.keys(window.__noActiveTools || {}) });
      return;
    }
  });

  // Track active tools on this page
  window.__noActiveTools = window.__noActiveTools || {};

  // ============================================
  // Execute a tool's code
  // ============================================
  function executeTool(tool) {
    if (!tool || !tool.id) {
      throw new Error('Invalid tool object');
    }

    if (window.__noActiveTools[tool.id]) {
      console.log(`[New Order Global] Tool "${tool.name}" already active on this page`);
      return;
    }

    console.log(`[New Order Global] Executing tool: ${tool.name}`);

    // Inject styles
    if (tool.styles) {
      const styleEl = document.createElement('style');
      styleEl.id = `no-tool-style-${tool.id}`;
      styleEl.setAttribute('data-no-tool', tool.id);
      styleEl.textContent = tool.styles;
      document.head.appendChild(styleEl);
    }

    // Execute the content script
    if (tool.contentScript) {
      try {
        // Use Function constructor for execution in content script context
        const toolFn = new Function(
          'ToolStorage', 'downloadData', 'showToolToast', 'TOOL_ID', 'TOOL_NAME',
          tool.contentScript
        );

        const storage = createToolStorage(tool.id);
        toolFn(
          storage,
          downloadData,
          showToolToast,
          tool.id,
          tool.name
        );

        window.__noActiveTools[tool.id] = {
          name: tool.name,
          startedAt: Date.now()
        };

      } catch (err) {
        console.error(`[New Order Global] Error executing tool "${tool.name}":`, err);
        showToolToast(`Error in "${tool.name}": ${err.message}`);
      }
    }
  }

  // ============================================
  // Remove a tool from the page
  // ============================================
  function removeTool(toolId) {
    // Remove styles
    const styleEl = document.getElementById(`no-tool-style-${toolId}`);
    if (styleEl) styleEl.remove();

    // Remove all injected DOM elements
    document.querySelectorAll(`[data-no-tool="${toolId}"]`).forEach(el => el.remove());

    // Call cleanup function if registered
    const cleanupKey = `__noToolCleanup_${toolId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    if (typeof window[cleanupKey] === 'function') {
      try {
        window[cleanupKey]();
      } catch (e) {
        console.warn('[New Order Global] Cleanup error:', e);
      }
    }

    delete window.__noActiveTools[toolId];
    console.log(`[New Order Global] Tool "${toolId}" removed from page`);
  }

  // ============================================
  // Tool Storage API (per-tool isolated storage)
  // ============================================
  function createToolStorage(toolId) {
    const prefix = `toolData_${toolId}_`;

    return {
      async get(key) {
        return new Promise((resolve) => {
          const storageKey = prefix + key;
          chrome.storage.local.get([storageKey], (result) => {
            resolve(result[storageKey] || null);
          });
        });
      },

      async set(key, value) {
        return new Promise((resolve) => {
          const storageKey = prefix + key;
          chrome.storage.local.set({ [storageKey]: value }, resolve);
        });
      },

      async getAll() {
        return new Promise((resolve) => {
          chrome.storage.local.get(null, (result) => {
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

      async remove(key) {
        return new Promise((resolve) => {
          chrome.storage.local.remove([prefix + key], resolve);
        });
      },

      async clear() {
        return new Promise((resolve) => {
          chrome.storage.local.get(null, (result) => {
            const keysToRemove = Object.keys(result).filter(k => k.startsWith(prefix));
            if (keysToRemove.length > 0) {
              chrome.storage.local.remove(keysToRemove, resolve);
            } else {
              resolve();
            }
          });
        });
      }
    };
  }

  // ============================================
  // Shared Utilities
  // ============================================
  function downloadData(data, filename, type = 'application/json') {
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function showToolToast(message, duration = 3000) {
    const existing = document.querySelector('.no-tool-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'no-tool-toast';
    toast.textContent = message;
    toast.style.cssText = `
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
      animation: noToastSlideIn 0.3s ease;
      font-family: 'Inter', system-ui, sans-serif;
      pointer-events: none;
    `;

    // Inject animation if not already present
    if (!document.getElementById('no-toast-animations')) {
      const style = document.createElement('style');
      style.id = 'no-toast-animations';
      style.textContent = `
        @keyframes noToastSlideIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes noToastSlideOut { from { transform: translateY(0); opacity: 1; } to { transform: translateY(20px); opacity: 0; } }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'noToastSlideOut 0.3s ease forwards';
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
      }, 300);
    }, duration);
  }

})();
