document.addEventListener('DOMContentLoaded', async () => {
  const tools = await ToolManager.getInstalledTools();
  const container = document.getElementById('tools-container');
  
  if (!tools || tools.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">No tools created yet. Go to the AI Builder to make one!</div>';
    return;
  }

  container.innerHTML = '';
  tools.forEach(tool => {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `
      <div class="tool-card-header">
        <div class="tool-icon">${tool.icon || '🔧'}</div>
        <div>
          <div class="tool-title">${tool.name}</div>
          <div style="font-size: 11px; color: var(--success); margin-top: 4px;">Active</div>
        </div>
      </div>
      <div class="tool-desc">${tool.description || 'Custom AI Tool'}</div>
    `;
    card.addEventListener('click', () => {
      window.location.href = 'tool-detail.html?id=' + tool.id;
    });
    container.appendChild(card);
  });
});
