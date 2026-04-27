document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('tools-container');
  const loadingOverlay = document.getElementById('initial-loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingSubtext = document.getElementById('loading-subtext');

  function updateLoading(status, sub) {
    if (loadingStatus) loadingStatus.textContent = status;
    if (loadingSubtext) loadingSubtext.textContent = sub;
  }

  try {
    updateLoading('Authenticating', 'Checking session...');
    await NewOrderAuth.init();
    
    let stats;
    if (NewOrderAuth.isAuthenticated()) {
      updateLoading('Syncing Tools', 'Fetching your AI arsenal...');
      stats = await ToolManager.syncTools();
    } else {
      updateLoading('Loading Tools', 'Accessing local storage...');
      stats = await ToolManager.getStats();
    }

    const tools = stats.tools || [];
    
    if (tools.length === 0) {
      container.innerHTML = '<div style="color: var(--on-surface-variant); padding: 48px; text-align: center;">No tools created yet. Go to the AI Builder to make one!</div>';
      return;
    }

    container.innerHTML = '';
  tools.forEach(tool => {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `
      <div class="tool-card-header">
        <div class="tool-icon" style="background: rgba(184, 52, 28, 0.08); color: var(--primary);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        </div>
        <div>
          <div class="tool-title">${tool.name}</div>
          <div style="font-size: 11px; color: var(--tertiary); margin-top: 4px;">Active</div>
        </div>
      </div>
      <div class="tool-desc">${tool.description || 'Custom AI Tool'}</div>
    `;
    card.addEventListener('click', () => {
      window.location.href = 'tool-detail.html?id=' + (tool.id || tool._id);
    });
    container.appendChild(card);
  });
  } catch (err) {
    console.error('Tools: Error loading tools:', err);
    container.innerHTML = '<div style="padding: 48px; text-align: center; color: var(--danger);">Error loading tools. Please check your connection.</div>';
  } finally {
    setTimeout(() => {
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }, 800);
  }
});
