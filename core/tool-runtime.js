// New Order Global — Tool Runtime & Storage Bridge
// This runs as a content script in the ISOLATED world
// It provides a bridge between the page (MAIN world) and Chrome APIs

(function () {
  'use strict';

  if (window[Symbol.for('_nrt')]) return;
  window[Symbol.for('_nrt')] = true;

  // Override navigator.webdriver in MAIN world before any page JS runs
  try {
    const _s = document.createElement('script');
    _s.textContent = "Object.defineProperty(navigator,'webdriver',{get:()=>false,configurable:true});";
    (document.head || document.documentElement).prepend(_s);
    _s.remove();
  } catch {}

  // Listen for messages from the page (MAIN world)
  window.addEventListener('message', async (event) => {
    // Only trust messages from the same window
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== '_tc') return;

    // Handle Storage Requests
    if (data.type === 'storage-request') {
      const { requestId, action, key, value, prefix } = data;
      const storageKey = prefix + key;

      try {
        if (action === 'get') {
          chrome.storage.local.get([storageKey], (result) => {
            sendResponse(requestId, { value: result[storageKey] || null });
          });
        } 
        else if (action === 'set') {
          chrome.storage.local.set({ [storageKey]: value }, () => {
            sendResponse(requestId, { success: true });
          });
        }
        else if (action === 'remove') {
          chrome.storage.local.remove([storageKey], () => {
            sendResponse(requestId, { success: true });
          });
        }
        else if (action === 'getAll') {
          chrome.storage.local.get(null, (result) => {
            const filtered = {};
            Object.keys(result).forEach(k => {
              if (k.startsWith(prefix)) {
                filtered[k.replace(prefix, '')] = result[k];
              }
            });
            sendResponse(requestId, { value: filtered });
          });
        }
        else if (action === 'clear') {
          chrome.storage.local.get(null, (result) => {
            const keysToRemove = Object.keys(result).filter(k => k.startsWith(prefix));
            if (keysToRemove.length > 0) {
              chrome.storage.local.remove(keysToRemove, () => {
                sendResponse(requestId, { success: true });
              });
            } else {
              sendResponse(requestId, { success: true });
            }
          });
        }
      } catch (err) {
        sendResponse(requestId, { error: err.message });
      }
    }

    // Handle UI Requests (Toasts, etc)
    if (data.type === 'ui-request') {
        // Forward some things to background if needed, or handle locally
        if (data.action === 'toast') {
            // Local toast already handled in buildToolWrapper? 
            // Better to keep UI logic consistent.
        }
    }
  });

  function sendResponse(requestId, data) {
    window.postMessage({
      source: '_rb',
      requestId,
      ...data
    }, '*');
  }

  // Response to ping from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ping') {
      sendResponse({ pong: true, runtimeActive: true });
    }
  });

})();
