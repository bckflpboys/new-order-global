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

  document.getElementById('tool-name').textContent = tool.icon + ' ' + tool.name;
  document.getElementById('tool-desc').textContent = tool.description || 'Custom AI Tool running on ' + (tool.targetSites?.join(', ') || 'all sites');

  document.getElementById('btn-edit').addEventListener('click', () => {
    window.location.href = '../builder/builder.html?loadTool=' + tool.id;
  });

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
