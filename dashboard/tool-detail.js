document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const toolId = urlParams.get('id');
  
  if (!toolId) {
    window.location.href = 'tools.html';
    return;
  }

  const tools = await ToolManager.getInstalledTools();
  const tool = tools.find(t => t.id === toolId);
  
  if (!tool) {
    document.getElementById('tool-name').textContent = 'Tool Not Found';
    document.getElementById('tool-desc').textContent = 'This tool could not be found locally.';
    return;
  }

  document.getElementById('tool-name').innerHTML = `
    <span style="display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; background:rgba(124,92,252,0.1); border-radius:8px; margin-right:12px; color:var(--accent-primary); vertical-align: middle;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
    </span>
    ${tool.name}
  `;
  document.getElementById('tool-desc').textContent = tool.description || 'Custom AI Tool running on ' + (tool.targetSites?.join(', ') || 'all sites');

  document.getElementById('btn-edit').addEventListener('click', () => {
    window.location.href = '../builder/builder.html?loadTool=' + tool.id;
  });

  // Populate Code
  document.getElementById('code-js').textContent = tool.contentScript || '// No JavaScript';
  document.getElementById('code-css').textContent = tool.styles || '/* No CSS */';
  document.getElementById('code-config').textContent = JSON.stringify(tool.config || {}, null, 2);

  // Tab switching logic
  const tabs = {
    'js': document.getElementById('code-js'),
    'css': document.getElementById('code-css'),
    'config': document.getElementById('code-config')
  };
  const btns = {
    'js': document.getElementById('tab-js'),
    'css': document.getElementById('tab-css'),
    'config': document.getElementById('tab-config')
  };

  function switchTab(active) {
    Object.keys(tabs).forEach(key => {
      tabs[key].style.display = key === active ? 'block' : 'none';
      btns[key].style.background = key === active ? 'var(--accent-primary)' : 'transparent';
      btns[key].style.color = key === active ? 'white' : 'var(--text-secondary)';
    });
  }

  btns['js'].addEventListener('click', () => switchTab('js'));
  btns['css'].addEventListener('click', () => switchTab('css'));
  btns['config'].addEventListener('click', () => switchTab('config'));

  // Load tool data
  chrome.storage.local.get(null, (result) => {
    const prefix = 'toolData_' + tool.id + '_';
    const data = {};
    let hasData = false;
    
    Object.keys(result).forEach(key => {
      if (key.startsWith(prefix)) {
        data[key.replace(prefix, '')] = result[key];
        hasData = true;
      }
    });

    const dataContainer = document.getElementById('data-container');
    if (hasData) {
      document.getElementById('btn-download').style.display = 'block';
      document.getElementById('btn-download').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = tool.name.replace(/\s+/g, '_').toLowerCase() + '_data.json';
        a.click();
        URL.revokeObjectURL(url);
      });
      
      dataContainer.innerHTML = '<pre style="font-size: 12px; color: var(--text-secondary);">' + JSON.stringify(data, null, 2) + '</pre>';
    } else {
      dataContainer.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">No data has been saved by this tool yet.</span>';
    }
  });
});
