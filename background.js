// New Order Global — Background Service Worker
// Handles: YouTube tool, AI tool management, tab injection, settings, API bridge
//
// ARCHITECTURE:
// - YouTube content scripts registered dynamically (avoids "Reload this page" notification)
// - AI-generated tools injected on-demand based on URL matching
// - Core modules (api-client, tool-manager, auth) loaded for background context

// ============================================
// Import core modules
// ============================================
// ============================================
// Import core modules
// ============================================
importScripts('core/api-client.js', 'core/tool-manager.js', 'core/auth.js');

// ============================================
// Notifications System
// ============================================
async function addActivityActivityOrNotification(title, message, type = 'info', icon = '⚙️', isActivity = false) {
    const storageKey = isActivity ? 'no_activity' : 'no_notifications';
    const unreadKey = isActivity ? 'no_unread_activity' : 'no_unread_notifications';
    
    const data = await chrome.storage.local.get([storageKey]);
    let items = data[storageKey] || [];
    items.unshift({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        title,
        message,
        type,
        icon,
        timestamp: Date.now()
    });
    items = items.slice(0, 50); // Keep last 50
    await chrome.storage.local.set({ [storageKey]: items, [unreadKey]: true });
}


// ============================================
// Constants
// ============================================
const CONTENT_SCRIPT_ID = 'yt-new-order-main';
const CONTENT_CSS_ID = 'yt-new-order-styles';
const TOOL_RUNTIME_ID = 'no-tool-runtime';

// ============================================
// YouTube Host Permission
// ============================================
async function ensureHostPermission() {
    const hasPermission = await chrome.permissions.contains({
        origins: ['https://www.youtube.com/*']
    });

    if (!hasPermission) {
        try {
            const granted = await chrome.permissions.request({
                origins: ['https://www.youtube.com/*']
            });
            if (granted) {
                console.log('New Order Global: YouTube host permission granted');
                return true;
            } else {
                console.log('New Order Global: YouTube host permission denied');
                return false;
            }
        } catch (err) {
            console.log('New Order Global: Could not request permission from background:', err.message);
            return false;
        }
    }

    return true;
}

// ============================================
// Register YouTube Content Scripts
// ============================================
let _registrationInProgress = null;

async function registerContentScripts() {
    if (_registrationInProgress) {
        console.log('New Order Global: Registration already in progress, waiting...');
        return _registrationInProgress;
    }

    _registrationInProgress = _doRegisterContentScripts();
    try {
        return await _registrationInProgress;
    } finally {
        _registrationInProgress = null;
    }
}

async function _doRegisterContentScripts() {
    try {
        // Unregister ALL content scripts first
        try {
            await chrome.scripting.unregisterContentScripts();
        } catch (e) {
            // Nothing registered — fine
        }

        // Register YouTube CSS and JS
        await chrome.scripting.registerContentScripts([
            {
                id: CONTENT_CSS_ID,
                matches: ['https://www.youtube.com/*'],
                css: ['styles.css'],
                runAt: 'document_start',
                persistAcrossSessions: true
            },
            {
                id: CONTENT_SCRIPT_ID,
                matches: ['https://www.youtube.com/*'],
                js: ['content.js'],
                runAt: 'document_idle',
                persistAcrossSessions: true
            }
        ]);

        console.log('New Order Global: YouTube content scripts registered');
        return true;
    } catch (err) {
        console.error('New Order Global: Failed to register content scripts:', err);
        return false;
    }
}

