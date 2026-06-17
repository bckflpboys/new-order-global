// New Order Global — Document Engine
// Browser-side document editing without a server round-trip.
// Handles PDFs (pdf-lib), spreadsheets (SheetJS), Word docs (mammoth + docxtemplater).
//
// Usage:
//   DocEngine.loadPdf(url)              → { ok, pageCount, fields, title }
//   DocEngine.editPdf(url, edits)       → { ok, pdfBytes, filledFields, skipped }
//   DocEngine.createPdf(blocks, opts)   → { ok, pdfBytes }
//   DocEngine.loadSheet(url)            → { ok, sheets, preview }
//   DocEngine.editSheet(url, edits)     → { ok, xlsxBytes }
//   DocEngine.readDocx(url)             → { ok, text, html, headings, tables }
//   DocEngine.editDocx(url, data)       → { ok, docxBytes, replaced }
//   DocEngine.createDocx(content, opts) → { ok, docxBytes }
//   DocEngine.downloadFile(bytes, name, mime)
//   DocEngine.bytesToBase64(bytes)      → string
//   DocEngine.bytesToObjectUrl(bytes, mime) → string
//
// All async methods return { ok: true, ... } or { ok: false, error }.

const DocEngine = (() => {
  'use strict';

  // ============================================
  // Library loaders (lazy, cached)
  // ============================================
  let _pdfLib  = null;
  let _xlsx    = null;
  let _mammoth = null;
  let _pizzip  = null;
  let _docxTpl = null;

  function pdfLibLoaded() {
    if (_pdfLib) return _pdfLib;
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    if (g.PDFLib) { _pdfLib = g.PDFLib; return _pdfLib; }
    return null;
  }

  function xlsxLoaded() {
    if (_xlsx) return _xlsx;
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    if (g.XLSX) { _xlsx = g.XLSX; return _xlsx; }
    return null;
  }

  function mammothLoaded() {
    if (_mammoth) return _mammoth;
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    if (g.mammoth) { _mammoth = g.mammoth; return _mammoth; }
    return null;
  }

  function pizzipLoaded() {
    if (_pizzip) return _pizzip;
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    // PizZip exposes as PizZip (capital P)
    if (g.PizZip) { _pizzip = g.PizZip; return _pizzip; }
    return null;
  }

  function docxTplLoaded() {
    if (_docxTpl) return _docxTpl;
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    // docxtemplater exposes as Docxtemplater
    if (g.Docxtemplater) { _docxTpl = g.Docxtemplater; return _docxTpl; }
    return null;
  }

  // ============================================
  // Fetch helpers
  // ============================================

  async function fetchBytes(url) {
    const resp = await fetch(url, { credentials: 'include', method: 'GET' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    return await resp.arrayBuffer();
  }

  // ============================================
  // PDF utilities (pdf-lib)
  // ============================================

  async function loadPdf(url) {
    const lib = pdfLibLoaded();
    if (!lib) return { ok: false, error: 'pdf-lib not loaded. Make sure libs/pdf-lib.min.js is included.' };
    try {
      const buf = await fetchBytes(url);
      const { PDFDocument } = lib;
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
      const pages = doc.getPages();

      const fields = [];
      let hasAcroForm = false;
      try {
        const form = doc.getForm();
        for (const f of form.getFields()) {
          hasAcroForm = true;
          const ctor = f.constructor && f.constructor.name;
          let type = 'unknown', value = '';
          if (/TextField/i.test(ctor))  { type = 'text';     try { value = f.getText() || ''; } catch {} }
          if (/CheckBox/i.test(ctor))   { type = 'checkbox'; try { value = f.isChecked() ? 'on' : 'off'; } catch {} }
          if (/RadioGroup/i.test(ctor)) { type = 'radio';    try { value = f.getSelected() || ''; } catch {} }
          if (/Dropdown|OptionList/i.test(ctor)) { type = 'choice'; try { value = (f.getSelected && f.getSelected().join(',')) || ''; } catch {} }
          if (/Signature/i.test(ctor))  { type = 'signature'; }
          fields.push({ name: f.getName(), type, value: String(value).slice(0, 300) });
        }
      } catch { /* no AcroForm — fine */ }

      return {
        ok: true,
        pageCount: pages.length,
        fields,
        hasAcroForm,
        title: doc.getTitle() || '',
        author: doc.getAuthor() || '',
        bytes: buf.byteLength
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function editPdf(url, edits = {}) {
    const lib = pdfLibLoaded();
    if (!lib) return { ok: false, error: 'pdf-lib not loaded.' };
    try {
      const buf = await fetchBytes(url);
      const { PDFDocument, StandardFonts, rgb } = lib;
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true, throwOnInvalidObject: false });
      const pages = doc.getPages();

      const filledFields = [];
      const skippedFields = [];

      // ---- AcroForm fill ----
      if (edits.formFields && typeof edits.formFields === 'object') {
        let form;
        try { form = doc.getForm(); } catch { form = null; }
        if (!form) {
          for (const k of Object.keys(edits.formFields)) skippedFields.push({ field: k, reason: 'no_form' });
        } else {
          for (const [name, raw] of Object.entries(edits.formFields)) {
            try {
              let f = null;
              try { f = form.getField(name); } catch { f = null; }
              if (!f) { skippedFields.push({ field: name, reason: 'not_found' }); continue; }
              const ctor = f.constructor && f.constructor.name;
              if (/TextField/i.test(ctor))       f.setText(String(raw == null ? '' : raw));
              else if (/CheckBox/i.test(ctor))   { if (raw === true || raw === 'on' || raw === 'true' || raw === 1) f.check(); else f.uncheck(); }
              else if (/RadioGroup/i.test(ctor)) f.select(String(raw));
              else if (/Dropdown|OptionList/i.test(ctor)) f.select(String(raw));
              else { skippedFields.push({ field: name, reason: `unsupported_type:${ctor}` }); continue; }
              filledFields.push({ field: name, type: ctor, value: String(raw).slice(0, 200) });
            } catch (e) {
              skippedFields.push({ field: name, reason: 'fill_failed', error: e.message });
            }
          }
          if (edits.flattenForm) { try { form.flatten(); } catch {} }
        }
      }

      // ---- Text overlays ----
      const drawnOverlays = [];
      if (Array.isArray(edits.overlays) && edits.overlays.length) {
        const helv = await doc.embedFont(StandardFonts.Helvetica);
        for (const o of edits.overlays) {
          const pn = parseInt(o.page, 10);
          if (!pn || pn < 1 || pn > pages.length) continue;
          const page = pages[pn - 1];
          const fontSize = Math.min(Math.max(Number(o.fontSize) || 12, 4), 72);
          const text = String(o.text || '').slice(0, 1000);
          if (!text) continue;
          const pw = page.getWidth(), ph = page.getHeight();
          const x = (o.x > 0 && o.x <= 1) ? o.x * pw : Number(o.x) || 0;
          const y = (o.y > 0 && o.y <= 1) ? (1 - o.y) * ph : Number(o.y) || 0;
          let color;
          try { const c = o.color || [0,0,0]; color = Array.isArray(c) && c.length===3 ? rgb(c[0],c[1],c[2]) : rgb(0,0,0); }
          catch { color = rgb(0,0,0); }
          page.drawText(text, { x, y, size: fontSize, font: helv, color });
          drawnOverlays.push({ page: pn, x, y, fontSize, chars: text.length });
        }
      }

      const out = await doc.save({ updateFieldAppearances: true });
      return { ok: true, pdfBytes: new Uint8Array(out), filledFields, skippedFields, drawnOverlays, pageCount: pages.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function createPdf(textBlocks = [], options = {}) {
    const lib = pdfLibLoaded();
    if (!lib) return { ok: false, error: 'pdf-lib not loaded.' };
    try {
      const { PDFDocument, StandardFonts, rgb } = lib;
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      let page = doc.addPage();
      const { width, height } = page.getSize();
      if (options.title) doc.setTitle(options.title);

      let curY = height - 50;
      for (const block of textBlocks) {
        const text = String(block.text || '');
        if (!text) continue;
        const size = Math.min(Math.max(Number(block.fontSize) || 12, 4), 72);
        const x = Number(block.x) || 50;
        curY -= (size + 6);
        if (curY < 30) { page = doc.addPage(); curY = height - 50 - size; }
        const col = Array.isArray(block.color) && block.color.length === 3
          ? rgb(block.color[0], block.color[1], block.color[2]) : rgb(0, 0, 0);
        page.drawText(text, { x, y: block.y != null ? Number(block.y) : curY, size, font, color: col });
      }

      const out = await doc.save();
      return { ok: true, pdfBytes: new Uint8Array(out) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ============================================
  // Word document utilities
  // ============================================

  /**
   * Read a Word (.docx) document — extract all text, HTML, headings, and tables.
   * Uses mammoth.js for faithful text extraction.
   *
   * Returns:
   *   { ok, text, html, headings[], tables[][], wordCount }
   */
  async function readDocx(url) {
    const mammoth = mammothLoaded();
    if (!mammoth) return { ok: false, error: 'mammoth.js not loaded. Make sure libs/mammoth.browser.min.js is included.' };
    try {
      const buf = await fetchBytes(url);
      // mammoth wants an ArrayBuffer
      const [htmlResult, textResult] = await Promise.all([
        mammoth.convertToHtml({ arrayBuffer: buf }),
        mammoth.extractRawText({ arrayBuffer: buf })
      ]);

      const html = htmlResult.value || '';
      const text = textResult.value || '';

      // Extract headings from HTML
      const headings = [];
      const hMatches = html.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi);
      for (const m of hMatches) {
        headings.push({ level: parseInt(m[1]), text: m[2].replace(/<[^>]+>/g, '').trim() });
      }

      // Extract tables from HTML
      const tables = [];
      const tableMatches = html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi);
      for (const tm of tableMatches) {
        const rows = [];
        const rowMatches = tm[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
        for (const rm of rowMatches) {
          const cells = [];
          const cellMatches = rm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
          for (const cm of cellMatches) cells.push(cm[1].replace(/<[^>]+>/g, '').trim());
          if (cells.length) rows.push(cells);
        }
        if (rows.length) tables.push(rows);
      }

      const warnings = [...(htmlResult.messages || []), ...(textResult.messages || [])]
        .filter(m => m.type === 'warning')
        .map(m => m.message)
        .slice(0, 10);

      return {
        ok: true,
        text: text.trim(),
        html,
        headings,
        tables,
        wordCount: text.trim().split(/\s+/).filter(Boolean).length,
        warnings
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Fill a Word document template (.docx) by replacing placeholders.
   *
   * Two modes:
   *
   * 1. TEMPLATE mode (recommended): The .docx has `{placeholder}` tags.
   *    Provide data = { "placeholder": "value", ... }
   *    Uses docxtemplater — handles nested tags, loops, conditions.
   *
   * 2. FIND & REPLACE mode: No special tags needed.
   *    Provide replacements = [ { find: "old text", replace: "new text" }, ... ]
   *    Works on raw XML — useful for simple substitution in any .docx.
   *
   * params = {
   *   data:         { key: value, ... }           — template mode
   *   replacements: [ { find, replace }, ... ]    — find-and-replace mode
   *   mode:         'template' | 'replace'        — default: auto-detect
   * }
   */
  async function editDocx(url, params = {}) {
    const PizZip   = pizzipLoaded();
    const DocxTpl  = docxTplLoaded();

    // Determine mode
    const hasData         = params.data && Object.keys(params.data).length > 0;
    const hasReplacements = Array.isArray(params.replacements) && params.replacements.length > 0;
    const mode = params.mode || (hasReplacements ? 'replace' : 'template');

    if (mode === 'template') {
      if (!PizZip || !DocxTpl) {
        return { ok: false, error: 'docxtemplater + PizZip not loaded. Make sure libs/pizzip.min.js and libs/docxtemplater.js are included.' };
      }
      try {
        const buf = await fetchBytes(url);
        const zip  = new PizZip(buf);
        const doc  = new DocxTpl(zip, {
          delimiters: params.delimiters || { start: '{', end: '}' },
          paragraphLoop: true,
          linebreaks: true
        });

        const data = params.data || {};
        doc.render(data);

        const out = doc.getZip().generate({
          type: 'uint8array',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          compression: 'DEFLATE'
        });

        return {
          ok: true,
          docxBytes: out,
          mode: 'template',
          replaced: Object.keys(data),
          hint: `Template filled: ${Object.keys(data).length} placeholder(s) replaced.`
        };
      } catch (e) {
        // docxtemplater throws structured errors
        const msg = e.properties && e.properties.errors
          ? e.properties.errors.map(er => er.message || er.toString()).join('; ')
          : e.message;
        return { ok: false, error: `docxtemplater: ${msg}` };
      }
    }

    // --- Find & Replace mode (raw XML surgery — works without docxtemplater) ---
    if (!PizZip) {
      return { ok: false, error: 'PizZip not loaded. Make sure libs/pizzip.min.js is included.' };
    }
    try {
      const buf = await fetchBytes(url);
      const zip  = new PizZip(buf);

      // The main document content lives in word/document.xml
      const PARTS = ['word/document.xml', 'word/header1.xml', 'word/footer1.xml', 'word/header2.xml', 'word/footer2.xml'];
      const replaced = [];

      for (const part of PARTS) {
        if (!zip.files[part]) continue;
        let xml = zip.files[part].asText();
        for (const { find, replace: repl } of (params.replacements || [])) {
          if (!find) continue;
          // Two passes:
          // Pass 1: direct match (find appears as one XML text run — most common)
          const escaped = String(find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const before = xml;
          xml = xml.replace(new RegExp(escaped, 'g'), String(repl ?? ''));
          // Pass 2: match across split <w:t> runs (Word splits long strings)
          // Strip tags between identical text chunks and retry
          if (xml === before) {
            const xmlStripped = xml.replace(/<\/w:t>.*?<w:t[^>]*>/g, '');
            if (xmlStripped.includes(find)) {
              // Need a smarter approach — collapse split runs
              const runPattern = new RegExp(
                String(find).split('').map(c => `${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:<\\/w:t>.*?<w:t[^>]*>)?`).join(''),
                'g'
              );
              xml = xml.replace(runPattern, String(repl ?? ''));
            }
          }
          if (xml !== before) replaced.push({ find, part });
        }
        zip.file(part, xml);
      }

      const out = zip.generate({
        type: 'uint8array',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        compression: 'DEFLATE'
      });

      return {
        ok: true,
        docxBytes: out,
        mode: 'replace',
        replaced,
        hint: `Find & replace complete. ${replaced.length} substitution(s) made across document parts.`
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Create a brand-new Word document (.docx) from structured content.
   *
   * content = {
   *   title?:     string
   *   paragraphs: [ { text, style?, bold?, italic?, size? }, ... ]
   *   tables?:    [ { rows: [ [ "cell", ... ], ... ], headerRow?: bool } ]
   * }
   *
   * Uses docxtemplater with a minimal blank template as base.
   * Falls back to a very simple XML skeleton if docxtemplater isn't available.
   */
  async function createDocx(content = {}, opts = {}) {
    const PizZip  = pizzipLoaded();
    const DocxTpl = docxTplLoaded();

    const paragraphs = Array.isArray(content.paragraphs) ? content.paragraphs : [];
    const title      = content.title || opts.title || 'Document';

    // Build minimal OOXML document.xml
    const xmlParas = paragraphs.map(p => {
      const text   = String(p.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const bold   = p.bold   ? '<w:b/>'  : '';
      const italic = p.italic ? '<w:i/>'  : '';
      const size   = p.size   ? `<w:sz w:val="${p.size * 2}"/><w:szCs w:val="${p.size * 2}"/>` : '';
      const style  = p.style  ? `<w:pStyle w:val="${p.style}"/>` : '';
      return `<w:p><w:pPr>${style}</w:pPr><w:r><w:rPr>${bold}${italic}${size}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    }).join('');

    // Build tables
    const xmlTables = (content.tables || []).map(tbl => {
      const rows = (tbl.rows || []).map((row, ri) => {
        const cells = row.map(cell => {
          const ct = String(cell || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const bold = (tbl.headerRow && ri === 0) ? '<w:b/>' : '';
          return `<w:tc><w:p><w:r><w:rPr>${bold}</w:rPr><w:t>${ct}</w:t></w:r></w:p></w:tc>`;
        }).join('');
        return `<w:tr>${cells}</w:tr>`;
      }).join('');
      return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${rows}</w:tbl>`;
    }).join('');

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</w:t></w:r></w:p>
    ${xmlParas}
    ${xmlTables}
    <w:sectPr/>
  </w:body>
</w:document>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

    if (!PizZip) return { ok: false, error: 'PizZip not loaded. libs/pizzip.min.js is required to create .docx files.' };
    try {
      const zip = new PizZip();
      zip.file('[Content_Types].xml', contentTypes);
      zip.file('_rels/.rels',         relsXml);
      zip.folder('word');
      zip.file('word/document.xml',   documentXml);
      zip.file('word/_rels/document.xml.rels', wordRelsXml);

      const out = zip.generate({
        type: 'uint8array',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        compression: 'DEFLATE'
      });
      return { ok: true, docxBytes: out, paragraphCount: paragraphs.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ============================================
  // PowerPoint utilities
  // ============================================

  /**
   * Read a PowerPoint (.pptx) presentation — extract text slide-by-slide.
   * Uses PizZip to dissect the presentation XML.
   */
  async function readPptx(url) {
    const PizZip = pizzipLoaded();
    if (!PizZip) return { ok: false, error: 'PizZip not loaded. Make sure libs/pizzip.min.js is included.' };
    try {
      const buf = await fetchBytes(url);
      const zip = new PizZip(buf);

      const slideFiles = Object.keys(zip.files).filter(k => /^ppt\/slides\/slide\d+\.xml$/i.test(k));
      slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)[0], 10);
        const numB = parseInt(b.match(/\d+/)[0], 10);
        return numA - numB;
      });

      const slides = [];
      let fullText = '';

      for (const file of slideFiles) {
        const xml = zip.files[file].asText();
        // Extract text from <a:t> tags
        const textMatches = xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g);
        let slideText = '';
        for (const m of textMatches) {
          slideText += m[1].replace(/<[^>]+>/g, '').trim() + ' ';
        }
        const cleanText = slideText.trim();
        slides.push({
          slideNum: parseInt(file.match(/\d+/)[0], 10),
          text: cleanText
        });
        fullText += `[Slide ${slides.length}]:\n${cleanText}\n\n`;
      }

      return {
        ok: true,
        text: fullText.trim(),
        slides,
        slideCount: slides.length,
        wordCount: fullText.trim().split(/\s+/).filter(Boolean).length
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Fill a PowerPoint presentation template (.pptx) or find-and-replace text.
   */
  async function editPptx(url, params = {}) {
    const PizZip  = pizzipLoaded();
    const DocxTpl = docxTplLoaded();

    const hasData         = params.data && Object.keys(params.data).length > 0;
    const hasReplacements = Array.isArray(params.replacements) && params.replacements.length > 0;
    const mode = params.mode || (hasReplacements ? 'replace' : 'template');

    if (mode === 'template') {
      if (!PizZip || !DocxTpl) {
        return { ok: false, error: 'docxtemplater + PizZip not loaded. Make sure libs/pizzip.min.js and libs/docxtemplater.js are included.' };
      }
      try {
        const buf = await fetchBytes(url);
        const zip  = new PizZip(buf);
        const doc  = new DocxTpl(zip, {
          delimiters: params.delimiters || { start: '{', end: '}' },
          paragraphLoop: true,
          linebreaks: true
        });

        const data = params.data || {};
        doc.render(data);

        const out = doc.getZip().generate({
          type: 'uint8array',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          compression: 'DEFLATE'
        });

        return {
          ok: true,
          pptxBytes: out,
          mode: 'template',
          replaced: Object.keys(data),
          hint: `PPTX template filled: ${Object.keys(data).length} placeholder(s) replaced.`
        };
      } catch (e) {
        return { ok: false, error: `docxtemplater: ${e.message}` };
      }
    }

    // --- Find & Replace mode (raw XML surgery) ---
    if (!PizZip) {
      return { ok: false, error: 'PizZip not loaded. Make sure libs/pizzip.min.js is included.' };
    }
    try {
      const buf = await fetchBytes(url);
      const zip = new PizZip(buf);

      const slideFiles = Object.keys(zip.files).filter(k => /^ppt\/slides\/slide\d+\.xml$/i.test(k));
      const replaced = [];

      for (const part of slideFiles) {
        let xml = zip.files[part].asText();
        for (const { find, replace: repl } of (params.replacements || [])) {
          if (!find) continue;
          const escaped = String(find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const before = xml;
          xml = xml.replace(new RegExp(escaped, 'g'), String(repl ?? ''));
          // Pass 2: match across split <a:t> runs (PowerPoint splits text elements)
          if (xml === before) {
            const xmlStripped = xml.replace(/<\/a:t>.*?<a:t[^>]*>/g, '');
            if (xmlStripped.includes(find)) {
              const runPattern = new RegExp(
                String(find).split('').map(c => `${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:<\\/a:t>.*?<a:t[^>]*>)?`).join(''),
                'g'
              );
              xml = xml.replace(runPattern, String(repl ?? ''));
            }
          }
          if (xml !== before) replaced.push({ find, part });
        }
        zip.file(part, xml);
      }

      const out = zip.generate({
        type: 'uint8array',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        compression: 'DEFLATE'
      });

      return {
        ok: true,
        pptxBytes: out,
        mode: 'replace',
        replaced,
        hint: `Find & replace complete. ${replaced.length} slide substitution(s) made.`
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ============================================
  // Spreadsheet utilities (SheetJS)
  // ============================================

  async function loadSheet(url) {
    const XLSX = xlsxLoaded();
    if (!XLSX) return { ok: false, error: 'SheetJS (xlsx) not loaded.' };
    try {
      const buf = await fetchBytes(url);
      const wb = XLSX.read(buf, { type: 'array' });
      const sheets = wb.SheetNames.map(name => {
        const ws   = wb.Sheets[name];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        return { name, rows: data.length, cols: (data[0] || []).length, preview: data.slice(0, 8) };
      });
      return { ok: true, sheets, sheetNames: wb.SheetNames };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * edits = {
   *   sheetName?: string,
   *   cells:    [ { ref: 'A1', value: 'Hello' }, ... ]
   *   rows?:    [ { row: 2, data: { A: 'x', B: 'y' } }, ... ]  — optional bulk row fill
   * }
   */
  async function editSheet(url, edits = {}) {
    const XLSX = xlsxLoaded();
    if (!XLSX) return { ok: false, error: 'SheetJS (xlsx) not loaded.' };
    try {
      const buf = await fetchBytes(url);
      const wb  = XLSX.read(buf, { type: 'array' });
      const sheetName = edits.sheetName || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) return { ok: false, error: `Sheet "${sheetName}" not found in document.` };

      const edited = [];

      // Cell-level edits
      for (const cell of (edits.cells || [])) {
        if (!cell.ref) continue;
        const t = typeof cell.value === 'number' ? 'n' : typeof cell.value === 'boolean' ? 'b' : 's';
        ws[cell.ref] = { v: cell.value, t };
        edited.push(cell.ref);
      }

      // Row-level bulk fill
      for (const r of (edits.rows || [])) {
        const rowNum = Number(r.row);
        if (!rowNum || !r.data) continue;
        for (const [col, val] of Object.entries(r.data)) {
          const ref = col.toUpperCase() + rowNum;
          const t = typeof val === 'number' ? 'n' : typeof val === 'boolean' ? 'b' : 's';
          ws[ref] = { v: val, t };
          edited.push(ref);
        }
      }

      // Update sheet range
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
      for (const ref of edited) {
        const cr = XLSX.utils.decode_cell(ref);
        if (cr.r > range.e.r) range.e.r = cr.r;
        if (cr.c > range.e.c) range.e.c = cr.c;
      }
      ws['!ref'] = XLSX.utils.encode_range(range);

      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      return { ok: true, xlsxBytes: new Uint8Array(out), edited, sheetName };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ============================================
  // File download / conversion helpers
  // ============================================

  function downloadFile(bytes, filename, mime = 'application/octet-stream') {
    try {
      const blob = new Blob([bytes], { type: mime });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = filename; a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
      return { ok: true, filename };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function bytesToObjectUrl(bytes, mime = 'application/pdf') {
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  }

  // Detect MIME from filename extension
  function mimeForFilename(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    const map = {
      pdf:  'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc:  'application/msword',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xls:  'application/vnd.ms-excel',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ppt:  'application/vnd.ms-powerpoint',
      csv:  'text/csv',
      txt:  'text/plain',
      png:  'image/png',
      jpg:  'image/jpeg',
      jpeg: 'image/jpeg'
    };
    return map[ext] || 'application/octet-stream';
  }

  // ============================================
  // Public API
  // ============================================
  return {
    // PDF
    loadPdf,
    editPdf,
    createPdf,
    // Word
    readDocx,
    editDocx,
    createDocx,
    // Spreadsheet
    loadSheet,
    editSheet,
    // PowerPoint
    readPptx,
    editPptx,
    // Helpers
    downloadFile,
    bytesToBase64,
    base64ToBytes,
    bytesToObjectUrl,
    mimeForFilename,
    // Library readiness checks
    isPdfLibReady:    () => !!pdfLibLoaded(),
    isXlsxReady:      () => !!xlsxLoaded(),
    isMammothReady:   () => !!mammothLoaded(),
    isDocxTplReady:   () => !!(pizzipLoaded() && docxTplLoaded()),
    isPizZipReady:    () => !!pizzipLoaded()
  };
})();

if (typeof globalThis !== 'undefined') globalThis.DocEngine = DocEngine;
