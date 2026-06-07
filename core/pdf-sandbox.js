// New Order Global — PDF Sandbox
// Renders a live PDF-filling preview in the agent's step-log chat view.
// Appears as a card in the thread showing:
//   - Document title + page count
//   - A live progress bar as fields are filled
//   - Field-by-field animation with ✓ / ⏳ / ✗ indicators
//   - An inline embed of the final PDF once editing is done
//   - A download button
//
// Usage:
//   const sandbox = PdfSandbox.create(stepEntry, { filename, pageCount, fields });
//   sandbox.setFieldStatus('Field Name', 'filling' | 'done' | 'skipped');
//   sandbox.setProgress(filled, total);
//   sandbox.showResult(pdfBytes, filename);
//   sandbox.setError(message);

const PdfSandbox = (() => {
  'use strict';

  /**
   * Create a new sandbox card and append it to `container`.
   *
   * @param {HTMLElement} container   - The step-entry .step-body element to append to.
   * @param {Object}      opts
   *   @param {string}    opts.filename
   *   @param {number}    opts.pageCount
   *   @param {Array}     opts.fields      - [{ name, type }] list of AcroForm fields
   *   @param {string}    [opts.docType]   - 'pdf' | 'xlsx' | 'docx' (default 'pdf')
   */
  function create(container, opts = {}) {
    const {
      filename    = 'document.pdf',
      pageCount   = 1,
      fields      = [],
      docType     = 'pdf'
    } = opts;

    // ---- Build DOM ----
    const card = document.createElement('div');
    card.className = 'pdf-sandbox-card';
    card.setAttribute('data-doc-type', docType);

    const icon = docType === 'xlsx' ? '📊' : docType === 'docx' ? '📝' : '📄';

    card.innerHTML = `
      <div class="psb-header">
        <span class="psb-icon">${icon}</span>
        <div class="psb-title-block">
          <div class="psb-filename" title="${escHtml(filename)}">${escHtml(truncate(filename, 46))}</div>
          <div class="psb-meta">${pageCount} page${pageCount !== 1 ? 's' : ''} · ${fields.length} field${fields.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="psb-status-badge psb-badge-working">
          <span class="psb-spinner"></span>
          <span class="psb-badge-text">Reading…</span>
        </div>
      </div>

      <div class="psb-progress-wrap" style="${fields.length === 0 ? 'display:none' : ''}">
        <div class="psb-progress-bar"><div class="psb-progress-fill" style="width:0%"></div></div>
        <div class="psb-progress-label">0 / ${fields.length} fields filled</div>
      </div>

      <div class="psb-fields" style="${fields.length === 0 ? 'display:none' : ''}">
        ${fields.slice(0, 20).map(f => `
          <div class="psb-field" data-field-name="${escHtml(f.name)}">
            <span class="psb-field-icon psb-pending">◦</span>
            <span class="psb-field-name">${escHtml(truncate(f.name, 36))}</span>
            <span class="psb-field-value"></span>
          </div>
        `).join('')}
        ${fields.length > 20 ? `<div class="psb-field psb-more-fields">… and ${fields.length - 20} more</div>` : ''}
      </div>

      <div class="psb-result" style="display:none">
        <div class="psb-embed-wrap">
          <embed class="psb-pdf-embed" type="application/pdf" src="" />
        </div>
        <div class="psb-actions">
          <button class="psb-btn psb-btn-download">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download ${escHtml(filename)}
          </button>
        </div>
      </div>

      <div class="psb-error" style="display:none"></div>
    `;

    container.appendChild(card);

    // ---- State ----
    let _pdfBytes     = null;
    let _filename     = filename;
    let _filledCount  = 0;
    let _totalFields  = fields.length;
    let _objectUrl    = null;

    // ---- Internals ----
    const badge      = card.querySelector('.psb-status-badge');
    const badgeText  = card.querySelector('.psb-badge-text');
    const spinner    = card.querySelector('.psb-spinner');
    const progressBar= card.querySelector('.psb-progress-fill');
    const progressLbl= card.querySelector('.psb-progress-label');
    const resultEl   = card.querySelector('.psb-result');
    const embedEl    = card.querySelector('.psb-pdf-embed');
    const errorEl    = card.querySelector('.psb-error');
    const dlBtn      = card.querySelector('.psb-btn-download');

    function _setFieldEl(name, status, value) {
      const el = card.querySelector(`.psb-field[data-field-name="${CSS.escape(name)}"]`);
      if (!el) return;
      const iconEl  = el.querySelector('.psb-field-icon');
      const valueEl = el.querySelector('.psb-field-value');
      iconEl.className = 'psb-field-icon';
      if (status === 'filling') {
        iconEl.textContent = '⏳';
        iconEl.classList.add('psb-filling');
        el.classList.add('psb-field-active');
      } else if (status === 'done') {
        iconEl.textContent = '✓';
        iconEl.classList.add('psb-done');
        el.classList.remove('psb-field-active');
        el.classList.add('psb-field-done');
        if (value != null) valueEl.textContent = String(value).slice(0, 50);
      } else if (status === 'skipped') {
        iconEl.textContent = '—';
        iconEl.classList.add('psb-skipped');
        el.classList.remove('psb-field-active');
      }
      // Scroll into view within the fields list
      try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
    }

    function _updateProgress(filled, total) {
      _filledCount = filled;
      _totalFields = total || _totalFields;
      const pct = _totalFields > 0 ? Math.round((filled / _totalFields) * 100) : 0;
      if (progressBar) progressBar.style.width = pct + '%';
      if (progressLbl) progressLbl.textContent = `${filled} / ${_totalFields} fields filled`;
    }

    function _setBadge(state) {
      badge.className = 'psb-status-badge psb-badge-' + state;
      if (state === 'working') {
        badgeText.textContent = 'Filling…';
        spinner.style.display = '';
      } else if (state === 'done') {
        badgeText.textContent = 'Done';
        spinner.style.display = 'none';
      } else if (state === 'error') {
        badgeText.textContent = 'Error';
        spinner.style.display = 'none';
      } else if (state === 'reading') {
        badgeText.textContent = 'Reading…';
        spinner.style.display = '';
      }
    }

    // Download button handler
    if (dlBtn) {
      dlBtn.addEventListener('click', () => {
        if (_pdfBytes) {
          DocEngine.downloadFile(_pdfBytes, _filename, 'application/pdf');
        }
      });
    }

    // ---- Public API ----
    return {
      card,

      /** Mark a field as filling / done / skipped */
      setFieldStatus(name, status, value) {
        _setFieldEl(name, status, value);
      },

      /** Update the progress bar */
      setProgress(filled, total) {
        _updateProgress(filled, total);
        if (filled > 0 && badge.className.includes('reading')) {
          _setBadge('working');
        }
      },

      /** Switch badge to "Reading" state */
      setReading() {
        _setBadge('reading');
        badgeText.textContent = 'Reading PDF…';
      },

      /** Switch badge to "Filling" */
      setFilling() {
        _setBadge('working');
      },

      /** Show the finished PDF embed + download button */
      showResult(pdfBytes, fname) {
        _pdfBytes = pdfBytes;
        if (fname) _filename = fname;

        _setBadge('done');
        _updateProgress(_totalFields, _totalFields);

        // Revoke any previous object URL
        if (_objectUrl) { try { URL.revokeObjectURL(_objectUrl); } catch {} }

        if (pdfBytes && typeof DocEngine !== 'undefined') {
          _objectUrl = DocEngine.bytesToObjectUrl(pdfBytes, 'application/pdf');
          if (embedEl) {
            embedEl.src = _objectUrl;
            resultEl.style.display = '';
          }
        }

        if (dlBtn) dlBtn.querySelector('span') || (dlBtn.lastChild.textContent = ` Download ${_filename}`);
      },

      /** Display an error state */
      setError(message) {
        _setBadge('error');
        if (errorEl) {
          errorEl.textContent = '⚠ ' + message;
          errorEl.style.display = '';
        }
      },

      /** Update the badge text (e.g. custom status) */
      setStatus(text) {
        if (badgeText) badgeText.textContent = text;
      },

      /** Clean up object URLs */
      destroy() {
        if (_objectUrl) { try { URL.revokeObjectURL(_objectUrl); } catch {} _objectUrl = null; }
      }
    };
  }

  // ---- Utilities ----
  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function truncate(str, max) {
    if (!str || str.length <= max) return str;
    return str.slice(0, max - 1) + '…';
  }

  return { create };
})();

if (typeof globalThis !== 'undefined') globalThis.PdfSandbox = PdfSandbox;
