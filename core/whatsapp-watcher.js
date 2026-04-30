// WhatsApp Web watcher — runs as a content script on web.whatsapp.com.
//
// Responsibilities:
//   1. Find the user's "My Agent" group in the chat list (resilient, multi-strategy).
//   2. When a new INCOMING message appears in that group, post it to the background
//      which forwards to the server's /api/integrations/whatsapp/incoming.
//   3. Periodically poll the background for outbound messages and type them into
//      the chat input box, then press Enter.
//
// Resilience strategies:
//   - Multiple selector fallbacks (data-testid, aria-label, role, textContent)
//   - Reattaches MutationObserver after DOM rebuilds (WhatsApp Web rebuilds often)
//   - Self-heals: if it loses the chat reference, it re-locates it on next tick
//   - Heartbeat to background every 25s (keeps service worker alive)
//
// This script is intentionally defensive: if anything fails, it logs and retries
// rather than throwing.

(function () {
  if (window.__GE_WA_WATCHER_LOADED) return;
  window.__GE_WA_WATCHER_LOADED = true;

  const LOG = (...args) => console.log('[GE-WA]', ...args);
  const ERR = (...args) => console.warn('[GE-WA]', ...args);

  // Must match WHATSAPP_AGENT_PREFIX in services/notificationService.js.
  // Used to (a) prefix outgoing messages so the user can tell them apart,
  // (b) skip our own messages when we see them echoed back in the bubble list.
  const AGENT_PREFIX = '🤖 Agent: ';

  // ============================================
  // State
  // ============================================
  let state = {
    enabled: false,
    groupName: 'My Agent',
    lastSeenIds: new Set(),       // set of message ids we've already reported
    chatObserver: null,           // MutationObserver on the active chat
    listObserver: null,           // MutationObserver on the chat list (for re-finding the group)
    activeChatNode: null,         // the conversation panel node
    pollOutboxTimer: null,
    heartbeatTimer: null,
    lastSeenFromServer: ''
  };

  // ============================================
  // Resilient selector helpers
  // ============================================
  function $first(...selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function $all(...selectors) {
    const out = [];
    for (const sel of selectors) {
      out.push(...document.querySelectorAll(sel));
    }
    return out;
  }

  // Find the chat list pane
  function findChatList() {
    return $first(
      '[aria-label="Chat list"]',
      '#pane-side',
      '[data-testid="chat-list"]'
    );
  }

  // Find a chat row in the list whose title matches `name` (case-insensitive)
  function findChatRowByName(name) {
    const list = findChatList();
    if (!list) return null;
    // Each row typically has a span[title] with the chat name
    const candidates = list.querySelectorAll('span[title], div[role="listitem"], [data-testid^="cell-frame"]');
    for (const node of candidates) {
      const title = node.getAttribute('title') || node.querySelector?.('span[title]')?.getAttribute('title') || node.textContent || '';
      if (title.trim().toLowerCase() === name.toLowerCase()) {
        // Walk up to a clickable row
        return node.closest('[role="listitem"]') || node.closest('div[tabindex]') || node;
      }
    }
    return null;
  }

  // Find the open conversation panel
  function findConversationPanel() {
    return $first(
      '#main',
      '[data-testid="conversation-panel-wrapper"]',
      'div[role="application"]'
    );
  }

  // The header of the open conversation (used to verify the open chat name)
  function getOpenChatTitle() {
    const header = $first('header [data-testid="conversation-info-header-chat-title"]', '#main header span[title]');
    return header ? (header.getAttribute('title') || header.textContent || '').trim() : '';
  }

  // The message-input box (where we type to send)
  function findInputBox() {
    return $first(
      '[contenteditable="true"][data-tab="10"]',
      '[contenteditable="true"][role="textbox"]',
      'footer [contenteditable="true"]'
    );
  }

  // Each message bubble in the open chat
  function getMessageBubbles() {
    const panel = findConversationPanel();
    if (!panel) return [];
    return panel.querySelectorAll('[data-id], div.message-in, div.message-out, [role="row"]');
  }

  // Extract id + text + isIncoming from a bubble (with multiple fallbacks)
  function parseBubble(node) {
    if (!node) return null;
    const id = node.getAttribute('data-id') || node.getAttribute('id') || '';
    // Incoming = received message; outgoing = the user's own
    const isIncoming =
      node.classList?.contains('message-in') ||
      !!node.querySelector('.message-in') ||
      (id && id.includes('false_'));   // WhatsApp data-id format: <chat>_<bool>_<msgid>
    // Text body — try several patterns
    const textNode =
      node.querySelector('span.selectable-text') ||
      node.querySelector('[data-testid="conversation-text"]') ||
      node.querySelector('.copyable-text [dir="ltr"]') ||
      node.querySelector('[dir="ltr"]');
    const text = textNode ? textNode.textContent.trim() : '';
    return { id, text, isIncoming };
  }

  // ============================================
  // Click into the group chat
  // ============================================
  async function openGroupChat(name) {
    // If already open, nothing to do
    if (getOpenChatTitle().toLowerCase() === name.toLowerCase()) return true;
    const row = findChatRowByName(name);
    if (!row) return false;
    row.click();
    // Wait for the conversation panel to update
    await new Promise(r => setTimeout(r, 600));
    return getOpenChatTitle().toLowerCase() === name.toLowerCase();
  }

  // ============================================
  // Message scanning (called on every chat-pane mutation)
  // ============================================
  function scanForNewIncoming() {
    if (!state.enabled) return;
    const bubbles = getMessageBubbles();
    if (!bubbles.length) return;
    // Walk from oldest to newest
    bubbles.forEach(b => {
      const parsed = parseBubble(b);
      if (!parsed || !parsed.id || !parsed.text) return;
      if (state.lastSeenIds.has(parsed.id)) return;
      state.lastSeenIds.add(parsed.id);
      if (!parsed.isIncoming) return; // ignore the user's own messages echoed back
      // Also skip any message that is an agent echo (prefix match), in case
      // WhatsApp briefly classifies our own send as "incoming" during render.
      if (parsed.text.startsWith(AGENT_PREFIX)) return;
      // Forward to background → server
      chrome.runtime.sendMessage({
        type: 'ge-wa-incoming',
        text: parsed.text,
        messageId: parsed.id
      }).catch(() => {});
      LOG('Forwarded incoming:', parsed.text.substring(0, 80));
    });
    // Cap memory usage
    if (state.lastSeenIds.size > 500) {
      const arr = Array.from(state.lastSeenIds);
      state.lastSeenIds = new Set(arr.slice(-300));
    }
  }

  // ============================================
  // Outbox: send queued messages from the agent into the group
  // ============================================
  async function typeAndSend(text) {
    const input = findInputBox();
    if (!input) return false;
    input.focus();

    // Use clipboard paste — most reliable for emojis/multi-line/Unicode
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
    } catch (e) {
      // Fallback: execCommand insertText
      document.execCommand('insertText', false, text);
    }

    // Press Enter
    await new Promise(r => setTimeout(r, 150));
    const enterEvt = (type) => new KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    input.dispatchEvent(enterEvt('keydown'));
    input.dispatchEvent(enterEvt('keypress'));
    input.dispatchEvent(enterEvt('keyup'));
    return true;
  }

  async function drainOutbox() {
    if (!state.enabled) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'ge-wa-fetch-outbox' });
      const messages = result?.messages || [];
      if (!messages.length) return;
      // Make sure the right chat is open
      const opened = await openGroupChat(state.groupName);
      if (!opened) { ERR('Could not open group; will retry'); return; }
      for (const m of messages) {
        const sent = await typeAndSend(m.text);
        if (!sent) { ERR('Send failed for:', m.text.substring(0, 60)); break; }
        await new Promise(r => setTimeout(r, 600));
      }
    } catch (e) {
      ERR('Outbox drain error:', e.message);
    }
  }

  // ============================================
  // Observer attachment with self-healing
  // ============================================
  function attachChatObserver() {
    if (state.chatObserver) {
      try { state.chatObserver.disconnect(); } catch {}
      state.chatObserver = null;
    }
    const panel = findConversationPanel();
    if (!panel) return false;
    state.activeChatNode = panel;
    state.chatObserver = new MutationObserver(() => scanForNewIncoming());
    state.chatObserver.observe(panel, { childList: true, subtree: true, characterData: true });
    // Initial scan
    scanForNewIncoming();
    return true;
  }

  function attachListObserver() {
    if (state.listObserver) { try { state.listObserver.disconnect(); } catch {} }
    const list = findChatList();
    if (!list) return false;
    state.listObserver = new MutationObserver(() => {
      // If the active chat panel disappeared (DOM rebuild), reattach.
      if (!state.activeChatNode || !document.contains(state.activeChatNode)) {
        attachChatObserver();
      }
    });
    state.listObserver.observe(list, { childList: true, subtree: true });
    return true;
  }

  // ============================================
  // Main loop: keep things alive, retry on failures
  // ============================================
  async function tick() {
    if (!state.enabled) return;
    try {
      // Make sure observers are alive
      if (!state.chatObserver || !state.activeChatNode || !document.contains(state.activeChatNode)) {
        await openGroupChat(state.groupName);
        attachChatObserver();
      }
      if (!state.listObserver) attachListObserver();
      // Drain anything queued
      await drainOutbox();
    } catch (e) {
      ERR('tick error:', e.message);
    }
  }

  function startLoops() {
    stopLoops();
    state.pollOutboxTimer = setInterval(tick, 5000);
    // Heartbeat to keep service worker alive (every 25s)
    state.heartbeatTimer = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'ge-wa-heartbeat' }).catch(() => {});
    }, 25000);
  }

  function stopLoops() {
    if (state.pollOutboxTimer) clearInterval(state.pollOutboxTimer);
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    state.pollOutboxTimer = null;
    state.heartbeatTimer = null;
  }

  // ============================================
  // Verify (called by the Setup page via background)
  // ============================================
  async function verifyGroup(name) {
    state.groupName = name || state.groupName;
    // Wait briefly for chat list to render if WhatsApp Web just loaded
    for (let i = 0; i < 20; i++) {
      if (findChatList()) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!findChatList()) return { found: false, error: 'WhatsApp Web not fully loaded — refresh and retry.' };
    const row = findChatRowByName(state.groupName);
    if (!row) return { found: false, error: `Group "${state.groupName}" not found in your chat list.` };
    return { found: true };
  }

  // ============================================
  // Message bridge from background
  // ============================================
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'ge-wa-watcher-start') {
      state.enabled = true;
      state.groupName = msg.groupName || state.groupName;
      LOG('Started watcher for group:', state.groupName);
      startLoops();
      // Run immediately
      tick();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'ge-wa-watcher-stop') {
      state.enabled = false;
      stopLoops();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'ge-wa-verify-in-page') {
      verifyGroup(msg.groupName).then(sendResponse);
      return true;
    }
    return false;
  });

  // Auto-announce presence to background on load
  LOG('WhatsApp watcher loaded.');
  chrome.runtime.sendMessage({ type: 'ge-wa-watcher-loaded' }).catch(() => {});
})();
