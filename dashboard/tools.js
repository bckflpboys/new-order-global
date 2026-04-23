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
        <div class="tool-icon" style="background: rgba(124,92,252,0.1); color: var(--accent-primary);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        </div>
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
