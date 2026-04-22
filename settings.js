// Settings Page JavaScript
// Handles saving/loading settings and UI interactions

// Track if there are unsaved changes
let hasUnsavedChanges = false;
// Global variable to keep track of current settings for customFonts
let currentSettings = {};

document.addEventListener('DOMContentLoaded', function () {
    console.log('YouTube New Order Settings: Page loaded');

    // Load saved settings
    loadSettings();

    // Add event listeners
    setupEventListeners();
});

// Default settings
const defaultSettings = {
    // Layout & Reordering
    toggleReorder: true,
    showCommentsOnHomepage: false,
    layoutMode: 'swapped',
    resizableColumns: false,
    collapsibleSections: false,
    pipComments: false,
    gridView: false,

    // Visual Enhancements
    hideDescription: false,
    hideChannelInfo: false,
    hideMerch: false,
    hideEndScreen: false,
    customFont: 'default',
    compactMode: false,
    highlightComments: true,
    navbarLogoMode: 'youtube', // youtube, extension, custom
    navbarLogoData: '', // url or base64

    // Comments Features
    commentSearch: true,
    filterComments: false,
    autoloadComments: false,

    // Video Player Features
    keyboardShortcuts: false,
    copyTimestamp: false,
    skipIntro: false,
    skipAds: false,
    screenshot: true,
    volumeBoost: false,
    videoPip: true,

    // Content Filtering
    hideShorts: false,
    blockChannels: '',
    hideClickbait: false,
    keywordFilter: '',
    hideAds: false,

    // Productivity Features
    watchLater: false,
    playlistManager: false,
    notesSection: false,
    bookmarks: false,
    historySearch: false,
    customFonts: []
};

// Load settings from Chrome storage
function loadSettings() {
    console.log('Loading settings...');

    chrome.storage.sync.get(['settings'], function (result) {
        if (chrome.runtime.lastError) {
            console.error('Error loading settings:', chrome.runtime.lastError);
            showNotification('Error loading settings', 'error');
            return;
        }

        const settings = { ...defaultSettings, ...result.settings };
        currentSettings = settings;
        applySettingsToForm(settings);
        console.log('Settings loaded:', settings);

        // Reset unsaved flag after loading
        hasUnsavedChanges = false;
        updateSaveButton();
    });
}

// Apply settings to the form elements
function applySettingsToForm(settings) {
    // Layout & Reordering
    setCheckbox('toggle-reorder', settings.toggleReorder);
    setCheckbox('show-comments-homepage', settings.showCommentsOnHomepage);
    setSelectValue('layout-mode', settings.layoutMode);
    setCheckbox('resizable-columns', settings.resizableColumns);
    setCheckbox('collapsible-sections', settings.collapsibleSections);
    setCheckbox('pip-comments', settings.pipComments);
    setCheckbox('grid-view', settings.gridView);

    // Visual Enhancements
    setCheckbox('hide-description', settings.hideDescription);
    setCheckbox('hide-channel-info', settings.hideChannelInfo);
    setCheckbox('hide-merch', settings.hideMerch);
    setCheckbox('hide-end-screen', settings.hideEndScreen);
    setSelectValue('custom-font', settings.customFont);
    updateFontDropdown(settings);
    setCheckbox('compact-mode', settings.compactMode);
    setCheckbox('highlight-comments', settings.highlightComments);
    setSelectValue('navbar-logo-mode', settings.navbarLogoMode);

    // Handle specific logic for custom logo UI
    const logoMode = document.getElementById('navbar-logo-mode');
    const customOptions = document.getElementById('custom-logo-options');
    if (logoMode && customOptions) {
        customOptions.style.display = settings.navbarLogoMode === 'custom' ? 'block' : 'none';
    }

    if (settings.navbarLogoMode === 'custom' && settings.navbarLogoData) {
        // If it looks like a URL, put it in the input
        if (settings.navbarLogoData.startsWith('http')) {
            setInputValue('custom-logo-url', settings.navbarLogoData);
        } else if (settings.navbarLogoData.startsWith('data:image')) {
            // It's a base64, show preview
            const preview = document.getElementById('custom-logo-preview');
            if (preview) {
                preview.innerHTML = `<img src="${settings.navbarLogoData}" style="max-height: 24px; max-width: 100%;">`;
                document.getElementById('custom-logo-filename').textContent = 'Custom image loaded';
            }
        }
    }

    // Comments Features
    setCheckbox('comment-search', settings.commentSearch);
    setCheckbox('filter-comments', settings.filterComments);
    setCheckbox('autoload-comments', settings.autoloadComments);

    // Video Player Features
    setCheckbox('keyboard-shortcuts', settings.keyboardShortcuts);
    setCheckbox('copy-timestamp', settings.copyTimestamp);
    setCheckbox('skip-intro', settings.skipIntro);
    setCheckbox('skip-ads', settings.skipAds);
    setCheckbox('screenshot', settings.screenshot);
    setCheckbox('volume-boost', settings.volumeBoost);
    setCheckbox('video-pip', settings.videoPip);

    // Content Filtering
    setCheckbox('hide-shorts', settings.hideShorts);
    setInputValue('block-channels', settings.blockChannels);
    setCheckbox('hide-clickbait', settings.hideClickbait);
    setInputValue('keyword-filter', settings.keywordFilter);
    setCheckbox('hide-ads', settings.hideAds);

    // Productivity Features
    setCheckbox('watch-later', settings.watchLater);
    setCheckbox('playlist-manager', settings.playlistManager);
    setCheckbox('notes-section', settings.notesSection);
    setCheckbox('bookmarks', settings.bookmarks);
    setCheckbox('history-search', settings.historySearch);
}

