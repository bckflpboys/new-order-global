// New Order Global — Popup Script

document.addEventListener('DOMContentLoaded', () => {
    // ============================================
    // Navigation / Slider Logic
    // ============================================
    const slider = document.getElementById('screens-slider');
    const btnLeft = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');
    let currentPosition = 1; // 0 = Left (History), 1 = Center (Main), 2 = Right (Settings)

    function updateSlider() {
        const translateVal = currentPosition * -33.333;
        slider.style.transform = `translateX(${translateVal}%)`;
        
        // Update icons dynamically based on position
        if (currentPosition === 0) {
            btnLeft.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>'; // Close
            btnRight.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>';
        } else if (currentPosition === 2) {
            btnRight.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>'; // Close
            btnLeft.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg>';
        } else {
            btnLeft.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg>';
            btnRight.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>';
        }
    }

    btnLeft.addEventListener('click', () => {
        currentPosition = currentPosition === 0 ? 1 : 0;
        updateSlider();
    });

    btnRight.addEventListener('click', () => {
        currentPosition = currentPosition === 2 ? 1 : 2;
        updateSlider();
    });

    // ============================================
    // Action Buttons
    // ============================================
    function openUrl(url) {
        chrome.tabs.create({ url: chrome.runtime.getURL(url) });
    }

    document.getElementById('btn-create').addEventListener('click', () => openUrl('builder/builder.html'));
    document.getElementById('btn-tools').addEventListener('click', () => openUrl('dashboard/tools.html'));
    document.getElementById('btn-account').addEventListener('click', () => openUrl('dashboard/billing.html'));
    document.getElementById('btn-settings').addEventListener('click', () => openUrl('dashboard/settings.html'));
    document.getElementById('btn-yt-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

    // ============================================
    // Init Center Screen
    // ============================================
    loadCustomTools();

    // ============================================
    // Init Right Screen (YouTube/Integrations)
    // ============================================
    ensureYouTubeReady();

    document.getElementById('yt-quick-toggle').addEventListener('change', function () {
        const enabled = this.checked;
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
            });
        });
    });
});

// ============================================
// Data Loading
// ============================================
async function loadCustomTools() {
    const container = document.getElementById('tools-container');
    try {
        const tools = await ToolManager.getTools();
        if (!tools || tools.length === 0) {
            container.innerHTML = '<div class="empty-state">No custom tools created yet.<br><br>Click "Create" to build your first AI tool!</div>';
            return;
        }

        container.innerHTML = '';
        tools.forEach(tool => {
            const card = document.createElement('div');
            card.className = 'tool-card';
            
            // Go to detail page on click
            card.addEventListener('click', (e) => {
                if (e.target.tagName.toLowerCase() !== 'input' && !e.target.classList.contains('slider')) {
                    chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard/tool-detail.html?id=${tool.id}`) });
                }
            });

            const info = document.createElement('div');
            info.className = 'tool-info';
            
            const name = document.createElement('div');
            name.className = 'tool-name';
            name.textContent = tool.name || 'Untitled Tool';
            
            const desc = document.createElement('div');
            desc.className = 'tool-desc';
            desc.textContent = tool.description || (tool.matches ? tool.matches.join(', ') : 'Global Tool');
            
            info.appendChild(name);
            info.appendChild(desc);

            const toggle = document.createElement('label');
            toggle.className = 'toggle-switch';
            
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = tool.isActive !== false;
            
            input.addEventListener('change', async (e) => {
                const checked = e.target.checked;
                if (checked) {
                    await ToolManager.activateTool(tool.id);
                } else {
                    await ToolManager.deactivateTool(tool.id);
                }
            });

            const slider = document.createElement('span');
            slider.className = 'slider';
            
            toggle.appendChild(input);
            toggle.appendChild(slider);

            card.appendChild(info);
            card.appendChild(toggle);
            container.appendChild(card);
        });

    } catch (err) {
        console.error(err);
        container.innerHTML = '<div class="empty-state">Error loading tools.</div>';
    }
}

// ============================================
// YouTube Permissions & Data
// ============================================
async function ensureYouTubeReady() {
    const hasPermission = await chrome.permissions.contains({
        origins: ['https://www.youtube.com/*']
    });

    if (!hasPermission) {
        try {
            await chrome.permissions.request({ origins: ['https://www.youtube.com/*'] });
            await chrome.runtime.sendMessage({ type: 'requestPermission' });
        } catch (e) { }
    } else {
        // Ensure content script on active YouTube tab
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
                    } catch (err) { }
                }
            }
        } catch (err) { }
    }
    
    // Inject custom tools if needed into current active tab
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].url) {
            chrome.runtime.sendMessage({
                type: 'noInjectTools',
                tabId: tabs[0].id,
                url: tabs[0].url
            }).catch(() => {});
        }
    } catch (err) { }

    loadYouTubeStatus();
}

const ytFeatureNames = {
    resizableColumns: 'Resizable Cols', pipComments: 'PiP Comments', gridView: 'Grid View',
    skipAds: 'Skip Ads', hideShorts: 'Hide Shorts', highlightComments: 'Highlight',
    hideClickbait: 'No Clickbait', hideAds: 'Hide Ads', watchLater: 'Watch Later'
};

function loadYouTubeStatus() {
    chrome.storage.sync.get(['settings'], function (result) {
        const settings = result.settings || {};
        const enabled = settings.toggleReorder !== false;
        document.getElementById('yt-quick-toggle').checked = enabled;

        const featuresList = document.getElementById('yt-features-list');
        featuresList.innerHTML = '';
        
        let hasActive = false;
        for (const [key, label] of Object.entries(ytFeatureNames)) {
            if (settings[key]) {
                hasActive = true;
                const row = document.createElement('div');
                row.className = 'setting-row';
                row.style.padding = '8px 14px';
                row.innerHTML = `<span class="setting-name" style="font-size:12px;">${label}</span><span style="color:#00d4aa; font-size:11px; font-weight:600;">ACTIVE</span>`;
                featuresList.appendChild(row);
            }
        }
        
        if (!hasActive) {
            featuresList.innerHTML = '<div style="font-size:12px; color:#5a5a6a; margin-top:8px;">No extra modules enabled.</div>';
        }
    });
}
