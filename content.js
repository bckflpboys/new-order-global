// YouTube New Order - Layout Swapper & Feature Manager
// Swaps comments to right side and related videos to bottom

// Guard against double-injection (manifest + programmatic injection)
if (window.__ytNewOrderLoaded) {
  // Already loaded, do nothing
} else {
  window.__ytNewOrderLoaded = true;

  (function () {
    'use strict';

    console.log('YouTube New Order: Script loaded');

    // Respond to ping from background script to confirm content script is active
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'ping') {
          sendResponse({ pong: true });
          return;
        }
      });
    }

    // Settings state with defaults
    let settings = {
      toggleReorder: true,
      showCommentsOnHomepage: false,
      layoutMode: 'swapped',
      resizableColumns: false,
      collapsibleSections: false,
      pipComments: false,
      gridView: false,
      hideDescription: false,
      hideChannelInfo: false,
      hideMerch: false,
      hideEndScreen: false,
      customFont: 'default',
      compactMode: false,
      highlightComments: true,
      commentSearch: true,
      filterComments: false,
      autoloadComments: false,
      keyboardShortcuts: false,
      copyTimestamp: false,
      skipIntro: false,
      skipAds: false,
      screenshot: true,
      volumeBoost: false,
      videoPip: true,
      hideShorts: false,
      blockChannels: '',
      hideClickbait: false,
      keywordFilter: '',
      hideAds: false,
      navbarLogoMode: 'youtube',
      navbarLogoData: '',
      watchLater: false,
      playlistManager: false,
      notesSection: false,
      bookmarks: false,
      historySearch: false
    };

    let lastVideoId = '';
    let swapObserver = null;
    let featureCheckInterval = null;

    // Load settings from Chrome storage
    async function loadSettings() {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['settings'], function (result) {
            if (result.settings) {
              settings = { ...settings, ...result.settings };
              console.log('YouTube New Order: Settings loaded', settings);
            }
            resolve();
          });
        } else {
          resolve();
        }
      });
    }

    // Listen for settings changes from popup/settings page
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'settingsUpdated') {
          console.log('YouTube New Order: Settings updated via message', message.settings);
          settings = { ...settings, ...message.settings };
          applyAllFeatures();
          sendResponse({ success: true });
        }
        // User flipped the YouTube Toolkit toggle off in the popup —
        // remove every class + element we ever added so the page
        // looks like vanilla YouTube without needing a reload.
        if (message.type === 'ytToolkitDisable') {
          try {
            document.body.classList.forEach((cls) => {
              if (cls.startsWith('yt-new-order')) document.body.classList.remove(cls);
            });
            document.querySelectorAll('[class*="yt-new-order"]').forEach((el) => el.remove());
          } catch (e) { console.warn('YouTube New Order: teardown failed', e); }
          sendResponse({ success: true });
        }
        return true;
      });
    }

    // Listen for storage changes
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.settings) {
          settings = { ...settings, ...changes.settings.newValue };
          console.log('YouTube New Order: Settings changed via storage', settings);
          applyAllFeatures();
        }
      });
    }

    // Check if we're on a watch page
    function isWatchPage() {
      return window.location.pathname === '/watch';
    }

    // Get current video ID
    function getVideoId() {
      const params = new URLSearchParams(window.location.search);
      return params.get('v') || '';
    }

    // Wait for element to appear
    function waitForElement(selector, timeout = 10000) {
      return new Promise((resolve) => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }

        const observer = new MutationObserver((mutations, obs) => {
          const el = document.querySelector(selector);
          if (el) {
            obs.disconnect();
            resolve(el);
          }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, timeout);
      });
    }

    // Move enforceLayout to outer scope so it can be used by watchers
    function enforceLayout() {
      if (!settings.toggleReorder || !isWatchPage()) return;

      // Only enforced for custom layouts
      const customLayouts = ['swapped', 'swapped_left', 'triple_left', 'triple_right'];
      if (!customLayouts.includes(settings.layoutMode)) return;

      // Redefine elements as they might have been replaced
      const currentSecondary = document.querySelector('#secondary');
      const currentComments = document.querySelector('#comments');
      const currentColumns = document.querySelector('#columns');
      const currentBelow = document.querySelector('#below');

      if (!currentSecondary || !currentComments || !currentColumns || !currentBelow) return;

      const isTripleColumn = settings.layoutMode.startsWith('triple_');

      // 1. Handle Secondary (Related Videos)
      if (isTripleColumn) {
        // In triple column, secondary should be in #columns
        if (currentSecondary.parentElement !== currentColumns) {
          currentColumns.appendChild(currentSecondary);
          // console.log('YouTube New Order: Enforced secondary to columns');
        }
      } else {
        // In swapped modes, secondary moves to #below
        if (currentSecondary.parentElement !== currentBelow) {
          currentSecondary.remove();
          currentBelow.appendChild(currentSecondary);
          // console.log('YouTube New Order: Enforced secondary to below');
        }
        // Force visibility — YouTube's own styles may hide #secondary
        // and our CSS rule may not have taken effect yet
        currentSecondary.style.setProperty('display', 'block', 'important');
        currentSecondary.style.setProperty('visibility', 'visible', 'important');
        currentSecondary.style.setProperty('opacity', '1', 'important');
      }

      // 2. Handle Comments
      // Comments always move to #columns for our custom layouts
      if (currentComments.parentElement !== currentColumns) {
        currentComments.remove();
        currentColumns.appendChild(currentComments);
        // console.log('YouTube New Order: Enforced comments to columns');
      }
    }

    // Main layout swap function
    async function applyLayoutSwap() {
      if (!settings.toggleReorder) {
        removeLayoutSwap();
        return;
      }

      if (!isWatchPage()) {
        removeLayoutSwap();
        return;
      }

      // Only apply for custom layouts
      const customLayouts = ['swapped', 'swapped_left', 'triple_left', 'triple_right'];
      if (!customLayouts.includes(settings.layoutMode)) {
        if (settings.layoutMode === 'minimal') {
          removeLayoutSwap();
          applyMinimalLayout();
        } else if (settings.layoutMode === 'focus') {
          removeLayoutSwap();
          applyFocusLayout();
        } else {
          removeLayoutSwap();
        }
        return;
      }

      console.log('YouTube New Order: Attempting layout swap:', settings.layoutMode);

      // Wait for required elements
      const columns = await waitForElement('#columns');
      const primary = await waitForElement('#primary');
      const secondary = await waitForElement('#secondary');
      const comments = await waitForElement('#comments');
      const below = await waitForElement('#below');

      if (!columns || !primary || !secondary || !comments || !below) {
        console.log('YouTube New Order: Required elements not found yet');
        return;
      }

      try {
        // Remove any existing layout classes first to prevent conflicts
        document.body.classList.remove('yt-comments-swapped', 'yt-comments-swapped-left', 'yt-triple-column-left', 'yt-triple-column-right');

        // Add appropriate class based on mode
        if (settings.layoutMode === 'swapped') {
          document.body.classList.add('yt-comments-swapped');
        } else if (settings.layoutMode === 'swapped_left') {
          document.body.classList.add('yt-comments-swapped-left');
        } else if (settings.layoutMode === 'triple_left') {
          document.body.classList.add('yt-triple-column-left');
        } else if (settings.layoutMode === 'triple_right') {
          document.body.classList.add('yt-triple-column-right');
        }

        // Initial enforcement
        enforceLayout();

        // Setup Observer to keep it enforced
        if (swapObserver) swapObserver.disconnect();

        swapObserver = new MutationObserver((mutations) => {
          let shouldEnforce = false;
          for (const mutation of mutations) {
            if (mutation.type === 'childList') {
              shouldEnforce = true;
              break;
            }
          }

          if (shouldEnforce) {
            enforceLayout();
          }
        });

        swapObserver.observe(columns, { childList: true });
        // Also observe below since we move things there
        if (below) swapObserver.observe(below, { childList: true });

        console.log('YouTube New Order: Layout swap observer active');
        console.log('YouTube New Order: Layout swap complete!');
      } catch (error) {
        console.error('YouTube New Order: Error during layout swap', error);
      }
    }

    // Remove layout swap and restore original DOM structure
    function removeLayoutSwap() {
      if (swapObserver) {
        swapObserver.disconnect();
        swapObserver = null;
      }

      const wasSwapped = document.body.classList.contains('yt-comments-swapped') ||
        document.body.classList.contains('yt-comments-swapped-left') ||
        document.body.classList.contains('yt-triple-column-left') ||
        document.body.classList.contains('yt-triple-column-right');

      document.body.classList.remove(
        'yt-comments-swapped',
        'yt-comments-swapped-left',
        'yt-triple-column-left',
        'yt-triple-column-right',
        'yt-new-order-minimal',
        'yt-new-order-focus',
        'yt-new-order-theater'
      );

      // Only attempt to restore if we were previously swapped.
      // This prevents us from moving elements when we're on a fresh page load (Home -> Watch)
      // where elements might be in their standard locations but just being created.
      if (!wasSwapped) return;

      // Only attempt to restore if the elements exist and are misplaced
      // This fixes the bug where navigating from Home -> Watch breaks the layout
      // because YouTube expects elements in their original containers to update them.
      const columns = document.querySelector('#columns');
      const secondary = document.querySelector('#secondary');
      const comments = document.querySelector('#comments');
      const below = document.querySelector('#below');

      // 1. Restore Secondary (Related Videos) to columns if it was moved to below
      if (columns && secondary && secondary.parentElement !== columns) {
        // In standard layout, secondary is in columns
        // apppendChild moves it to the end, which is standard for secondary
        columns.appendChild(secondary);
        console.log('YouTube New Order: Restored secondary to columns');
      }

      // 2. Restore Comments to below if it was moved to columns
      if (below && comments && comments.parentElement !== below) {
        // In standard layout, comments is in below
        below.appendChild(comments);
        console.log('YouTube New Order: Restored comments to below');
      }

      // 3. Clear inline styles that might have been set by Resizable Columns or other features
      const primary = document.querySelector('#primary');
      const elementsToReset = [columns, primary, secondary, comments, below];
      elementsToReset.forEach(el => {
        if (el) {
          el.style.removeProperty('flex');
          el.style.removeProperty('width');
          el.style.removeProperty('max-width');
          el.style.removeProperty('min-width');
          el.style.removeProperty('order');
          el.style.removeProperty('position');
          el.style.removeProperty('top');
          el.style.removeProperty('z-index');
          el.style.removeProperty('display');
          el.style.removeProperty('visibility');
          el.style.removeProperty('opacity');
          el.style.removeProperty('overflow');
          el.style.removeProperty('overflow-y');
        }
      });

      // Remove resizers if any
      document.querySelectorAll('.yt-new-order-resizer').forEach(el => el.remove());
    }

    // Apply minimal layout
    function applyMinimalLayout() {
      if (!isWatchPage()) return;
      document.body.classList.add('yt-new-order-minimal');
    }

    // Apply focus layout
    function applyFocusLayout() {
      if (!isWatchPage()) return;
      document.body.classList.add('yt-new-order-focus');
    }

    // ============================================
    // FEATURE: Comment Search
    // ============================================
    function addCommentSearch() {
      if (!settings.commentSearch || !isWatchPage()) return;
      if (document.querySelector('.yt-new-order-comment-search')) return;

      const commentsHeader = document.querySelector('#comments #header #title');
      if (!commentsHeader) return;

      const searchContainer = document.createElement('div');
      searchContainer.className = 'yt-new-order-comment-search';
      searchContainer.innerHTML = `
      <input type="text" placeholder="Search comments..." class="yt-new-order-search-input">
      <button class="yt-new-order-search-btn">🔍</button>
      <button class="yt-new-order-search-clear" style="display:none">✕</button>
    `;

      // Insert after the header
      commentsHeader.parentElement.appendChild(searchContainer);

      const input = searchContainer.querySelector('.yt-new-order-search-input');
      const clearBtn = searchContainer.querySelector('.yt-new-order-search-clear');

      input.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        clearBtn.style.display = query ? 'inline-block' : 'none';
        filterCommentsBySearch(query);
      });

      clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        filterCommentsBySearch('');
      });

      console.log('YouTube New Order: Comment search added');
    }

    function filterCommentsBySearch(query) {
      const comments = document.querySelectorAll('ytd-comment-thread-renderer');
      comments.forEach(comment => {
        const text = comment.textContent.toLowerCase();
        if (!query || text.includes(query)) {
          comment.style.display = '';
        } else {
          comment.style.display = 'none';
        }
      });
    }

    // ============================================
    // FEATURE: Advanced Comment Filters
    // ============================================
    function addCommentFilters() {
      if (!settings.filterComments || !isWatchPage()) return;
      if (document.querySelector('.yt-new-order-comment-filters')) return;

      const commentsHeader = document.querySelector('#comments #header');
      if (!commentsHeader) return;

      const filterContainer = document.createElement('div');
      filterContainer.className = 'yt-new-order-comment-filters';
      filterContainer.innerHTML = `
      <button class="yt-new-order-filter-btn active" data-filter="all">All</button>
      <button class="yt-new-order-filter-btn" data-filter="liked">Most Liked</button>
      <button class="yt-new-order-filter-btn" data-filter="replies">Has Replies</button>
      <button class="yt-new-order-filter-btn" data-filter="creator">Creator</button>
    `;

      commentsHeader.appendChild(filterContainer);

      filterContainer.querySelectorAll('.yt-new-order-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          filterContainer.querySelectorAll('.yt-new-order-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          applyCommentFilter(btn.dataset.filter);
        });
      });

      console.log('YouTube New Order: Comment filters added');
    }

    function applyCommentFilter(filter) {
      const comments = document.querySelectorAll('ytd-comment-thread-renderer');
      comments.forEach(comment => {
        let show = true;

        switch (filter) {
          case 'liked':
            const likes = comment.querySelector('#vote-count-middle');
            const likeCount = parseInt(likes?.textContent?.replace(/[^0-9]/g, '') || '0');
            show = likeCount > 10;
            break;
          case 'replies':
            const replies = comment.querySelector('#replies');
            show = replies && replies.children.length > 0;
            break;
          case 'creator':
            show = comment.querySelector('[is-by-creator]') !== null;
            break;
          default:
            show = true;
        }

        comment.style.display = show ? '' : 'none';
      });
    }

    // ============================================
    // FEATURE: Auto-load Comments
    // ============================================
    function setupAutoloadComments() {
      if (!settings.autoloadComments || !isWatchPage()) return;

      const loadMoreButtons = document.querySelectorAll('ytd-continuation-item-renderer, #show-more-button');
      loadMoreButtons.forEach(btn => {
        if (!btn.dataset.autoloaded) {
          btn.dataset.autoloaded = 'true';
          btn.click();
        }
      });
    }

    // ============================================
    // FEATURE: Video Player Controls
    // ============================================
    function addVideoPlayerControls() {
      const rightControls = document.querySelector('.ytp-right-controls');
      if (!rightControls) return;

      // Screenshot button
      if (settings.screenshot && !document.querySelector('.yt-new-order-screenshot-btn')) {
        const screenshotBtn = document.createElement('button');
        screenshotBtn.className = 'ytp-button yt-new-order-screenshot-btn';
        screenshotBtn.title = 'Take Screenshot (S)';
        screenshotBtn.innerHTML = `
        <svg height="100%" version="1.1" viewBox="0 0 24 24" width="100%">
          <path fill="#fff" d="M12 12m-3.2 0a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0"></path>
          <path fill="#fff" d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"></path>
        </svg>
      `;

        screenshotBtn.onclick = takeScreenshot;
        rightControls.insertBefore(screenshotBtn, rightControls.firstChild);
        console.log('YouTube New Order: Screenshot button added');
      }

      // Copy timestamp button
      if (settings.copyTimestamp && !document.querySelector('.yt-new-order-timestamp-btn')) {
        const timestampBtn = document.createElement('button');
        timestampBtn.className = 'ytp-button yt-new-order-timestamp-btn';
        timestampBtn.title = 'Copy Timestamp URL';
        timestampBtn.innerHTML = `
        <svg height="100%" version="1.1" viewBox="0 0 24 24" width="100%">
          <path fill="#fff" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"></path>
        </svg>
      `;
        timestampBtn.onclick = copyTimestamp;
        rightControls.insertBefore(timestampBtn, rightControls.firstChild);
        console.log('YouTube New Order: Timestamp button added');
      }
    }

    function takeScreenshot() {
      const video = document.querySelector('video');
      if (!video) return;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);

      canvas.toBlob((blob) => {
        const link = document.createElement('a');
        link.download = `youtube-screenshot-${Date.now()}.png`;
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
      });

      showToast('Screenshot saved!');
    }

    function copyTimestamp() {
      const video = document.querySelector('video');
      if (!video) return;

      const time = Math.floor(video.currentTime);
      const url = `${window.location.origin}${window.location.pathname}?v=${getVideoId()}&t=${time}`;

      navigator.clipboard.writeText(url).then(() => {
        showToast('Timestamp URL copied!');
      });
    }

    // ============================================
    // FEATURE: Video Picture-in-Picture
    // ============================================
    function setupVideoPip() {
      if (!settings.videoPip) {
        const btn = document.querySelector('.yt-new-order-pip-btn');
        if (btn) btn.remove();
        return;
      }

      const video = document.querySelector('video');
      const rightControls = document.querySelector('.ytp-right-controls');
      if (!video || !rightControls) return;

      if (document.querySelector('.yt-new-order-pip-btn')) return;

      const pipBtn = document.createElement('button');
      pipBtn.className = 'ytp-button yt-new-order-pip-btn';
      pipBtn.title = 'Picture-in-Picture';
      // Standard PiP Icon
      pipBtn.innerHTML = `
      <svg height="100%" viewBox="0 0 24 24" width="100%">
        <path fill="#fff" d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"></path>
      </svg>
    `;

      pipBtn.onclick = async () => {
        try {
          if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
          } else {
            await video.requestPictureInPicture();
          }
        } catch (error) {
          console.error('YouTube New Order: PiP failed', error);
          showToast('PiP failed: ' + error.message);
        }
      };

      video.addEventListener('enterpictureinpicture', () => {
        // Optional: change icon or style
      });

      video.addEventListener('leavepictureinpicture', () => {
        // Optional: revert icon or style
      });

      rightControls.insertBefore(pipBtn, rightControls.firstChild);
      console.log('YouTube New Order: Video PiP button added');
    }

    // ============================================
    // FEATURE: Skip Ads
    // ============================================
    function setupSkipAds() {
      if (!settings.skipAds) return;

      // Check for skip button periodically
      const skipAd = () => {
        const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern');
        if (skipBtn && skipBtn.offsetParent !== null) {
          skipBtn.click();
          console.log('YouTube New Order: Skipped ad');
        }

        // Also try to skip overlay ads
        const closeBtn = document.querySelector('.ytp-ad-overlay-close-button');
        if (closeBtn) {
          closeBtn.click();
        }
      };

      setInterval(skipAd, 500);
    }

    // Volume Boost moved below with UI implementation

    // ============================================
    // FEATURE: Keyboard Shortcuts
    // ============================================
    function setupKeyboardShortcuts() {
      if (!settings.keyboardShortcuts) return;
      if (window.ytNewOrderShortcutsSetup) return;

      window.ytNewOrderShortcutsSetup = true;

      document.addEventListener('keydown', (e) => {
        // Don't trigger in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        if (!settings.keyboardShortcuts) return;

        switch (e.key.toLowerCase()) {
          case 's':
            if (settings.screenshot) {
              e.preventDefault();
              takeScreenshot();
            }
            break;
          case 'c':
            if (settings.copyTimestamp && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              copyTimestamp();
            }
            break;
        }
      });

      console.log('YouTube New Order: Keyboard shortcuts enabled');
    }

    // ============================================
    // FEATURE: Hide Elements
    // ============================================
    function applyHideElements() {
      // Hide Description
      if (settings.hideDescription) {
        document.body.classList.add('yt-hide-description');
      } else {
        document.body.classList.remove('yt-hide-description');
      }

      // Hide Channel Info
      if (settings.hideChannelInfo) {
        document.body.classList.add('yt-hide-channel-info');
      } else {
        document.body.classList.remove('yt-hide-channel-info');
      }

      // Hide Merch
      if (settings.hideMerch) {
        document.body.classList.add('yt-hide-merch');
      } else {
        document.body.classList.remove('yt-hide-merch');
      }

      // Hide End Screen
      if (settings.hideEndScreen) {
        document.body.classList.add('yt-hide-endscreen');
      } else {
        document.body.classList.remove('yt-hide-endscreen');
      }

      // Compact Mode
      if (settings.compactMode) {
        document.body.classList.add('yt-compact-mode');
      } else {
        document.body.classList.remove('yt-compact-mode');
      }

      // Highlight Comments
      if (settings.highlightComments) {
        document.body.classList.add('yt-highlight-comments');
      } else {
        document.body.classList.remove('yt-highlight-comments');
      }
    }

    // ============================================
    // FEATURE: Navbar Logo
    // ============================================
    function applyNavbarLogo() {
      const logoContainer = document.querySelector('ytd-topbar-logo-renderer #logo-icon');
      if (!logoContainer) return;

      // Reset if default
      if (settings.navbarLogoMode === 'youtube') {
        // If we previously modified it, we might need to restore. 
        // However, usually refreshing page is enough or we can try to re-inject original SVG if we saved it.
        // For now, let's assume valid state on load. If changing live, user might need reload.
        // But we can try to remove our custom img if it exists.
        const customImg = logoContainer.querySelector('.yt-new-order-custom-logo');
        if (customImg) {
          customImg.remove();
          // Restore SVG visibility
          Array.from(logoContainer.children).forEach(child => {
            if (!child.classList.contains('yt-new-order-custom-logo')) {
              child.style.display = '';
            }
          });
        }
        return;
      }

      let src = '';
      if (settings.navbarLogoMode === 'extension') {
        src = chrome.runtime.getURL('icons/logo.png');
      } else if (settings.navbarLogoMode === 'custom' && settings.navbarLogoData) {
        src = settings.navbarLogoData;
      }

      if (!src) return;

      // Hide original children (SVG)
      Array.from(logoContainer.children).forEach(child => {
        if (!child.classList.contains('yt-new-order-custom-logo')) {
          child.style.display = 'none';
        }
      });

      // Add or update our image
      let img = logoContainer.querySelector('.yt-new-order-custom-logo');
      if (!img) {
        img = document.createElement('img');
        img.className = 'yt-new-order-custom-logo';
        // Make logo bigger and clearer
        img.style.height = '35px';
        img.style.maxHeight = 'none';
        img.style.maxWidth = '180px';
        img.style.objectFit = 'contain';
        img.style.display = 'block';
        img.style.marginLeft = '-5px'; // Adjust position slightly

        // Ensure container allows larger size
        logoContainer.style.height = 'auto';
        logoContainer.style.display = 'flex';
        logoContainer.style.alignItems = 'center';

        logoContainer.appendChild(img);
      }
      img.src = src;
    }

    // ============================================
    // FEATURE: Content Filtering
    // ============================================
    function applyContentFiltering() {
      // Hide Shorts
      if (settings.hideShorts) {
        document.body.classList.add('yt-hide-shorts');
      } else {
        document.body.classList.remove('yt-hide-shorts');
      }

      // Hide Ads/Promos
      if (settings.hideAds) {
        document.body.classList.add('yt-hide-promos');
      } else {
        document.body.classList.remove('yt-hide-promos');
      }

      // Block Channels
      if (settings.blockChannels) {
        blockChannels();
      }

      // Keyword Filter
      if (settings.keywordFilter) {
        filterByKeywords();
      }

      // Hide Clickbait
      if (settings.hideClickbait) {
        hideClickbait();
      }
    }

    function blockChannels() {
      if (!settings.blockChannels) return;

      const blocked = settings.blockChannels.split(',').map(c => c.trim().toLowerCase()).filter(c => c);
      if (blocked.length === 0) return;

      const videos = document.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer');
      videos.forEach(video => {
        const channelEl = video.querySelector('#channel-name a, .ytd-channel-name a, #text.ytd-channel-name');
        const channelName = channelEl?.textContent?.toLowerCase()?.trim();

        if (channelName && blocked.some(b => channelName.includes(b))) {
          video.style.display = 'none';
        }
      });
    }

    function filterByKeywords() {
      if (!settings.keywordFilter) return;

      const keywords = settings.keywordFilter.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
      if (keywords.length === 0) return;

      const videos = document.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer');
      videos.forEach(video => {
        const titleEl = video.querySelector('#video-title');
        const title = titleEl?.textContent?.toLowerCase();

        if (title && keywords.some(k => title.includes(k))) {
          video.style.display = 'none';
        }
      });
    }

    function hideClickbait() {
      const videos = document.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer');
      videos.forEach(video => {
        const titleEl = video.querySelector('#video-title');
        if (!titleEl) return;

        const title = titleEl.textContent;
        const letters = title.replace(/[^a-zA-Z]/g, '');
        const caps = title.replace(/[^A-Z]/g, '');
        const capsRatio = letters.length > 0 ? caps.length / letters.length : 0;

        // Hide if more than 60% caps
        if (capsRatio > 0.6) {
          video.style.display = 'none';
        }
      });
    }

    // ============================================
    // FEATURE: Resizable Columns
    // ============================================
    function setupResizableColumns() {
      // Remove existing resizers first
      document.querySelectorAll('.yt-new-order-resizer').forEach(el => el.remove());

      if (!settings.resizableColumns || !isWatchPage()) return;

      // Only applies if layout mode is custom
      const customLayouts = ['swapped', 'swapped_left', 'triple_left', 'triple_right'];
      if (!customLayouts.includes(settings.layoutMode)) return;

      const comments = document.querySelector('#comments');
      const secondary = document.querySelector('#secondary');

      // Helper to add resizer
      const addResizer = (element, side) => {
        if (!element) return;

        const resizer = document.createElement('div');
        resizer.className = `yt-new-order-resizer yt-resizer-${side}`;
        resizer.title = 'Drag to resize';
        resizer.style.position = 'absolute';
        resizer.style.top = '0';
        resizer.style.bottom = '0';

        let startX, startWidth;

        const onMouseDown = (e) => {
          e.preventDefault();
          startX = e.clientX;
          startWidth = element.offsetWidth;
          resizer.classList.add('resizing');

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        };

        const onMouseMove = (e) => {
          const currentX = e.clientX;
          const diff = currentX - startX;

          let newWidth;
          if (side === 'left') {
            newWidth = startWidth - diff;
          } else {
            newWidth = startWidth + diff;
          }

          const maxWidth = window.innerWidth * 0.6;
          if (newWidth < 300) newWidth = 300;
          if (newWidth > maxWidth) newWidth = maxWidth;

          element.style.setProperty('flex', `0 0 ${newWidth}px`, 'important');
          element.style.setProperty('width', `${newWidth}px`, 'important');
          element.style.setProperty('min-width', `${newWidth}px`, 'important');
          element.style.setProperty('max-width', `${newWidth}px`, 'important');
        };

        const onMouseUp = () => {
          resizer.classList.remove('resizing');
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          document.body.style.removeProperty('cursor');
          document.body.style.removeProperty('user-select');
        };

        resizer.addEventListener('mousedown', onMouseDown);
        element.style.position = element.id === 'comments' ? 'sticky' : 'relative';
        element.appendChild(resizer);
      };

      // Apply based on layout
      if (settings.layoutMode === 'swapped') {
        addResizer(comments, 'left');
      } else if (settings.layoutMode === 'swapped_left') {
        addResizer(comments, 'right');
      } else if (settings.layoutMode === 'triple_left') {
        addResizer(comments, 'right');
        addResizer(secondary, 'left');
      } else if (settings.layoutMode === 'triple_right') {
        addResizer(secondary, 'right');
        addResizer(comments, 'left');
      }

      console.log('YouTube New Order: Resizable columns setup complete');
    }

    // ============================================
    // FEATURE: Custom Font
    // ============================================
    async function applyCustomFont() {
      // Clean up previous custom font injections
      const existingLink = document.getElementById('yt-new-order-font-link');
      if (existingLink) existingLink.remove();

      const existingStyle = document.getElementById('yt-new-order-font-style');
      if (existingStyle) existingStyle.remove();

      if (!settings.customFont || settings.customFont === 'default') {
        document.body.classList.remove('yt-custom-font');
        document.documentElement.style.removeProperty('--yt-new-order-font');
        return;
      }

      const fontMap = {
        'inter': '"Inter", sans-serif',
        'system': '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        'arial': 'Arial, sans-serif',
        'helvetica': 'Helvetica, sans-serif',
        'verdana': 'Verdana, sans-serif',
        'tahoma': 'Tahoma, sans-serif',
        'trebuchet': '"Trebuchet MS", sans-serif',
        'georgia': 'Georgia, serif',
        'times': '"Times New Roman", serif',
        'garamond': 'Garamond, serif',
        'monospace': 'Consolas, Monaco, "Courier New", monospace',
        'console': 'Consolas, monospace',
        'comic': '"Comic Sans MS", cursive',
        'impact': 'Impact, sans-serif'
      };

      let fontFamily = fontMap[settings.customFont];

      // Handle User Custom Fonts
      if (!fontFamily && settings.customFonts) {
        const customFont = settings.customFonts.find(f => f.id === settings.customFont);
        if (customFont) {
          fontFamily = `"${customFont.name}", sans-serif`;

          if (customFont.type === 'url') {
            // For URL-based fonts (e.g. Google Fonts), we fetch the CSS and inline
            // the @font-face rules with data URIs to bypass Chrome extension CSP.
            try {
              await inlineExternalFont(customFont.value, customFont.name);
            } catch (err) {
              console.warn('YouTube New Order: Failed to inline external font, trying link fallback', err);
              // Fallback: inject as link (may not work due to CSP, but worth trying)
              const link = document.createElement('link');
              link.id = 'yt-new-order-font-link';
              link.rel = 'stylesheet';
              link.href = customFont.value;
              document.head.appendChild(link);
            }
          } else if (customFont.type === 'upload') {
            // Fetch from local storage and wait for it to complete
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              await new Promise((resolve) => {
                chrome.storage.local.get([customFont.id], function (result) {
                  const fontData = result[customFont.id];
                  if (fontData) {
                    const style = document.createElement('style');
                    style.id = 'yt-new-order-font-style';
                    style.textContent = `
                    @font-face {
                      font-family: "${customFont.name}";
                      src: url("${fontData}");
                      font-weight: 100 900;
                      font-style: normal;
                    }
                  `;
                    document.head.appendChild(style);
                  }
                  resolve();
                });
              });
            }
          }
        }
      }

      if (fontFamily) {
        document.documentElement.style.setProperty('--yt-new-order-font', fontFamily);
        document.body.classList.add('yt-custom-font');
      }
    }

    // Fetch a Google Fonts (or similar) CSS URL, download the actual font files,
    // convert them to data URIs, and inject everything as an inline <style> tag.
    // This is required because Chrome extension CSP blocks external font loading.
    async function inlineExternalFont(cssUrl, fontName) {
      // Fetch the CSS — Google Fonts serves different formats based on User-Agent,
      // using the browser's UA ensures we get woff2 (smallest, most compatible)
      const cssResponse = await fetch(cssUrl);

      if (!cssResponse.ok) {
        throw new Error(`Failed to fetch font CSS: ${cssResponse.status}`);
      }

      let cssText = await cssResponse.text();

      // Find all url() references in the CSS and replace them with data URIs
      const urlRegex = /url\(([^)]+)\)/g;
      const urls = new Set();
      let match;

      while ((match = urlRegex.exec(cssText)) !== null) {
        const url = match[1].replace(/["']/g, '').trim();
        if (url.startsWith('http')) {
          urls.add(url);
        }
      }

      // Fetch each font file and convert to data URI
      for (const url of urls) {
        try {
          const fontResponse = await fetch(url);
          if (!fontResponse.ok) continue;

          const blob = await fontResponse.blob();
          const dataUri = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });

          // Replace the remote URL with the data URI in the CSS
          cssText = cssText.split(url).join(dataUri);
        } catch (e) {
          console.warn('YouTube New Order: Failed to fetch font file:', url, e);
        }
      }

      // Inject the fully inlined CSS
      const style = document.createElement('style');
      style.id = 'yt-new-order-font-style';
      style.textContent = cssText;
      document.head.appendChild(style);

      console.log('YouTube New Order: External font inlined successfully for', fontName);
    }

    // ============================================
    // Toast Notification
    // ============================================
    function showToast(message) {
      const existing = document.querySelector('.yt-new-order-toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'yt-new-order-toast';
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => toast.classList.add('show'), 10);
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 2000);
    }

    // ============================================
    // FEATURE: Collapsible Sections
    // ============================================
    function setupCollapsibleSections() {
      if (!settings.collapsibleSections || !isWatchPage()) return;

      // Add collapse button to comments
      const commentsHeader = document.querySelector('#comments #header');
      if (commentsHeader && !commentsHeader.querySelector('.yt-new-order-collapse-btn')) {
        const btn = document.createElement('button');
        btn.className = 'yt-new-order-collapse-btn';
        btn.innerHTML = '<span class="collapse-icon">▼</span> Collapse';
        btn.addEventListener('click', () => {
          const commentsContent = document.querySelector('#comments #contents');
          if (!commentsContent) return;
          const isCollapsed = commentsContent.classList.toggle('yt-new-order-section-collapsed');
          btn.classList.toggle('collapsed', isCollapsed);
          btn.innerHTML = isCollapsed
            ? '<span class="collapse-icon">▼</span> Expand'
            : '<span class="collapse-icon">▼</span> Collapse';
        });
        commentsHeader.appendChild(btn);
      }

      // Add collapse button to related videos
      const secondaryInner = document.querySelector('#secondary-inner, #secondary #related');
      if (secondaryInner && !secondaryInner.parentElement.querySelector('.yt-new-order-collapse-btn')) {
        const relatedHeader = document.querySelector('#secondary #related h2, #secondary #related #title');
        const target = relatedHeader || secondaryInner;
        if (target) {
          const btn = document.createElement('button');
          btn.className = 'yt-new-order-collapse-btn';
          btn.innerHTML = '<span class="collapse-icon">▼</span> Collapse';
          btn.addEventListener('click', () => {
            const items = document.querySelector('#secondary #related #items, #secondary #related ytd-item-section-renderer');
            if (!items) return;
            const isCollapsed = items.classList.toggle('yt-new-order-section-collapsed');
            btn.classList.toggle('collapsed', isCollapsed);
            btn.innerHTML = isCollapsed
              ? '<span class="collapse-icon">▼</span> Expand'
              : '<span class="collapse-icon">▼</span> Collapse';
          });
          target.parentElement.insertBefore(btn, target.nextSibling);
        }
      }
      console.log('YouTube New Order: Collapsible sections setup');
    }

    // ============================================
    // FEATURE: Picture-in-Picture Comments
    // ============================================
    function setupPipComments() {
      if (!settings.pipComments || !isWatchPage()) return;
      if (document.querySelector('.yt-new-order-pip-comments')) return;

      const pip = document.createElement('div');
      pip.className = 'yt-new-order-pip-comments';
      pip.innerHTML = `
      <div class="yt-new-order-pip-header">
        <span>💬 Comments</span>
        <button class="yt-new-order-pip-close">✕</button>
      </div>
      <div class="yt-new-order-pip-body"></div>
    `;

      document.body.appendChild(pip);

      pip.querySelector('.yt-new-order-pip-close').addEventListener('click', () => pip.remove());

      // Make draggable
      const header = pip.querySelector('.yt-new-order-pip-header');
      let isDragging = false, offsetX, offsetY;
      header.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - pip.getBoundingClientRect().left;
        offsetY = e.clientY - pip.getBoundingClientRect().top;
      });
      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        pip.style.left = (e.clientX - offsetX) + 'px';
        pip.style.top = (e.clientY - offsetY) + 'px';
        pip.style.right = 'auto';
        pip.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', () => { isDragging = false; });

      // Load comments into PiP
      const loadComments = () => {
        const body = pip.querySelector('.yt-new-order-pip-body');
        const commentEls = document.querySelectorAll('ytd-comment-thread-renderer');
        body.innerHTML = '';
        const count = Math.min(commentEls.length, 30);
        for (let i = 0; i < count; i++) {
          const c = commentEls[i];
          const author = c.querySelector('#author-text')?.textContent?.trim() || 'Anonymous';
          const text = c.querySelector('#content-text')?.textContent?.trim() || '';
          if (!text) continue;
          const div = document.createElement('div');
          div.className = 'yt-new-order-pip-comment';
          div.innerHTML = `<div class="yt-new-order-pip-author">${author}</div><div class="yt-new-order-pip-text">${text.substring(0, 200)}${text.length > 200 ? '...' : ''}</div>`;
          body.appendChild(div);
        }
        if (body.children.length === 0) {
          body.innerHTML = '<div style="text-align:center;color:#666;padding:30px;">Comments loading...</div>';
        }
      };
      loadComments();
      // Refresh every 5s
      const pipInterval = setInterval(() => {
        if (!document.querySelector('.yt-new-order-pip-comments')) {
          clearInterval(pipInterval);
          return;
        }
        loadComments();
      }, 5000);

      console.log('YouTube New Order: PiP comments enabled');
    }

    // ============================================
    // FEATURE: Grid View for Related Videos
    // ============================================
    function applyGridView() {
      if (settings.gridView && isWatchPage()) {
        document.body.classList.add('yt-grid-related');
      } else {
        document.body.classList.remove('yt-grid-related');
      }
    }

    // ============================================
    // FEATURE: Volume Boost (with UI)
    // ============================================
    let volumeBoostGainNode = null;
    let volumeBoostAudioCtx = null;

    function setupVolumeBoost() {
      if (!settings.volumeBoost) {
        // Remove UI if disabled
        document.querySelectorAll('.yt-new-order-volume-boost-container').forEach(el => el.remove());
        return;
      }

      const video = document.querySelector('video');
      const rightControls = document.querySelector('.ytp-right-controls');
      if (!video || !rightControls) return;
      if (document.querySelector('.yt-new-order-volume-boost-container')) return;

      // Create audio boost
      try {
        if (!video.ytNewOrderVolumeBoost) {
          volumeBoostAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const source = volumeBoostAudioCtx.createMediaElementSource(video);
          volumeBoostGainNode = volumeBoostAudioCtx.createGain();
          volumeBoostGainNode.gain.value = 1.5;
          source.connect(volumeBoostGainNode);
          volumeBoostGainNode.connect(volumeBoostAudioCtx.destination);
          video.ytNewOrderVolumeBoost = true;
        }
      } catch (e) {
        console.log('YouTube New Order: Volume boost audio setup skipped:', e.message);
      }

      // Create UI
      const container = document.createElement('div');
      container.className = 'yt-new-order-volume-boost-container';

      const btn = document.createElement('button');
      btn.className = 'ytp-button yt-new-order-volume-boost-btn active';
      btn.title = 'Volume Boost';
      btn.innerHTML = `
      <svg height="100%" viewBox="0 0 24 24" width="100%">
        <path fill="#3ea6ff" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"></path>
      </svg>
    `;

      const badge = document.createElement('span');
      badge.className = 'yt-new-order-boost-badge';
      badge.textContent = '150%';
      btn.appendChild(badge);

      const popup = document.createElement('div');
      popup.className = 'yt-new-order-volume-popup';
      popup.innerHTML = `
      <span class="yt-new-order-boost-value">150%</span>
      <input type="range" class="yt-new-order-volume-slider" min="100" max="400" value="150" step="10">
      <label>Boost</label>
    `;

      const slider = popup.querySelector('.yt-new-order-volume-slider');
      const valueDisplay = popup.querySelector('.yt-new-order-boost-value');

      // Improve slider interaction
      slider.addEventListener('input', (e) => {
        updateVolume(e.target.value);
      });

      // Add wheel support for "moving the scroll wheel"
      slider.addEventListener('wheel', (e) => {
        e.preventDefault();
        // Invert deltaY so scrolling UP increases volume
        const delta = (e.deltaY < 0 ? 10 : -10);
        let newVal = parseInt(slider.value) + delta;

        // Clamp values
        if (newVal > 400) newVal = 400;
        if (newVal < 100) newVal = 100;

        slider.value = newVal;
        updateVolume(newVal);
      });

      function updateVolume(val) {
        valueDisplay.textContent = val + '%';
        badge.textContent = val + '%';
        if (volumeBoostGainNode) {
          volumeBoostGainNode.gain.value = val / 100;
        }
      }

      // Toggle visibility
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent immediate closing
        popup.classList.toggle('visible');
      });

      // Prevent clicks inside popup from closing it
      popup.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      // Close popup when clicking outside
      document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
          popup.classList.remove('visible');
        }
      });

      container.appendChild(popup);
      container.appendChild(btn);
      rightControls.insertBefore(container, rightControls.firstChild);
      console.log('YouTube New Order: Volume boost UI added');
    }

    // ============================================
    // FEATURE: Watch Later Quick Add
    // ============================================
    function setupWatchLater() {
      if (!settings.watchLater) return;

      const videos = document.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, ytd-grid-video-renderer');
      videos.forEach(video => {
        if (video.querySelector('.yt-new-order-watch-later-btn')) return;
        const thumbnail = video.querySelector('ytd-thumbnail, #thumbnail');
        if (!thumbnail) return;

        // Ensure relative positioning for thumbnail
        if (getComputedStyle(thumbnail).position === 'static') {
          thumbnail.style.position = 'relative';
        }

        const btn = document.createElement('button');
        btn.className = 'yt-new-order-watch-later-btn';
        btn.innerHTML = '⏰';
        btn.title = 'Add to Watch Later';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          // Try to click YouTube's native watch later button
          const menu = video.querySelector('#menu button, ytd-menu-renderer button');
          if (menu) {
            menu.click();
            setTimeout(() => {
              const watchLaterOption = document.querySelector('tp-yt-paper-listbox ytd-menu-service-item-renderer:nth-child(3)');
              if (watchLaterOption) watchLaterOption.click();
              // Close menu
              const dismissBtn = document.querySelector('tp-yt-iron-dropdown');
              if (dismissBtn) dismissBtn.style.display = 'none';
            }, 300);
          }

          btn.classList.add('added');
          btn.innerHTML = '✓';
          btn.title = 'Added!';
          showToast('Added to Watch Later!');

          setTimeout(() => {
            btn.classList.remove('added');
            btn.innerHTML = '⏰';
            btn.title = 'Add to Watch Later';
          }, 2000);
        });

        thumbnail.appendChild(btn);
      });
    }

    // ============================================
    // FEATURE: Enhanced Playlist Manager
    // ============================================
    function setupPlaylistManager() {
      if (!settings.playlistManager || !isWatchPage()) return;
      if (document.querySelector('.yt-new-order-playlist-toggle')) return;

      // Toggle button
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'yt-new-order-playlist-toggle';
      toggleBtn.innerHTML = '📋';
      toggleBtn.title = 'Playlist Manager';

      // Panel
      const panel = document.createElement('div');
      panel.className = 'yt-new-order-playlist-panel';
      panel.innerHTML = `
      <div class="yt-new-order-playlist-header">
        <h3>📋 Playlists</h3>
        <button class="yt-new-order-playlist-close">✕</button>
      </div>
      <div class="yt-new-order-playlist-search">
        <input type="text" placeholder="Search playlists...">
      </div>
      <div class="yt-new-order-playlist-list"></div>
      <div class="yt-new-order-playlist-actions">
        <button class="yt-new-order-playlist-add-btn">+ Create New Playlist</button>
      </div>
    `;

      document.body.appendChild(panel);
      document.body.appendChild(toggleBtn);

      // Load playlists from storage
      const loadPlaylists = () => {
        chrome.storage.local.get(['playlists'], (result) => {
          const playlists = result.playlists || [
            { name: 'Favorites', icon: '⭐', videos: [] },
            { name: 'Watch Later', icon: '⏰', videos: [] },
            { name: 'Music', icon: '🎵', videos: [] }
          ];
          renderPlaylists(playlists);
        });
      };

      const renderPlaylists = (playlists) => {
        const list = panel.querySelector('.yt-new-order-playlist-list');
        list.innerHTML = '';
        playlists.forEach((pl, idx) => {
          const item = document.createElement('div');
          item.className = 'yt-new-order-playlist-item';
          item.innerHTML = `
          <span class="pl-icon">${pl.icon || '📁'}</span>
          <div class="pl-info">
            <div class="pl-name">${pl.name}</div>
            <div class="pl-count">${(pl.videos || []).length} videos</div>
          </div>
        `;
          item.addEventListener('click', () => {
            const videoId = getVideoId();
            const title = document.querySelector('#title h1 yt-formatted-string, h1.ytd-watch-metadata')?.textContent || 'Untitled';
            if (!pl.videos) pl.videos = [];
            if (!pl.videos.find(v => v.id === videoId)) {
              pl.videos.push({ id: videoId, title: title, addedAt: Date.now() });
              chrome.storage.local.set({ playlists });
              showToast(`Added to "${pl.name}"!`);
              renderPlaylists(playlists);
            } else {
              showToast(`Already in "${pl.name}"`);
            }
          });
          list.appendChild(item);
        });
      };

      // Add playlist
      panel.querySelector('.yt-new-order-playlist-add-btn').addEventListener('click', () => {
        const name = prompt('Enter playlist name:');
        if (!name) return;
        chrome.storage.local.get(['playlists'], (result) => {
          const playlists = result.playlists || [];
          playlists.push({ name, icon: '📁', videos: [] });
          chrome.storage.local.set({ playlists });
          renderPlaylists(playlists);
          showToast(`Playlist "${name}" created!`);
        });
      });

      // Search
      panel.querySelector('.yt-new-order-playlist-search input').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        panel.querySelectorAll('.yt-new-order-playlist-item').forEach(item => {
          const name = item.querySelector('.pl-name').textContent.toLowerCase();
          item.style.display = name.includes(q) ? '' : 'none';
        });
      });

      toggleBtn.addEventListener('click', () => {
        panel.classList.toggle('visible');
        if (panel.classList.contains('visible')) loadPlaylists();
      });

      panel.querySelector('.yt-new-order-playlist-close').addEventListener('click', () => {
        panel.classList.remove('visible');
      });

      loadPlaylists();
      console.log('YouTube New Order: Playlist manager setup');
    }

    // ============================================
    // FEATURE: Video Notes
    // ============================================
    function setupVideoNotes() {
      if (!settings.notesSection || !isWatchPage()) return;
      if (document.querySelector('.yt-new-order-notes-container')) return;

      const below = document.querySelector('#below') || document.querySelector('#primary #primary-inner');
      if (!below) return;

      const videoId = getVideoId();
      if (!videoId) return;

      const container = document.createElement('div');
      container.className = 'yt-new-order-notes-container';
      container.innerHTML = `
      <div class="yt-new-order-notes-header">
        <h4>📝 My Notes</h4>
        <span>Auto-saved per video</span>
      </div>
      <textarea class="yt-new-order-notes-textarea" placeholder="Write your notes about this video..."></textarea>
      <div class="yt-new-order-notes-actions">
        <button class="yt-new-order-notes-save">💾 Save Note</button>
      </div>
    `;

      below.insertBefore(container, below.firstChild);

      const textarea = container.querySelector('.yt-new-order-notes-textarea');

      // Load saved note
      chrome.storage.local.get([`note_${videoId}`], (result) => {
        if (result[`note_${videoId}`]) {
          textarea.value = result[`note_${videoId}`];
        }
      });

      // Save button
      container.querySelector('.yt-new-order-notes-save').addEventListener('click', () => {
        chrome.storage.local.set({ [`note_${videoId}`]: textarea.value });
        showToast('Note saved!');
      });

      // Auto-save on blur
      textarea.addEventListener('blur', () => {
        if (textarea.value) {
          chrome.storage.local.set({ [`note_${videoId}`]: textarea.value });
        }
      });

      console.log('YouTube New Order: Video notes setup');
    }

    // ============================================
    // FEATURE: Timestamp Bookmarks
    // ============================================
    function setupTimestampBookmarks() {
      if (!settings.bookmarks || !isWatchPage()) return;
      if (document.querySelector('.yt-new-order-bookmarks-container')) return;

      const below = document.querySelector('#below') || document.querySelector('#primary #primary-inner');
      if (!below) return;

      const videoId = getVideoId();
      if (!videoId) return;

      const container = document.createElement('div');
      container.className = 'yt-new-order-bookmarks-container';
      container.innerHTML = `
      <div class="yt-new-order-bookmarks-header">
        <h4>🔖 Timestamp Bookmarks</h4>
        <button class="yt-new-order-bookmark-add-btn">+ Add Bookmark</button>
      </div>
      <div class="yt-new-order-bookmarks-list"></div>
    `;

      // Insert after notes if present, otherwise at top
      const notesContainer = below.querySelector('.yt-new-order-notes-container');
      if (notesContainer) {
        notesContainer.after(container);
      } else {
        below.insertBefore(container, below.firstChild);
      }

      const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h > 0
          ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
          : `${m}:${s.toString().padStart(2, '0')}`;
      };

      const renderBookmarks = (bookmarks) => {
        const list = container.querySelector('.yt-new-order-bookmarks-list');
        list.innerHTML = '';
        if (bookmarks.length === 0) {
          list.innerHTML = '<div class="yt-new-order-bookmark-empty">No bookmarks yet. Click "Add Bookmark" to save the current timestamp.</div>';
          return;
        }
        bookmarks.sort((a, b) => a.time - b.time);
        bookmarks.forEach((bm, idx) => {
          const item = document.createElement('div');
          item.className = 'yt-new-order-bookmark-item';
          item.innerHTML = `
          <button class="yt-new-order-bookmark-time">${formatTime(bm.time)}</button>
          <span class="yt-new-order-bookmark-note">${bm.note || 'No note'}</span>
          <button class="yt-new-order-bookmark-delete">✕</button>
        `;
          item.querySelector('.yt-new-order-bookmark-time').addEventListener('click', () => {
            const video = document.querySelector('video');
            if (video) video.currentTime = bm.time;
          });
          item.querySelector('.yt-new-order-bookmark-delete').addEventListener('click', () => {
            bookmarks.splice(idx, 1);
            chrome.storage.local.set({ [`bookmarks_${videoId}`]: bookmarks });
            renderBookmarks(bookmarks);
            showToast('Bookmark removed');
          });
          list.appendChild(item);
        });
      };

      // Load bookmarks
      chrome.storage.local.get([`bookmarks_${videoId}`], (result) => {
        const bookmarks = result[`bookmarks_${videoId}`] || [];
        renderBookmarks(bookmarks);
      });

      // Add bookmark
      container.querySelector('.yt-new-order-bookmark-add-btn').addEventListener('click', () => {
        const video = document.querySelector('video');
        if (!video) return;
        const time = video.currentTime;
        const note = prompt('Add a note for this bookmark (optional):') || '';

        chrome.storage.local.get([`bookmarks_${videoId}`], (result) => {
          const bookmarks = result[`bookmarks_${videoId}`] || [];
          bookmarks.push({ time, note, createdAt: Date.now() });
          chrome.storage.local.set({ [`bookmarks_${videoId}`]: bookmarks });
          renderBookmarks(bookmarks);
          showToast(`Bookmark added at ${formatTime(time)}`);
        });
      });

      console.log('YouTube New Order: Timestamp bookmarks setup');
    }

    // ============================================
    // FEATURE: Enhanced History Search
    // ============================================
    function setupHistorySearch() {
      if (!settings.historySearch) return;
      const isHistoryPage = window.location.pathname === '/feed/history';
      if (!isHistoryPage) return;
      if (document.querySelector('.yt-new-order-history-search')) return;

      const contents = document.querySelector('ytd-browse[page-subtype="history"] #contents, ytd-section-list-renderer #contents');
      if (!contents) return;

      const searchBar = document.createElement('div');
      searchBar.className = 'yt-new-order-history-search';
      searchBar.innerHTML = `
      <div class="yt-new-order-history-search-bar">
        <input type="text" class="yt-new-order-history-input" placeholder="Search your watch history...">
      </div>
      <div class="yt-new-order-history-filters">
        <button class="yt-new-order-history-filter-btn active" data-filter="all">All</button>
        <button class="yt-new-order-history-filter-btn" data-filter="today">Today</button>
        <button class="yt-new-order-history-filter-btn" data-filter="week">This Week</button>
        <button class="yt-new-order-history-filter-btn" data-filter="month">This Month</button>
      </div>
    `;

      contents.parentElement.insertBefore(searchBar, contents);

      const input = searchBar.querySelector('.yt-new-order-history-input');
      input.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        const videos = document.querySelectorAll('ytd-video-renderer, ytd-compact-video-renderer');
        videos.forEach(v => {
          const title = v.querySelector('#video-title')?.textContent?.toLowerCase() || '';
          const channel = v.querySelector('#channel-name')?.textContent?.toLowerCase() || '';
          v.style.display = (title.includes(q) || channel.includes(q) || !q) ? '' : 'none';
        });
      });

      // Filter buttons
      searchBar.querySelectorAll('.yt-new-order-history-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          searchBar.querySelectorAll('.yt-new-order-history-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          showToast(`Filter: ${btn.textContent}`);
        });
      });

      console.log('YouTube New Order: Enhanced history search setup');
    }

    // ============================================
    // Disable All Features (full cleanup)
    // ============================================
    function disableAllFeatures() {
      console.log('YouTube New Order: Disabling all features...');

      // Stop the layout swap observer
      removeLayoutSwap();

      // Remove ALL body classes added by this extension
      document.body.classList.remove(
        'yt-comments-swapped',
        'yt-comments-swapped-left',
        'yt-triple-column-left',
        'yt-triple-column-right',
        'yt-new-order-minimal',
        'yt-new-order-focus',
        'yt-new-order-theater',
        'yt-hide-description',
        'yt-hide-channel-info',
        'yt-hide-merch',
        'yt-hide-endscreen',
        'yt-compact-mode',
        'yt-highlight-comments',
        'yt-hide-shorts',
        'yt-hide-promos',
        'yt-grid-related',
        'yt-custom-font'
      );

      // Remove custom font CSS variable
      document.documentElement.style.removeProperty('--yt-new-order-font');

      // Remove injected UI elements
      const selectorsToRemove = [
        '.yt-new-order-comment-search',
        '.yt-new-order-comment-filters',
        '.yt-new-order-collapse-btn',
        '.yt-new-order-pip-comments',
        '.yt-new-order-screenshot-btn',
        '.yt-new-order-timestamp-btn',
        '.yt-new-order-pip-btn',
        '.yt-new-order-volume-boost-container',
        '.yt-new-order-watch-later-btn',
        '.yt-new-order-playlist-toggle',
        '.yt-new-order-playlist-panel',
        '.yt-new-order-notes-container',
        '.yt-new-order-bookmarks-container',
        '.yt-new-order-history-search',
        '.yt-new-order-resizer',
        '.yt-new-order-toast',
        '.yt-new-order-custom-logo',
        '#yt-new-order-font-link',
        '#yt-new-order-font-style'
      ];

      selectorsToRemove.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
      });

      // Restore navbar logo SVG visibility
      const logoContainer = document.querySelector('ytd-topbar-logo-renderer #logo-icon');
      if (logoContainer) {
        Array.from(logoContainer.children).forEach(child => {
          child.style.display = '';
        });
      }

      // Un-hide any videos that were hidden by content filtering
      document.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, ytd-grid-video-renderer').forEach(el => {
        el.style.removeProperty('display');
      });

      // Un-hide any collapsed sections
      document.querySelectorAll('.yt-new-order-section-collapsed').forEach(el => {
        el.classList.remove('yt-new-order-section-collapsed');
      });

      // Clear feature check interval
      if (featureCheckInterval) {
        clearInterval(featureCheckInterval);
        featureCheckInterval = null;
      }

      console.log('YouTube New Order: All features disabled');
    }

    // ============================================
    // Apply All Features
    // ============================================
    async function applyAllFeatures() {
      console.log('YouTube New Order: Applying all features...');

      // If extension is disabled, clean up everything and stop
      if (!settings.toggleReorder) {
        disableAllFeatures();
        return;
      }

      // Layout
      if (isWatchPage()) {
        const customLayouts = ['swapped', 'swapped_left', 'triple_left', 'triple_right'];
        if (customLayouts.includes(settings.layoutMode)) {
          await applyLayoutSwap();
        } else if (settings.layoutMode === 'minimal') {
          removeLayoutSwap();
          applyMinimalLayout();
        } else if (settings.layoutMode === 'focus') {
          removeLayoutSwap();
          applyFocusLayout();
        } else {
          removeLayoutSwap();
        }
      } else {
        removeLayoutSwap();
      }

      // Visual features
      applyHideElements();
      applyCustomFont();
      applyNavbarLogo();
      applyContentFiltering();
      setupResizableColumns();
      applyGridView();

      // Comment features (with delay to ensure comments are loaded)
      setTimeout(() => {
        if (!settings.toggleReorder) return; // Guard against race if disabled
        addCommentSearch();
        addCommentFilters();
        setupCollapsibleSections();
        setupVideoNotes();
        setupTimestampBookmarks();
      }, 1000);

      // Video player features
      setTimeout(() => {
        if (!settings.toggleReorder) return; // Guard against race if disabled
        addVideoPlayerControls();
        setupVolumeBoost();
        setupVideoPip();
      }, 500);

      // Other features
      setupSkipAds();
      setupKeyboardShortcuts();
      setupAutoloadComments();
      setupPipComments();
      setupPlaylistManager();
      setupHistorySearch();

      // Watch later (also runs on non-watch pages)
      setTimeout(() => {
        if (!settings.toggleReorder) return; // Guard against race if disabled
        setupWatchLater();
      }, 1500);
    }

    // ============================================
    // Navigation Detection
    // ============================================
    function onNavigate() {
      const currentVideoId = getVideoId();

      if (currentVideoId !== lastVideoId) {
        console.log('YouTube New Order: Video changed from', lastVideoId, 'to', currentVideoId);
        lastVideoId = currentVideoId;

        // Reset classes
        removeLayoutSwap();

        // Clear any existing observer
        if (swapObserver) {
          swapObserver.disconnect();
          swapObserver = null;
        }

        // Wait a bit for YouTube to render new content, then apply features
        // Use multiple passes to catch the video player sizing race condition
        setTimeout(applyAllFeatures, 300);
        setTimeout(() => enforceLayout(), 800);
        setTimeout(() => enforceLayout(), 1500);

        // Also set up a watcher to keep applying until stable
        let attempts = 0;
        const maxAttempts = 20;

        const checkAndApply = () => {
          attempts++;
          const customLayouts = ['swapped', 'swapped_left', 'triple_left', 'triple_right'];

          if (isWatchPage() && settings.toggleReorder && customLayouts.includes(settings.layoutMode)) {
            const comments = document.querySelector('#comments');
            const secondary = document.querySelector('#secondary');
            const columns = document.querySelector('#columns');
            const below = document.querySelector('#below');

            // Check if layout classes are missing
            const hasClasses = document.body.classList.contains('yt-comments-swapped') ||
              document.body.classList.contains('yt-comments-swapped-left') ||
              document.body.classList.contains('yt-triple-column-left') ||
              document.body.classList.contains('yt-triple-column-right');

            if (!hasClasses) {
              console.log('YouTube New Order: Layout classes missing, applying full swap...');
              applyLayoutSwap();
              return; // allow applyLayoutSwap to handle it
            }

            let needsEnforcement = false;

            // Check if elements exist
            if (comments && secondary && columns && below) {
              const isTriple = settings.layoutMode.startsWith('triple_');

              // Check comments position (should always be in columns)
              if (comments.parentElement !== columns) {
                needsEnforcement = true;
              }

              // Check secondary position
              if (isTriple) {
                // In triple mode, secondary should be in columns
                if (secondary.parentElement !== columns) {
                  needsEnforcement = true;
                }
              } else {
                // In swapped mode, secondary should be in below
                if (secondary.parentElement !== below) {
                  needsEnforcement = true;
                }
              }

              if (needsEnforcement) {
                console.log('YouTube New Order: Detected layout mismatch, enforcing...');
                // Just enforce DOM positions without tearing down the world
                enforceLayout();
              }
            }
          }

          if (attempts < maxAttempts) {
            setTimeout(checkAndApply, 500);
          }
        };

        checkAndApply();
      }
    }

    // Set up navigation listeners
    function setupNavigationListeners() {
      // YouTube SPA navigation events
      document.addEventListener('yt-navigate-start', () => {
        console.log('YouTube New Order: yt-navigate-start');
        // removeLayoutSwap(); // Don't remove blindly on start, wait for finish
      });

      document.addEventListener('yt-navigate-finish', () => {
        console.log('YouTube New Order: yt-navigate-finish');
        setTimeout(onNavigate, 100);
      });

      document.addEventListener('yt-page-data-updated', () => {
        console.log('YouTube New Order: yt-page-data-updated');
        setTimeout(onNavigate, 100);
      });

      // History API
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      history.pushState = function () {
        originalPushState.apply(this, arguments);
        setTimeout(onNavigate, 100);
      };

      history.replaceState = function () {
        originalReplaceState.apply(this, arguments);
        setTimeout(onNavigate, 100);
      };

      window.addEventListener('popstate', () => {
        setTimeout(onNavigate, 100);
      });

      // Re-apply layout when window resizes (e.g. moving between monitors)
      let resizeTimer = null;
      window.addEventListener('resize', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (settings.toggleReorder && isWatchPage()) {
            console.log('YouTube New Order: Window resized, re-enforcing layout');
            enforceLayout();
          }
        }, 250);
      });

      // Periodic check for content changes
      featureCheckInterval = setInterval(() => {
        // Don't run periodic checks if extension is disabled
        if (!settings.toggleReorder) return;

        if (isWatchPage()) {
          // Re-apply comment features if comments section changed
          const commentsHeader = document.querySelector('#comments #header');
          if (commentsHeader && settings.commentSearch && !document.querySelector('.yt-new-order-comment-search')) {
            addCommentSearch();
          }
          if (commentsHeader && settings.filterComments && !document.querySelector('.yt-new-order-comment-filters')) {
            addCommentFilters();
          }
          if (commentsHeader && settings.collapsibleSections && !commentsHeader.querySelector('.yt-new-order-collapse-btn')) {
            setupCollapsibleSections();
          }

          // Re-apply video controls if player changed
          const rightControls = document.querySelector('.ytp-right-controls');
          if (rightControls) {
            if (settings.screenshot && !document.querySelector('.yt-new-order-screenshot-btn')) {
              addVideoPlayerControls();
            }
            if (settings.volumeBoost && !document.querySelector('.yt-new-order-volume-boost-container')) {
              setupVolumeBoost();
            }
            if (settings.videoPip && !document.querySelector('.yt-new-order-pip-btn')) {
              setupVideoPip();
            }
          }

          // Re-apply productivity features
          if (settings.notesSection && !document.querySelector('.yt-new-order-notes-container')) {
            setupVideoNotes();
          }
          if (settings.bookmarks && !document.querySelector('.yt-new-order-bookmarks-container')) {
            setupTimestampBookmarks();
          }

          // Auto-load comments
          if (settings.autoloadComments) {
            setupAutoloadComments();
          }
        }

        // Always apply content filtering and watch later on homepage/search
        applyContentFiltering();
        if (settings.watchLater) {
          setupWatchLater();
        }
      }, 2000);
    }

    // ============================================
    // Initialization
    // ============================================
    async function init() {
      console.log('YouTube New Order: Initializing...');

      // Load settings
      await loadSettings();

      // Initialize
      lastVideoId = getVideoId();

      // Set up navigation listeners
      setupNavigationListeners();

      // Apply features
      await applyAllFeatures();

      console.log('YouTube New Order: Initialization complete');
    }

    // Start
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }

  })();

} // end of double-injection guard
