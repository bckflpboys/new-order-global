// Global Executive — Background Agent Loop (service worker)
//
// Runs agent tasks that originated from Telegram / WhatsApp WITHOUT requiring
// the side panel / dashboard to be open. Gated server-side to paying users:
// every request this loop makes is stamped with the `X-Agent-Run-Mode:
// background` header, which the server uses to require an active
// subscription (Monthly / Yearly / Super Agent).
//
// This file is loaded by `background.js` via importScripts, so the helpers
// it references (ensureAgentRuntime, sendMessageToTabWithRetry,
// waitForTabLoad, GE_API_BASE) are already in scope.

(function () {
    'use strict';

    const ALARM_NAME = 'geBgAgentPoll';
    const POLL_MINUTES = 0.5; // 30s
    const INTEG_CACHE_MS = 2 * 60 * 1000; // 2 minutes

    let _running = false;
    let _cachedIntegAt = 0;
    let _cachedInteg = null;

    // ============================================
    // Service-worker keep-alive
    // ----------------------------------------------
    // MV3 suspends the worker after ~30s of inactivity. While a task is in
    // flight we hold an open port to a content script and send a heartbeat
    // every 20s; an open port resets the idle timer on every message (up to
    // Chrome's hard 5-minute cap per port, which we work around by cycling
    // the port every 4 minutes).
    // ============================================
    let _kaPort = null;
    let _kaTimer = null;
    let _kaTabId = null;
    let _kaCycleAt = 0;

    // Service-worker browser env (no `window` here — viewport not applicable).
    // Server-side ENVIRONMENT block uses this to render OS/browser/timezone
    // and the online flag.
    function _bgBrowserEnv() {
        let timezone = '';
        try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
        return {
            userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
            locale: (typeof navigator !== 'undefined' && (navigator.language || (navigator.languages && navigator.languages[0]))) || '',
            timezone,
            online: (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') ? navigator.onLine : undefined
        };
    }

    function _kaOpen(tabId) {
        try {
            _kaPort = chrome.tabs.connect(tabId, { name: 'ge-bg-keepalive' });
            _kaCycleAt = Date.now();
            _kaPort.onDisconnect.addListener(() => {
                _kaPort = null;
                // If we're still supposed to be running, try to reopen on next tick.
                if (_running && _kaTabId) {
                    setTimeout(() => { if (_running && _kaTabId && !_kaPort) _kaOpen(_kaTabId); }, 500);
                }
            });
        } catch (e) {
            _kaPort = null;
        }
    }

    function startKeepalive(tabId) {
        if (!tabId) return;
        stopKeepalive();
        _kaTabId = tabId;
        _kaOpen(tabId);
        _kaTimer = setInterval(() => {
            if (!_running) { stopKeepalive(); return; }
            // Cycle the port every ~4 minutes to stay well under Chrome's 5-min port cap.
            if (_kaPort && (Date.now() - _kaCycleAt) > 4 * 60 * 1000) {
                try { _kaPort.disconnect(); } catch { /* ignore */ }
                _kaPort = null;
            }
            if (!_kaPort && _kaTabId) _kaOpen(_kaTabId);
            try { _kaPort && _kaPort.postMessage({ type: 'ge-ka-ping', t: Date.now() }); }
            catch { try { _kaPort && _kaPort.disconnect(); } catch {} _kaPort = null; }
        }, 20000);
    }

    function stopKeepalive() {
        if (_kaTimer) { clearInterval(_kaTimer); _kaTimer = null; }
        try { _kaPort && _kaPort.disconnect(); } catch { /* ignore */ }
        _kaPort = null;
        _kaTabId = null;
    }

    // ============================================
    // Auth / HTTP
    // ============================================
    async function getToken() {
        const out = await chrome.storage.local.get(['noAuthToken']);
        return out.noAuthToken || null;
    }

    async function api(path, options = {}) {
        const token = await getToken();
        if (!token) { const e = new Error('not_authed'); e.status = 401; throw e; }
        const resp = await fetch(GE_API_BASE + path, {
            method: options.method || 'GET',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json',
                // Signals the server this call is coming from the MV3 service
                // worker, which gates execution to paying users.
                'X-Agent-Run-Mode': 'background',
                ...(options.headers || {})
            },
            body: options.body
        });
        let data = null;
        try { data = await resp.json(); } catch { /* non-JSON body */ }
        if (!resp.ok) {
            const err = new Error((data && data.error) || ('HTTP ' + resp.status));
            err.status = resp.status;
            err.payload = data;
            throw err;
        }
        return data;
    }

    async function fetchIntegrationsCached() {
        if (_cachedInteg && (Date.now() - _cachedIntegAt) < INTEG_CACHE_MS) return _cachedInteg;
        _cachedInteg = await api('/api/integrations');
        _cachedIntegAt = Date.now();
        return _cachedInteg;
    }

    // ============================================
    // Target tab resolution
    // ============================================
    async function pickOrOpenTargetTab() {
        // Prefer the currently-active tab if it's a normal web page.
        try {
            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (active && active.id && active.url && /^https?:\/\//i.test(active.url)) return active.id;
        } catch { /* ignore */ }
        // Otherwise pick any open http(s) tab.
        try {
            const tabs = await chrome.tabs.query({});
            const cand = tabs.find(t => t.url && /^https?:\/\//i.test(t.url));
            if (cand && cand.id) return cand.id;
        } catch { /* ignore */ }
        // Last resort: open a new background tab on a neutral page.
        const created = await chrome.tabs.create({ url: 'https://www.google.com', active: false });
        try { await waitForTabLoad(created.id, 15000); } catch { /* best effort */ }
        return created.id;
    }

    // ============================================
    // Action execution (mirrors background.js message handlers but callable
    // directly from the loop)
    // ============================================
    async function execInTab(tabId, action, params) {
        await ensureAgentRuntime(tabId);
        const res = await sendMessageToTabWithRetry(tabId, { type: 'ge-action', action, params: params || {} });
        return res || { success: false, error: 'No response from tab' };
    }

    async function readPageState(tabId) {
        try {
            const r = await execInTab(tabId, 'readPage', {});
            return r && r.success ? r.result : null;
        } catch (e) {
            return null;
        }
    }

    async function gotoUrl(tabId, url) {
        if (!/^https?:\/\//i.test(url) && !/^(chrome|about):/i.test(url)) url = 'https://' + url;
        await chrome.tabs.update(tabId, { url });
        try { await waitForTabLoad(tabId, 15000); } catch { /* timeout tolerated */ }
        const tab = await chrome.tabs.get(tabId);
        return { success: true, tabId, url: tab.url, title: tab.title };
    }

    async function openTab(url) {
        if (!/^https?:\/\//i.test(url) && !/^(chrome|about):/i.test(url)) url = 'https://' + url;
        const tab = await chrome.tabs.create({ url, active: false });
        try { await waitForTabLoad(tab.id, 15000); } catch { /* ignore */ }
        const refreshed = await chrome.tabs.get(tab.id);
        return { success: true, tabId: tab.id, url: refreshed.url, title: refreshed.title };
    }

    async function closeTab(tabId) {
        try { await chrome.tabs.remove(tabId); return { success: true }; }
        catch (e) { return { success: false, error: e.message }; }
    }

    // Tracks multi-tab state for the duration of one task.
    function makeTabState(initialTabId) {
        return {
            tabs: [{ tabId: initialTabId, tabIndex: 0, status: 'active' }],
            activeTabIndex: 0,
            get currentTabId() { return this.tabs[this.activeTabIndex]?.tabId || null; }
        };
    }

    async function executeAction(state, action, params) {
        const p = params || {};
        const tabId = state.currentTabId;

        switch (action) {
            case 'done':
                return { success: true, done: true };
            case 'think':
            case 'message':
                return { success: true };
            case 'wait': {
                const ms = Math.max(100, Math.min(p.ms || 1000, 10000));
                await new Promise(r => setTimeout(r, ms));
                return { success: true };
            }
            case 'storeData':
                return { success: true, key: p.key, itemCount: Array.isArray(p.data) ? p.data.length : 1 };
            case 'openTab': {
                const r = await openTab(p.url);
                if (r.success) {
                    state.tabs.push({ tabId: r.tabId, tabIndex: state.tabs.length, status: 'active' });
                    state.activeTabIndex = state.tabs.length - 1;
                    return { success: true, tabId: r.tabId, title: r.title };
                }
                return { success: false, error: 'Failed to open tab' };
            }
            case 'switchTab': {
                const idx = p.tabIndex ?? 0;
                if (idx < 0 || idx >= state.tabs.length) return { success: false, error: `Tab index ${idx} out of range` };
                try { await chrome.tabs.update(state.tabs[idx].tabId, { active: true }); } catch { /* ignore */ }
                state.activeTabIndex = idx;
                return { success: true };
            }
            case 'closeTab': {
                const idx = p.tabIndex ?? 0;
                if (idx < 0 || idx >= state.tabs.length) return { success: false, error: `Tab index ${idx} out of range` };
                const r = await closeTab(state.tabs[idx].tabId);
                if (r.success) state.tabs[idx].status = 'closed';
                return r;
            }
            case 'goto': {
                if (!p.url) return { success: false, error: "goto requires params.url" };
                if (!tabId) return { success: false, error: 'No active tab' };
                return await gotoUrl(tabId, p.url);
            }
            case 'goBack':
            case 'goForward':
            case 'reload': {
                if (!tabId) return { success: false, error: 'No active tab' };
                try {
                    if (action === 'goBack') await chrome.tabs.goBack(tabId);
                    else if (action === 'goForward') await chrome.tabs.goForward(tabId);
                    else await chrome.tabs.reload(tabId);
                    try { await waitForTabLoad(tabId, 10000); } catch { /* ignore */ }
                    const t = await chrome.tabs.get(tabId);
                    return { success: true, url: t.url, title: t.title };
                } catch (e) { return { success: false, error: e.message }; }
            }
            case 'askUser':
            case 'confirmAction':
                // The background loop cannot answer these. Server already saved
                // pendingQuestion and sent a notification to the user via
                // Telegram/WhatsApp. The user's next chat reply will be routed
                // into `pendingQuestion.lastTelegramReply` / `lastWhatsAppReply`;
                // a panel session (or a future server-side answer flow) will
                // resume. For this background loop we surface an explicit
                // "awaiting_user" and stop.
                return { success: true, awaitingUser: true };
            default:
                // DOM actions run in the agent runtime content script.
                if (!tabId) return { success: false, error: 'No active tab' };
                try {
                    return await execInTab(tabId, action, p);
                } catch (e) {
                    return { success: false, error: e.message };
                }
        }
    }

    // ============================================
    // Page state helpers
    // ============================================
    function truncatePageState(state, maxChars = 80000) {
        if (!state) return state;
        const s = JSON.stringify(state);
        if (s.length <= maxChars) return state;
        const clone = { ...state };
        if (typeof clone.visibleText === 'string') {
            clone.visibleText = clone.visibleText.substring(0, Math.max(1000, Math.floor(maxChars / 3)));
        }
        ['links', 'buttons', 'inputs', 'forms', 'images', 'tables', 'headings'].forEach(k => {
            if (Array.isArray(clone[k])) clone[k] = clone[k].slice(0, 15);
        });
        return clone;
    }

    // ============================================
    // Step loop — shared between fresh runs and chat-reply resumes.
    // Executes `currentStep` in `state`, then rounds through /step until
    // done, awaiting_user, max steps, or an error.
    // ============================================
    async function runStepLoop({ taskId, state, currentStep, maxSteps }) {
        let iterations = 0;
        while (iterations < maxSteps + 5) {
            iterations++;

            // Execute current action
            let result = null, error = null;
            try {
                const out = await executeAction(state, currentStep.action, currentStep.params);
                if (out && out.success) result = out;
                else error = (out && out.error) || 'Action failed';
                if (currentStep.action === 'done') return { ok: true, taskId, stage: 'done_local' };
            } catch (e) {
                error = e.message || String(e);
            }

            // Refresh page state after DOM-affecting actions
            let pageState = null;
            const refreshers = ['readPage', 'click', 'type', 'scroll', 'extract', 'waitForElement', 'select', 'pressKey', 'clear', 'goto', 'reload', 'goBack', 'goForward'];
            if (refreshers.includes(currentStep.action) && state.currentTabId) {
                pageState = await readPageState(state.currentTabId);
            }
            pageState = truncatePageState(pageState);

            // Live tab snapshot lets the server detect "utility" tabs (Gmail
            // for OTPs, WhatsApp/Telegram web, etc.) and surface them in the
            // ENVIRONMENT block so the agent can switchTab to grab a code.
            let liveTabs = [];
            try {
                const allOpen = await chrome.tabs.query({});
                liveTabs = allOpen
                    .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('about:'))
                    .map(t => ({ url: t.url, title: t.title, active: t.active }));
            } catch { /* best effort */ }

            // Gather recent downloads so the agent sees in-progress /
            // completed file downloads without having to call readDownloads.
            let recentDownloads = [];
            try {
                if (chrome?.downloads?.search) {
                    const dls = await new Promise((resolve) => {
                        try {
                            chrome.downloads.search({ orderBy: ['-startTime'], limit: 5 }, (items) => resolve(Array.isArray(items) ? items : []));
                        } catch { resolve([]); }
                    });
                    recentDownloads = dls.map(d => ({
                        id: d.id,
                        url: d.finalUrl || d.url || '',
                        filename: (d.filename || '').split(/[\\/]/).pop() || '',
                        state: d.state || 'unknown',
                        bytesReceived: d.bytesReceived || 0,
                        totalBytes: d.totalBytes || 0,
                        mime: d.mime || ''
                    }));
                }
            } catch { /* best effort */ }

            // /step
            let nextData;
            try {
                nextData = await api('/api/agent/step', {
                    method: 'POST',
                    body: JSON.stringify({
                        taskId,
                        stepNumber: currentStep.stepNumber,
                        result: result || null,
                        error: error || null,
                        pageState: pageState || null,
                        runMode: 'background',
                        allTabs: liveTabs,
                        recentDownloads,
                        ..._bgBrowserEnv()
                    })
                });
            } catch (err) {
                if (err.status === 403) return { ok: false, stage: 'step', error: 'not_eligible', taskId };
                return { ok: false, stage: 'step', error: err.message, taskId, status: err.status };
            }

            // If the agent just created a Tool, force-resync ToolManager so
            // a follow-up `useTool` in this same run can find the new script.
            if (nextData && nextData.toolCreated) {
                try {
                    if (typeof self !== 'undefined' && self.ToolManager && typeof self.ToolManager.syncTools === 'function') {
                        await self.ToolManager.syncTools(true);
                    }
                } catch (syncErr) {
                    console.warn('[GE bg-agent] tool resync after createTool failed:', syncErr.message);
                }
            }

            if (nextData.done) return { ok: true, stage: 'done', taskId, summary: nextData.summary, status: nextData.status };
            if (nextData.awaitingUser) return { ok: true, stage: 'awaiting_user', taskId };
            if (!nextData.step || !nextData.step.action) return { ok: false, stage: 'step', error: 'no_next_action', taskId };

            currentStep = nextData.step;
        }
        return { ok: false, stage: 'max_steps', taskId };
    }

    // ============================================
    // Default permissions for background-mode tasks.
    // Safe-by-default: risky categories stay OFF. `uploadFiles` is allowed
    // because a common use case is "summarise this doc I sent you". The
    // agent cannot create accounts, make payments, post publicly, or
    // delete data without the user approving it from the dashboard.
    // ============================================
    const BG_DEFAULT_PERMISSIONS = {
        createAccounts: false,
        sendMessages: true,
        postPublicly: false,
        makePayments: false,
        deleteData: false,
        uploadFiles: true
    };

    // ============================================
    // Main loop — fresh task from /inbox queue
    // ============================================
    async function runOneTask({ prompt, source }) {
        const tabId = await pickOrOpenTargetTab();
        const state = makeTabState(tabId);
        let tabInfo;
        try { tabInfo = await chrome.tabs.get(tabId); } catch { tabInfo = {}; }
        startKeepalive(tabId);

        try {
            // --- PLAN ---
            let planResp;
            try {
                planResp = await api('/api/agent/plan', {
                    method: 'POST',
                    body: JSON.stringify({
                        prompt,
                        source,
                        runMode: 'background',
                        mode: 'autopilot', // server may override with user's /copilot /autopilot preference
                        tabUrl: tabInfo.url || '',
                        tabTitle: tabInfo.title || '',
                        allTabs: []
                    })
                });
            } catch (err) {
                console.warn('[GE bg-agent] /plan failed:', err.status, err.message);
                return { ok: false, stage: 'plan', error: err.message, status: err.status };
            }

            const taskId = planResp.taskId;
            if (!taskId) return { ok: false, stage: 'plan', error: 'no_task_id' };

            if (Array.isArray(planResp.requiredInputs) && planResp.requiredInputs.length) {
                return { ok: false, stage: 'requires_briefing', taskId };
            }

            const maxSteps = planResp.tier?.maxSteps || 30;

            // --- BRIEF ---
            let briefResp;
            try {
                briefResp = await api('/api/agent/brief', {
                    method: 'POST',
                    body: JSON.stringify({
                        taskId,
                        briefing: {},
                        permissions: BG_DEFAULT_PERMISSIONS,
                        runMode: 'background'
                    })
                });
            } catch (err) {
                if (err.status === 403) return { ok: false, stage: 'brief', error: 'not_eligible', taskId };
                return { ok: false, stage: 'brief', error: err.message, taskId, status: err.status };
            }

            if (briefResp.done) return { ok: true, stage: 'done', taskId, summary: briefResp.summary };
            if (!briefResp.step || !briefResp.step.action) return { ok: false, stage: 'brief', error: 'no_first_step', taskId };

            return await runStepLoop({ taskId, state, currentStep: briefResp.step, maxSteps });
        } finally {
            stopKeepalive();
        }
    }

    // ============================================
    // Resume any awaiting_user tasks whose chat-replies we haven't consumed
    // yet. Server owns the queue; we just drain one reply at a time and
    // round-trip through /api/agent/answer to get the next step.
    // ============================================
    async function resumePendingReplies() {
        let pending;
        try { pending = await api('/api/agent/pending-chat-reply'); }
        catch (e) {
            if (e.status && e.status !== 401 && e.status !== 404) {
                console.warn('[GE bg-agent] pending-chat-reply failed:', e.message);
            }
            return null;
        }
        if (!pending || !pending.taskId || !pending.reply) return null;

        const tabId = await pickOrOpenTargetTab();
        const state = makeTabState(tabId);
        startKeepalive(tabId);
        try {
            let answerResp;
            try {
                answerResp = await api('/api/agent/answer', {
                    method: 'POST',
                    body: JSON.stringify({ taskId: pending.taskId, reply: pending.reply, runMode: 'background' })
                });
            } catch (err) {
                if (err.status === 403) return { ok: false, stage: 'answer', error: 'not_eligible' };
                return { ok: false, stage: 'answer', error: err.message };
            }
            if (answerResp.done) return { ok: true, stage: 'done', taskId: pending.taskId };
            if (!answerResp.step || !answerResp.step.action) return { ok: false, stage: 'answer', error: 'no_next_step' };

            // We don't have the original tier info here — use a safe cap.
            return await runStepLoop({ taskId: pending.taskId, state, currentStep: answerResp.step, maxSteps: 50 });
        } finally {
            stopKeepalive();
        }
    }

    // ============================================
    // Is the Global Executive panel currently open and driving the agent?
    // If so, the service worker MUST NOT run its own agent loop — otherwise
    // both would race on the same task (double /step calls, double
    // /pending-reply drains, keep-alive port cycling on the same tab, etc.)
    // The panel writes `ge_panel_active_at` to chrome.storage.session every
    // 5s while it is open; we treat it as alive if the heartbeat is < 15s
    // old.
    // ============================================
    async function isPanelActive() {
        try {
            if (!chrome?.storage?.session) return false;
            const out = await chrome.storage.session.get(['ge_panel_active_at']);
            const at = Number(out.ge_panel_active_at || 0);
            return at > 0 && (Date.now() - at) < 15000;
        } catch {
            return false;
        }
    }

    // ============================================
    // Alarm tick — poll /inbox and run if eligible. Also drain any pending
    // chat-replies for tasks that are awaiting the user's answer.
    // ============================================
    async function onTick() {
        if (_running) return;
        // The panel is driving — stay out of its way.
        if (await isPanelActive()) return;
        let integ;
        try { integ = await fetchIntegrationsCached(); }
        catch (e) {
            if (e.status === 401) return; // not logged in
            console.warn('[GE bg-agent] integrations check failed:', e.message);
            return;
        }
        if (!integ?.backgroundAgent?.autoRun) return; // not on a paid plan

        _running = true;
        try {
            // 1) Resume any awaiting_user task that has a fresh chat-reply.
            try {
                const resumed = await resumePendingReplies();
                if (resumed) console.log('[GE bg-agent] Resumed awaiting-user task:', resumed);
            } catch (e) {
                console.warn('[GE bg-agent] resume error:', e.message);
            }

            // 2) Start any newly queued task from Telegram/WhatsApp.
            let inbox;
            try { inbox = await api('/api/integrations/inbox'); }
            catch (e) {
                if (e.status !== 401) console.warn('[GE bg-agent] inbox failed:', e.message);
                return;
            }
            if (!inbox || !inbox.queuedPrompt || !inbox.backgroundEligible) return;

            console.log('[GE bg-agent] Running task from', inbox.source, ':', inbox.queuedPrompt.substring(0, 80));
            const r = await runOneTask({ prompt: inbox.queuedPrompt, source: inbox.source });
            console.log('[GE bg-agent] Task finished:', r);
        } catch (e) {
            console.error('[GE bg-agent] Tick crashed:', e);
        } finally {
            _running = false;
            // Invalidate integration cache so a newly-lapsed subscription is
            // picked up quickly.
            _cachedInteg = null;
        }
    }

    // ============================================
    // Setup — register alarm, handler
    // ============================================
    function ensureAlarm() {
        try {
            chrome.alarms.get(ALARM_NAME, (a) => {
                if (!a) chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_MINUTES });
            });
        } catch (e) { console.warn('[GE bg-agent] alarm setup failed:', e.message); }
    }

    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm && alarm.name === ALARM_NAME) {
            onTick().catch(err => console.error('[GE bg-agent] tick error:', err));
        }
    });

    // Wake on install, update, and browser startup — then every POLL_MINUTES.
    chrome.runtime.onInstalled.addListener(ensureAlarm);
    if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(ensureAlarm);
    // Also do an immediate-ish first tick after the worker wakes.
    setTimeout(() => { ensureAlarm(); onTick().catch(() => {}); }, 3000);

    // Expose for debugging / other modules
    globalThis.GE_BG_AGENT = {
        runOneTask,
        onTick,
        ensureAlarm,
        isRunning: () => _running,
        invalidateCache: () => { _cachedInteg = null; }
    };

    console.log('[GE bg-agent] Background agent loop loaded');
})();
