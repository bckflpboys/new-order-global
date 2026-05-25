// New Order Global — Tool Detail Page
// Manages code editing, data viewing, and the AI-generated dashboard iframe

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const toolId = urlParams.get('id');
  
  if (!toolId) {
    window.location.href = 'tools.html';
    return;
  }

  const tools = await ToolManager.getInstalledTools();
  let tool = tools.find(t => t.id === toolId || t._id === toolId);
  
  if (!tool) {
    document.getElementById('tool-name').textContent = 'Tool Not Found';
    document.getElementById('tool-desc').textContent = 'This tool could not be found locally.';
    return;
  }

  // If dashboardHTML is missing locally, try fetching from cloud
  if (!tool.dashboardHTML && typeof NewOrderAuth !== 'undefined' && NewOrderAuth.isAuthenticated()) {
    try {
      const cloudTool = await NewOrderAPI.getToolById(toolId);
      if (cloudTool && cloudTool.dashboardHTML) {
        tool.dashboardHTML = cloudTool.dashboardHTML;
        // Persist it locally so we don't need to fetch again
        await ToolManager.installTool({ ...tool, dashboardHTML: cloudTool.dashboardHTML });
      }
    } catch (e) {
      // Non-critical — dashboard may just not exist on cloud yet
    }
  }

  // ============================================
  // Header
  // ============================================
  document.getElementById('tool-name').innerHTML = `
    <span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; background:rgba(184,52,28,0.1); border-radius:10px; margin-right:12px; font-size:20px; vertical-align:middle;">${tool.icon || '🔧'}</span>
    ${escapeHtml(tool.name)}
  `;
  document.getElementById('tool-desc').textContent = tool.description || 'Custom AI Tool running on ' + (tool.targetSites?.join(', ') || 'all sites');

  document.getElementById('btn-edit').addEventListener('click', () => {
    window.location.href = '../builder/builder.html?loadTool=' + tool.id;
  });

  // ============================================
  // Code Editors — Populate
  // ============================================
  const codeJs = document.getElementById('code-js');
  const codeCss = document.getElementById('code-css');
  const codeConfig = document.getElementById('code-config');
  const codeDashboard = document.getElementById('code-dashboard');

  codeJs.value = tool.contentScript || '// No JavaScript';
  codeCss.value = tool.styles || '/* No CSS */';
  codeConfig.value = JSON.stringify(tool.config || {}, null, 2);
  codeDashboard.value = tool.dashboardHTML || '<!-- No dashboard HTML generated -->';

  // Show save button on edit
  const btnSave = document.getElementById('btn-save');
  const markChanged = () => { btnSave.style.display = 'inline-flex'; };
  codeJs.addEventListener('input', markChanged);
  codeCss.addEventListener('input', markChanged);
  codeConfig.addEventListener('input', markChanged);
  codeDashboard.addEventListener('input', markChanged);

  // ============================================
  // Save Logic
  // ============================================
  btnSave.addEventListener('click', async () => {
    try {
      btnSave.textContent = '⏳ Saving...';
      btnSave.disabled = true;

      tool.contentScript = codeJs.value;
      tool.styles = codeCss.value;
      tool.dashboardHTML = codeDashboard.value;

      try {
        tool.config = JSON.parse(codeConfig.value);
      } catch (e) {
        alert('Invalid JSON in Config tab!');
        btnSave.textContent = '💾 Save Changes';
        btnSave.disabled = false;
        return;
      }

      await ToolManager.installTool(tool);

      // Sync to cloud
      if (typeof NewOrderAuth !== 'undefined' && NewOrderAuth.isAuthenticated()) {
        try {
          await window.NewOrderAPI.saveToolToCloud(tool);
        } catch (e) {
          // Non-critical — local save succeeded, cloud sync can retry later
        }
      }

      btnSave.textContent = '✅ Saved!';
      setTimeout(() => {
        btnSave.style.display = 'none';
        btnSave.textContent = '💾 Save Changes';
        btnSave.disabled = false;
      }, 2000);

      // Reload dashboard iframe if dashboard HTML was changed
      loadDashboardIframe();

    } catch (err) {
      console.error('[Tool Detail] Save error:', err.status || 'unknown');
      alert('Failed to save changes. Please try again.');
      btnSave.textContent = '💾 Save Changes';
      btnSave.disabled = false;
    }
  });

  // ============================================
  // Code Tab Switching
  // ============================================
  const codeTabs = {
    'js': codeJs,
    'css': codeCss,
    'config': codeConfig,
    'dashboard': codeDashboard
  };
  const tabBtns = {
    'js': document.getElementById('tab-js'),
    'css': document.getElementById('tab-css'),
    'config': document.getElementById('tab-config'),
    'dashboard': document.getElementById('tab-dashboard')
  };

  function switchCodeTab(active) {
    Object.keys(codeTabs).forEach(key => {
      codeTabs[key].style.display = key === active ? 'block' : 'none';
      tabBtns[key].classList.toggle('active', key === active);
    });
  }

  Object.keys(tabBtns).forEach(key => {
    tabBtns[key].addEventListener('click', () => switchCodeTab(key));
  });

  // ============================================
  // Dashboard Tabs (Dashboard vs Raw Data)
  // ============================================
  const dashTabs = document.querySelectorAll('[data-dash-tab]');
  const viewDashboard = document.getElementById('view-dashboard');
  const viewRaw = document.getElementById('view-raw');

  dashTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      dashTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.dataset.dashTab;
      viewDashboard.style.display = target === 'dashboard' ? 'block' : 'none';
      viewRaw.style.display = target === 'raw' ? 'block' : 'none';
    });
  });

  // ============================================
  // Load Tool Data from chrome.storage
  // ============================================
  let toolData = {};
  let toolDataKeys = [];

  function loadToolData() {
    return new Promise(resolve => {
      chrome.storage.local.get(null, (result) => {
        const prefix = 'toolData_' + tool.id + '_';
        toolData = {};
        toolDataKeys = [];

        Object.keys(result).forEach(key => {
          if (key.startsWith(prefix)) {
            const cleanKey = key.replace(prefix, '');
            toolData[cleanKey] = result[key];
            toolDataKeys.push(cleanKey);
          }
        });
        resolve(toolData);
      });
    });
  }

  // ============================================
  // Render Stats Row
  // ============================================
  function renderStats() {
    const statsEl = document.getElementById('data-stats');
    const keyCount = toolDataKeys.length;
    
    // Count total items across all keys
    let totalItems = 0;
    toolDataKeys.forEach(key => {
      const val = toolData[key];
      if (Array.isArray(val)) totalItems += val.length;
      else if (typeof val === 'object' && val !== null) totalItems += Object.keys(val).length;
      else totalItems += 1;
    });

    // Calculate data size
    const dataStr = JSON.stringify(toolData);
    const sizeBytes = new Blob([dataStr]).size;
    const sizeLabel = sizeBytes > 1024 * 1024 
      ? (sizeBytes / (1024 * 1024)).toFixed(1) + ' MB'
      : sizeBytes > 1024 
        ? (sizeBytes / 1024).toFixed(1) + ' KB' 
        : sizeBytes + ' B';

    if (keyCount === 0) {
      statsEl.innerHTML = '';
      return;
    }

    statsEl.innerHTML = `
      <div class="data-stat">
        <div class="data-stat-value">${keyCount}</div>
        <div class="data-stat-label">Storage Keys</div>
      </div>
      <div class="data-stat">
        <div class="data-stat-value">${totalItems}</div>
        <div class="data-stat-label">Total Entries</div>
      </div>
      <div class="data-stat">
        <div class="data-stat-value">${sizeLabel}</div>
        <div class="data-stat-label">Data Size</div>
      </div>
    `;
  }

  // ============================================
  // Render Raw Data View
  // ============================================
  function renderRawData(filter = '') {
    const container = document.getElementById('data-container');
    
    if (toolDataKeys.length === 0) {
      container.innerHTML = `
        <div class="empty-data">
          <div class="icon">📭</div>
          <p>No data has been saved by this tool yet.<br>
          Run the tool on a page and it will store data here.</p>
        </div>
      `;
      return;
    }

    const filtered = filter 
      ? toolDataKeys.filter(k => k.toLowerCase().includes(filter.toLowerCase()))
      : toolDataKeys;

    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:13px;">No keys match "${escapeHtml(filter)}"</div>`;
      return;
    }

    let html = '';
    filtered.forEach(key => {
      const val = toolData[key];
      const preview = getDataPreview(val);
      const typeBadge = getTypeBadge(val);

      html += `
        <div class="data-key-row" data-key="${escapeHtml(key)}">
          <div class="data-key-name">${escapeHtml(key)}</div>
          <div class="data-key-preview">${escapeHtml(preview)}</div>
          <div class="data-key-actions">
            <span class="data-key-badge">${typeBadge}</span>
            <button class="btn-sm" onclick="viewKeyDetail('${escapeHtml(key)}')">👁️</button>
            <button class="btn-sm danger" onclick="deleteKey('${escapeHtml(key)}')">🗑️</button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function getDataPreview(val) {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'string') return val.length > 80 ? val.substring(0, 80) + '...' : val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return `[${val.length} items]`;
    if (typeof val === 'object') return `{${Object.keys(val).length} keys}`;
    return String(val);
  }

  function getTypeBadge(val) {
    if (val === null || val === undefined) return 'null';
    if (Array.isArray(val)) return `array(${val.length})`;
    if (typeof val === 'object') return `object(${Object.keys(val).length})`;
    return typeof val;
  }

  // Expose to global for inline onclick
  window.viewKeyDetail = function(key) {
    const val = toolData[key];
    const formatted = JSON.stringify(val, null, 2);
    
    // Create a modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:32px;';
    overlay.innerHTML = `
      <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:16px;width:100%;max-width:700px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border-color);">
          <div>
            <div style="font-weight:700;font-size:15px;">${escapeHtml(key)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${getTypeBadge(val)}</div>
          </div>
          <button id="modal-close" style="background:none;border:none;color:var(--text-secondary);font-size:20px;cursor:pointer;">✕</button>
        </div>
        <div style="padding:16px 20px;overflow-y:auto;flex:1;">
          <pre style="font-size:12px;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word;">${escapeHtml(formatted)}</pre>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    overlay.querySelector('#modal-close').addEventListener('click', () => overlay.remove());
  };

  window.deleteKey = async function(key) {
    const prefix = 'toolData_' + tool.id + '_';
    const storageKey = prefix + key;
    
    // Inline confirmation
    const confirmed = confirm(`Delete key "${key}"?`);
    if (!confirmed) return;
    
    await new Promise(resolve => chrome.storage.local.remove([storageKey], resolve));
    
    // Refresh
    await loadToolData();
    renderStats();
    renderRawData(document.getElementById('data-search').value);
    sendDataToIframe();
  };

  // ============================================
  // Search Filter
  // ============================================
  document.getElementById('data-search').addEventListener('input', (e) => {
    renderRawData(e.target.value);
  });

  // ============================================
  // Export Buttons
  // ============================================
  document.getElementById('btn-download-json').addEventListener('click', () => {
    downloadFile(
      JSON.stringify(toolData, null, 2),
      tool.name.replace(/\s+/g, '_').toLowerCase() + '_data.json',
      'application/json'
    );
  });

  document.getElementById('btn-download-csv').addEventListener('click', () => {
    const csv = convertToCSV(toolData);
    downloadFile(
      csv,
      tool.name.replace(/\s+/g, '_').toLowerCase() + '_data.csv',
      'text/csv'
    );
  });

  document.getElementById('btn-clear-data').addEventListener('click', async () => {
    if (!confirm(`Clear ALL data for "${tool.name}"? This cannot be undone.`)) return;

    const prefix = 'toolData_' + tool.id + '_';
    const allKeys = toolDataKeys.map(k => prefix + k);
    
    if (allKeys.length > 0) {
      await new Promise(resolve => chrome.storage.local.remove(allKeys, resolve));
    }

    await loadToolData();
    renderStats();
    renderRawData();
    sendDataToIframe();
  });

  // ============================================
  // Dashboard Iframe — Load & Bridge
  // ============================================
  let dashboardIframe = null;
  let dashboardBlobUrl = null;

  function loadDashboardIframe() {
    const container = document.getElementById('view-dashboard');
    const noMsg = document.getElementById('no-dashboard-msg');
    
    // Remove existing iframe and clean up blob URL
    if (dashboardIframe) {
      dashboardIframe.remove();
      dashboardIframe = null;
    }
    if (dashboardBlobUrl) {
      URL.revokeObjectURL(dashboardBlobUrl);
      dashboardBlobUrl = null;
    }

    const dashHTML = tool.dashboardHTML || codeDashboard.value;

    if (!dashHTML || dashHTML.trim().length < 30 || dashHTML.includes('No dashboard HTML')) {
      // No dashboard available
      if (noMsg) noMsg.style.display = 'block';
      return;
    }

    if (noMsg) noMsg.style.display = 'none';

    // Inject initial data directly into the dashboard HTML so it's available immediately.
    // This avoids the postMessage race condition where iframe JS isn't ready yet.
    //
    // We use a Blob URL instead of srcdoc because Chrome extension pages
    // enforce a strict Content Security Policy that silently blocks inline
    // <script> tags in srcdoc iframes. Blob URLs are treated as same-origin
    // with the extension, so inline scripts execute normally.
    const dataPayload = JSON.stringify({
      type: 'toolData',
      data: toolData,
      toolName: tool.name,
      toolId: tool.id
    });

    // Safely escape closing script tags inside JSON payload
    const safePayload = dataPayload.replace(/<\/script/gi, '<\\/script');

    const dataInjectionScript = `<script>
      window.__noInitialData = ${safePayload};
      window.__noDataReceived = false;
      window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'toolData') {
          window.__noDataReceived = true;
        }
      });
      // Dispatch the injected data so existing listeners pick it up
      function __noDispatchData() {
        if (window.__noDataReceived || !window.__noInitialData) return;
        try {
          window.postMessage(window.__noInitialData, '*');
        } catch(e) {}
      }
      // Fire at multiple points to catch listeners registered at different times
      document.addEventListener('DOMContentLoaded', function() {
        setTimeout(__noDispatchData, 0);
        setTimeout(__noDispatchData, 100);
        setTimeout(__noDispatchData, 300);
      });
      window.addEventListener('load', function() {
        setTimeout(__noDispatchData, 0);
        setTimeout(__noDispatchData, 200);
        setTimeout(__noDispatchData, 500);
        setTimeout(__noDispatchData, 1000);
      });
    <\/script>`;

    // Insert the data injection script right before </head> or at the start
    let modifiedHTML = dashHTML;
    if (modifiedHTML.includes('</head>')) {
      modifiedHTML = modifiedHTML.replace('</head>', dataInjectionScript + '</head>');
    } else if (modifiedHTML.includes('<body')) {
      modifiedHTML = modifiedHTML.replace('<body', dataInjectionScript + '<body');
    } else {
      modifiedHTML = dataInjectionScript + modifiedHTML;
    }

    // Create a Blob URL from the dashboard HTML.
    // Unlike srcdoc, Blob URLs bypass the Chrome extension CSP restriction
    // that blocks inline scripts, allowing all dashboard JS to execute.
    dashboardBlobUrl = URL.createObjectURL(new Blob([modifiedHTML], { type: 'text/html' }));

    dashboardIframe = document.createElement('iframe');
    dashboardIframe.style.cssText = 'width:100%;min-height:520px;border:none;display:block;border-radius:0 0 10px 10px;';
    dashboardIframe.src = dashboardBlobUrl;

    container.appendChild(dashboardIframe);

    // Also send data via postMessage after load as a secondary mechanism
    dashboardIframe.addEventListener('load', () => {
      // Send multiple times with delays to handle race conditions
      sendDataToIframe();
      setTimeout(() => sendDataToIframe(), 200);
      setTimeout(() => sendDataToIframe(), 600);
      setTimeout(() => sendDataToIframe(), 1200);
    });
  }

  function sendDataToIframe() {
    if (!dashboardIframe || !dashboardIframe.contentWindow) return;
    
    try {
      // Use '*' for targetOrigin since blob: URLs have opaque origins
      dashboardIframe.contentWindow.postMessage({
        type: 'toolData',
        data: toolData,
        toolName: tool.name,
        toolId: tool.id
      }, '*');
    } catch (e) {
      console.log('postMessage to dashboard iframe failed:', e);
    }
  }

  // ============================================
  // Listen for messages from the dashboard iframe
  // ============================================
  window.addEventListener('message', async (event) => {
    // Accept messages from our dashboard iframe
    // Use relaxed check: if we have a dashboardIframe, accept messages that look like dashboard commands
    if (!dashboardIframe) return;
    
    // Try to match event.source, but also accept blob: origins and null origins
    // (blob: URLs from our dashboard, or srcdoc fallback)
    const isFromIframe = (event.source === dashboardIframe.contentWindow) || 
                         (event.source === null) ||
                         (event.origin === 'null') ||
                         (event.origin === '') ||
                         (event.origin && event.origin.startsWith('blob:'));
    if (!isFromIframe) return;

    const msg = event.data;
    if (!msg || !msg.type) return;

    // Only handle known dashboard message types
    const knownTypes = ['requestData', 'exportData', 'clearData', 'updateData', 'deleteData'];
    if (!knownTypes.includes(msg.type)) return;

    const prefix = 'toolData_' + tool.id + '_';

    switch (msg.type) {
      case 'requestData':
        // Dashboard is requesting fresh data
        sendDataToIframe();
        break;

      case 'exportData': {
        const format = msg.format || 'json';
        const filename = tool.name.replace(/\s+/g, '_').toLowerCase() + '_data';
        if (format === 'csv') {
          downloadFile(convertToCSV(toolData), filename + '.csv', 'text/csv');
        } else {
          downloadFile(JSON.stringify(toolData, null, 2), filename + '.json', 'application/json');
        }
        break;
      }

      case 'clearData': {
        const allKeys = toolDataKeys.map(k => prefix + k);
        if (allKeys.length > 0) {
          await new Promise(resolve => chrome.storage.local.remove(allKeys, resolve));
        }
        await loadToolData();
        renderStats();
        renderRawData(document.getElementById('data-search').value);
        sendDataToIframe();
        break;
      }

      case 'updateData': {
        if (msg.key) {
          const storageKey = prefix + msg.key;
          await new Promise(resolve => chrome.storage.local.set({ [storageKey]: msg.value }, resolve));
          await loadToolData();
          renderStats();
          renderRawData(document.getElementById('data-search').value);
        }
        break;
      }

      case 'deleteData': {
        if (msg.key) {
          const storageKey = prefix + msg.key;
          await new Promise(resolve => chrome.storage.local.remove([storageKey], resolve));
          await loadToolData();
          renderStats();
          renderRawData(document.getElementById('data-search').value);
          sendDataToIframe();
        }
        break;
      }
    }
  });

  // ============================================
  // Utility Functions
  // ============================================
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function convertToCSV(data) {
    // Try to find the most "tabular" data key
    let bestKey = null;
    let bestArray = null;

    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key]) && data[key].length > 0 && typeof data[key][0] === 'object') {
        if (!bestArray || data[key].length > bestArray.length) {
          bestKey = key;
          bestArray = data[key];
        }
      }
    }

    if (bestArray && bestArray.length > 0) {
      // Use the array of objects as CSV rows
      const headers = Object.keys(bestArray[0]);
      const rows = [headers.join(',')];
      bestArray.forEach(item => {
        const row = headers.map(h => {
          let val = item[h];
          if (val === null || val === undefined) val = '';
          val = String(val).replace(/"/g, '""');
          return `"${val}"`;
        });
        rows.push(row.join(','));
      });
      return rows.join('\n');
    }

    // Fallback: key-value pairs
    const rows = ['key,value'];
    Object.keys(data).forEach(key => {
      const val = typeof data[key] === 'object' ? JSON.stringify(data[key]) : String(data[key]);
      rows.push(`"${key}","${val.replace(/"/g, '""')}"`);
    });
    return rows.join('\n');
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================
  // Initialize Everything
  // ============================================
  await loadToolData();
  renderStats();
  renderRawData();
  loadDashboardIframe();
});
