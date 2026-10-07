// test-voxcode-phase1.js
// Deep verification test suite for Phase 1: Chrome Extension Bridge

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

(async function runAllTests() {
    console.log('=== STARTING VOXCODE EXTENSION BRIDGE DEEP VERIFICATION ===\n');

    // ----------------------------------------------------
    // Test Group 1: Manifest Schema & Configuration
    // ----------------------------------------------------
    console.log('--- Test Group 1: Manifest Schema & Configuration ---');
    const rootDir = path.resolve(__dirname, '..');
    const manifestPath = path.resolve(rootDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
    assert.ok(manifest.permissions.includes('storage'), 'Must have storage permission');
    assert.ok(manifest.permissions.includes('tabs'), 'Must have tabs permission');

    // Validate externally_connectable
    assert.ok(manifest.externally_connectable, 'externally_connectable must be declared');
    assert.ok(Array.isArray(manifest.externally_connectable.matches), 'externally_connectable.matches must be array');

    const requiredConnectablePatterns = [
        'http://localhost/*',
        'http://127.0.0.1/*',
        'https://voxcode.app/*',
        'https://*.voxcode.app/*',
        'https://voxcode.space/*',
        'https://*.voxcode.space/*',
        'https://*.vercel.app/*'
    ];

    for (const pattern of requiredConnectablePatterns) {
        assert.ok(
            manifest.externally_connectable.matches.includes(pattern),
            `externally_connectable must contain pattern: ${pattern}`
        );
    }
    console.log('✓ externally_connectable patterns verified');

    // Validate content scripts
    const bridgeCs = manifest.content_scripts.find(cs => cs.js && cs.js.includes('core/voxcode-bridge.js'));
    assert.ok(bridgeCs, 'core/voxcode-bridge.js must be configured in content_scripts');
    assert.strictEqual(bridgeCs.run_at, 'document_start', 'core/voxcode-bridge.js must run_at document_start');

    const beaconCs = manifest.content_scripts.find(cs => cs.js && cs.js.includes('core/voxcode-main-beacon.js'));
    assert.ok(beaconCs, 'core/voxcode-main-beacon.js must be configured in content_scripts');
    assert.strictEqual(beaconCs.world, 'MAIN', 'core/voxcode-main-beacon.js must run in MAIN world');
    assert.strictEqual(beaconCs.run_at, 'document_start', 'core/voxcode-main-beacon.js must run_at document_start');

    for (const pattern of requiredConnectablePatterns) {
        assert.ok(
            bridgeCs.matches.includes(pattern),
            `content_scripts bridge matches must contain: ${pattern}`
        );
        assert.ok(
            beaconCs.matches.includes(pattern),
            `content_scripts beacon matches must contain: ${pattern}`
        );
    }
    console.log('✓ content_scripts configurations verified');

    // Validate web_accessible_resources
    const warResources = manifest.web_accessible_resources.flatMap(w => w.resources || []);
    assert.ok(warResources.includes('core/voxcode-bridge.js'), 'voxcode-bridge.js must be in web_accessible_resources');
    assert.ok(warResources.includes('core/voxcode-main-beacon.js'), 'voxcode-main-beacon.js must be in web_accessible_resources');
    console.log('✓ web_accessible_resources verified\n');

    // ----------------------------------------------------
    // Test Group 2: Content Script Bridge (core/voxcode-bridge.js)
    // ----------------------------------------------------
    console.log('--- Test Group 2: Content Script Bridge Runtime Logic ---');

    // Mock browser environment
    const messageListeners = [];
    const customEventListeners = new Map();
    const postedWindowMessages = [];
    let chromeRuntimeSendMessageHandler = null;
    let chromeRuntimeOnMessageHandler = null;

    const mockDocumentElement = {
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return this.attributes[k]; },
        appendChild() {},
        removeChild() {}
    };

    const mockDocument = {
        documentElement: mockDocumentElement,
        head: mockDocumentElement,
        readyState: 'complete',
        createElement(tag) {
            return { tag, id: '', textContent: '', remove() {} };
        },
        addEventListener() {},
        dispatchEvent(evt) {
            const list = customEventListeners.get(evt.type) || [];
            list.forEach(fn => fn(evt));
        }
    };

    const mockWindow = {
        location: { origin: 'https://voxcode.app' },
        addEventListener(type, fn) {
            if (type === 'message') {
                messageListeners.push(fn);
            } else {
                if (!customEventListeners.has(type)) customEventListeners.set(type, []);
                customEventListeners.get(type).push(fn);
            }
        },
        dispatchEvent(evt) {
            const list = customEventListeners.get(evt.type) || [];
            list.forEach(fn => fn(evt));
        },
        postMessage(data, targetOrigin) {
            postedWindowMessages.push({ data, targetOrigin });
            for (const fn of messageListeners) {
                fn({ source: mockWindow, data, origin: 'https://voxcode.app' });
            }
        }
    };

    class MockCustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        }
    }

    const mockChrome = {
        runtime: {
            sendMessage(msg, callback) {
                if (chromeRuntimeSendMessageHandler) {
                    chromeRuntimeSendMessageHandler(msg, callback);
                }
            },
            onMessage: {
                addListener(fn) {
                    chromeRuntimeOnMessageHandler = fn;
                }
            }
        }
    };

    // Execute voxcode-bridge.js inside mock sandbox
    const bridgeCode = fs.readFileSync(path.resolve(rootDir, 'core/voxcode-bridge.js'), 'utf8');
    const bridgeSandbox = {
        window: mockWindow,
        document: mockDocument,
        CustomEvent: MockCustomEvent,
        chrome: mockChrome,
        console: console,
        Date: Date,
        Math: Math
    };
    bridgeSandbox.window.window = mockWindow;

    vm.createContext(bridgeSandbox);
    vm.runInContext(bridgeCode, bridgeSandbox);

    // Check beacon injection
    assert.strictEqual(bridgeSandbox.window.__NOG_EXTENSION_INSTALLED__, true, 'Window beacon installed must be true');
    assert.strictEqual(bridgeSandbox.window.__NOG_EXTENSION_VERSION__, '1.0.0', 'Window beacon version must be 1.0.0');
    assert.strictEqual(mockDocumentElement.getAttribute('data-nog-extension-installed'), 'true', 'DOM attribute data-nog-extension-installed must be true');
    assert.strictEqual(mockDocumentElement.getAttribute('data-nog-extension-version'), '1.0.0', 'DOM attribute data-nog-extension-version must be 1.0.0');
    console.log('✓ Bridge beacon & DOM attributes set successfully');

    // Test window.postMessage VOXCODE_TO_EXTENSION relay with top-level prompt
    let lastSentBridgeMsg = null;
    chromeRuntimeSendMessageHandler = (msg, cb) => {
        lastSentBridgeMsg = msg;
        cb({ ok: true, echo: msg.action, resultData: msg.data });
    };

    postedWindowMessages.length = 0;
    mockWindow.postMessage({
        type: 'VOXCODE_TO_EXTENSION',
        action: 'EXECUTE_TASK',
        prompt: 'Create a full spreadsheet of pricing',
        messageId: 'test-req-123'
    }, '*');

    assert.ok(lastSentBridgeMsg, 'Bridge must relay to chrome.runtime.sendMessage');
    assert.strictEqual(lastSentBridgeMsg.type, 'VOXCODE_BRIDGE_MESSAGE');
    assert.strictEqual(lastSentBridgeMsg.action, 'EXECUTE_TASK');
    assert.strictEqual(lastSentBridgeMsg.messageId, 'test-req-123');
    assert.strictEqual(lastSentBridgeMsg.data.prompt, 'Create a full spreadsheet of pricing', 'Top-level prompt must be preserved');

    // Verify response relay back to window
    const replyMsg = postedWindowMessages.find(m => m.data.type === 'EXTENSION_TO_VOXCODE' && m.data.messageId === 'test-req-123');
    assert.ok(replyMsg, 'Bridge must post EXTENSION_TO_VOXCODE reply to window');
    assert.strictEqual(replyMsg.data.action, 'EXECUTE_TASK');
    assert.strictEqual(replyMsg.data.response.ok, true);
    console.log('✓ VOXCODE_TO_EXTENSION -> chrome.runtime -> EXTENSION_TO_VOXCODE roundtrip verified');

    // Test background VOXCODE_LIVE_EVENT relay to window
    postedWindowMessages.length = 0;
    let customLiveEventReceived = null;
    customEventListeners.set('VOXCODE_LIVE_EVENT', [evt => { customLiveEventReceived = evt.detail; }]);

    chromeRuntimeOnMessageHandler({
        type: 'VOXCODE_LIVE_EVENT',
        event: 'step_log',
        data: { action: 'click', selector: 'button.checkout' }
    });

    const relayedLiveMsg = postedWindowMessages.find(m => m.data.type === 'VOXCODE_LIVE_EVENT');
    assert.ok(relayedLiveMsg, 'Bridge must relay live events via postMessage');
    assert.strictEqual(relayedLiveMsg.data.event, 'step_log');
    assert.strictEqual(relayedLiveMsg.data.data.action, 'click');
    assert.ok(customLiveEventReceived, 'Bridge must also relay via CustomEvent');
    assert.strictEqual(customLiveEventReceived.event, 'step_log');
    console.log('✓ VOXCODE_LIVE_EVENT broadcast relay verified\n');

    // ----------------------------------------------------
    // Test Group 3: Background Bridge Handler (background.js)
    // ----------------------------------------------------
    console.log('--- Test Group 3: Background Router & Handlers ---');

    const bgCode = fs.readFileSync(path.resolve(rootDir, 'background.js'), 'utf8');

    const storageStore = {
        noAuthToken: 'jwt_mock_token_abc',
        noUser: { id: 'usr_nog_1', email: 'alice@voxcode.app', displayName: 'Alice', credits: 45 },
        voxcodeUserId: 'usr_vox_99',
        ge_bg_agent_status: { running: false, taskId: 'task_001', prompt: 'Prior task' }
    };

    const capturedLiveEvents = [];
    const mockBgChrome = {
        runtime: {
            id: 'mock_nog_extension_id',
            getManifest() { return { version: '1.0.0' }; },
            onMessage: { addListener() {} },
            onConnect: { addListener() {} },
            onMessageExternal: { addListener() {} },
            onConnectExternal: { addListener() {} }
        },
        storage: {
            local: {
                async get(keys) {
                    const res = {};
                    for (const k of keys) res[k] = storageStore[k];
                    return res;
                },
                async set(obj) {
                    Object.assign(storageStore, obj);
                }
            },
            onChanged: { addListener() {} }
        },
        tabs: {
            async query() {
                return [
                    { id: 101, url: 'https://voxcode.app/chat' },
                    { id: 102, url: 'https://youtube.com' }
                ];
            },
            async sendMessage(tabId, msg) {
                capturedLiveEvents.push({ tabId, msg });
            }
        }
    };

    let runOneTaskCalledWith = null;
    let injectToolCalledWith = null;

    const bgSandbox = {
        chrome: mockBgChrome,
        console: console,
        Date: Date,
        Set: Set,
        Array: Array,
        Object: Object,
        globalThis: {
            GE_BG_AGENT: {
                isRunning: () => false,
                runOneTask: async (opts) => {
                    runOneTaskCalledWith = opts;
                    if (opts.prompt === 'fail_task') {
                        return { ok: false, error: 'Target element not found' };
                    }
                    return { ok: true, taskId: 'new_task_1', summary: 'Scraped 5 items' };
                }
            }
        },
        ToolManager: {
            getInstalledTools: async () => [
                { id: 'tool_yt', name: 'YouTube Downloader', enabled: true },
                { id: 'tool_csv', name: 'CSV Exporter', enabled: true }
            ],
            getActiveToolIds: async () => ['tool_yt'],
            injectToolIntoTab: async (tabId, tool) => {
                injectToolCalledWith = { tabId, tool };
            }
        },
        NewOrderAuth: {
            getCurrentUser: () => storageStore.noUser,
            init: async () => {}
        }
    };

    const bgFuncMatch = bgCode.match(/async function handleVoxCodeBridgeMessage[\s\S]*?\n\}/);
    assert.ok(bgFuncMatch, 'handleVoxCodeBridgeMessage must exist in background.js');

    const broadcastFuncMatch = bgCode.match(/async function broadcastVoxCodeLiveEvent[\s\S]*?\n\}/);
    assert.ok(broadcastFuncMatch, 'broadcastVoxCodeLiveEvent must exist in background.js');

    vm.createContext(bgSandbox);
    vm.runInContext('globalThis._voxcodeConnectedPorts = new Set(); const _voxcodeConnectedPorts = globalThis._voxcodeConnectedPorts;\n' + broadcastFuncMatch[0] + '\n' + bgFuncMatch[0], bgSandbox);

    const handleBridge = bgSandbox.handleVoxCodeBridgeMessage;

    // 1. Test GET_STATUS
    let statusResp = null;
    await handleBridge({ action: 'GET_STATUS' }, {}, (r) => { statusResp = r; });
    assert.ok(statusResp.ok, 'GET_STATUS must return ok: true');
    assert.strictEqual(statusResp.authenticated, true, 'User must be authenticated');
    assert.strictEqual(statusResp.user.credits, 45, 'Credits must match');
    assert.strictEqual(statusResp.user.voxcodeUserId, 'usr_vox_99', 'voxcodeUserId must match');
    assert.strictEqual(statusResp.tools.length, 2, 'Must list installed tools');
    console.log('✓ Action GET_STATUS verified');

    // 2. Test EXECUTE_TASK (Success flow)
    capturedLiveEvents.length = 0;
    let taskResp = null;
    await handleBridge({ action: 'EXECUTE_TASK', prompt: 'Extract prices from page' }, {}, (r) => { taskResp = r; });
    assert.ok(taskResp.ok, 'EXECUTE_TASK must return ok: true');
    assert.strictEqual(runOneTaskCalledWith.prompt, 'Extract prices from page');
    assert.strictEqual(runOneTaskCalledWith.source, 'voxcode');

    await new Promise(r => setTimeout(r, 50));
    const taskStartedEvent = capturedLiveEvents.find(e => e.msg.event === 'task_started');
    const taskCompletedEvent = capturedLiveEvents.find(e => e.msg.event === 'task_completed');
    assert.ok(taskStartedEvent, 'Must broadcast task_started');
    assert.ok(taskCompletedEvent, 'Must broadcast task_completed');
    assert.strictEqual(taskStartedEvent.tabId, 101, 'Broadcast must target voxcode tab');
    console.log('✓ Action EXECUTE_TASK (success) verified');

    // 3. Test EXECUTE_TASK (Failure flow -> task_failed event)
    capturedLiveEvents.length = 0;
    await handleBridge({ action: 'EXECUTE_TASK', prompt: 'fail_task' }, {}, () => {});
    await new Promise(r => setTimeout(r, 50));
    const taskFailedEvent = capturedLiveEvents.find(e => e.msg.event === 'task_failed');
    assert.ok(taskFailedEvent, 'Must broadcast task_failed when runOneTask returns ok: false');
    assert.strictEqual(taskFailedEvent.msg.data.error, 'Target element not found');
    console.log('✓ Action EXECUTE_TASK (failure broadcasting) verified');

    // 4. Test RUN_TOOL by toolId
    let runToolResp = null;
    await handleBridge({ action: 'RUN_TOOL', tabId: 102, toolId: 'tool_csv' }, {}, (r) => { runToolResp = r; });
    assert.ok(runToolResp.ok, 'RUN_TOOL must return ok: true');
    assert.strictEqual(injectToolCalledWith.tabId, 102);
    assert.strictEqual(injectToolCalledWith.tool.id, 'tool_csv');
    console.log('✓ Action RUN_TOOL by toolId verified');

    // 5. Test ABORT_TASK
    let abortResp = null;
    await handleBridge({ action: 'ABORT_TASK' }, {}, (r) => { abortResp = r; });
    assert.ok(abortResp.ok, 'ABORT_TASK must return ok: true');
    assert.strictEqual(storageStore.ge_bg_agent_abort, true, 'Abort flag in storage must be true');
    console.log('✓ Action ABORT_TASK verified');

    // 6. Test LINK_USER
    let linkResp = null;
    await handleBridge({
        action: 'LINK_USER',
        token: 'jwt_new_token_777',
        user: { id: 'usr_linked_8', email: 'bob@voxcode.app', credits: 100 },
        voxcodeUserId: 'vox_user_prime'
    }, {}, (r) => { linkResp = r; });
    assert.ok(linkResp.ok, 'LINK_USER must return ok: true');
    assert.strictEqual(storageStore.noAuthToken, 'jwt_new_token_777');
    assert.strictEqual(storageStore.voxcodeUserId, 'vox_user_prime');
    console.log('✓ Action LINK_USER verified');

    const mockPort = {
        messages: [],
        postMessage(m) { this.messages.push(m); }
    };
    bgSandbox.globalThis._voxcodeConnectedPorts.add(mockPort);
    await bgSandbox.broadcastVoxCodeLiveEvent('heartbeat', { alive: true });
    assert.ok(mockPort.messages.length > 0, 'External port must receive broadcast');
    assert.strictEqual(mockPort.messages[0].event, 'heartbeat');
    console.log('✓ External streaming port broadcasting verified');

    console.log('\n=== ALL PHASE 1 TESTS PASSED WITH 100% SUCCESS ===');
})().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
