// =====================================================================
// Extension auto-update checker (service-worker side).
// =====================================================================
// Loaded by background.js via importScripts(). Registers a chrome.alarms
// alarm that fires every 6 hours and on extension startup/install. When
// the alarm fires:
//
//   1. Read the user's `autoExtensionUpdates` preference from
//      /api/agent-settings. If OFF, skip silently. The "Check for
//      updates now" button on the Settings page bypasses this gate by
//      sending an `EXT_UPDATE_FORCE_SHOW` message.
//
//   2. Hit /api/extension/latest-release with the current manifest
//      version. If hasUpdate is true, open a small popup window with
//      the changelog + "Open release page" / "Download ZIP" CTAs.
//
//   3. Remember the version we last informed the user about so we don't
//      re-open the dialog on every alarm tick. Stored in chrome.storage.
//      A new release with a higher version still triggers a fresh
//      dialog because the comparison is against the LAST-SHOWN version.
//
// Chrome extensions cannot rewrite their own installed files, so the
// "update" UX is a popup with download links — the user grabs the ZIP
// from GitHub and reloads the unpacked extension manually.

(function () {
  'use strict';

  const ALARM_NAME = 'ngo-ext-update-check';
  const STORAGE_KEY_LAST_SHOWN = 'ngo:lastShownReleaseVersion';
  const STORAGE_KEY_LAST_CHECK = 'ngo:lastUpdateCheckAt';
  const CHECK_PERIOD_MINUTES = 60 * 6; // every 6h

  function log(...args) { console.log('[ExtUpdates]', ...args); }

  // ============================================
  // Alarm registration. Idempotent — Chrome dedupes by name.
  // ============================================
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,                  // first fire ~1m after worker wakes
    periodInMinutes: CHECK_PERIOD_MINUTES
  });

  chrome.runtime.onStartup.addListener(() => {
    // Probe shortly after browser start so users see updates promptly.
    setTimeout(() => { runCheck('startup').catch(() => {}); }, 5000);
  });

  chrome.runtime.onInstalled.addListener((details) => {
    // Probe ~30s after install/update so we don't compete with the
    // browser's own initial work.
    if (details.reason === 'install' || details.reason === 'update') {
      setTimeout(() => { runCheck('installed').catch(() => {}); }, 30000);
    }
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    runCheck('alarm').catch((e) => log('alarm check failed:', e?.message));
  });

  // ============================================
  // Settings page "Check now" forwards the release object directly so
  // the user always sees a dialog, even if the preference is off.
  // ============================================
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'EXT_UPDATE_FORCE_SHOW' && msg.release) {
      openUpdateDialog(msg.release).then(() => sendResponse({ ok: true }));
      return true; // async response
    }
    return false;
  });

  // ============================================
  // Core check.
  // ============================================
  async function runCheck(trigger) {
    try {
      // Skip if we don't have a logged-in token; nothing to check against.
      const token = await getToken();
      if (!token) return;

      // Honour the user's autoExtensionUpdates pref from agent-settings.
      const settings = await fetchAgentSettings();
      const autoOn = !settings || settings.autoExtensionUpdates !== false;
      if (!autoOn) {
        log('auto-updates off, skipping');
        return;
      }

      const installed = chrome.runtime.getManifest().version;
      const data = await apiGet(
        `/api/extension/latest-release?currentVersion=${encodeURIComponent(installed)}`
      );
      if (!data || !data.release) { log('no release published'); return; }

      const lastShown = await getStorage(STORAGE_KEY_LAST_SHOWN);
      // Only bother the user if (a) the server says there's an update
      // AND (b) we haven't already nagged them about this exact version.
      if (data.hasUpdate && data.release.version !== lastShown) {
        log(`new release v${data.release.version} (${trigger})`);
        await openUpdateDialog(data.release);
        await setStorage(STORAGE_KEY_LAST_SHOWN, data.release.version);
      } else {
        log(`no update (installed v${installed}, latest v${data.release.version})`);
      }

      await setStorage(STORAGE_KEY_LAST_CHECK, new Date().toISOString());
    } catch (e) {
      log('check failed:', e?.message);
    }
  }

  // ============================================
  // Dialog opener — uses chrome.windows.create so it stays foregrounded
  // even when the user is in another tab. The dialog page reads the
  // release info from chrome.storage.session (set right before open).
  // ============================================
  async function openUpdateDialog(release) {
    try {
      await chrome.storage.session.set({ 'ngo:pendingUpdateRelease': release });
    } catch {
      // session storage may not exist on very old Chrome — fall back to local.
      await chrome.storage.local.set({ 'ngo:pendingUpdateRelease': release });
    }
    const url = chrome.runtime.getURL('dashboard/update-dialog.html');
    try {
      await chrome.windows.create({
        url, type: 'popup', width: 560, height: 640, focused: true
      });
    } catch (e) {
      log('windows.create failed, falling back to tab:', e?.message);
      try { await chrome.tabs.create({ url }); } catch {}
    }
  }

  // ============================================
  // Small helpers — talk to the API + chrome.storage without requiring
  // any of the existing api-client.js helpers (which target a different
  // call style). Self-contained on purpose.
  // ============================================
  async function getToken() {
    const data = await chrome.storage.local.get(['authToken']);
    return data?.authToken || '';
  }

  async function getBaseUrl() {
    const data = await chrome.storage.local.get(['serverUrl']);
    return (data?.serverUrl || 'https://api.newordr.io').replace(/\/$/, '');
  }

  async function apiGet(path) {
    const token = await getToken();
    const base = await getBaseUrl();
    const res = await fetch(base + path, {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function fetchAgentSettings() {
    try {
      const data = await apiGet('/api/agent-settings');
      return data?.settings || null;
    } catch {
      return null;
    }
  }

  function getStorage(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (r) => resolve(r?.[key] || ''));
    });
  }
  function setStorage(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  }
})();
