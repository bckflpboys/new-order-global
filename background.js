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
importScripts('core/api-client.js', 'core/tool-manager.js', 'core/auth.js', 'core/bg-agent-loop.js', 'core/extension-updates.js');

// ============================================
// Lightweight authenticated fetch helper for background-side API calls
// (separate from NewOrderAPI which is window-scoped in pages)
// ============================================
const GE_API_BASE = 'https://apiv2.global-order.32d.one';
async function fetchWithAuth(path, token, options = {}) {
    const resp = await fetch(GE_API_BASE + path, {
        method: options.method || 'GET',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        body: options.body
    });
    let data = null;
    try { data = await resp.json(); } catch {}
    if (!resp.ok) throw new Error(data?.error || ('HTTP ' + resp.status));
    return data;
}

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

        chrome.storage.local.set({ settings: defaultSettings }, () => {
            console.log('New Order Global: Default settings initialized');
        });
    }

    // Respect the user's YouTube Toolkit toggle (defaults to ON).
    const ytEnabled = await new Promise((resolve) => {
        chrome.storage.local.get(['ytToolkitEnabled'], (r) => {
            resolve(r.ytToolkitEnabled !== false);
        });
    });
    if (ytEnabled) {
        await registerContentScripts();
        await injectIntoExistingTabs();
    } else {
        try { await chrome.scripting.unregisterContentScripts(); } catch {}
    }
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
// Recently-opened tab tracker
// ============================================
// Records every tab creation so the agent loop can auto-adopt a tab that
// was opened as a side-effect of a click (target=_blank, JS window.open, etc.)
// without requiring the LLM to emit a separate `switchTab` action. Entries
// are keyed by tabId and drop when the tab closes or when we exceed the cap.
const __geRecentTabs = new Map(); // tabId -> { createdAt, openerTabId, url, title }
const __GE_RECENT_TABS_MAX = 30;

chrome.tabs.onCreated.addListener((tab) => {
    try {
        if (!tab || typeof tab.id !== 'number') return;
        __geRecentTabs.set(tab.id, {
            createdAt: Date.now(),
            openerTabId: typeof tab.openerTabId === 'number' ? tab.openerTabId : null,
            url: tab.pendingUrl || tab.url || '',
            title: tab.title || ''
        });
        if (__geRecentTabs.size > __GE_RECENT_TABS_MAX) {
            // Drop the oldest entry so the map doesn't grow unbounded in
            // long-lived sessions.
            let oldestId = null; let oldestAt = Infinity;
            for (const [id, info] of __geRecentTabs) {
                if (info.createdAt < oldestAt) { oldestAt = info.createdAt; oldestId = id; }
            }
            if (oldestId !== null) __geRecentTabs.delete(oldestId);
        }
    } catch { /* ignore */ }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    __geRecentTabs.delete(tabId);
});

