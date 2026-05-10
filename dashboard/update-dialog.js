// =====================================================================
// Update dialog renderer.
// =====================================================================
// Loaded by dashboard/update-dialog.html. Reads the pending release info
// the service worker stashed in chrome.storage(.session|.local) before
// opening this window, then wires up the action buttons.

(async function () {
  'use strict';

  const els = {
    title: document.getElementById('ud-title'),
    current: document.getElementById('ud-current'),
    latest: document.getElementById('ud-latest'),
    changelog: document.getElementById('ud-changelog'),
    btnOpen: document.getElementById('ud-open'),
    btnZip: document.getElementById('ud-zip'),
    btnExt: document.getElementById('ud-extensions'),
    btnLater: document.getElementById('ud-later')
  };

  // Try session storage first (preferred, auto-clears when browser quits),
  // then fall back to local storage which the worker uses on older Chrome.
  async function readPending() {
    try {
      const s = await chrome.storage.session.get(['ngo:pendingUpdateRelease']);
      if (s && s['ngo:pendingUpdateRelease']) return s['ngo:pendingUpdateRelease'];
    } catch { /* session storage unavailable */ }
    const l = await chrome.storage.local.get(['ngo:pendingUpdateRelease']);
    return (l && l['ngo:pendingUpdateRelease']) || null;
  }

  async function clearPending() {
    try { await chrome.storage.session.remove(['ngo:pendingUpdateRelease']); } catch {}
    try { await chrome.storage.local.remove(['ngo:pendingUpdateRelease']); } catch {}
  }

  const installed = (() => {
    try { return chrome.runtime.getManifest().version; } catch { return 'unknown'; }
  })();

  const release = await readPending();
  els.current.textContent = installed;

  if (!release) {
    // No pending release — likely the user opened the page directly.
    // Show a friendly empty state and leave the buttons disabled.
    els.title.textContent = 'No pending update';
    els.latest.textContent = installed;
    els.changelog.textContent = '';
    els.btnOpen.disabled = true;
    els.btnOpen.style.opacity = '0.5';
    return;
  }

  // Hydrate.
  els.latest.textContent = release.version || '?';
  els.title.textContent = release.title
    ? release.title
    : `Version ${release.version} is available`;
  els.changelog.textContent = release.changelog || '';

  if (release.zipUrl) {
    els.btnZip.hidden = false;
  }

  // Actions.
  els.btnOpen.addEventListener('click', () => {
    if (release.githubReleaseUrl) {
      chrome.tabs.create({ url: release.githubReleaseUrl });
    }
  });
  els.btnZip.addEventListener('click', () => {
    if (release.zipUrl) {
      // Use chrome.downloads when available so the user can pick a save
      // location; fall back to a normal navigation otherwise.
      try {
        chrome.downloads.download({ url: release.zipUrl, saveAs: true });
      } catch {
        chrome.tabs.create({ url: release.zipUrl });
      }
    }
  });
  els.btnExt.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions' });
  });
  els.btnLater.addEventListener('click', async () => {
    await clearPending();
    window.close();
  });
})();