// ============================================
// Inject into existing YouTube tabs
// ============================================
async function injectIntoExistingTabs() {
    try {
        const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
        for (const tab of tabs) {
            try {
                try {
                    const response = await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
                    if (response && response.pong) continue;
                } catch (e) {
                    // Not injected, proceed
                }

                await chrome.scripting.insertCSS({
                    target: { tabId: tab.id },
                    files: ['styles.css']
                });
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                console.log(`New Order Global: Injected YouTube tool into tab ${tab.id}`);
            } catch (err) {
                console.log(`New Order Global: Could not inject into tab ${tab.id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('New Order Global: Error injecting into existing tabs:', err);
    }
}

// ============================================
// AI Tool Injection
// ============================================
async function injectCustomToolsIntoTab(tabId, url) {
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return 0;

    try {
        const matchingTools = await ToolManager.getToolsForUrl(url);
        if (matchingTools.length === 0) return 0;

        for (const tool of matchingTools) {
            try {
                // Inject styles
                if (tool.styles) {
                    await chrome.scripting.insertCSS({
                        target: { tabId },
                        css: tool.styles
                    });
                }

                // Inject the content script code
                if (tool.contentScript) {
                    const wrappedCode = ToolManager.buildToolWrapper(tool);
                    await chrome.scripting.executeScript({
                        target: { tabId },
                        func: (code) => {
                            try {
                                const script = document.createElement('script');
                                script.textContent = code;
                                (document.head || document.documentElement).appendChild(script);
                                script.remove();
                            } catch (e) {
                                console.error('[New Order] Tool execution error:', e);
                            }
                        },
                        args: [wrappedCode],
                        world: 'MAIN'
                    });
                }

                console.log(`New Order Global: Injected tool "${tool.name}" into tab ${tabId}`);

                // Broadcast to popup / side panel that a tool was injected
                broadcastToPopup({ type: 'toolInjected', toolId: tool.id, toolName: tool.name });
                addActivityActivityOrNotification('Tool Injected', `"${tool.name}" was injected on this page.`, 'success', '✨', true);
            } catch (err) {
                console.error(`New Order Global: Failed to inject tool "${tool.name}":`, err);
                broadcastToPopup({ type: 'toolError', toolId: tool.id, toolName: tool.name, error: err.message });
                addActivityActivityOrNotification('Tool Error', `"${tool.name}" failed: ${err.message}`, 'error', '⚠️', false);
            }
        }

        return matchingTools.length;
    } catch (err) {
        console.error('New Order Global: Error injecting custom tools:', err);
        return 0;
    }
}

// Broadcast a message to popup / side panel pages
function broadcastToPopup(msg) {
    chrome.runtime.sendMessage(msg).catch(() => {
        // Popup/side panel not open — ignore
    });
}

// ============================================
// Tab Navigation Listener — inject tools on page load
// ============================================
const recentlyInjectedTabs = new Set();

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        // Don't inject into extension pages or chrome pages
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

        // Prevent duplicate injections into the same tab within a short window
        const key = `${tabId}-${tab.url}`;
        if (recentlyInjectedTabs.has(key)) return;
        recentlyInjectedTabs.add(key);
        setTimeout(() => recentlyInjectedTabs.delete(key), 5000);

        // Inject custom AI tools that match this URL
        try {
            await injectCustomToolsIntoTab(tabId, tab.url);
        } catch (err) {
            // Tab may have been closed between event firing and injection
            console.log(`New Order Global: Skipped injection for closed tab ${tabId}`);
        }
    }
});

// ============================================
// Extension Install/Update
// ============================================
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        const defaultSettings = {
            toggleReorder: true,
            showCommentsOnHomepage: false,
            layoutMode: 'swapped',
            resizableColumns: false,
            collapsibleSections: false,
            pipComments: false,
            gridView: false,
            hideDescription: false,
            hideChannelInfo: false,
            hideMerch: false,
            hideEndScreen: false,
            customFont: 'default',
            compactMode: false,
            highlightComments: true,
            commentSearch: false,
            filterComments: false,
            autoloadComments: false,
            keyboardShortcuts: false,
            copyTimestamp: false,
            skipIntro: false,
            skipAds: false,
            screenshot: false,
            volumeBoost: false,
            hideShorts: false,
            blockChannels: '',
            hideClickbait: false,
            keywordFilter: '',
            hideAds: false,
            watchLater: false,
            playlistManager: false,
            notesSection: false,
            bookmarks: false,
            historySearch: false
        };

        chrome.storage.sync.set({ settings: defaultSettings }, () => {
            console.log('New Order Global: Default settings initialized');
        });
    }

    // Register YouTube content scripts
    await registerContentScripts();

    // Inject into any already-open YouTube tabs
    await injectIntoExistingTabs();
});

// ============================================
// Track injected tabs
// ============================================
const injectedTabs = new Set();

async function injectIfNeeded(tabId) {
    if (injectedTabs.has(tabId)) return;

    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url || !tab.url.includes('youtube.com')) return;
        if (tab.status !== 'complete') return;

        let isActive = false;
        try {
            const response = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
            isActive = response && response.pong;
        } catch (e) {
            isActive = false;
        }

        if (!isActive) {
            injectedTabs.add(tabId);
            console.log(`New Order Global: Injecting into tab ${tabId}`);
            try {
                await chrome.scripting.insertCSS({
                    target: { tabId: tabId },
                    files: ['styles.css']
                });
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content.js']
                });
            } catch (injectErr) {
                console.log(`New Order Global: Could not inject into tab ${tabId}:`, injectErr.message);
            }
        }
    } catch (err) {
        // Tab might have been closed
    }
}

// ============================================
// Service Worker Startup
// ============================================
(async () => {
    await registerContentScripts();

    // Delayed injection for restored tabs
    setTimeout(async () => {
        try {
            const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
            for (const tab of tabs) {
                await injectIfNeeded(tab.id);
            }
        } catch (err) {
            console.log('New Order Global: Error checking tabs on startup:', err);
        }
    }, 1500);
})();

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
    injectedTabs.delete(tabId);
});

// ============================================
// Message Handlers
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- YouTube Messages (preserved) ---

    if (message.type === 'getSettings') {
        chrome.storage.sync.get(['settings'], (result) => {
            sendResponse({ settings: result.settings || {} });
        });
        return true;
    }

    if (message.type === 'requestPermission') {
        chrome.permissions.request({
            origins: ['https://www.youtube.com/*']
        }).then(async (granted) => {
            if (granted) {
                await registerContentScripts();
                await injectIntoExistingTabs();
            }
            sendResponse({ granted });
        }).catch((err) => {
            sendResponse({ granted: false, error: err.message });
        });
        return true;
    }

    if (message.type === 'ensureContentScript') {
        (async () => {
            try {
                const tabId = message.tabId;

                try {
                    const response = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
                    if (response && response.pong) {
                        sendResponse({ success: true, alreadyInjected: true });
                        return;
                    }
                } catch (e) {
                    // Not injected
                }

                await chrome.scripting.insertCSS({
                    target: { tabId: tabId },
                    files: ['styles.css']
                });
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content.js']
                });

                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.type === 'updateSettings') {
        chrome.storage.sync.set({ settings: message.settings }, () => {
            chrome.tabs.query({ url: 'https://www.youtube.com/*' }, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'settingsUpdated',
                        settings: message.settings
                    }).catch(() => {
                        // Content script not loaded in this tab
                    });
                });
            });
            sendResponse({ success: true });
        });
        return true;
    }

    // --- New Order Global Messages ---

    if (message.type === 'noInjectTools') {
        (async () => {
            try {
                const count = await injectCustomToolsIntoTab(message.tabId, message.url);
                sendResponse({ success: true, count });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.type === 'noGetToolStats') {
        (async () => {
            try {
                const stats = await ToolManager.getStats();
                sendResponse(stats);
            } catch (err) {
                sendResponse({ error: err.message });
            }
        })();
        return true;
    }

    if (message.type === 'noInstallTool') {
        (async () => {
            try {
                const tool = await ToolManager.installTool(message.tool);
                sendResponse({ success: true, tool });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.type === 'noUninstallTool') {
        (async () => {
            try {
                await ToolManager.uninstallTool(message.toolId);
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.type === 'noToggleTool') {
        (async () => {
            try {
                const isActive = await ToolManager.isToolActive(message.toolId);
                if (isActive) {
                    await ToolManager.deactivateTool(message.toolId);
                } else {
                    await ToolManager.activateTool(message.toolId);
                }
                sendResponse({ success: true, active: !isActive });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Run a specific tool on a specific tab (manual run from popup)
    if (message.type === 'noRunToolOnTab') {
        (async () => {
            try {
                const tools = await ToolManager.getInstalledTools();
                const tool = tools.find(t => t.id === message.toolId);
                if (!tool) {
                    sendResponse({ success: false, error: 'Tool not found' });
                    return;
                }

                // Inject styles
                if (tool.styles) {
                    await chrome.scripting.insertCSS({
                        target: { tabId: message.tabId },
                        css: tool.styles
                    });
                }

                // Inject the script
                if (tool.contentScript) {
                    const wrappedCode = ToolManager.buildToolWrapper(tool);
                    await chrome.scripting.executeScript({
                        target: { tabId: message.tabId },
                        func: (code) => {
                            try {
                                const script = document.createElement('script');
                                script.textContent = code;
                                (document.head || document.documentElement).appendChild(script);
                                script.remove();
                            } catch (e) {
                                console.error('[New Order] Tool execution error:', e);
                            }
                        },
                        args: [wrappedCode],
                        world: 'MAIN'
                    });
                }

                console.log(`New Order Global: Manually ran tool "${tool.name}" on tab ${message.tabId}`);
                addActivityActivityOrNotification('Tool Run', `"${tool.name}" was manually run on the current page.`, 'success', '▶️', true);
                sendResponse({ success: true });
            } catch (err) {
                console.error(`New Order Global: Failed to run tool:`, err);
                addActivityActivityOrNotification('Tool Error', `Failed to run tool: ${err.message}`, 'error', '⚠️', false);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Auth state change broadcast
    if (message.type === 'noAuthChanged') {
        // Rebroadcast to all extension pages
        return false; // Don't block
    }

    // ============================================
    // Global Executive — Agent Messages
    // ============================================

    // Execute an action inside a tab's content script
    if (message.type === 'ge-execute-in-tab') {
        (async () => {
            try {
                const { tabId, action, params } = message;

                if (!tabId) {
                    sendResponse({ success: false, error: 'No active browser tab available. The agent needs an open web tab to interact with.' });
                    return;
                }

                // Ensure agent runtime is injected
                await ensureAgentRuntime(tabId);

                // Send action to the content script (with retry in case SW woke or script just loaded)
                const result = await sendMessageToTabWithRetry(tabId, {
                    type: 'ge-action',
                    action,
                    params: params || {}
                });

                sendResponse(result || { success: false, error: 'No response from tab' });
            } catch (err) {
                console.error('[Global Executive] Execute error:', err);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Open a new tab
    if (message.type === 'ge-open-tab') {
        (async () => {
            try {
                const tab = await chrome.tabs.create({ url: message.url, active: false });
                // Wait for the tab to finish loading
                await waitForTabLoad(tab.id, 15000);
                sendResponse({ tabId: tab.id, url: tab.url, title: tab.title });
            } catch (err) {
                console.error('[Global Executive] Open tab error:', err);
                sendResponse({ error: err.message });
            }
        })();
        return true;
    }

    // Switch to a tab
    if (message.type === 'ge-switch-tab') {
        (async () => {
            try {
                await chrome.tabs.update(message.tabId, { active: true });
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Close a tab
    if (message.type === 'ge-close-tab') {
        (async () => {
            try {
                await chrome.tabs.remove(message.tabId);
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Download a file by URL
    if (message.type === 'ge-download') {
        (async () => {
            try {
                const downloadId = await chrome.downloads.download({
                    url: message.url,
                    filename: message.filename || undefined,
                    saveAs: false
                });
                sendResponse({ success: true, downloadId });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Download generated content (creates a data URL)
    if (message.type === 'ge-download-content') {
        (async () => {
            try {
                const { content, filename, mimeType } = message;
                const blob = new Blob([content], { type: mimeType || 'text/plain' });
                const reader = new FileReader();
                reader.onload = async () => {
                    try {
                        const downloadId = await chrome.downloads.download({
                            url: reader.result,
                            filename: filename || 'download.txt',
                            saveAs: false
                        });
                        sendResponse({ success: true, downloadId });
                    } catch (err) {
                        sendResponse({ success: false, error: err.message });
                    }
                };
                reader.readAsDataURL(blob);
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }
});

// ============================================
// Global Executive — Keep-alive port (MV3 SW)
// ============================================
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'ge-keep-alive') {
        port.onMessage.addListener(() => {
            // No-op — the open port keeps the SW alive
        });
        port.onDisconnect.addListener(() => {
            // Port closed — SW may now idle-die
        });
    }
});

// ============================================
// Global Executive — Helper Functions
// ============================================

// Ensure agent runtime content script is injected into a tab
async function ensureAgentRuntime(tabId) {
    if (!tabId) return;

    try {
        // Check tab is a real web page we can inject into
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            throw new Error(`Cannot inject agent runtime into ${tab.url}`);
        }
    } catch (e) {
        throw new Error(`Tab ${tabId} not accessible: ${e.message}`);
    }

    try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'ge-ping' });
        if (response && response.agentRuntime) return; // Already injected
    } catch {
        // Not injected, proceed
    }

    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['core/agent-runtime.js']
    });
    console.log(`[Global Executive] Agent runtime injected into tab ${tabId}`);

    // Wait for the content script to initialize (retry up to 2s)
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const response = await chrome.tabs.sendMessage(tabId, { type: 'ge-ping' });
            if (response && response.agentRuntime) return;
        } catch {
            // Still not ready
        }
    }
    throw new Error('Agent runtime failed to initialize in tab');
}

// Send a message to a tab with retries
async function sendMessageToTabWithRetry(tabId, message, retries = 2, delay = 300) {
    for (let i = 0; i <= retries; i++) {
        try {
            const result = await chrome.tabs.sendMessage(tabId, message);
            return result;
        } catch (err) {
            if (i === retries) throw err;
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// Wait for a tab to finish loading
function waitForTabLoad(tabId, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(); // Resolve anyway after timeout
        }, timeout);

        function listener(updatedTabId, changeInfo) {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        }

        chrome.tabs.onUpdated.addListener(listener);

        // Check if already complete
        chrome.tabs.get(tabId).then(tab => {
            if (tab.status === 'complete') {
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        }).catch(() => {
            clearTimeout(timer);
            reject(new Error('Tab not found'));
        });
    });
}

// ============================================
// Configure Side Panel Behavior
// ============================================
if (chrome.sidePanel) {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error(error));
}
