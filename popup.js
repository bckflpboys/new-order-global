// New Order Global — Popup Script
// Quick controls + AI Builder launcher + YouTube tool management

document.addEventListener('DOMContentLoaded', function () {
    console.log('New Order Global Popup: Loaded');

    // Initialize
    ensureEverythingReady();
    loadCustomToolsCount();

    // ============================================
    // AI Builder Buttons
    // ============================================
    document.getElementById('open-builder').addEventListener('click', openBuilder);
    document.getElementById('open-builder-btn').addEventListener('click', openBuilder);

    function openBuilder() {
        chrome.tabs.create({ url: chrome.runtime.getURL('builder/builder.html') });
        window.close();
    }

    // ============================================
    // YouTube Settings
    // ============================================
    document.getElementById('open-settings').addEventListener('click', function () {
        chrome.runtime.openOptionsPage();
    });

    // Reload current page
    document.getElementById('reload-page').addEventListener('click', function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.reload(tabs[0].id);
                window.close();
            }
        });
    });

    // YouTube quick toggle
    document.getElementById('quick-toggle').addEventListener('change', function () {
        const enabled = this.checked;
        console.log('YouTube quick toggle:', enabled);

        chrome.storage.sync.get(['settings'], function (result) {
            const settings = result.settings || {};
            settings.toggleReorder = enabled;

            chrome.storage.sync.set({ settings: settings }, function () {
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                    if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            type: 'settingsUpdated',
                            settings: settings
                        }).catch(() => { });
                    }
                });
                updateStatusText(enabled);
            });
        });
    });
});

// ============================================
// Load Custom Tools Count
// ============================================
async function loadCustomToolsCount() {
    try {
        const stats = await ToolManager.getStats();
        const badge = document.getElementById('custom-tools-badge');
        const count = document.getElementById('custom-tools-count');

        if (stats.active > 0) {
            badge.style.display = 'inline-flex';
            count.textContent = stats.active;
        }
    } catch (err) {
        console.log('Error loading tool stats:', err);
    }
}

// ============================================
// Ensure YouTube host permission & injection
// ============================================
async function ensureEverythingReady() {
    // Step 1: Check YouTube host permission
    const hasPermission = await chrome.permissions.contains({
        origins: ['https://www.youtube.com/*']
    });

    if (!hasPermission) {
        console.log('New Order Popup: YouTube host permission not granted, requesting...');
        try {
            const granted = await chrome.permissions.request({
                origins: ['https://www.youtube.com/*']
            });
            if (granted) {
                await chrome.runtime.sendMessage({ type: 'requestPermission' });
            } else {
                loadYouTubeStatus();
                return;
            }
        } catch (err) {
            const nowHasPermission = await chrome.permissions.contains({
                origins: ['https://www.youtube.com/*']
            });
            if (!nowHasPermission) {
                loadYouTubeStatus();
                return;
            }
        }
    }

    // Step 2: Ensure content script on active YouTube tab
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];

        if (tab && tab.url && tab.url.includes('youtube.com')) {
            let contentScriptReady = false;
            try {
                const response = await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
                contentScriptReady = response && response.pong;
            } catch (e) {
                contentScriptReady = false;
            }

            if (!contentScriptReady) {
                try {
                    await chrome.runtime.sendMessage({
                        type: 'ensureContentScript',
                        tabId: tab.id
                    });
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (err) {
                    try {
                        await chrome.scripting.insertCSS({
                            target: { tabId: tab.id },
                            files: ['styles.css']
                        });
                        await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            files: ['content.js']
                        });
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (directErr) {
                        console.error('New Order Popup: Injection failed:', directErr);
                    }
                }
            }
        }
    } catch (err) {
        console.log('New Order Popup: Error checking content script:', err);
    }

    // Step 3: Also inject custom tools into current tab
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].url) {
            chrome.runtime.sendMessage({
                type: 'noInjectTools',
                tabId: tabs[0].id,
                url: tabs[0].url
            }).catch(() => {});
        }
    } catch (err) {
        // Non-critical
    }

    loadYouTubeStatus();
}

// ============================================
// YouTube Feature Display
// ============================================
const featureNames = {
    resizableColumns: 'Resizable Cols',
    collapsibleSections: 'Collapsible',
    pipComments: 'PiP Comments',
    gridView: 'Grid View',
    commentSearch: 'Search',
    filterComments: 'Filter',
    autoloadComments: 'Auto-load',
    keyboardShortcuts: 'Shortcuts',
    copyTimestamp: 'Copy Time',
    skipAds: 'Skip Ads',
    screenshot: 'Screenshot',
    volumeBoost: 'Vol. Boost',
    videoPip: 'Video PiP',
    hideShorts: 'Hide Shorts',
    hideClickbait: 'No Clickbait',
    hideAds: 'Hide Ads',
    hideDescription: 'Hide Desc',
    hideChannelInfo: 'Hide Channel',
    hideMerch: 'Hide Merch',
    hideEndScreen: 'Hide EndScr',
    compactMode: 'Compact',
    highlightComments: 'Highlight',
    watchLater: 'Watch Later',
    playlistManager: 'Playlist Mgr',
    notesSection: 'Notes',
    bookmarks: 'Bookmarks',
    historySearch: 'History Search'
};

const layoutNames = {
    'swapped': 'Comments Right',
    'swapped_left': 'Comments Left',
    'triple_left': 'Triple (C-V-R)',
    'triple_right': 'Triple (R-V-C)',
    'original': 'Original',
    'theater': 'Theater',
    'minimal': 'Minimal',
    'focus': 'Focus Mode'
};

function loadYouTubeStatus() {
    chrome.storage.sync.get(['settings'], function (result) {
        const settings = result.settings || {};
        const enabled = settings.toggleReorder !== false;

        document.getElementById('quick-toggle').checked = enabled;
        updateStatusText(enabled);

        const layoutEl = document.getElementById('layout-display');
        if (layoutEl) {
            layoutEl.textContent = layoutNames[settings.layoutMode] || 'Swapped';
        }

        const activeFeatures = [];
        for (const [key, label] of Object.entries(featureNames)) {
            if (settings[key]) {
                activeFeatures.push(label);
            }
        }

        const countEl = document.getElementById('feature-count');
        if (countEl) {
            countEl.textContent = activeFeatures.length + ' enabled';
        }

        const grid = document.getElementById('features-grid');
        if (grid) {
            grid.innerHTML = '';

            const featuresToShow = activeFeatures.slice(0, 8);

            if (featuresToShow.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.className = 'tool-chip';
                emptyMsg.style.gridColumn = '1 / -1';
                emptyMsg.style.justifyContent = 'center';
                emptyMsg.style.opacity = '0.5';
                emptyMsg.style.borderStyle = 'dashed';
                emptyMsg.textContent = 'No features active';
                grid.appendChild(emptyMsg);
            } else {
                featuresToShow.forEach(label => {
                    const tag = document.createElement('div');
                    tag.className = 'tool-chip active';

                    const dot = document.createElement('span');
                    dot.className = 'tool-dot';
                    tag.appendChild(dot);

                    tag.appendChild(document.createTextNode(label));
                    grid.appendChild(tag);
                });
            }
        }
    });
}

function updateStatusText(enabled) {
    const statusEl = document.querySelector('.status-text');
    if (statusEl) {
        statusEl.textContent = enabled ? 'Active' : 'Paused';
        statusEl.style.color = enabled ? '#00d4aa' : '#ff5757';
    }
}
