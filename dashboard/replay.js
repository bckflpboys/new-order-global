// Global Executive — Action Replay / Debug Playback
// List of past agent tasks, with click-through to a step-by-step replay.

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const taskId = params.get('taskId');

  // ============================================
  // Helpers
  // ============================================
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function fmtRelative(d) {
    if (!d) return '—';
    const diff = (Date.now() - new Date(d).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
    return fmtDate(d);
  }
  function statusPill(status) {
    return `<span class="status-pill status-${escapeHtml(status || 'unknown')}">${escapeHtml(status || 'unknown')}</span>`;
  }
  function prettyJson(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v, null, 2); }
    catch { return String(v); }
  }

  // ============================================
  // LIST VIEW
  // ============================================
  async function loadTaskList() {
    const container = document.getElementById('tasks-container');
    try {
      const data = await NewOrderAPI.request('/api/agent/tasks');
      const tasks = data.tasks || [];

      if (!tasks.length) {
        container.innerHTML = `
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <h3>No tasks yet</h3>
            <p>Run an agent task from the Global Executive panel and it'll show up here for replay.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = '';
      tasks.forEach(t => {
        const row = document.createElement('div');
        row.className = 'task-row';
        row.innerHTML = `
          <div style="min-width: 0;">
            <div class="title">${escapeHtml(t.title || 'Untitled task')}</div>
            ${t.summary ? `<div class="summary">${escapeHtml(t.summary)}</div>` : ''}
          </div>
          <div>${statusPill(t.status)}</div>
          <div class="meta">${t.steps || 0}</div>
          <div class="meta">${(t.creditsUsed || 0).toFixed(3)}</div>
          <div class="meta" title="${escapeHtml(fmtDate(t.createdAt))}">${escapeHtml(fmtRelative(t.createdAt))}</div>
          <div style="text-align: right;"><button class="btn-secondary" style="font-size: 12px; padding: 6px 12px;">Replay →</button></div>
        `;
        row.addEventListener('click', () => {
          location.href = `replay.html?taskId=${encodeURIComponent(t.id)}`;
        });
        container.appendChild(row);
      });
    } catch (err) {
      console.error('Failed to load tasks:', err);
      container.innerHTML = `<div class="empty-state"><h3>Couldn't load tasks</h3><p>${escapeHtml(err.message || 'Unknown error')}</p></div>`;
    }
  }

  // ============================================
  // DETAIL / REPLAY VIEW
  // ============================================
  let _task = null;
  let _activeIdx = -1;       // -1 = nothing highlighted yet
  let _playing = false;
  let _playTimer = null;
  let _playSpeedMs = 1200;

  async function loadTaskDetail(id) {
    const root = document.getElementById('detail-content');
    try {
      const data = await NewOrderAPI.request(`/api/agent/tasks/${encodeURIComponent(id)}`);
      _task = data.task;
      renderDetail();
    } catch (err) {
      console.error('Failed to load task:', err);
      root.innerHTML = `<div class="empty-state"><h3>Couldn't load task</h3><p>${escapeHtml(err.message || 'Unknown error')}</p></div>`;
    }
  }

  function renderDetail() {
    const t = _task;
    const root = document.getElementById('detail-content');
    const steps = t.steps || [];

    const planSection = (t.plan && (t.plan.goal || (t.plan.steps && t.plan.steps.length))) ? `
      <div class="card" style="margin-bottom: 20px;">
        <h3 style="font-family: var(--font-headline); font-size: 16px; font-weight: 600; margin-bottom: 12px;">Pre-task Plan</h3>
        ${t.plan.goal ? `<p style="font-size: 13px; color: var(--on-surface-variant); margin-bottom: 10px;"><strong style="color: var(--on-surface);">Goal:</strong> ${escapeHtml(t.plan.goal)}</p>` : ''}
        ${t.plan.summary ? `<p style="font-size: 13px; color: var(--on-surface-variant); margin-bottom: 10px;">${escapeHtml(t.plan.summary)}</p>` : ''}
        ${(t.plan.steps && t.plan.steps.length) ? `
          <ol style="margin: 8px 0 0 20px; padding: 0; font-size: 13px; color: var(--on-surface-variant); line-height: 1.6;">
            ${t.plan.steps.map(s => `<li>${escapeHtml(s.description || '')} <span style="font-size: 10px; color: var(--on-surface-muted); text-transform: uppercase; margin-left: 6px;">${escapeHtml(s.risk || '')}</span></li>`).join('')}
          </ol>
        ` : ''}
      </div>
    ` : '';

    const storedHasData = t.storedData && Object.keys(t.storedData).filter(k => k !== '_subAgents').length > 0;
    const storedSection = storedHasData ? `
      <details class="card" style="margin-bottom: 20px;">
        <summary style="cursor: pointer; font-family: var(--font-headline); font-size: 16px; font-weight: 600;">Stored Data <span style="font-size: 12px; color: var(--on-surface-muted); font-weight: 400;">(${Object.keys(t.storedData).length} keys)</span></summary>
        <pre style="margin-top: 12px; background: var(--surface-container); border: 1px solid var(--ghost-border); border-radius: 6px; padding: 12px; font-family: ui-monospace, monospace; font-size: 12px; max-height: 300px; overflow: auto;">${escapeHtml(prettyJson(t.storedData))}</pre>
      </details>
    ` : '';

    const tabsSection = (t.trackedTabs && t.trackedTabs.length) ? `
      <div class="card" style="margin-bottom: 20px;">
        <h3 style="font-family: var(--font-headline); font-size: 16px; font-weight: 600; margin-bottom: 12px;">Tracked Tabs <span style="font-size: 12px; color: var(--on-surface-muted); font-weight: 400;">(${t.trackedTabs.length})</span></h3>
        ${t.trackedTabs.map((tab, i) => `
          <div style="padding: 8px 0; border-bottom: 1px solid var(--ghost-border); font-size: 13px;">
            <strong style="color: var(--primary);">[${i}]</strong> ${escapeHtml(tab.title || tab.url || '(blank)')}
            <span class="status-pill status-${escapeHtml(tab.status)}" style="margin-left: 8px;">${escapeHtml(tab.status)}</span>
            <div style="font-size: 11px; color: var(--on-surface-muted); margin-top: 2px; word-break: break-all;">${escapeHtml(tab.url || '')}</div>
          </div>
        `).join('')}
      </div>
    ` : '';

    root.innerHTML = `
      <div class="replay-header">
        <div style="flex: 1; min-width: 280px;">
          <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;">
            <h1 style="font-family: var(--font-headline); font-size: 26px; font-weight: 600; color: var(--on-surface); margin: 0;">${escapeHtml(t.title || 'Untitled task')}</h1>
            ${statusPill(t.status)}
          </div>
          <p style="font-family: var(--font-body); font-size: 14px; color: var(--on-surface-variant); margin: 0 0 12px;">${escapeHtml(t.originalPrompt || '')}</p>
          ${t.summary ? `<p style="font-family: var(--font-body); font-size: 13px; color: var(--on-surface-muted); margin: 0; padding: 10px 12px; background: var(--surface-container-low); border-left: 3px solid var(--primary); border-radius: 4px;"><strong>Summary:</strong> ${escapeHtml(t.summary)}</p>` : ''}
          ${t.errorMessage ? `<p style="color: var(--error); font-size: 13px; margin-top: 8px;"><strong>Error:</strong> ${escapeHtml(t.errorMessage)}</p>` : ''}
          ${steps.length ? `
            <div style="margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap;">
              <button id="btn-browser-replay" class="btn-primary" style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; padding: 8px 14px;" title="Re-run the browser steps in a new window so you can watch the actions happen again. No LLM calls, no credits.">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polygon points="10 8 16 11 10 14 10 8" fill="currentColor"/></svg>
                Browser Replay
              </button>
              <span style="font-size: 11px; color: var(--on-surface-muted); align-self: center;">Re-executes the recorded steps in a fresh window. Pages may have changed since the original run.</span>
            </div>
          ` : ''}
        </div>
        <div class="replay-meta-grid">
          <div><div class="label">Mode</div><div class="value">${escapeHtml(t.mode || '—')}</div></div>
          <div><div class="label">Steps</div><div class="value">${steps.length} / ${t.maxSteps || 0}</div></div>
          <div><div class="label">Credits</div><div class="value">${(t.totalCreditsUsed || 0).toFixed(3)}</div></div>
          <div><div class="label">Model</div><div class="value">${escapeHtml(t.modelUsed || '—')}</div></div>
          <div><div class="label">Started</div><div class="value">${escapeHtml(fmtDate(t.createdAt))}</div></div>
          <div><div class="label">Updated</div><div class="value">${escapeHtml(fmtDate(t.updatedAt))}</div></div>
        </div>
      </div>

      ${planSection}
      ${tabsSection}
      ${storedSection}

      ${steps.length ? `
        <div class="playback-bar">
          <button id="btn-prev" title="Previous step (←)">⏮ Prev</button>
          <button id="btn-play" class="primary" title="Play / pause (Space)">▶ Play</button>
          <button id="btn-next" title="Next step (→)">Next ⏭</button>
          <button id="btn-restart" title="Restart">↺</button>
          <div class="playback-progress"><div id="progress-fill" class="playback-progress-fill"></div></div>
          <div class="playback-step-counter" id="step-counter">— / ${steps.length}</div>
          <div class="playback-speed">
            Speed
            <select id="speed-select">
              <option value="2400">0.5×</option>
              <option value="1200" selected>1×</option>
              <option value="600">2×</option>
              <option value="300">4×</option>
            </select>
          </div>
        </div>

        <h3 style="font-family: var(--font-headline); font-size: 18px; font-weight: 600; color: var(--on-surface); margin: 24px 0 14px;">Step Timeline</h3>
        <div id="steps-list"></div>
      ` : `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <h3>No steps recorded</h3>
          <p>This task didn't execute any actions.</p>
        </div>
      `}
    `;

    if (steps.length) {
      renderSteps();
      attachControls();
    }
  }

  function renderSteps() {
    const container = document.getElementById('steps-list');
    if (!container) return;
    const steps = _task.steps || [];
    container.innerHTML = '';
    steps.forEach((s, i) => {
      const card = document.createElement('div');
      card.className = 'step-card';
      card.dataset.idx = String(i);
      card.id = `step-${i}`;
      card.innerHTML = renderStepInner(s);
      card.addEventListener('click', () => setActive(i, false));
      container.appendChild(card);
    });
    updateActiveStyles();
  }

  function renderStepInner(s) {
    const params = (s.params && Object.keys(s.params).length) ? prettyJson(s.params) : '';
    const result = s.result !== null && s.result !== undefined && s.result !== '' ? prettyJson(s.result) : '';
    const error = s.error || '';

    const meta = [];
    if (s.model) meta.push(`<span><strong>Model:</strong> ${escapeHtml(s.model)}</span>`);
    if (typeof s.creditsUsed === 'number') meta.push(`<span><strong>Credits:</strong> ${s.creditsUsed.toFixed(4)}</span>`);
    if (s.inputTokens) meta.push(`<span><strong>In:</strong> ${s.inputTokens}t</span>`);
    if (s.outputTokens) meta.push(`<span><strong>Out:</strong> ${s.outputTokens}t</span>`);
    if (s.duration) meta.push(`<span><strong>Duration:</strong> ${s.duration}ms</span>`);
    if (s.timestamp) meta.push(`<span><strong>At:</strong> ${escapeHtml(fmtDate(s.timestamp))}</span>`);

    return `
      <div class="step-num">${s.stepNumber || ''}</div>
      <div class="step-body">
        <div class="step-head">
          <span class="action-badge">${escapeHtml(s.action || '?')}</span>
          ${statusPill(s.status)}
          ${s.expectation ? `<span style="font-size: 11px; color: var(--on-surface-muted);">→ ${escapeHtml(s.expectation)}</span>` : ''}
        </div>
        ${s.thought ? `<div class="step-thought">${escapeHtml(s.thought)}</div>` : ''}
        ${params ? `<div class="step-section"><div class="lbl">Parameters</div><pre>${escapeHtml(params)}</pre></div>` : ''}
        ${result ? `<div class="step-section"><div class="lbl">Result</div><pre>${escapeHtml(result)}</pre></div>` : ''}
        ${error ? `<div class="step-section error"><div class="lbl">Error</div><pre>${escapeHtml(error)}</pre></div>` : ''}
        ${meta.length ? `<div class="step-meta">${meta.join('')}</div>` : ''}
      </div>
    `;
  }

  function updateActiveStyles() {
    const cards = document.querySelectorAll('.step-card');
    const total = (_task.steps || []).length;
    cards.forEach((c, i) => {
      c.classList.toggle('active', i === _activeIdx);
      c.classList.toggle('dim', _activeIdx >= 0 && i > _activeIdx);
    });
    const fill = document.getElementById('progress-fill');
    const counter = document.getElementById('step-counter');
    if (fill) fill.style.width = (_activeIdx < 0 ? 0 : ((_activeIdx + 1) / total) * 100) + '%';
    if (counter) counter.textContent = (_activeIdx < 0 ? '—' : (_activeIdx + 1)) + ' / ' + total;
    const playBtn = document.getElementById('btn-play');
    if (playBtn) playBtn.textContent = _playing ? '⏸ Pause' : '▶ Play';
  }

  function setActive(i, scroll) {
    const total = (_task.steps || []).length;
    _activeIdx = Math.max(-1, Math.min(total - 1, i));
    updateActiveStyles();
    if (scroll) {
      const el = document.getElementById('step-' + _activeIdx);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function play() {
    const total = (_task.steps || []).length;
    if (_activeIdx >= total - 1) _activeIdx = -1; // restart from top
    _playing = true;
    updateActiveStyles();
    clearTimeout(_playTimer);
    const tick = () => {
      if (!_playing) return;
      if (_activeIdx >= total - 1) { _playing = false; updateActiveStyles(); return; }
      setActive(_activeIdx + 1, true);
      _playTimer = setTimeout(tick, _playSpeedMs);
    };
    _playTimer = setTimeout(tick, 200);
  }

  function pause() {
    _playing = false;
    clearTimeout(_playTimer);
    updateActiveStyles();
  }

  function attachControls() {
    document.getElementById('btn-browser-replay')?.addEventListener('click', () => {
      if (!_task || !_task.steps || !_task.steps.length) return;
      if (window.BrowserReplay && typeof window.BrowserReplay.start === 'function') {
        window.BrowserReplay.start(_task);
      } else {
        alert('Browser Replay module failed to load.');
      }
    });
    document.getElementById('btn-prev')?.addEventListener('click', () => { pause(); setActive(_activeIdx - 1, true); });
    document.getElementById('btn-next')?.addEventListener('click', () => { pause(); setActive(_activeIdx + 1, true); });
    document.getElementById('btn-restart')?.addEventListener('click', () => { pause(); setActive(-1, false); });
    document.getElementById('btn-play')?.addEventListener('click', () => { _playing ? pause() : play(); });
    document.getElementById('speed-select')?.addEventListener('change', e => {
      _playSpeedMs = parseInt(e.target.value, 10) || 1200;
    });
    document.addEventListener('keydown', (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') { pause(); setActive(_activeIdx - 1, true); }
      else if (e.key === 'ArrowRight') { pause(); setActive(_activeIdx + 1, true); }
      else if (e.key === ' ') { e.preventDefault(); _playing ? pause() : play(); }
    });
  }

  // ============================================
  // Boot
  // ============================================
  document.addEventListener('DOMContentLoaded', () => {
    if (taskId) {
      document.getElementById('list-view').style.display = 'none';
      document.getElementById('detail-view').style.display = 'block';
      loadTaskDetail(taskId);
    } else {
      loadTaskList();
    }
  });
})();