// Helper functions for setting form values
function setCheckbox(id, value) {
    const el = document.getElementById(id);
    if (el) el.checked = value ?? false;
}

function setSelectValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
}

function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
}

// Save settings to Chrome storage
function saveSettings() {
    console.log('Saving settings...');

    const settings = gatherSettings();

    chrome.storage.sync.set({ settings: settings }, function () {
        if (chrome.runtime.lastError) {
            console.error('Error saving settings:', chrome.runtime.lastError);
            showNotification('Error saving settings: ' + chrome.runtime.lastError.message, 'error');
            return;
        }

        console.log('Settings saved successfully:', settings);

        // IMPORTANT: Reset unsaved changes flag
        hasUnsavedChanges = false;
        updateSaveButton();

        showNotification('Settings saved successfully! Refresh YouTube to see changes.', 'success');

        // Notify content scripts about the change
        chrome.tabs.query({ url: 'https://www.youtube.com/*' }, function (tabs) {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { type: 'settingsUpdated', settings: settings }).catch(() => {
                    // Tab might not have content script loaded yet
                });
            });
        });
    });
}

// Gather all settings from the form
function gatherSettings() {
    const settings = {
        // preserve customFonts from current state since they aren't in the form fields directly
        customFonts: currentSettings.customFonts || [],

        // Layout & Reordering
        toggleReorder: getCheckboxValue('toggle-reorder'),
        showCommentsOnHomepage: getCheckboxValue('show-comments-homepage'),
        layoutMode: getSelectValue('layout-mode'),
        resizableColumns: getCheckboxValue('resizable-columns'),
        collapsibleSections: getCheckboxValue('collapsible-sections'),
        pipComments: getCheckboxValue('pip-comments'),
        gridView: getCheckboxValue('grid-view'),

        // Visual Enhancements
        hideDescription: getCheckboxValue('hide-description'),
        hideChannelInfo: getCheckboxValue('hide-channel-info'),
        hideMerch: getCheckboxValue('hide-merch'),
        hideEndScreen: getCheckboxValue('hide-end-screen'),
        customFont: getSelectValue('custom-font'),
        compactMode: getCheckboxValue('compact-mode'),
        highlightComments: getCheckboxValue('highlight-comments'),
        navbarLogoMode: getSelectValue('navbar-logo-mode'),
        navbarLogoData: currentSettings.navbarLogoData || '', // Preserve existing data by default

        // Comments Features
        commentSearch: getCheckboxValue('comment-search'),
        filterComments: getCheckboxValue('filter-comments'),
        autoloadComments: getCheckboxValue('autoload-comments'),

        // Video Player Features
        keyboardShortcuts: getCheckboxValue('keyboard-shortcuts'),
        copyTimestamp: getCheckboxValue('copy-timestamp'),
        skipIntro: getCheckboxValue('skip-intro'),
        skipAds: getCheckboxValue('skip-ads'),
        screenshot: getCheckboxValue('screenshot'),
        volumeBoost: getCheckboxValue('volume-boost'),
        videoPip: getCheckboxValue('video-pip'),

        // Content Filtering
        hideShorts: getCheckboxValue('hide-shorts'),
        blockChannels: getInputValue('block-channels'),
        hideClickbait: getCheckboxValue('hide-clickbait'),
        keywordFilter: getInputValue('keyword-filter'),
        hideAds: getCheckboxValue('hide-ads'),

        // Productivity Features
        watchLater: getCheckboxValue('watch-later'),
        playlistManager: getCheckboxValue('playlist-manager'),
        notesSection: getCheckboxValue('notes-section'),
        bookmarks: getCheckboxValue('bookmarks'),
        historySearch: getCheckboxValue('history-search'),
        customFonts: currentSettings.customFonts || []
    };

    return settings;
}