// ============================================
// Message Handlers
// ============================================
// Helper: read the user's YouTube Toolkit on/off flag (default true).
async function isYtToolkitEnabled() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['ytToolkitEnabled'], (r) => {
            resolve(r.ytToolkitEnabled !== false);
        });
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- YouTube Toolkit enable/disable from popup ---
    if (message.type === 'ytToolkitSetEnabled') {
        (async () => {
            try {
                if (message.enabled) {
                    await registerContentScripts();
                    // Inject into any already-open YouTube tabs so the
                    // toolkit lights up immediately without a reload.
                    await injectIntoExistingTabs();
                } else {
                    // Stop future tabs from auto-injecting.
                    try { await chrome.scripting.unregisterContentScripts(); } catch {}
                    // Tell any open YouTube tabs to tear down their UI.
                    try {
                        const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
                        for (const tab of tabs) {
                            chrome.tabs.sendMessage(tab.id, { type: 'ytToolkitDisable' }).catch(() => {});
                        }
                    } catch {}
                }
                sendResponse({ ok: true });
            } catch (err) {
                sendResponse({ ok: false, error: err.message });
            }
        })();
        return true;
    }

    // --- YouTube Messages (preserved) ---

    if (message.type === 'getSettings') {
        chrome.storage.local.get(['settings'], (result) => {
            sendResponse({ settings: result.settings || {} });
        });
        return true;
    }

    // Pull cloud-synced YT Toolkit settings from the server.
    // Responds with { success, settings } on success, or
    // { success: false, error: 'not_signed_in' | <msg> } on failure.
    if (message.type === 'ytLoadCloudSettings') {
        (async () => {
            try {
                const { noAuthToken } = await chrome.storage.local.get(['noAuthToken']);
                if (!noAuthToken) {
                    sendResponse({ success: false, error: 'not_signed_in' });
                    return;
                }
                const data = await fetchWithAuth('/api/user/yt-settings', noAuthToken, { method: 'GET' });
                sendResponse({ success: true, settings: (data && data.settings) || {} });
            } catch (err) {
                sendResponse({ success: false, error: err.message || 'cloud_load_failed' });
            }
        })();
        return true;
    }

    // Push local YT Toolkit settings to the server.
    if (message.type === 'ytSyncCloudSettings') {
        (async () => {
            try {
                const { noAuthToken } = await chrome.storage.local.get(['noAuthToken']);
                if (!noAuthToken) {
                    sendResponse({ success: false, error: 'not_signed_in' });
                    return;
                }
                const data = await fetchWithAuth('/api/user/yt-settings', noAuthToken, {
                    method: 'PUT',
                    body: JSON.stringify({ settings: message.settings || {} })
                });
                sendResponse({ success: true, settings: (data && data.settings) || {} });
            } catch (err) {
                sendResponse({ success: false, error: err.message || 'cloud_sync_failed' });
            }
        })();
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
        chrome.storage.local.set({ settings: message.settings }, () => {
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

    // Forward test output from content scripts to extension pages (builder)
    if (message.type === 'no-test-output' || message.type === 'no-test-done') {
        // Re-broadcast to all extension pages so the builder can pick it up
        chrome.runtime.sendMessage(message).catch(() => {});
        return false;
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
                let { tabId, action, params } = message;

                // Defence-in-depth self-healing: the agent-side executeLoop
                // already runs ensureLiveTab() before dispatch, but if a
                // caller slips through with no tabId (or a stale one), try
                // to recover here instead of hard-failing the step. Falls
                // back to Chrome's currently-active http(s) tab, then any
                // open http(s) tab. If nothing works, surface a directive
                // error the LLM can act on (openTab / goto).
                async function resolveFallbackTabId() {
                    try {
                        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
                        if (active && typeof active.id === 'number' && /^https?:\/\//i.test(active.url || '')) return active.id;
                    } catch { /* ignore */ }
                    try {
                        const all = await chrome.tabs.query({});
                        const cand = all.find(t => typeof t.id === 'number' && /^https?:\/\//i.test(t.url || ''));
                        if (cand) return cand.id;
                    } catch { /* ignore */ }
                    return null;
                }

                let tabIdRecovered = false;
                if (!tabId) {
                    const fallback = await resolveFallbackTabId();
                    if (fallback) {
                        tabId = fallback;
                        tabIdRecovered = true;
                        console.log('[bg] ge-execute-in-tab: no tabId supplied; auto-recovered to tab', fallback);
                    } else {
                        sendResponse({ success: false, error: 'No active browser tab available and no open http(s) tab to fall back to. Use `openTab` with a url to create one, then retry.' });
                        return;
                    }
                } else {
                    // Validate the supplied tabId is still alive; if not, try a fallback.
                    let alive = false;
                    try { await chrome.tabs.get(tabId); alive = true; } catch { alive = false; }
                    if (!alive) {
                        const fallback = await resolveFallbackTabId();
                        if (fallback) {
                            console.log('[bg] ge-execute-in-tab: supplied tabId', tabId, 'is dead; auto-recovered to', fallback);
                            tabId = fallback;
                            tabIdRecovered = true;
                        } else {
                            sendResponse({ success: false, error: `Tab ${tabId} no longer exists and no other http(s) tab is open. Use \`openTab\` with a url to create one, then retry.` });
                            return;
                        }
                    }
                }

                // === Debugger-based actions ===
                // These bypass the content script and dispatch real input events
                // via the Chrome DevTools Protocol. Required for canvas / WebGL /
                // video / 3D / game UIs where there is no DOM element to click.
                if (DEBUGGER_ACTIONS.has(action)) {
                    const result = await runDebuggerAction(tabId, action, params || {});
                    sendResponse({ success: true, result });
                    return;
                }

                // Explicit detach request (task end / cancel) — frees the
                // yellow Chrome "debugging this browser" banner.
                if (action === 'detachDebugger') {
                    await debuggerDetach(tabId).catch(() => {});
                    sendResponse({ success: true, result: { detached: true } });
                    return;
                }

                // === Background-orchestrated actions ===
                // These need tab-navigation / chrome.* APIs and can't run
                // from the content script. They drive the tab, wait for
                // load, then (optionally) inject an extractor.
                if (action === 'readEmail') {
                    const result = await runReadEmail(tabId, params || {});
                    sendResponse({ success: true, result });
                    return;
                }
                if (action === 'readDownloads') {
                    const result = runReadDownloads(params || {});
                    sendResponse({ success: true, result });
                    return;
                }
                if (action === 'captureFile') {
                    const result = await runCaptureFile(tabId, params || {});
                    sendResponse({ success: true, result });
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

    // Probe chrome.downloads for a matching completed download. Used by
    // the content-script's `waitUntil { downloadComplete }` condition.
    // spec: { id?, filenameContains?, urlContains? } \u2014 any/all match.
    if (message.type === 'ge-check-download') {
        (async () => {
            try {
                const spec = message.spec || {};
                if (!chrome?.downloads?.search) {
                    return sendResponse({ matched: false, error: 'downloads_api_unavailable' });
                }
                const items = await new Promise((r) => {
                    try { chrome.downloads.search({ orderBy: ['-startTime'], limit: 10 }, (items) => r(items || [])); }
                    catch { r([]); }
                });
                const match = items.find((d) => {
                    if (d.state !== 'complete') return false;
                    if (spec.id != null && d.id !== spec.id) return false;
                    if (spec.filenameContains) {
                        const fn = (d.filename || '').split(/[\\/]/).pop() || '';
                        if (fn.toLowerCase().indexOf(String(spec.filenameContains).toLowerCase()) === -1) return false;
                    }
                    if (spec.urlContains) {
                        const u = d.finalUrl || d.url || '';
                        if (u.toLowerCase().indexOf(String(spec.urlContains).toLowerCase()) === -1) return false;
                    }
                    return true;
                });
                if (!match) return sendResponse({ matched: false });
                sendResponse({
                    matched: true,
                    download: {
                        id: match.id,
                        url: match.finalUrl || match.url || '',
                        filename: (match.filename || '').split(/[\\/]/).pop() || '',
                        mime: match.mime || '',
                        bytesReceived: match.bytesReceived || 0,
                        totalBytes: match.totalBytes || 0,
                        state: match.state
                    }
                });
            } catch (err) {
                sendResponse({ matched: false, error: err.message });
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

    // List ALL Chrome tabs in the current window, so the agent can see
    // every tab that's actually open — not just the ones it has tracked.
    if (message.type === 'ge-list-tabs') {
        (async () => {
            try {
                const tabs = await chrome.tabs.query({ currentWindow: true });
                sendResponse({
                    success: true,
                    tabs: tabs.map(t => ({
                        tabId: t.id,
                        index: t.index,
                        url: t.url || '',
                        title: t.title || '',
                        active: !!t.active,
                        pinned: !!t.pinned
                    }))
                });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Find the newest tab created since a given timestamp. Used by the agent
    // loop to auto-adopt a tab opened as a side-effect of `click` (target=_blank,
    // window.open, etc.) so the LLM doesn't need to manually `switchTab`.
    // Accepts:
    //   sinceMs      — only return tabs created at/after this epoch ms (required)
    //   openerTabId  — optional: prefer tabs whose openerTabId matches this
    //   hrefHint     — optional: URL substring the new tab is expected to navigate to
    //   timeout      — how long to poll before giving up (500..10000 ms, default 4000)
    if (message.type === 'ge-get-newest-tab') {
        (async () => {
            try {
                const sinceMs = Number(message.sinceMs) || 0;
                const openerTabId = typeof message.openerTabId === 'number' ? message.openerTabId : null;
                const hrefHint = (message.hrefHint || '').toString().toLowerCase();
                const timeout = Math.min(Math.max(Number(message.timeout) || 4000, 200), 10000);
                const deadline = Date.now() + timeout;

                // Count candidate tabs created in our window (used for the
                // fast-path: when the caller does a universal post-click
                // check and NO tab was actually created, we must not burn
                // the full timeout polling for nothing).
                const countCandidates = () => {
                    let n = 0;
                    for (const [, info] of __geRecentTabs) if (info.createdAt >= sinceMs) n++;
                    return n;
                };

                // Pick the best candidate. Prefers, in order:
                //   1. Tabs whose openerTabId matches (strong signal)
                //   2. Tabs whose current URL contains hrefHint
                //   3. Most recently created
                const pickBest = () => {
                    let best = null;
                    for (const [tabId, info] of __geRecentTabs) {
                        if (info.createdAt < sinceMs) continue;
                        let score = info.createdAt;
                        if (openerTabId && info.openerTabId === openerTabId) score += 1e12;
                        if (hrefHint) {
                            const liveUrl = (info.url || '').toLowerCase();
                            if (liveUrl.includes(hrefHint)) score += 5e11;
                        }
                        if (!best || score > best.score) best = { tabId, info, score };
                    }
                    return best;
                };

                // Fast-path: if nothing was created in our window at all,
                // give one grace tick (tab creation events sometimes arrive
                // a hair after the click response) and then bail. Keeps
                // latency near-zero on clicks that didn't open anything.
                if (countCandidates() === 0) {
                    await new Promise(r => setTimeout(r, 150));
                    if (countCandidates() === 0) {
                        sendResponse({ success: false, reason: 'no_new_tab', error: 'No new tab was created by this action' });
                        return;
                    }
                }

                let lastSeenTabId = null;
                let lastSeenUrl = '';
                let lastSeenTitle = '';

                while (Date.now() < deadline) {
                    const best = pickBest();
                    if (best) {
                        try {
                            const live = await chrome.tabs.get(best.tabId);
                            // Refresh the cached info so subsequent picks
                            // score on the real post-navigation URL.
                            best.info.url = live.url || best.info.url;
                            best.info.title = live.title || best.info.title;
                            lastSeenTabId = best.tabId;
                            lastSeenUrl = live.url || lastSeenUrl;
                            lastSeenTitle = live.title || lastSeenTitle;

                            const url = (live.url || '').trim();
                            const isBlank =
                                !url ||
                                url === 'about:blank' ||
                                url === 'chrome://newtab/' ||
                                url.startsWith('chrome://new-tab-page') ||
                                url.startsWith('edge://newtab');
                            const looksReady = live.status === 'complete' || !isBlank;
                            if (looksReady) {
                                try { await waitForTabLoad(best.tabId, Math.max(500, deadline - Date.now())); } catch { /* ignore */ }
                                const finalTab = await chrome.tabs.get(best.tabId).catch(() => live);
                                sendResponse({
                                    success: true,
                                    tabId: finalTab.id,
                                    url: finalTab.url || '',
                                    title: finalTab.title || '',
                                    index: finalTab.index,
                                    openerTabId: typeof finalTab.openerTabId === 'number' ? finalTab.openerTabId : (best.info.openerTabId || null),
                                    createdAt: best.info.createdAt
                                });
                                return;
                            }
                        } catch {
                            // Tab closed between pick and get — drop and continue.
                            __geRecentTabs.delete(best.tabId);
                        }
                    }
                    await new Promise(r => setTimeout(r, 150));
                }

                // Timed out. If we did see a tab but it never navigated away
                // from about:blank, the popup was most likely blocked or
                // the opener never actually navigated it — surface the
                // tabId so the caller can close the empty shell.
                if (lastSeenTabId !== null) {
                    sendResponse({
                        success: false,
                        reason: 'blank_or_blocked',
                        error: 'A new tab was created but never navigated away from about:blank (popup blocker or failed window.open).',
                        staleTabId: lastSeenTabId,
                        url: lastSeenUrl,
                        title: lastSeenTitle
                    });
                } else {
                    sendResponse({ success: false, reason: 'timeout', error: 'No new tab detected within timeout' });
                }
            } catch (err) {
                sendResponse({ success: false, reason: 'exception', error: err.message });
            }
        })();
        return true;
    }

    // Force-resync the user's Tool catalog from the server. Triggered by the
    // agent panel after the agent emits a `createTool` action so a follow-up
    // `useTool` in the same task can find the new content script locally.
    if (message.type === 'ge-sync-tools') {
        (async () => {
            try {
                if (typeof globalThis.ToolManager !== 'object' || typeof globalThis.ToolManager.syncTools !== 'function') {
                    sendResponse({ success: false, error: 'ToolManager unavailable' });
                    return;
                }
                const r = await globalThis.ToolManager.syncTools(!!message.force);
                sendResponse({ success: true, result: r || null });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Resolve a target tab from any of: tabId | url substring | title substring
    // | browserIndex (chrome window index). Returns the matched tab(s).
    // The same matching logic is used by ge-switch-tab and ge-close-tab so the
    // agent can target ANY open Chrome tab, not just the ones it has tracked.
    async function resolveTabFromParams(params) {
        if (!params || typeof params !== 'object') return { tabs: [] };
        if (params.tabId) {
            try {
                const t = await chrome.tabs.get(params.tabId);
                return { tabs: [t] };
            } catch { return { tabs: [], error: `tabId ${params.tabId} not found` }; }
        }
        const all = await chrome.tabs.query({ currentWindow: true });
        if (typeof params.url === 'string' && params.url.trim()) {
            const needle = params.url.toLowerCase();
            const matches = all.filter(t => (t.url || '').toLowerCase().includes(needle));
            if (matches.length) return { tabs: matches };
        }
        if (typeof params.title === 'string' && params.title.trim()) {
            const needle = params.title.toLowerCase();
            const matches = all.filter(t => (t.title || '').toLowerCase().includes(needle));
            if (matches.length) return { tabs: matches };
        }
        if (typeof params.browserIndex === 'number') {
            const m = all.find(t => t.index === params.browserIndex);
            if (m) return { tabs: [m] };
        }
        // Last-resort: tabIndex interpreted as chrome window index. (The agent
        // commonly emits `tabIndex` against the "Available Browser Tabs" list,
        // which is ordered by chrome window index.)
        if (typeof params.tabIndex === 'number') {
            const m = all.find(t => t.index === params.tabIndex);
            if (m) return { tabs: [m] };
        }
        return { tabs: [], error: 'No tab matched the given selectors (tabId/url/title/browserIndex/tabIndex)' };
    }

    // Switch to a tab — accepts tabId | url | title | browserIndex | tabIndex
    if (message.type === 'ge-switch-tab') {
        (async () => {
            try {
                const { tabs, error } = await resolveTabFromParams(message);
                if (!tabs.length) {
                    sendResponse({ success: false, error: error || 'Tab not found' });
                    return;
                }
                if (tabs.length > 1 && !message.tabId) {
                    sendResponse({
                        success: false,
                        ambiguous: true,
                        error: `Multiple tabs matched (${tabs.length}). Refine with a more specific url/title.`,
                        candidates: tabs.slice(0, 5).map(t => ({ tabId: t.id, url: t.url, title: t.title, index: t.index }))
                    });
                    return;
                }
                const target = tabs[0];
                if (!target || typeof target.id !== 'number') {
                    sendResponse({ success: false, error: 'Resolved tab has no usable tabId — try a different selector.' });
                    return;
                }
                await chrome.tabs.update(target.id, { active: true });
                sendResponse({ success: true, tabId: target.id, url: target.url, title: target.title, index: target.index });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Close a tab — accepts tabId | url | title | browserIndex | tabIndex
    if (message.type === 'ge-close-tab') {
        (async () => {
            try {
                const { tabs, error } = await resolveTabFromParams(message);
                if (!tabs.length) {
                    sendResponse({ success: false, error: error || 'Tab not found' });
                    return;
                }
                // For close, ambiguity is dangerous — refuse if multiple match.
                if (tabs.length > 1 && !message.tabId) {
                    sendResponse({
                        success: false,
                        ambiguous: true,
                        error: `Multiple tabs matched (${tabs.length}) — refusing to close. Refine with a more specific url/title or pass tabId.`,
                        candidates: tabs.slice(0, 5).map(t => ({ tabId: t.id, url: t.url, title: t.title, index: t.index }))
                    });
                    return;
                }
                const target = tabs[0];
                if (!target || typeof target.id !== 'number') {
                    sendResponse({ success: false, error: 'Resolved tab has no usable tabId — try a different selector.' });
                    return;
                }
                await chrome.tabs.remove(target.id);
                sendResponse({ success: true, closedTabId: target.id, url: target.url, title: target.title });
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

    // Navigate the current tab to a URL (no new tab)
    if (message.type === 'ge-goto') {
        (async () => {
            try {
                let { tabId, url } = message;
                if (!url || typeof url !== 'string') {
                    sendResponse({ success: false, error: "Missing 'url' parameter — pass params.url as a string starting with http:// or https://" });
                    return;
                }
                // Normalise URL: add https:// if missing scheme
                if (!/^https?:\/\//i.test(url) && !/^chrome:|^about:/i.test(url)) {
                    url = 'https://' + url;
                }
                // Fall back to the most recently active normal tab if no tabId was provided
                if (!tabId) {
                    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (activeTab && activeTab.id) tabId = activeTab.id;
                }
                if (!tabId) {
                    // Last resort: open a new tab
                    const newTab = await chrome.tabs.create({ url, active: true });
                    await waitForTabLoad(newTab.id, 15000);
                    const refreshed = await chrome.tabs.get(newTab.id);
                    sendResponse({ success: true, tabId: newTab.id, url: refreshed.url, title: refreshed.title, openedNew: true });
                    return;
                }
                await chrome.tabs.update(tabId, { url });
                await waitForTabLoad(tabId, 15000);
                const tab = await chrome.tabs.get(tabId);
                sendResponse({ success: true, tabId, url: tab.url, title: tab.title });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Browser back / forward / reload
    if (message.type === 'ge-go-back' || message.type === 'ge-go-forward' || message.type === 'ge-reload') {
        (async () => {
            try {
                const { tabId } = message;
                if (!tabId) { sendResponse({ success: false, error: 'Missing tabId' }); return; }
                if (message.type === 'ge-go-back') await chrome.tabs.goBack(tabId);
                else if (message.type === 'ge-go-forward') await chrome.tabs.goForward(tabId);
                else await chrome.tabs.reload(tabId);
                await waitForTabLoad(tabId, 10000);
                const tab = await chrome.tabs.get(tabId);
                sendResponse({ success: true, url: tab.url, title: tab.title });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Capture visible tab as screenshot (returns base64 PNG data URL)
    if (message.type === 'ge-screenshot') {
        (async () => {
            try {
                const tab = await chrome.tabs.get(message.tabId);
                const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
                sendResponse({ success: true, dataUrl, url: tab.url, title: tab.title });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Stage a file (uploaded via the agent UI) for later use by uploadFile actions.
    // We store a minimal record (name, type, size, base64) keyed by ref name.
    // The agent runtime asks for it by ref via 'ge-get-staged-file'.
    if (message.type === 'ge-stage-file') {
        (async () => {
            try {
                const { ref, name, mimeType, dataUrl } = message;
                if (!ref || !dataUrl) {
                    sendResponse({ success: false, error: 'Missing ref or dataUrl' });
                    return;
                }
                const data = await chrome.storage.local.get(['ge_staged_files']);
                const files = data.ge_staged_files || {};
                files[ref] = { name: name || ref, mimeType: mimeType || 'application/octet-stream', dataUrl };
                await chrome.storage.local.set({ ge_staged_files: files });
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Retrieve a staged file (called by agent runtime during uploadFile)
    if (message.type === 'ge-get-staged-file') {
        (async () => {
            try {
                const { ref } = message;
                const data = await chrome.storage.local.get(['ge_staged_files']);
                const files = data.ge_staged_files || {};
                const file = files[ref];
                if (!file) {
                    sendResponse({ success: false, error: `No staged file with ref "${ref}"` });
                    return;
                }
                sendResponse({ success: true, file });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // ============================================
    // WhatsApp Web bridge (content script <-> server)
    // ============================================

    // Content script reports it loaded — kick it off if WA is enabled for this user
    if (message.type === 'ge-wa-watcher-loaded') {
        (async () => {
            try {
                const { noAuthToken } = await chrome.storage.local.get(['noAuthToken']);
                if (!noAuthToken) { sendResponse({ ok: false, reason: 'not_authed' }); return; }
                const integ = await fetchWithAuth('/api/integrations', noAuthToken);
                if (integ?.whatsapp?.enabled && sender.tab?.id) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        type: 'ge-wa-watcher-start',
                        groupName: integ.whatsapp.groupName || 'My Agent'
                    });
                }
                sendResponse({ ok: true });
            } catch (e) { sendResponse({ ok: false, error: e.message }); }
        })();
        return true;
    }

    // Verify the WhatsApp group exists in the user's chat list (called by Setup page)
    if (message.type === 'ge-wa-verify') {
        (async () => {
            try {
                // Find an open WhatsApp Web tab
                const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
                if (!tabs.length) { sendResponse({ found: false, error: 'Open https://web.whatsapp.com first.' }); return; }
                // Ask the content script to verify
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'ge-wa-verify-in-page',
                    groupName: message.groupName
                }, (reply) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ found: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    sendResponse(reply || { found: false, error: 'No response from WhatsApp tab' });
                });
            } catch (e) { sendResponse({ found: false, error: e.message }); }
        })();
        return true;
    }

    // Content script reports a new incoming message in the My Agent group
    if (message.type === 'ge-wa-incoming') {
        (async () => {
            try {
                const { noAuthToken } = await chrome.storage.local.get(['noAuthToken']);
                if (!noAuthToken) { sendResponse({ ok: false }); return; }
                await fetchWithAuth('/api/integrations/whatsapp/incoming', noAuthToken, {
                    method: 'POST',
                    body: JSON.stringify({ text: message.text, messageId: message.messageId })
                });
                sendResponse({ ok: true });
            } catch (e) { sendResponse({ ok: false, error: e.message }); }
        })();
        return true;
    }

    // Content script polls for outbound messages to type into the group
    if (message.type === 'ge-wa-fetch-outbox') {
        (async () => {
            try {
                const { noAuthToken } = await chrome.storage.local.get(['noAuthToken']);
                if (!noAuthToken) { sendResponse({ messages: [] }); return; }
                const data = await fetchWithAuth('/api/integrations/whatsapp/outbox', noAuthToken);
                sendResponse({ messages: data?.messages || [] });
            } catch (e) { sendResponse({ messages: [], error: e.message }); }
        })();
        return true;
    }

    // Heartbeat (keeps service worker alive while WhatsApp Web tab is active)
    if (message.type === 'ge-wa-heartbeat') {
        sendResponse({ ok: true, t: Date.now() });
        return false;
    }

    // Clear all staged files (e.g., on task end)
    if (message.type === 'ge-clear-staged-files') {
        (async () => {
            try {
                await chrome.storage.local.remove(['ge_staged_files']);
                sendResponse({ success: true });
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
// Debugger (CDP) helpers — coord-based input for canvas / WebGL / video /
// 3D / game UIs that have no clickable DOM. Attaches lazily on first use;
// auto-detaches when the tab closes. Chrome will show a banner ("X is
// debugging this browser") while active — that's expected and required.
// ============================================
const DEBUGGER_ACTIONS = new Set([
    'clickAt', 'doubleClickAt', 'rightClickAt',
    'mouseMove', 'dragAndDrop',
    'typeText', 'pressKeyAt', 'scrollAt'
]);
const __geAttachedTabs = new Set();

function debuggerAttach(tabId) {
    return new Promise((resolve, reject) => {
        if (__geAttachedTabs.has(tabId)) return resolve();
        try {
            chrome.debugger.attach({ tabId }, '1.3', () => {
                if (chrome.runtime.lastError) {
                    const msg = chrome.runtime.lastError.message || 'attach failed';
                    if (/already attached/i.test(msg)) { __geAttachedTabs.add(tabId); return resolve(); }
                    // Common restricted-page failures — give the agent an actionable recovery hint.
                    if (/cannot access|restricted|chrome-untrusted|webstore|chrome:\/\//i.test(msg)) {
                        return reject(new Error(`debugger.attach blocked: this is a restricted Chrome page (chrome://, Web Store, PDF viewer, or similar). Coord-based actions cannot run here. Navigate to a normal https:// page first.`));
                    }
                    return reject(new Error('debugger.attach: ' + msg));
                }
                __geAttachedTabs.add(tabId);
                resolve();
            });
        } catch (e) { reject(e); }
    });
}

function debuggerDetach(tabId) {
    return new Promise((resolve) => {
        if (!__geAttachedTabs.has(tabId)) return resolve();
        try {
            chrome.debugger.detach({ tabId }, () => {
                __geAttachedTabs.delete(tabId);
                // Swallow lastError — detach failing is non-fatal.
                void chrome.runtime.lastError;
                resolve();
            });
        } catch { __geAttachedTabs.delete(tabId); resolve(); }
    });
}

function debuggerSend(tabId, method, params) {
    return new Promise((resolve, reject) => {
        try {
            chrome.debugger.sendCommand({ tabId }, method, params || {}, (res) => {
                if (chrome.runtime.lastError) return reject(new Error(`${method}: ${chrome.runtime.lastError.message}`));
                resolve(res);
            });
        } catch (e) { reject(e); }
    });
}

// Clean up on detach / tab close so we don't leak the debugger session.
if (chrome.debugger && chrome.debugger.onDetach) {
    chrome.debugger.onDetach.addListener((source) => {
        if (source && source.tabId) __geAttachedTabs.delete(source.tabId);
    });
}
chrome.tabs.onRemoved.addListener((tabId) => { __geAttachedTabs.delete(tabId); });

// Build a bitmask of modifier keys for CDP Input.dispatchKeyEvent / mouse events.
// Matches the CDP spec: Alt=1, Ctrl=2, Meta/Command=4, Shift=8.
function modifiersMask(mods) {
    if (!mods) return 0;
    let m = 0;
    if (mods.alt)   m |= 1;
    if (mods.ctrl)  m |= 2;
    if (mods.meta)  m |= 4;
    if (mods.shift) m |= 8;
    return m;
}

// Convert an "Enter"/"a"/"ArrowDown" string to a CDP Input.dispatchKeyEvent payload.
function buildKeyEvent(type, key) {
    const SPECIAL = {
        Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
        Tab: { code: 'Tab', windowsVirtualKeyCode: 9, text: '\t' },
        Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
        Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 },
        Delete: { code: 'Delete', windowsVirtualKeyCode: 46 },
        ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 },
        ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
        ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
        ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 },
        Space: { code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
        Home: { code: 'Home', windowsVirtualKeyCode: 36 },
        End: { code: 'End', windowsVirtualKeyCode: 35 },
        PageUp: { code: 'PageUp', windowsVirtualKeyCode: 33 },
        PageDown: { code: 'PageDown', windowsVirtualKeyCode: 34 }
    };
    const base = { type, key };
    if (SPECIAL[key]) Object.assign(base, SPECIAL[key]);
    else if (typeof key === 'string' && key.length === 1) {
        base.code = `Key${key.toUpperCase()}`;
        base.windowsVirtualKeyCode = key.toUpperCase().charCodeAt(0);
        base.text = key;
    }
    return base;
}

async function runDebuggerAction(tabId, action, params) {
    await debuggerAttach(tabId);

    // Resolve x/y. Accept { x, y } directly OR { centerOfViewport: true }
    // OR { ratioX, ratioY } (0–1 fractions of viewport) for resolution-independence.
    async function resolveXY() {
        if (Number.isFinite(params.x) && Number.isFinite(params.y)) return { x: params.x, y: params.y };
        // Fetch viewport size via CDP and compute from ratios.
        const { result } = await debuggerSend(tabId, 'Runtime.evaluate', {
            expression: 'JSON.stringify({w: innerWidth, h: innerHeight})',
            returnByValue: true
        });
        let vp = { w: 1280, h: 720 };
        try { vp = JSON.parse(result.value); } catch {}
        if (params.centerOfViewport) return { x: vp.w / 2, y: vp.h / 2 };
        if (Number.isFinite(params.ratioX) && Number.isFinite(params.ratioY)) {
            return { x: Math.round(vp.w * params.ratioX), y: Math.round(vp.h * params.ratioY) };
        }
        throw new Error('clickAt/mouseMove requires either {x,y}, {ratioX,ratioY}, or {centerOfViewport:true}');
    }

    const mouseDown = (x, y, button, clickCount) => debuggerSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button, clickCount, buttons: button === 'right' ? 2 : 1
    });
    const mouseUp = (x, y, button, clickCount) => debuggerSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button, clickCount, buttons: 0
    });
    const mouseMove = (x, y, buttons = 0) => debuggerSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, buttons
    });

    switch (action) {
        case 'clickAt':
        case 'doubleClickAt':
        case 'rightClickAt': {
            const { x, y } = await resolveXY();
            const button = action === 'rightClickAt' ? 'right' : 'left';
            const count = action === 'doubleClickAt' ? 2 : 1;
            await mouseMove(x, y);
            await mouseDown(x, y, button, 1);
            await mouseUp(x, y, button, 1);
            if (count === 2) {
                await mouseDown(x, y, button, 2);
                await mouseUp(x, y, button, 2);
            }
            return { success: true, clickedAt: { x, y }, button, clickCount: count };
        }
        case 'mouseMove': {
            const { x, y } = await resolveXY();
            await mouseMove(x, y);
            return { success: true, movedTo: { x, y } };
        }
        case 'dragAndDrop': {
            const fromX = params.fromX, fromY = params.fromY, toX = params.toX, toY = params.toY;
            if (![fromX, fromY, toX, toY].every(Number.isFinite)) {
                return { success: false, error: 'dragAndDrop requires fromX, fromY, toX, toY' };
            }
            const steps = Math.max(5, Math.min(params.steps || 15, 60));
            await mouseMove(fromX, fromY);
            await mouseDown(fromX, fromY, 'left', 1);
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                await mouseMove(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, 1);
                await new Promise(r => setTimeout(r, 10));
            }
            await mouseUp(toX, toY, 'left', 1);
            return { success: true, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
        }
        case 'typeText': {
            // Real keyboard input into whatever element has focus. Works in canvas
            // games and WebGL editors where `type` can't reach an <input>.
            const text = String(params.text || '');
            if (!text) return { success: false, error: 'typeText requires params.text' };
            const mode = params.mode === 'keystrokes' ? 'keystrokes' : 'insert';
            if (mode === 'keystrokes') {
                // Fires real keydown/keyup per char — required for games/editors
                // that listen to key events rather than input events.
                for (const ch of text) {
                    const down = buildKeyEvent('keyDown', ch);
                    await debuggerSend(tabId, 'Input.dispatchKeyEvent', down);
                    if (down.text) await debuggerSend(tabId, 'Input.dispatchKeyEvent', { ...down, type: 'char' });
                    await debuggerSend(tabId, 'Input.dispatchKeyEvent', buildKeyEvent('keyUp', ch));
                }
            } else {
                await debuggerSend(tabId, 'Input.insertText', { text });
            }
            return { success: true, typed: text.slice(0, 200), chars: text.length, mode };
        }
        case 'pressKeyAt': {
            const key = params.key || 'Enter';
            const mods = modifiersMask(params.modifiers || {});
            const down = { ...buildKeyEvent('keyDown', key), modifiers: mods };
            const up = { ...buildKeyEvent('keyUp', key), modifiers: mods };
            await debuggerSend(tabId, 'Input.dispatchKeyEvent', down);
            // Only fire `char` for printable keys when NO non-shift modifier is held
            // (e.g. Ctrl+A must NOT insert the letter 'a' into the document).
            if (down.text && !(params.modifiers && (params.modifiers.ctrl || params.modifiers.alt || params.modifiers.meta))) {
                await debuggerSend(tabId, 'Input.dispatchKeyEvent', { ...down, type: 'char' });
            }
            await debuggerSend(tabId, 'Input.dispatchKeyEvent', up);
            return { success: true, key, modifiers: params.modifiers || null };
        }
        case 'scrollAt': {
            const { x, y } = await resolveXY();
            const deltaY = Number.isFinite(params.deltaY) ? params.deltaY : (params.direction === 'up' ? -400 : 400);
            const deltaX = Number.isFinite(params.deltaX) ? params.deltaX : 0;
            await debuggerSend(tabId, 'Input.dispatchMouseEvent', {
                type: 'mouseWheel', x, y, deltaX, deltaY
            });
            return { success: true, scrolledAt: { x, y }, deltaX, deltaY };
        }
        default:
            return { success: false, error: 'Unknown debugger action: ' + action };
    }
}

// ============================================
// Configure Side Panel Behavior
// ============================================
if (chrome.sidePanel) {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error(error));
}

// ============================================
// Download capture — chrome.downloads events. We keep a rolling in-memory
// list of the last ~30 downloads across all tasks, each with enough
// metadata that the agent can verify "did my click actually download
// something?". Surfaced via the `readDownloads` action.
// ============================================
const __geDownloadLog = [];
const __GE_DOWNLOAD_LIMIT = 30;

function recordDownload(item, updateType) {
    try {
        const existingIdx = __geDownloadLog.findIndex(d => d.id === item.id);
        const now = Date.now();
        const record = existingIdx >= 0 ? __geDownloadLog[existingIdx] : { id: item.id, createdAt: now };
        if (item.filename !== undefined)  record.filename = item.filename;
        if (item.url !== undefined)       record.url = item.url;
        if (item.mime !== undefined)      record.mime = item.mime;
        if (item.state !== undefined)     record.state = item.state;
        if (item.totalBytes !== undefined) record.totalBytes = item.totalBytes;
        if (item.fileSize !== undefined)  record.fileSize = item.fileSize;
        if (item.danger !== undefined)    record.danger = item.danger;
        if (item.error !== undefined)     record.error = item.error;
        record.updatedAt = now;
        record.lastEvent = updateType;
        if (existingIdx < 0) {
            __geDownloadLog.push(record);
            if (__geDownloadLog.length > __GE_DOWNLOAD_LIMIT) __geDownloadLog.shift();
        }
    } catch (e) {
        console.warn('[Global Executive] recordDownload failed:', e.message);
    }
}

if (chrome.downloads) {
    try {
        chrome.downloads.onCreated.addListener((item) => recordDownload(item, 'created'));
        chrome.downloads.onChanged.addListener((delta) => {
            // delta contains {id, filename?:{current}, state?:{current}, ...} — flatten.
            const flat = { id: delta.id };
            for (const k of Object.keys(delta)) {
                if (k === 'id') continue;
                const v = delta[k];
                if (v && typeof v === 'object' && 'current' in v) flat[k] = v.current;
            }
            recordDownload(flat, 'changed');
        });
    } catch (e) {
        console.warn('[Global Executive] downloads listener setup failed:', e.message);
    }
}

// ============================================
// readDownloads — return recent captured downloads. Filterable by time
// window + state. The agent uses this after a "download" button click to
// verify a file actually arrived, or to get the real filename when the
// site mangles it.
//
// Params:
//   sinceMs?: number    only include downloads updated within this window (default 5 min)
//   state?: 'complete' | 'in_progress' | 'interrupted' | 'any'  (default 'any')
//   limit?: number      1..30  (default 10)
// ============================================
function runReadDownloads(params) {
    const sinceMs = Math.max(1000, params.sinceMs || 5 * 60 * 1000);
    const state = (params.state || 'any').toLowerCase();
    const limit = Math.min(Math.max(1, params.limit || 10), __GE_DOWNLOAD_LIMIT);
    const cutoff = Date.now() - sinceMs;
    let items = __geDownloadLog.filter(d => (d.updatedAt || d.createdAt) >= cutoff);
    if (state !== 'any') items = items.filter(d => d.state === state);
    items = items.slice(-limit);
    return {
        success: true,
        downloads: items.map(d => ({
            id: d.id,
            filename: d.filename || '',
            basename: (d.filename || '').split(/[\\/]/).pop(),
            url: d.url || '',
            mime: d.mime || '',
            state: d.state || '',
            bytes: d.fileSize || d.totalBytes || 0,
            danger: d.danger || '',
            ageMs: Date.now() - (d.updatedAt || d.createdAt)
        })),
        returned: items.length,
        totalBuffered: __geDownloadLog.length,
        hint: items.length === 0
            ? 'No downloads captured in the window. If you just clicked a download link, wait 1-3s and retry. If still empty, the click may not have triggered a real download.'
            : ''
    };
}

// ============================================
// readEmail — open the user's webmail in a tab (they're already logged in
// via the browser session), wait for load, and extract the most recent
// messages. No OAuth, no IMAP, no passwords stored — we just pilot the
// live webmail UI.
//
// Params:
//   provider: 'gmail' | 'outlook' | 'yahoo' | 'proton' | 'generic'  (default 'gmail')
//   filter?: string   provider-specific search (e.g. "from:stripe newer_than:10m")
//   limit?: number    1..20  (default 5)
//   otpOnly?: boolean extract the first 4-8 digit code from the latest message
//   newTab?: boolean  open in a new tab instead of the current one (default false)
//
// Returns: { messages: [{from, subject, snippet, receivedAt, url}], otpCode? }
// ============================================
const EMAIL_PROVIDERS = {
    gmail: {
        // Gmail supports operators inline in the URL hash. Default: unread in inbox, last 1 hour.
        urlFor: (filter) => {
            const q = filter || 'in:inbox newer_than:1h';
            return 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(q);
        },
        waitForSelector: 'div[role="main"]'
    },
    outlook: {
        urlFor: () => 'https://outlook.live.com/mail/0/inbox',
        waitForSelector: 'div[role="main"]'
    },
    yahoo: {
        urlFor: () => 'https://mail.yahoo.com/d/folders/1',
        waitForSelector: 'main'
    },
    proton: {
        urlFor: () => 'https://mail.proton.me/u/0/inbox',
        waitForSelector: 'main'
    },
    generic: {
        urlFor: () => null,
        waitForSelector: 'body'
    }
};

async function runReadEmail(tabId, params) {
    const provider = EMAIL_PROVIDERS[(params.provider || 'gmail').toLowerCase()] || EMAIL_PROVIDERS.gmail;
    const url = provider.urlFor(params.filter);
    const limit = Math.min(Math.max(1, params.limit || 5), 20);

    if (!url) {
        return {
            success: false,
            error: 'provider="generic" requires you to `goto` the webmail URL yourself, then call `readPage` / `extract`.',
            recovery: 'Use `goto https://your-webmail.example.com/inbox` then `readPage` with narrow extract selectors.'
        };
    }

    // Navigate (current tab or new tab based on params).
    let targetTabId = tabId;
    try {
        if (params.newTab) {
            const t = await chrome.tabs.create({ url, active: true });
            targetTabId = t.id;
        } else {
            await chrome.tabs.update(tabId, { url });
        }
    } catch (e) {
        return { success: false, error: `Failed to navigate to webmail: ${e.message}` };
    }

    // Wait for page to finish loading.
    try {
        await waitForTabLoad(targetTabId, 15000);
    } catch {
        return { success: false, error: 'Webmail page did not finish loading within 15s.', recovery: 'Retry `readEmail`, or `goto` the URL manually and use `readPage`.' };
    }

    // Small settle delay \u2014 webmail apps hydrate after readystate=complete.
    await new Promise(r => setTimeout(r, 1500));

    // Run the provider-aware extractor inside the webmail page.
    let messages = [];
    try {
        const [injected] = await chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            func: extractEmailsInPage,
            args: [params.provider || 'gmail', limit]
        });
        messages = (injected && injected.result && injected.result.messages) || [];
    } catch (e) {
        return { success: false, error: `Email extraction failed: ${e.message}`, recovery: 'Call `readPage` on this tab and identify email rows manually, or check that the user is signed in to the webmail.' };
    }

    // OTP scan: look in the latest (most-recent-first) message snippets for a
    // 4-8 digit number. Intentionally NOT using a complex regex \u2014 simple and
    // predictable is safer for verification codes.
    let otpCode = null;
    if (params.otpOnly || params.otpOnly === undefined) {
        for (const m of messages) {
            const hay = `${m.subject || ''} ${m.snippet || ''}`;
            const match = hay.match(/(?:^|[^\d])(\d{4,8})(?:[^\d]|$)/);
            if (match) { otpCode = match[1]; break; }
        }
    }

    return {
        success: true,
        provider: params.provider || 'gmail',
        searchedUrl: url,
        messages: messages.slice(0, limit),
        otpCode,
        hint: messages.length === 0
            ? 'Inbox query returned zero messages. Widen the filter (e.g. newer_than:24h), or verify the user is actually signed in \u2014 if not, `readEmail` will have landed on the webmail login page.'
            : (otpCode ? `Extracted OTP candidate: ${otpCode}` : '')
    };
}

// ============================================
// captureFile \u2014 fetch a URL from the user's live browser session (uses
// their cookies) and pipe the bytes to the server, which stores it on
// OBS for 7 days. The agent can then chain the returned `fileId` into
// uploadFile / fillPdf / notifyUser / readFile.
//
// Params:
//   url        required    The file URL to fetch.
//   filename?  override the filename (otherwise derived from URL / Content-Disposition)
//   description?  short human-readable reason ("August invoice from Stripe")
//   maxBytes?  client-side size cap (server also enforces)
//   taskId?    task _id (ALWAYS required in practice; sender passes it in)
// ============================================
async function runCaptureFile(tabId, params) {
    const url = (params.url || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
        return { success: false, error: 'captureFile requires an absolute http(s) URL.' };
    }
    const taskId = (params.taskId || '').trim();
    if (!taskId.match(/^[0-9a-fA-F]{24}$/)) {
        return { success: false, error: 'captureFile requires a valid taskId.', recovery: 'The system normally injects taskId automatically; if you see this, escalate to the user.' };
    }

    // Pull auth token the same way the sidepanel does.
    const tok = await new Promise(r => chrome.storage.local.get(['noAuthToken'], (d) => r(d.noAuthToken || '')));
    if (!tok) return { success: false, error: 'Not signed in.' };

    // Fetch with cookies. Service workers CAN do cross-origin credentialed
    // fetches when host_permissions cover the URL (we have <all_urls>).
    let blob, contentType, contentDispositionFilename = '';
    try {
        const resp = await fetch(url, { credentials: 'include', method: 'GET' });
        if (!resp.ok) return { success: false, error: `Source fetch failed: HTTP ${resp.status}`, recovery: 'The URL may be auth-walled with a session the extension can\'t reach, or expired. Try `goto`-ing the page first to refresh cookies, then retry.' };
        contentType = (resp.headers.get('content-type') || '').split(';')[0].trim() || 'application/octet-stream';
        const cd = resp.headers.get('content-disposition') || '';
        const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
        if (m) contentDispositionFilename = decodeURIComponent(m[1]);
        blob = await resp.blob();
    } catch (e) {
        return { success: false, error: `Failed to fetch URL: ${e.message}`, recovery: 'The URL may be invalid, CORS-restricted server-side, or the site may require an active session you don\'t have.' };
    }

    // Filename resolution: explicit param > Content-Disposition > URL basename > "file".
    const urlBasename = (() => {
        try { const u = new URL(url); return u.pathname.split('/').filter(Boolean).pop() || ''; } catch { return ''; }
    })();
    const filename = (params.filename || contentDispositionFilename || urlBasename || 'file').slice(0, 255);

    // Client-side size sanity check (server also enforces per-tier).
    const maxBytes = Math.min(params.maxBytes || 60 * 1024 * 1024, 60 * 1024 * 1024);
    if (blob.size > maxBytes) {
        return { success: false, error: `File too large (${(blob.size / 1024 / 1024).toFixed(1)}MB). Client cap: ${(maxBytes / 1024 / 1024).toFixed(0)}MB.` };
    }
    if (blob.size === 0) {
        return { success: false, error: 'Fetched file is empty (0 bytes).' };
    }

    // POST raw bytes to server with metadata headers.
    const buf = await blob.arrayBuffer();
    const b64enc = (s) => btoa(unescape(encodeURIComponent(s || '')));
    try {
        const resp = await fetch(GE_API_BASE + '/api/agent/capture-file', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + tok,
                'Content-Type': contentType,
                'X-Capture-Task-Id': taskId,
                'X-Capture-Filename': b64enc(filename),
                'X-Capture-Mime': contentType,
                'X-Capture-Source-Url': b64enc(url),
                'X-Capture-Description': b64enc(params.description || ''),
                'X-Capture-Step': String(params.stepNumber || 0)
            },
            body: buf
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            return { success: false, error: data.error || `Upload failed (HTTP ${resp.status})`, status: resp.status };
        }
        return {
            success: true,
            fileId: data.fileId,
            filename: data.filename,
            mime: data.mime,
            size: data.size,
            signedUrl: data.signedUrl,
            expiresAt: data.expiresAt,
            ttlDays: data.ttlDays,
            capturedFilesCount: data.capturedFilesCount,
            capturedFilesMax: data.capturedFilesMax,
            hint: `File stored. Reference it in later actions via fileRef="${data.fileId}" (uploadFile / fillPdf / notifyUser) or use signedUrl directly.`
        };
    } catch (e) {
        return { success: false, error: `Upload to server failed: ${e.message}` };
    }
}

// Runs INSIDE the webmail page via chrome.scripting.executeScript.
// Provider-aware selectors; falls back to heuristics.
// MUST be self-contained \u2014 can't reference outer scope.
function extractEmailsInPage(provider, limit) {
    const results = [];
    const p = (provider || 'gmail').toLowerCase();
    try {
        if (p === 'gmail') {
            const rows = document.querySelectorAll('tr.zA, div[role="main"] tr[jscontroller]');
            for (const row of rows) {
                if (results.length >= limit) break;
                const from = (row.querySelector('.yX span[email], .yW span[email], .zF') || {}).textContent || '';
                const subject = (row.querySelector('.y6 span, .bog') || {}).textContent || '';
                const snippet = (row.querySelector('.y2') || {}).textContent || '';
                const time = (row.querySelector('.xW span, .xY span') || {}).title || '';
                results.push({
                    from: from.trim().slice(0, 120),
                    subject: subject.trim().slice(0, 200),
                    snippet: snippet.trim().slice(0, 300),
                    receivedAt: time.trim().slice(0, 60),
                    unread: row.classList.contains('zE')
                });
            }
        } else if (p === 'outlook') {
            const rows = document.querySelectorAll('div[role="option"][aria-label]');
            for (const row of rows) {
                if (results.length >= limit) break;
                const label = row.getAttribute('aria-label') || '';
                results.push({ from: '', subject: label.slice(0, 200), snippet: '', receivedAt: '' });
            }
        }
        // Generic fallback: any element that looks like an email row.
        if (results.length === 0) {
            const rows = document.querySelectorAll('[role="listitem"], [role="row"], article, li');
            for (const row of rows) {
                if (results.length >= limit) break;
                const txt = (row.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 400);
                if (txt.length < 20) continue;
                results.push({ from: '', subject: txt.slice(0, 120), snippet: txt.slice(120, 400), receivedAt: '' });
            }
        }
    } catch (e) {
        return { messages: [], error: e.message };
    }
    return { messages: results };
}

