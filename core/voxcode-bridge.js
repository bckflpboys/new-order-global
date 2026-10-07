// core/voxcode-bridge.js
// New Order Global ↔ VoxCode Web Integration Bridge
// Injected into VoxCode domains at document_start to provide seamless communication
// between the web application and the New Order Global Chrome extension.

(function () {
    'use strict';

    const EXTENSION_VERSION = '1.0.0';

    // ========================================================
    // 1. Inject Beacon & Mark Readiness in DOM & Window
    // ========================================================
    function dispatchReady() {
        try {
            const readyDetail = {
                version: EXTENSION_VERSION,
                installed: true,
                timestamp: Date.now()
            };
            const readyEvent = new CustomEvent('NOG_EXTENSION_READY', { detail: readyDetail });
            window.dispatchEvent(readyEvent);
            if (typeof document !== 'undefined') {
                document.dispatchEvent(readyEvent);
            }
            // Also notify via postMessage for components that prefer postMessage listeners
            window.postMessage({
                type: 'NOG_EXTENSION_READY',
                ...readyDetail
            }, '*');
        } catch (_) {}
    }

    function injectBeacon() {
        // 1. Set on content script window
        try {
            window.__NOG_EXTENSION_INSTALLED__ = true;
            window.__NOG_EXTENSION_VERSION__ = EXTENSION_VERSION;
        } catch (_) {}

        // 2. Set DOM attribute on documentElement (CSP-immune, readable by all page scripts)
        try {
            if (document.documentElement) {
                document.documentElement.setAttribute('data-nog-extension-installed', 'true');
                document.documentElement.setAttribute('data-nog-extension-version', EXTENSION_VERSION);
            }
        } catch (_) {}

        // 3. Attempt inline script injection into main execution world (as fallback if world: MAIN not active)
        try {
            const script = document.createElement('script');
            script.id = 'nog-voxcode-beacon';
            script.textContent = `
                (function() {
                    window.__NOG_EXTENSION_INSTALLED__ = true;
                    window.__NOG_EXTENSION_VERSION__ = "${EXTENSION_VERSION}";
                    try {
                        window.dispatchEvent(new CustomEvent('NOG_EXTENSION_READY', {
                            detail: {
                                version: "${EXTENSION_VERSION}",
                                installed: true,
                                timestamp: Date.now()
                            }
                        }));
                    } catch (_) {}
                })();
            `;
            const target = document.head || document.documentElement;
            if (target) {
                target.appendChild(script);
                script.remove();
            }
        } catch (err) {
            // May be blocked by strict CSP; world: MAIN or DOM attributes handle this
        }

        dispatchReady();
    }

    // Run beacon injection immediately at document_start
    injectBeacon();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectBeacon, { once: true });
    }

    // ========================================================
    // 2. Relay window.postMessage (VOXCODE_TO_EXTENSION) -> Background SW
    // ========================================================
    window.addEventListener('message', (event) => {
        // Accept messages originating from the same window
        if (event.source !== window) return;
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        // Allow explicit query for extension presence
        if (data.type === 'VOXCODE_QUERY_EXTENSION' || data.type === 'CHECK_EXTENSION') {
            injectBeacon();
            window.postMessage({
                type: 'EXTENSION_TO_VOXCODE',
                action: 'PING',
                response: {
                    ok: true,
                    pong: true,
                    installed: true,
                    version: EXTENSION_VERSION,
                    bridgeActive: true
                }
            }, '*');
            return;
        }

        if (data.type !== 'VOXCODE_TO_EXTENSION') return;

        const action = data.action || data.command || (data.data && (data.data.action || data.data.command)) || (data.payload && (data.payload.action || data.payload.command)) || 'UNKNOWN';
        const messageId = data.messageId || data.id || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));

        // Assemble unified payload without dropping top-level fields
        let payload = {};
        if (data.data && typeof data.data === 'object') {
            payload = { ...data.data };
        } else if (data.payload && typeof data.payload === 'object') {
            payload = { ...data.payload };
        } else {
            const { type, action: _a, command: _c, messageId: _m, id: _i, data: _d, payload: _p, ...rest } = data;
            payload = rest;
        }
        // Explicitly preserve common task arguments if passed top-level
        if (data.prompt && !payload.prompt) payload.prompt = data.prompt;
        if (data.tool && !payload.tool) payload.tool = data.tool;
        if (data.toolId && !payload.toolId) payload.toolId = data.toolId;
        if (data.tabId && !payload.tabId) payload.tabId = data.tabId;
        if (data.token && !payload.token) payload.token = data.token;
        if (data.user && !payload.user) payload.user = data.user;
        if (data.voxcodeUserId && !payload.voxcodeUserId) payload.voxcodeUserId = data.voxcodeUserId;

        // If action is PING / STATUS, ensure beacon is verified
        if (action === 'PING' || action === 'CHECK_EXTENSION') {
            injectBeacon();
        }

        // Dispatch to background service worker via chrome.runtime.sendMessage
        try {
            chrome.runtime.sendMessage({
                type: 'VOXCODE_BRIDGE_MESSAGE',
                action: action,
                data: payload,
                payload: payload,
                messageId: messageId
            }, (response) => {
                const lastErr = chrome.runtime.lastError;
                const result = lastErr
                    ? { ok: false, error: lastErr.message }
                    : (response || { ok: false, error: 'Empty response from background' });

                const replyPayload = {
                    type: 'EXTENSION_TO_VOXCODE',
                    messageId: messageId,
                    action: action,
                    response: result,
                    data: result
                };

                // Post reply back to web page window
                window.postMessage(replyPayload, '*');

                // Also dispatch custom event for listeners attached to window/document
                try {
                    const evt = new CustomEvent('EXTENSION_TO_VOXCODE', { detail: replyPayload });
                    window.dispatchEvent(evt);
                    if (typeof document !== 'undefined') {
                        document.dispatchEvent(evt);
                    }
                } catch (_) {}
            });
        } catch (err) {
            const errPayload = {
                type: 'EXTENSION_TO_VOXCODE',
                messageId: messageId,
                action: action,
                response: { ok: false, error: err.message },
                data: { ok: false, error: err.message }
            };
            window.postMessage(errPayload, '*');
            try {
                const evt = new CustomEvent('EXTENSION_TO_VOXCODE', { detail: errPayload });
                window.dispatchEvent(evt);
                if (typeof document !== 'undefined') {
                    document.dispatchEvent(evt);
                }
            } catch (_) {}
        }
    });

    // ========================================================
    // 3. Listen for Background Live Events & Relay to Window
    // ========================================================
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message && message.type === 'VOXCODE_LIVE_EVENT') {
            const eventPayload = {
                type: 'VOXCODE_LIVE_EVENT',
                event: message.event,
                data: message.data,
                timestamp: message.timestamp || Date.now()
            };

            // Post to window so React/client listeners catch it
            window.postMessage(eventPayload, '*');

            // Dispatch CustomEvent on both window and document
            try {
                const liveEvt = new CustomEvent('VOXCODE_LIVE_EVENT', {
                    detail: eventPayload
                });
                window.dispatchEvent(liveEvt);
                if (typeof document !== 'undefined') {
                    document.dispatchEvent(liveEvt);
                }
            } catch (_) {}
        }
    });

    console.log('[NOG VoxCode Bridge] Bridge script loaded on', window.location.origin);
})();
