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
importScripts('core/api-client.js', 'core/tool-manager.js', 'core/auth.js');

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
                                const fn = new Function(code);
                                fn();
                            } catch (e) {
                                console.error('[New Order] Tool execution error:', e);
                            }
                        },
                        args: [wrappedCode]
                    });
                }

                console.log(`New Order Global: Injected tool "${tool.name}" into tab ${tabId}`);
            } catch (err) {
                console.error(`New Order Global: Failed to inject tool "${tool.name}":`, err);
            }
        }

        return matchingTools.length;
    } catch (err) {
        console.error('New Order Global: Error injecting custom tools:', err);
        return 0;
    }
}

// ============================================
// Tab Navigation Listener — inject tools on page load
// ============================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        // Don't inject into extension pages or chrome pages
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

        // Inject custom AI tools that match this URL
        await injectCustomToolsIntoTab(tabId, tab.url);
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

    // Auth state change broadcast
    if (message.type === 'noAuthChanged') {
        // Rebroadcast to all extension pages
        return false; // Don't block
    }
});

// ============================================
// Configure Side Panel Behavior
// ============================================
if (chrome.sidePanel) {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error(error));
}