// Helper functions for getting form values
function getCheckboxValue(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
}

function getSelectValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

function getInputValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

// Update save button appearance
function updateSaveButton() {
    const saveBtn = document.getElementById('save-settings');
    if (!saveBtn) return;

    if (hasUnsavedChanges) {
        saveBtn.classList.add('has-changes');
        saveBtn.textContent = '💾 Save Settings*';
    } else {
        saveBtn.classList.remove('has-changes');
        saveBtn.textContent = '💾 Save Settings';
    }
}

// Reset settings to default
function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to default?')) {
        console.log('Resetting settings to default...');

        chrome.storage.sync.set({ settings: defaultSettings }, function () {
            if (chrome.runtime.lastError) {
                console.error('Error resetting settings:', chrome.runtime.lastError);
                showNotification('Error resetting settings', 'error');
                return;
            }

            applySettingsToForm(defaultSettings);
            hasUnsavedChanges = false;
            updateSaveButton();
            showNotification('Settings reset to default!', 'info');

            // Notify content scripts
            chrome.tabs.query({ url: 'https://www.youtube.com/*' }, function (tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { type: 'settingsUpdated', settings: defaultSettings }).catch(() => { });
                });
            });
        });
    }
}

// Export settings to JSON file
function exportSettings() {
    console.log('Exporting settings...');

    const settings = gatherSettings();
    const exportData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        settings: settings
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `youtube-new-order-settings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();

    URL.revokeObjectURL(url);
    showNotification('Settings exported successfully!', 'success');
}

// Import settings from JSON file
function importSettings() {
    console.log('Importing settings...');

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    input.onchange = function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();

        reader.onload = function (event) {
            try {
                const data = JSON.parse(event.target.result);

                // Handle both old and new format
                const importedSettings = data.settings || data;

                // Validate settings
                if (typeof importedSettings !== 'object') {
                    throw new Error('Invalid settings format');
                }

                // Merge with defaults to ensure all fields exist
                const mergedSettings = { ...defaultSettings, ...importedSettings };

                chrome.storage.sync.set({ settings: mergedSettings }, function () {
                    if (chrome.runtime.lastError) {
                        console.error('Error importing settings:', chrome.runtime.lastError);
                        showNotification('Error importing settings', 'error');
                        return;
                    }

                    applySettingsToForm(mergedSettings);
                    hasUnsavedChanges = false;
                    updateSaveButton();
                    showNotification('Settings imported successfully!', 'success');

                    // Notify content scripts
                    chrome.tabs.query({ url: 'https://www.youtube.com/*' }, function (tabs) {
                        tabs.forEach(tab => {
                            chrome.tabs.sendMessage(tab.id, { type: 'settingsUpdated', settings: mergedSettings }).catch(() => { });
                        });
                    });
                });
            } catch (error) {
                console.error('Error parsing settings file:', error);
                showNotification('Error importing settings: Invalid file format', 'error');
            }
        };

        reader.readAsText(file);
    };

    input.click();
}

// Show notification
function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existing = document.querySelector('.yt-new-order-notification');
    if (existing) existing.remove();

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `yt-new-order-notification notification-${type}`;

    // Add icon based on type
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    notification.innerHTML = `<span class="notification-icon">${icon}</span> ${message}`;

    // Style the notification
    const colors = {
        success: 'linear-gradient(135deg, #00d26a, #00b359)',
        error: 'linear-gradient(135deg, #ff4444, #cc0000)',
        info: 'linear-gradient(135deg, #3ea6ff, #0077cc)'
    };

    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${colors[type] || colors.info};
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 10000;
        animation: slideIn 0.3s ease;
        font-weight: 600;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 400px;
    `;

    document.body.appendChild(notification);

    // Remove after 4 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 4000);
}

