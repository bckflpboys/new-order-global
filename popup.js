document.addEventListener('DOMContentLoaded', () => {
    // --- Vertical Slider (Notifications) ---
    const verticalSlider = document.getElementById('vertical-slider');
    const btnNotifications = document.getElementById('btn-notifications');
    const btnCloseNotifications = document.getElementById('btn-close-notifications');
    const notificationDot = document.getElementById('dot');
    const notificationBadge = document.getElementById('notification-badge');

    btnNotifications.addEventListener('click', () => {
        verticalSlider.style.transform = 'translateY(0)';
        if (notificationDot) notificationDot.style.display = 'none';
        // Clear badge when opening notifications
        updateBadge(0);
        chrome.storage.local.set({ no_unread_notifications: false });
    });

    btnCloseNotifications.addEventListener('click', () => {
        verticalSlider.style.transform = 'translateY(-50%)';
    });

    // --- Horizontal Slider (Main Content) ---
    const horizontalSlider = document.getElementById('horizontal-slider');
    const btnLeft = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');
    let hPos = 1; // 0=History, 1=Main, 2=Settings

    function updateH() {
        horizontalSlider.style.transform = `translateX(${hPos * -33.333}%)`;
        
        // Update Icons
        btnLeft.innerHTML = hPos === 0 ? '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg>';
        btnRight.innerHTML = hPos === 2 ? '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>';
        
        // Update Active States (Make them Red when selected)
        btnLeft.classList.toggle('active', hPos === 0);
        btnRight.classList.toggle('active', hPos === 2);
    }

    btnLeft.addEventListener('click', () => { hPos = hPos === 0 ? 1 : 0; updateH(); });
    btnRight.addEventListener('click', () => { hPos = hPos === 2 ? 1 : 2; updateH(); });

    // --- Navigation ---
    const open = (u) => chrome.tabs.create({ url: chrome.runtime.getURL(u) });
    document.getElementById('btn-create').onclick = () => open('builder/builder.html');
    document.getElementById('btn-tools').onclick = () => open('dashboard/tools.html');
    document.getElementById('btn-agent').onclick = () => open('agent/agent.html');
    document.getElementById('btn-account').onclick = () => open('dashboard/billing.html');
    document.getElementById('btn-settings').onclick = () => open('dashboard/settings.html');
    document.getElementById('btn-yt-settings').onclick = () => chrome.runtime.openOptionsPage();

    // =========================================================
    // Toast Notification System
    // =========================================================
    let badgeCount = 0;

    function updateBadge(count) {
        badgeCount = count;
        if (notificationBadge) {
            notificationBadge.textContent = count;
            notificationBadge.classList.toggle('visible', count > 0);
        }
    }

    function showToast(message, type = 'info', durationMs = 4000, persist = true) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const icons = {
            success: '✅',
            info: 'ℹ️',
            warning: '⚠️',
        };

        const toast = document.createElement('div');
        toast.className = `popup-toast toast-${type}`;
        toast.innerHTML = `
            <span class="popup-toast-icon">${icons[type] || icons.info}</span>
            <span>${message}</span>
        `;
        container.appendChild(toast);

        // Increment badge
        updateBadge(badgeCount + 1);

        // Auto-dismiss
        setTimeout(() => {
            toast.classList.add('exiting');
            setTimeout(() => toast.remove(), 300);
        }, durationMs);

        if (persist) {
            chrome.storage.local.get(['no_notifications'], (data) => {
                let notifs = data.no_notifications || [];
                let title = type === 'success' ? 'Success' : type === 'warning' ? 'Alert' : 'System Info';
                if (message.includes('activated') || message.includes('enabled')) title = 'Service Activated';
                if (message.includes('deactivated') || message.includes('disabled') || message.includes('stopped')) title = 'Service Stopped';
                
                notifs.unshift({
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    title: title,
                    message,
                    type,
                    icon: icons[type] || icons.info,
                    timestamp: Date.now()
                });
                notifs = notifs.slice(0, 50);
                chrome.storage.local.set({ no_notifications: notifs, no_unread_notifications: true });
            });
        }
    }

    // =========================================================
    // Persistent Notifications & Activity
    // =========================================================
    function initNotifications() {
        chrome.storage.local.get(['no_notifications', 'no_unread_notifications'], (data) => {
            renderNotifications(data.no_notifications || []);
            
            if (data.no_unread_notifications) {
                if (notificationDot) notificationDot.style.display = 'block';
            } else {
                if (notificationDot) notificationDot.style.display = 'none';
            }
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                if (changes.no_notifications) {
                    renderNotifications(changes.no_notifications.newValue || []);
                }
                if (changes.no_unread_notifications && changes.no_unread_notifications.newValue === true) {
                    if (notificationDot) notificationDot.style.display = 'block';
                }
            }
        });

        // Clear All button listener
        const btnClearAll = document.getElementById('btn-clear-all');
        if (btnClearAll) {
            btnClearAll.onclick = () => {
                chrome.storage.local.set({ no_notifications: [] });
            };
        }
    }

    function renderNotifications(notifs) {
        const cont = document.getElementById('notifications-container');
        if (!cont) return;

        if (notifs.length === 0) {
            cont.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">No new alerts</div>';
            return;
        }

        cont.innerHTML = notifs.map(n => `
            <div class="notification-item" ${n.type === 'warning' || n.type === 'error' ? 'style="border-color: rgba(214, 40, 40, 0.15); background: #fff;"' : ''}>
                <div class="notification-icon" ${n.type === 'warning' || n.type === 'error' ? 'style="color: var(--accent-red); background: rgba(214, 40, 40, 0.05);"' : ''}>${n.icon || 'ℹ️'}</div>
                <div class="notification-content">
                    <div class="notification-title" ${n.type === 'warning' || n.type === 'error' ? 'style="color: var(--accent-red);"' : ''}>${n.title}</div>
                    <div class="notification-text">${n.message}</div>
                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">${new Date(n.timestamp).toLocaleTimeString()}</div>
                </div>
                <button class="dismiss-btn" data-id="${n.id}" title="Dismiss">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        `).join('');

        // Add dismiss listeners
        cont.querySelectorAll('.dismiss-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                chrome.storage.local.get(['no_notifications'], (data) => {
                    let filtered = (data.no_notifications || []).filter(item => item.id !== id);
                    chrome.storage.local.set({ no_notifications: filtered });
                });
            });
        });
    }

    async function loadChatHistory() {
        const cont = document.getElementById('history-container');
        if (!cont) return;

        cont.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">Loading history...</div>';

        try {
            await NewOrderAuth.init();
            if (!NewOrderAuth.isAuthenticated()) {
                cont.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">Sign in to view chat history</div>';
                return;
            }

            const conversations = await NewOrderAPI.getConversations();
            
            if (!conversations || conversations.length === 0) {
                cont.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">No conversations yet</div>';
                return;
            }

            cont.innerHTML = conversations.map(c => {
                const date = c.updatedAt ? new Date(c.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Recently';
                const hasTool = c.toolName ? true : false;
                const icon = hasTool ? '🔧' : '💬';
                const pillText = hasTool ? c.toolName : 'General Chat';

                return `
                <div class="history-card" data-convo="${c.id}">
                    <div class="history-top">
                        <div class="history-icon-wrapper">${icon}</div>
                        <div class="history-title-group">
                            <div class="history-title">${c.title || 'New Conversation'}</div>
                            <div class="history-date">${date} &middot; ${c.messageCount || 0} messages</div>
                        </div>
                    </div>
                    <div class="history-bottom">
                        <div class="history-pill">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                            ${pillText}
                        </div>
                        <div style="font-size: 11px; color: var(--accent-red); font-weight: 700;">Open &rarr;</div>
                    </div>
                </div>
                `;
            }).join('');

            // Add click listeners to items
            cont.querySelectorAll('.history-card').forEach(item => {
                item.addEventListener('click', () => {
                    const id = item.getAttribute('data-convo');
                    chrome.tabs.create({ url: chrome.runtime.getURL(`builder/builder.html?conversationId=${id}`) });
                });
            });

        } catch (err) {
            cont.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--accent-red); font-size: 13px;">Error loading history</div>`;
        }
    }

    // =========================================================
    // Run Timer Helpers
    // =========================================================
    const runTimers = {}; // toolId -> { startTime, intervalId, el }

    function formatElapsed(ms) {
        const totalSec = Math.floor(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function startTimer(toolId, timerEl, cardEl, dotEl) {
        if (runTimers[toolId]) stopTimer(toolId); // prevent duplicates

        const startTime = Date.now();
        timerEl.classList.add('visible');
        cardEl.classList.add('is-running');
        if (dotEl) dotEl.classList.add('running');

        const intervalId = setInterval(() => {
            const elapsed = Date.now() - startTime;
            timerEl.querySelector('.timer-value').textContent = formatElapsed(elapsed);
        }, 1000);

        runTimers[toolId] = { startTime, intervalId, el: timerEl };

        // Persist run state
        chrome.storage.local.set({ [`toolRunning_${toolId}`]: startTime });
    }

    function stopTimer(toolId) {
        const entry = runTimers[toolId];
        if (entry) {
            clearInterval(entry.intervalId);
            entry.el.classList.remove('visible');
            delete runTimers[toolId];
        }
        chrome.storage.local.remove([`toolRunning_${toolId}`]);
    }

    // =========================================================
    // Run / Stop Tool
    // =========================================================
    async function runToolOnCurrentTab(tool) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.id) {
                showToast('No active tab found', 'warning');
                return false;
            }

            const url = tab.url || '';

            // Check for restricted Chrome pages
            if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
                url.startsWith('about:') || url.startsWith('edge://') || url.startsWith('brave://') ||
                url.startsWith('devtools://') || url === 'chrome://newtab/') {
                showToast('Navigate to a website first — tools can\'t run on browser pages', 'warning');
                return false;
            }

            // Ensure we have host permission for this site
            try {
                const origin = new URL(url).origin + '/*';
                const hasPermission = await chrome.permissions.contains({ origins: [origin] });
                if (!hasPermission) {
                    // Try requesting <all_urls> so it works everywhere
                    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
                    if (!granted) {
                        showToast('Permission denied — allow access to run tools', 'warning');
                        return false;
                    }
                }
            } catch (permErr) {
                console.warn('Permission check failed:', permErr);
                // Continue anyway — the injection itself will fail if no permission
            }

            // Ask background to inject
            const response = await chrome.runtime.sendMessage({
                type: 'noRunToolOnTab',
                toolId: tool.id,
                tabId: tab.id,
                url: tab.url
            });

            if (response && response.success) {
                showToast(`"${tool.name}" is now running`, 'success');
                return true;
            } else {
                const errMsg = response?.error || 'Unknown error';
                showToast(`Failed: ${errMsg}`, 'warning');
                return false;
            }
        } catch (err) {
            console.error('Run tool error:', err);
            showToast(`Error: ${err.message}`, 'warning');
            return false;
        }
    }

    async function stopToolOnCurrentTab(tool) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.id) return false;

            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (toolId) => {
                    const cleanupKey = `__noToolCleanup_${toolId.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    if (typeof window[cleanupKey] === 'function') {
                        window[cleanupKey]();
                    }
                },
                args: [tool.id]
            });

            showToast(`"${tool.name}" stopped`, 'info');
            return true;
        } catch (err) {
            console.error('Stop tool error:', err);
            return false;
        }
    }

    // =========================================================
    // Build Tool Card (Enhanced)
    // =========================================================
    function createToolCard(tool, options = {}) {
        const { isBuiltIn = false, isAutoRun = false } = options;
        const div = document.createElement('div');
        div.className = 'tool-card-enhanced';
        div.dataset.toolId = tool.id || 'youtube';

        const tagHTML = isBuiltIn
            ? '<span class="tool-tag built-in">Built-in</span>'
            : isAutoRun
                ? '<span class="tool-tag auto-run">Auto</span>'
                : '<span class="tool-tag manual">Manual</span>';

        // Run button tooltip varies by type
        const runBtnTitle = isBuiltIn ? 'Refresh on current tab' : isAutoRun ? 'Re-inject on current tab' : 'Run on current tab';

        div.innerHTML = `
            <div class="tool-card-top">
                <div class="tool-card-info">
                    <div class="tool-name-row">
                        <span class="tool-status-dot ${isAutoRun ? 'auto' : ''}" data-dot></span>
                        <span class="tool-name">${tool.name || 'Untitled'}</span>
                        ${tagHTML}
                    </div>
                    <div class="tool-desc">${tool.description || 'No description'}</div>
                </div>
                <div class="tool-card-controls">
                    <button class="run-btn play" data-run title="${runBtnTitle}">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                    <label class="toggle-switch">
                        <input type="checkbox" ${tool.isActive ? 'checked' : ''} data-toggle>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div class="tool-card-bottom">
                <div class="run-timer" data-timer>
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                    <span class="timer-value">0:00</span>
                </div>
                <div style="font-size: 11px; color: var(--text-muted);">${isAutoRun ? 'Auto-runs · ▶ to re-inject now' : isBuiltIn ? 'YouTube suite · ▶ to refresh' : 'Click ▶ to run on this page'}</div>
            </div>
        `;

        return div;
    }

    // =========================================================
    // Load Tools (Main Logic)
    // =========================================================
    const loadTools = async (forceSync = false) => {
        const cont = document.getElementById('tools-container');
        cont.innerHTML = '<div class="tool-card-enhanced" style="opacity: 0.5; text-align:center; padding:24px;"><div class="tool-name">Loading tools...</div></div>';
        
        try {
            // Initialize auth to see if we can sync
            await NewOrderAuth.init();
            
            if (!NewOrderAuth.isAuthenticated()) {
                // Show Sign In / Register card instead of tools based on user request
                cont.innerHTML = `
                    <div class="auth-card" style="background: var(--surface-container-lowest); border: 1px solid var(--ghost-border); border-radius: var(--radius-lg); padding: 20px; box-shadow: var(--shadow-xs);">
                        <div style="display: flex; gap: 4px; margin-bottom: 22px; background: var(--surface-container); border-radius: var(--radius-md); padding: 4px;">
                            <button class="auth-tab active" data-tab="login" style="flex: 1; padding: 9px; border: none; background: var(--surface-container-lowest); color: var(--primary); border-radius: var(--radius-sm); font-family: var(--font-label); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; cursor: pointer; transition: 0.2s ease; box-shadow: var(--shadow-xs);">Sign In</button>
                            <button class="auth-tab" data-tab="register" style="flex: 1; padding: 9px; border: none; background: transparent; color: var(--on-surface-muted); border-radius: var(--radius-sm); font-family: var(--font-label); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; cursor: pointer; transition: 0.2s ease;">Register</button>
                        </div>
                        
                        <form id="popup-login-form">
                            <div style="margin-bottom: 14px;">
                                <label style="display: block; font-family: var(--font-label); font-size: 11px; margin-bottom: 6px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--on-surface-variant);">Email</label>
                                <input type="email" id="popup-login-email" required placeholder="your@email.com" style="width: 100%; padding: 11px 14px; background: var(--surface-container-lowest); border: 1px solid var(--ghost-border-strong); border-radius: var(--radius-md); color: var(--on-surface); font-family: var(--font-body); font-size: 14px; outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;">
                            </div>
                            <div style="margin-bottom: 14px;">
                                <label style="display: block; font-family: var(--font-label); font-size: 11px; margin-bottom: 6px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--on-surface-variant);">Password</label>
                                <input type="password" id="popup-login-password" required placeholder="••••••••" style="width: 100%; padding: 11px 14px; background: var(--surface-container-lowest); border: 1px solid var(--ghost-border-strong); border-radius: var(--radius-md); color: var(--on-surface); font-family: var(--font-body); font-size: 14px; outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;">
                            </div>
                            <button type="submit" style="width: 100%; padding: 13px; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-container) 100%); color: var(--on-primary); border: none; border-radius: var(--radius-md); font-family: var(--font-label); font-size: 13px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease; margin-top: 10px; box-shadow: var(--shadow-xs);">Sign In</button>
                            <div id="popup-login-error" style="color: var(--on-error-container); font-size: 13px; margin-top: 14px; padding: 11px 14px; background: var(--error-container); border-radius: var(--radius-md); text-align: center; display: none;"></div>
                        </form>

                        <form id="popup-register-form" style="display: none;">
                            <div style="margin-bottom: 14px;">
                                <label style="display: block; font-family: var(--font-label); font-size: 11px; margin-bottom: 6px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--on-surface-variant);">Display Name</label>
                                <input type="text" id="popup-register-name" required placeholder="Your name" style="width: 100%; padding: 11px 14px; background: var(--surface-container-lowest); border: 1px solid var(--ghost-border-strong); border-radius: var(--radius-md); color: var(--on-surface); font-family: var(--font-body); font-size: 14px; outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;">
                            </div>
                            <div style="margin-bottom: 14px;">
                                <label style="display: block; font-family: var(--font-label); font-size: 11px; margin-bottom: 6px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--on-surface-variant);">Email</label>
                                <input type="email" id="popup-register-email" required placeholder="your@email.com" style="width: 100%; padding: 11px 14px; background: var(--surface-container-lowest); border: 1px solid var(--ghost-border-strong); border-radius: var(--radius-md); color: var(--on-surface); font-family: var(--font-body); font-size: 14px; outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;">
                            </div>
                            <div style="margin-bottom: 14px;">
                                <label style="display: block; font-family: var(--font-label); font-size: 11px; margin-bottom: 6px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--on-surface-variant);">Password</label>
                                <input type="password" id="popup-register-password" minlength="8" required placeholder="••••••••" style="width: 100%; padding: 11px 14px; background: var(--surface-container-lowest); border: 1px solid var(--ghost-border-strong); border-radius: var(--radius-md); color: var(--on-surface); font-family: var(--font-body); font-size: 14px; outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;">
                            </div>
                            <button type="submit" style="width: 100%; padding: 13px; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-container) 100%); color: var(--on-primary); border: none; border-radius: var(--radius-md); font-family: var(--font-label); font-size: 13px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease; margin-top: 10px; box-shadow: var(--shadow-xs);">Create Account</button>
                            <div id="popup-register-error" style="color: var(--on-error-container); font-size: 13px; margin-top: 14px; padding: 11px 14px; background: var(--error-container); border-radius: var(--radius-md); text-align: center; display: none;"></div>
                        </form>
                    </div>
                `;

                const tabs = cont.querySelectorAll('.auth-tab');
                const loginForm = document.getElementById('popup-login-form');
                const registerForm = document.getElementById('popup-register-form');

                tabs.forEach(tab => {
                    tab.addEventListener('click', () => {
                        tabs.forEach(t => {
                            t.style.background = 'transparent';
                            t.style.color = 'var(--on-surface-muted)';
                        });
                        tab.style.background = 'var(--surface-container-lowest)';
                        tab.style.color = 'var(--primary)';

                        const isLogin = tab.dataset.tab === 'login';
                        loginForm.style.display = isLogin ? 'block' : 'none';
                        registerForm.style.display = isLogin ? 'none' : 'block';
                    });
                });

                loginForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const email = document.getElementById('popup-login-email').value;
                    const password = document.getElementById('popup-login-password').value;
                    const errorEl = document.getElementById('popup-login-error');
                    errorEl.style.display = 'none';
                    try {
                        const submitBtn = loginForm.querySelector('button[type="submit"]');
                        submitBtn.textContent = 'Signing in...';
                        submitBtn.disabled = true;
                        await NewOrderAuth.login(email, password);
                        loadTools(true);
                    } catch (err) {
                        const submitBtn = loginForm.querySelector('button[type="submit"]');
                        submitBtn.textContent = 'Sign In';
                        submitBtn.disabled = false;
                        errorEl.textContent = err.message;
                        errorEl.style.display = 'block';
                    }
                });

                registerForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const name = document.getElementById('popup-register-name').value;
                    const email = document.getElementById('popup-register-email').value;
                    const password = document.getElementById('popup-register-password').value;
                    const errorEl = document.getElementById('popup-register-error');
                    errorEl.style.display = 'none';
                    try {
                        const submitBtn = registerForm.querySelector('button[type="submit"]');
                        submitBtn.textContent = 'Creating...';
                        submitBtn.disabled = true;
                        await NewOrderAuth.register(email, password, name);
                        loadTools(true);
                    } catch (err) {
                        const submitBtn = registerForm.querySelector('button[type="submit"]');
                        submitBtn.textContent = 'Create Account';
                        submitBtn.disabled = false;
                        errorEl.textContent = err.message;
                        errorEl.style.display = 'block';
                    }
                });

                return;
            }

            // If logged in, sync from cloud
            const stats = await ToolManager.syncTools(forceSync);
            const tools = stats.tools || [];
            
            cont.innerHTML = '';

            // ======================================
            // 1. Built-in YouTube Tool Card
            // ======================================
            const ytTool = {
                id: 'youtube-toolkit',
                name: 'YouTube Toolkit',
                description: 'Custom layouts, video tools, filters',
                isActive: false
            };

            // Check YouTube permission
            const hasYtPerm = await chrome.permissions.contains({ origins: ['https://www.youtube.com/*'] });
            ytTool.isActive = hasYtPerm;

            const ytCard = createToolCard(ytTool, { isBuiltIn: true });

            // YouTube toggle handler
            const ytToggle = ytCard.querySelector('[data-toggle]');
            ytToggle.checked = hasYtPerm;
            ytToggle.onchange = async (e) => {
                if (e.target.checked) {
                    try {
                        const granted = await chrome.permissions.request({ origins: ['https://www.youtube.com/*'] });
                        e.target.checked = granted;
                        if (granted) {
                            showToast('YouTube Toolkit enabled', 'success');
                            updateDot(ytCard, true);
                        }
                    } catch (err) {
                        e.target.checked = false;
                    }
                } else {
                    try {
                        const removed = await chrome.permissions.remove({ origins: ['https://www.youtube.com/*'] });
                        e.target.checked = !removed;
                        if (removed) {
                            showToast('YouTube Toolkit disabled', 'info');
                            updateDot(ytCard, false);
                        }
                    } catch (err) {
                        e.target.checked = true;
                    }
                }
            };

            // Click to open settings (but not on controls)
            ytCard.addEventListener('click', (e) => {
                if (e.target.closest('.tool-card-controls')) return;
                chrome.runtime.openOptionsPage();
            });

            // YouTube Run/Re-inject button
            const ytRunBtn = ytCard.querySelector('[data-run]');
            if (ytRunBtn) {
                ytRunBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                        if (!tab || !tab.url || !tab.url.includes('youtube.com')) {
                            showToast('Navigate to YouTube first', 'warning');
                            return;
                        }
                        // Re-inject YouTube CSS + JS
                        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] });
                        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
                        showToast('YouTube Toolkit refreshed on tab', 'success');
                        updateDot(ytCard, true);
                        const timerEl = ytCard.querySelector('[data-timer]');
                        const dotEl = ytCard.querySelector('[data-dot]');
                        startTimer('youtube-toolkit', timerEl, ytCard, dotEl);
                    } catch (err) {
                        showToast('Failed to inject: ' + err.message, 'warning');
                    }
                });
            }

            // Show YouTube as running if permission active
            if (hasYtPerm) {
                updateDot(ytCard, true);
                // Notify user
                showToast('YouTube Toolkit is active', 'info', 3000);
            }

            cont.appendChild(ytCard);

            // ======================================
            // 2. AI Builder Custom Tools
            // ======================================
            if (tools.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.className = 'empty-tools-msg';
                emptyMsg.innerHTML = 'No custom tools found.<br>Create more in the <strong>AI Builder</strong>!';
                cont.appendChild(emptyMsg);
            } else {
                // Check current tab to determine auto-run status
                let currentTabUrl = '';
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab) currentTabUrl = tab.url || '';
                } catch (e) {}

                for (const t of tools) {
                    // Determine if this tool auto-runs (has targetSites that match pages)
                    const hasTargetSites = t.targetSites && t.targetSites.length > 0;
                    const isAutoRun = hasTargetSites; // Tools with target sites auto-inject on matching pages

                    const card = createToolCard(t, { isAutoRun });

                    // Toggle handler
                    const toggle = card.querySelector('[data-toggle]');
                    toggle.onchange = async (e) => {
                        e.stopPropagation();
                        if (e.target.checked) {
                            await ToolManager.activateTool(t.id);
                            showToast(`"${t.name}" activated`, 'success');
                            if (isAutoRun) {
                                updateDot(card, true, true); // auto style
                                showToast(`"${t.name}" will auto-run on matching sites`, 'info', 4000);
                            }
                        } else {
                            await ToolManager.deactivateTool(t.id);
                            showToast(`"${t.name}" deactivated`, 'info');
                            updateDot(card, false);
                            // Stop any running timer
                            const timerEl = card.querySelector('[data-timer]');
                            const dotEl = card.querySelector('[data-dot]');
                            card.classList.remove('is-running');
                            if (timerEl) timerEl.classList.remove('visible');
                            if (dotEl) { dotEl.classList.remove('running'); dotEl.classList.remove('auto'); }
                            stopTimer(t.id);
                        }
                    };

                    // Run button handler (for manual tools)
                    const runBtn = card.querySelector('[data-run]');
                    if (runBtn) {
                        let isRunning = false;

                        // Check if it was already running (persisted state)
                        const stored = await new Promise(resolve => {
                            chrome.storage.local.get([`toolRunning_${t.id}`], result => {
                                resolve(result[`toolRunning_${t.id}`] || null);
                            });
                        });

                        if (stored) {
                            // Restore running state
                            isRunning = true;
                            runBtn.className = 'run-btn stop';
                            runBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
                            runBtn.title = 'Stop tool';
                            const timerEl = card.querySelector('[data-timer]');
                            const dotEl = card.querySelector('[data-dot]');
                            startTimer(t.id, timerEl, card, dotEl);
                            // Update timer to reflect actual elapsed time
                            const elapsed = Date.now() - stored;
                            timerEl.querySelector('.timer-value').textContent = formatElapsed(elapsed);
                        }

                        runBtn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const timerEl = card.querySelector('[data-timer]');
                            const dotEl = card.querySelector('[data-dot]');

                            if (!isRunning) {
                                // RUN
                                const success = await runToolOnCurrentTab(t);
                                if (success) {
                                    isRunning = true;
                                    runBtn.className = 'run-btn stop';
                                    runBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
                                    runBtn.title = 'Stop tool';
                                    startTimer(t.id, timerEl, card, dotEl);
                                }
                            } else {
                                // STOP
                                await stopToolOnCurrentTab(t);
                                isRunning = false;
                                runBtn.className = 'run-btn play';
                                runBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
                                runBtn.title = 'Run on current tab';
                                stopTimer(t.id);
                                card.classList.remove('is-running');
                                if (dotEl) dotEl.classList.remove('running');
                                if (timerEl) timerEl.classList.remove('visible');
                            }
                        });
                    }

                    // For auto-run tools that are active, show status notification
                    if (isAutoRun && t.isActive) {
                        updateDot(card, true, true);
                        // Check if tool is matching current page
                        if (currentTabUrl && isUrlMatchingTool(currentTabUrl, t)) {
                            showToast(`"${t.name}" is running on this page`, 'success', 3500);
                            // Also show running indicator
                            const timerEl = card.querySelector('[data-timer]');
                            const dotEl = card.querySelector('[data-dot]');
                            if (dotEl) { dotEl.classList.remove('auto'); dotEl.classList.add('running'); }
                            card.classList.add('is-running');
                        }
                    }

                    // Click to open tool detail (but not on controls)
                    card.addEventListener('click', (e) => {
                        if (e.target.closest('.tool-card-controls') || e.target.closest('[data-run]')) return;
                        open(`dashboard/tool-detail.html?id=${t.id}`);
                    });

                    cont.appendChild(card);
                }
            }
        } catch (e) {
            console.error('Popup: Error loading tools:', e);
            cont.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--accent-red); font-size: 13px;">Error loading tools. <br>Check your connection.</div>';
        }
    };

    // =========================================================
    // Helpers
    // =========================================================
    function updateDot(card, active, isAuto = false) {
        const dot = card.querySelector('[data-dot]');
        if (!dot) return;
        dot.classList.remove('running', 'auto');
        if (active) {
            dot.classList.add(isAuto ? 'auto' : 'running');
        }
    }

    function isUrlMatchingTool(url, tool) {
        if (!tool.targetSites || tool.targetSites.length === 0) return false;
        return tool.targetSites.some(pattern => {
            const regexStr = pattern
                .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\\\*/g, '.*')
                .replace(/^\\\*:/, '(https?|ftp):');
            try {
                return new RegExp(`^${regexStr}$`).test(url);
            } catch {
                return false;
            }
        });
    }

    // =========================================================
    // Listen for messages from background (tool status updates)
    // =========================================================
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'toolInjected') {
            showToast(`"${msg.toolName}" injected on this page`, 'success', 3500, false);
        }
        if (msg.type === 'toolError') {
            showToast(`"${msg.toolName}" failed: ${msg.error}`, 'warning', 5000, false);
        }
    });

    // Initial load
    loadTools();
    initNotifications();
    loadChatHistory();

    // --- YT Status ---
    (async () => {
        if (!(await chrome.permissions.contains({ origins: ['https://www.youtube.com/*'] }))) {
            try { await chrome.permissions.request({ origins: ['https://www.youtube.com/*'] }); } catch (e) { }
        }
    })();
});