// Setup event listeners
function setupEventListeners() {
    // Save button
    const saveBtn = document.getElementById('save-settings');
    if (saveBtn) saveBtn.addEventListener('click', saveSettings);

    // Reset button
    const resetBtn = document.getElementById('reset-settings');
    if (resetBtn) resetBtn.addEventListener('click', resetSettings);

    // Export button
    const exportBtn = document.getElementById('export-settings');
    if (exportBtn) exportBtn.addEventListener('click', exportSettings);

    // Import button
    const importBtn = document.getElementById('import-settings');
    if (importBtn) importBtn.addEventListener('click', importSettings);

    // Font Uploader
    setupFontUploader();

    // Logo Uploader
    setupLogoUploader();

    // Add change listeners to all inputs for unsaved indicator
    const allInputs = document.querySelectorAll('input, select');

    allInputs.forEach(input => {
        input.addEventListener('change', function () {
            console.log(`Setting changed: ${this.id} = ${this.type === 'checkbox' ? this.checked : this.value}`);
            hasUnsavedChanges = true;
            updateSaveButton();
        });
    });

    // Warn before leaving with unsaved changes
    window.addEventListener('beforeunload', function (e) {
        if (hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
            return e.returnValue;
        }
    });
}



// Setup Font Uploader UI
function setupFontUploader() {
    const radios = document.querySelectorAll('input[name="font-source"]');
    radios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.getElementById('font-url-input-group').style.display = e.target.value === 'url' ? 'block' : 'none';
            document.getElementById('font-upload-input-group').style.display = e.target.value === 'upload' ? 'block' : 'none';
        });
    });

    const addBtn = document.getElementById('btn-add-font');
    if (addBtn) addBtn.addEventListener('click', addNewFont);
}

// Add New Font
function addNewFont() {
    const source = document.querySelector('input[name="font-source"]:checked').value;
    const nameInput = document.getElementById(source === 'url' ? 'new-font-name-url' : 'new-font-name-file');


    let name = nameInput.value.trim();

    // If we have a URL but no name, try to extract it from the URL (Google Fonts specific)
    if (source === 'url' && !name) {
        const urlVal = document.getElementById('new-font-url').value;
        // Extract font name from Google Fonts URL — grab the LAST family= parameter
        // since that's most likely the one the user wants
        const familyMatches = urlVal.match(/family=([^&:"']+)/g);
        if (familyMatches && familyMatches.length > 0) {
            const lastFamily = familyMatches[familyMatches.length - 1];
            const familyName = lastFamily.replace('family=', '').split(':')[0].replace(/\+/g, ' ');
            if (familyName) {
                name = familyName;
                nameInput.value = name; // Update UI
            }
        }
    }

    if (!name) {
        showNotification('Please enter a font name', 'error');
        return;
    }

    if (source === 'url') {
        const urlInput = document.getElementById('new-font-url');
        let url = urlInput.value.trim();

        // Smart extraction: handle all the formats a user might paste
        // 1. Full <style>@import url(...)</style> block
        if (url.includes('<style')) {
            // Extract the @import URL from inside a <style> tag
            const importMatch = url.match(/@import\s+url\(['"]?([^'")\s]+)['"]?\)/);
            if (importMatch && importMatch[1]) {
                url = importMatch[1];
            } else {
                // Try to find any URL inside the style block
                const hrefMatch = url.match(/https?:\/\/[^\s'"<>]+/);
                if (hrefMatch) {
                    url = hrefMatch[0];
                }
            }
        }
        // 2. Full <link> tag
        else if (url.includes('<link')) {
            const match = url.match(/href=["']([^"']+)["']/);
            if (match && match[1]) {
                url = match[1];
            }
        }
        // 3. CSS @import statement
        else if (url.includes('@import')) {
            const match = url.match(/url\(["']?([^"')]+)["']?\)/);
            if (match && match[1]) {
                url = match[1];
            } else {
                // @import "url" format (without url())
                const match2 = url.match(/@import\s+["']([^"']+)["']/);
                if (match2 && match2[1]) {
                    url = match2[1];
                }
            }
        }
        // 4. Bare url() wrapper
        else if (url.includes('url(')) {
            const match = url.match(/url\(["']?([^"')]+)["']?\)/);
            if (match && match[1]) {
                url = match[1];
            }
        }

        if (!url) {
            showNotification('Please enter a font URL', 'error');
            return;
        }

        const font = {
            id: 'font_' + Date.now(),
            name: name,
            type: 'url',
            value: url
        };

        addFontToSettings(font);

        // Clear inputs
        nameInput.value = '';
        urlInput.value = '';

    } else {
        const fileInput = document.getElementById('new-font-file');
        const file = fileInput.files[0];

        if (!file) {
            showNotification('Please select a font file', 'error');
            return;
        }

        if (file.size > 2 * 1024 * 1024) { // 2MB limit
            showNotification('File is too large (max 2MB)', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = function (e) {
            const fontId = 'font_' + Date.now();
            const fontData = e.target.result; // Base64

            // Store data in local storage
            const storageData = {};
            storageData[fontId] = fontData;

            chrome.storage.local.set(storageData, function () {
                if (chrome.runtime.lastError) {
                    showNotification('Error saving font file: ' + chrome.runtime.lastError.message, 'error');
                    return;
                }

                const font = {
                    id: fontId,
                    name: name,
                    type: 'upload',
                    // Don't store value here to save sync space
                };

                addFontToSettings(font);

                // Clear inputs
                nameInput.value = '';
                fileInput.value = '';
            });
        };
        reader.readAsDataURL(file);
    }
}

// Add font to settings and save
function addFontToSettings(font) {
    if (!currentSettings.customFonts) {
        currentSettings.customFonts = [];
    }

    currentSettings.customFonts.push(font);

    // Update local variable
    updateFontDropdown(currentSettings);

    // Select the new font
    setSelectValue('custom-font', font.id);

    // Save settings
    saveSettings();
}

// Update Font Dropdown
function updateFontDropdown(settings) {
    const group = document.getElementById('user-fonts-group');
    if (!group) return;

    group.innerHTML = '';

    if (settings.customFonts && settings.customFonts.length > 0) {
        settings.customFonts.forEach(font => {
            const option = document.createElement('option');
            option.value = font.id;
            option.textContent = font.name;
            // Best effort preview
            option.style.fontFamily = `"${font.name}", sans-serif`;
            group.appendChild(option);
        });
    } else {
        const option = document.createElement('option');
        option.disabled = true;
        option.textContent = 'No custom fonts added';
        group.appendChild(option);
    }

    // Restore selection if it was a custom font
    const currentVal = getSelectValue('custom-font');
    if (currentVal && currentVal.startsWith('font_')) {
        setSelectValue('custom-font', currentVal);
    }
}

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }

    .notification-icon {
        font-size: 18px;
    }

    #save-settings.has-changes {
        animation: pulse-btn 1s ease infinite;
        background: linear-gradient(135deg, #ff6b35, #f7931e) !important;
    }

    @keyframes pulse-btn {
        0%, 100% {
            transform: scale(1);
            box-shadow: 0 4px 12px rgba(255, 107, 53, 0.3);
        }
        50% {
            transform: scale(1.02);
            box-shadow: 0 6px 20px rgba(255, 107, 53, 0.5);
        }
    }
`;
document.head.appendChild(style);

// Setup Logo Uploader
function setupLogoUploader() {
    const logoMode = document.getElementById('navbar-logo-mode');
    const customOptions = document.getElementById('custom-logo-options');
    const urlInput = document.getElementById('custom-logo-url');
    const fileInput = document.getElementById('custom-logo-upload');
    const preview = document.getElementById('custom-logo-preview');

    if (logoMode) {
        logoMode.addEventListener('change', (e) => {
            if (customOptions) customOptions.style.display = e.target.value === 'custom' ? 'block' : 'none';
        });
    }

    if (urlInput) {
        urlInput.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val) {
                currentSettings.navbarLogoData = val;
                if (preview) {
                    preview.innerHTML = `<img src="${val}" style="max-height: 24px; max-width: 100%;" onerror="this.style.display='none'">`;
                    document.getElementById('custom-logo-filename').textContent = 'URL Image';
                }
                hasUnsavedChanges = true;
                updateSaveButton();
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > 2 * 1024 * 1024) {
                showNotification('Image too large (max 2MB)', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = function (evt) {
                const base64 = evt.target.result;
                currentSettings.navbarLogoData = base64;
                if (preview) {
                    preview.innerHTML = `<img src="${base64}" style="max-height: 24px; max-width: 100%;">`;
                }
                const nameSpan = document.getElementById('custom-logo-filename');
                if (nameSpan) nameSpan.textContent = file.name;

                hasUnsavedChanges = true;
                updateSaveButton();
            };
            reader.readAsDataURL(file);
        });
    }
}
