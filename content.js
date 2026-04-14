(function () {
  'use strict';

  const DEFAULT_PROVIDER = 'openai';
  const PROVIDER_OPTIONS = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'gemini', label: 'Gemini' },
  ];
  const STORAGE_KEYS = {
    provider: 'CONTENT_SUMMARIZER_AI_PROVIDER',
    tokens: {
      openai: 'CONTENT_SUMMARIZER_OPENAI_TOKEN',
      gemini: 'CONTENT_SUMMARIZER_GEMINI_TOKEN',
    },
  };
  const INJECTED_ID = 'cs-ext-injected';
  const POPOVER_ID = 'cs-ext-popover';
  const MODAL_ID = 'cs-ext-modal';

  const LANGUAGES = [
    { code: 'th', name: 'ไทย', flag: '🇹🇭' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
  ];

  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  // ===================== Injection Guard =====================

  const existing = document.getElementById(INJECTED_ID);
  if (existing) {
    try {
      const storedId = existing.getAttribute('data-ext-id');
      if (storedId && storedId === chrome.runtime.id) {
        return;
      }
    } catch {}
    [INJECTED_ID, POPOVER_ID, MODAL_ID].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  const marker = document.createElement('div');
  marker.id = INJECTED_ID;
  marker.style.display = 'none';
  try {
    marker.setAttribute('data-ext-id', chrome.runtime.id);
  } catch {}
  document.body.appendChild(marker);

  // ===================== Markdown Parser =====================

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inlineFormat(text) {
    let s = escapeHtml(text);
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/_(.+?)_/g, '<em>$1</em>');
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
    return s;
  }

  function parseMarkdown(md) {
    if (!md) return '';
    const lines = md.split('\n');
    const result = [];
    let inCode = false;
    let codeLang = '';
    let codeLines = [];
    let inList = false;
    let listTag = '';

    function closeList() {
      if (inList) {
        result.push(`</${listTag}>`);
        inList = false;
      }
    }

    function splitTableRow(line) {
      const t = line.trim();
      if (!t.includes('|')) return null;
      let s = t;
      if (s.startsWith('|')) s = s.slice(1);
      if (s.endsWith('|')) s = s.slice(0, -1);
      const parts = s.split('|').map((cell) => cell.trim());
      if (parts.length < 2) return null;
      return parts;
    }

    function isSeparatorCells(cells) {
      return cells.every((c) => {
        const x = c.trim();
        return /^:?\s*-{3,}\s*:?$/.test(x);
      });
    }

    function tryConsumeTable(startIdx) {
      const headerCells = splitTableRow(lines[startIdx]);
      if (!headerCells) return null;
      const sepLine = lines[startIdx + 1];
      if (sepLine === undefined) return null;
      const sepCells = splitTableRow(sepLine);
      if (
        !sepCells ||
        sepCells.length !== headerCells.length ||
        !isSeparatorCells(sepCells)
      ) {
        return null;
      }

      const bodyRows = [];
      let j = startIdx + 2;
      for (; j < lines.length; j++) {
        const raw = lines[j];
        if (raw.trim() === '') break;
        const rowCells = splitTableRow(raw);
        if (!rowCells || rowCells.length < 2) break;
        const normalized = [];
        for (let k = 0; k < headerCells.length; k++) {
          normalized.push(rowCells[k] !== undefined ? rowCells[k] : '');
        }
        bodyRows.push(normalized);
      }

      let html = '<table><thead><tr>';
      headerCells.forEach((c) => {
        html += `<th>${inlineFormat(c)}</th>`;
      });
      html += '</tr></thead><tbody>';
      bodyRows.forEach((row) => {
        html += '<tr>';
        row.forEach((c) => {
          html += `<td>${inlineFormat(c)}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      return { html, endIdx: j };
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim().startsWith('```')) {
        if (inCode) {
          result.push(
            `<pre><code class="lang-${codeLang}">${escapeHtml(codeLines.join('\n'))}</code></pre>`
          );
          inCode = false;
          codeLines = [];
          codeLang = '';
        } else {
          closeList();
          inCode = true;
          codeLang = line.trim().slice(3).trim();
        }
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        continue;
      }

      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        closeList();
        const lvl = headerMatch[1].length;
        result.push(`<h${lvl}>${inlineFormat(headerMatch[2])}</h${lvl}>`);
        continue;
      }

      if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
        closeList();
        result.push('<hr>');
        continue;
      }

      const tableBlock = tryConsumeTable(i);
      if (tableBlock) {
        closeList();
        result.push(tableBlock.html);
        i = tableBlock.endIdx - 1;
        continue;
      }

      const ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
      if (ulMatch) {
        if (!inList || listTag !== 'ul') {
          closeList();
          result.push('<ul>');
          inList = true;
          listTag = 'ul';
        }
        result.push(`<li>${inlineFormat(ulMatch[1])}</li>`);
        continue;
      }

      const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
      if (olMatch) {
        if (!inList || listTag !== 'ol') {
          closeList();
          result.push('<ol>');
          inList = true;
          listTag = 'ol';
        }
        result.push(`<li>${inlineFormat(olMatch[1])}</li>`);
        continue;
      }

      const bqMatch = line.match(/^>\s*(.*)$/);
      if (bqMatch) {
        closeList();
        result.push(`<blockquote>${inlineFormat(bqMatch[1])}</blockquote>`);
        continue;
      }

      if (line.trim() === '') {
        closeList();
        continue;
      }

      closeList();
      result.push(`<p>${inlineFormat(line)}</p>`);
    }

    closeList();
    if (inCode) {
      result.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    }

    return result.join('\n');
  }

  // ===================== Modal CSS =====================

  const MODAL_CSS = `
    :host { all: initial; }

    * {
      margin: 0; padding: 0; box-sizing: border-box;
    }

    .modal {
      position: fixed;
      background: #E8F5E9;
      border-radius: 14px;
      box-shadow: 0 20px 70px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.05);
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      color: #2E3A2E;
      z-index: 2147483647;
      pointer-events: auto;
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: linear-gradient(135deg, #66BB6A 0%, #43A047 100%);
      color: #fff;
      cursor: move;
      user-select: none;
      -webkit-user-select: none;
      flex-shrink: 0;
      border-radius: 14px 14px 0 0;
    }

    .modal-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.3px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .modal-title::before {
      content: '📝';
      font-size: 16px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .header-btn {
      width: 26px;
      height: 26px;
      border: none;
      background: rgba(255,255,255,0.18);
      border-radius: 50%;
      color: #fff;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
      line-height: 1;
    }

    .header-btn:hover {
      background: rgba(255,255,255,0.35);
    }

    .modal-body {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }

    /* ===== Key Form ===== */

    .key-view {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 28px;
      gap: 16px;
      flex: 1;
    }

    .key-view .icon { font-size: 40px; }

    .key-view h2 {
      font-size: 16px;
      color: #2E7D32;
      font-weight: 700;
    }

    .key-view p {
      font-size: 13px;
      color: #6B7B6B;
      text-align: center;
      line-height: 1.5;
    }

    .key-view .key-input {
      width: 100%;
      max-width: 380px;
      border: 2px solid #A5D6A7;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 14px;
      font-family: inherit;
      background: #FAFFF5;
      color: #2E3A2E;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
    }

    .key-view .key-input:focus {
      border-color: #43A047;
      box-shadow: 0 0 0 3px rgba(102, 187, 106, 0.18);
      background: #FFFFFF;
    }

    .key-view .provider-select {
      appearance: none;
      -webkit-appearance: none;
      cursor: pointer;
      font-weight: 600;
      padding-right: 36px;
      background-image:
        linear-gradient(45deg, transparent 50%, #66BB6A 50%),
        linear-gradient(135deg, #66BB6A 50%, transparent 50%),
        linear-gradient(#FAFFF5, #FAFFF5);
      background-position:
        calc(100% - 18px) calc(50% - 3px),
        calc(100% - 12px) calc(50% - 3px),
        100% 0;
      background-size: 6px 6px, 6px 6px, 2.6em 100%;
      background-repeat: no-repeat;
    }

    .key-view .provider-select:hover {
      border-color: #81C784;
      background-color: #FFFFFF;
    }

    .key-view .save-btn {
      padding: 10px 36px;
      background: linear-gradient(135deg, #66BB6A, #43A047);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: box-shadow 0.2s, transform 0.15s;
    }

    .key-view .save-btn:hover {
      box-shadow: 0 4px 14px rgba(76,175,80,0.4);
      transform: translateY(-1px);
    }

    .key-view .error-msg {
      color: #c62828;
      font-size: 12px;
      min-height: 16px;
    }

    /* ===== Input Panel ===== */

    .input-panel {
      display: flex;
      flex-direction: column;
      padding: 16px;
      gap: 10px;
      min-width: 280px;
      flex: 1;
    }

    .content-input {
      flex: 1;
      min-height: 180px;
      border: 2px solid #A5D6A7;
      border-radius: 8px;
      padding: 12px;
      font-family: inherit;
      font-size: 14px;
      line-height: 1.6;
      resize: none;
      background: #FAFFF5;
      color: #2E3A2E;
      outline: none;
      transition: border-color 0.2s;
    }

    .content-input:focus { border-color: #43A047; }

    .content-input::placeholder { color: #9CAF9C; }

    .option-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .option-row label {
      font-size: 13px;
      color: #558B2F;
      font-weight: 600;
      white-space: nowrap;
    }

    .option-row input[type="number"] {
      width: 90px;
      border: 2px solid #C8E6C9;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 13px;
      font-family: inherit;
      background: #FAFFF5;
      color: #2E3A2E;
      outline: none;
      transition: border-color 0.2s;
    }

    .option-row input[type="number"]:focus { border-color: #43A047; }

    .option-row .hint {
      font-size: 11px;
      color: #9E9E9E;
      font-style: italic;
    }

    .btn-row {
      display: flex;
      gap: 10px;
    }

    .btn {
      flex: 1;
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-summarize {
      background: linear-gradient(135deg, #66BB6A, #43A047);
      color: #fff;
    }

    .btn-summarize:hover:not(:disabled) {
      box-shadow: 0 4px 14px rgba(76,175,80,0.4);
      transform: translateY(-1px);
    }

    .btn-summarize:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
    }

    .btn-clear {
      background: #fff;
      color: #43A047;
      border: 2px solid #C8E6C9;
    }

    .btn-clear:hover:not(:disabled) {
      background: #F1F8E9;
      border-color: #81C784;
    }

    .btn-clear:disabled,
    .toggle-option:disabled,
    .lang-select-btn:disabled,
    .translate-btn:disabled,
    .copy-btn:disabled,
    .refresh-btn:disabled,
    .assistant-chat-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .content-input:disabled,
    .option-row input[type="number"]:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      background: #EDF7ED;
      border-color: #C8E6C9;
    }

    /* ===== Input Toggle ===== */

    .input-toggle-row {
      display: flex;
    }

    .input-toggle {
      display: inline-flex;
      background: #C8E6C9;
      border-radius: 8px;
      padding: 3px;
    }

    .toggle-option {
      padding: 6px 18px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: #558B2F;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .toggle-option.active {
      background: #fff;
      color: #2E7D32;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }

    .toggle-option:hover:not(.active) {
      background: rgba(255,255,255,0.4);
    }

    /* ===== URL Section ===== */

    .url-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .url-input {
      width: 100%;
      border: 2px solid #A5D6A7;
      border-radius: 8px;
      padding: 12px 14px;
      font-family: inherit;
      font-size: 14px;
      background: #FAFFF5;
      color: #2E3A2E;
      outline: none;
      transition: border-color 0.2s, opacity 0.2s;
    }

    .url-input:focus { border-color: #43A047; }
    .url-input::placeholder { color: #9CAF9C; }
    .url-input:disabled { opacity: 0.55; cursor: not-allowed; background: #EDF7ED; border-color: #C8E6C9; }

    .url-display {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 14px;
      background: #F1F8E9;
      border-radius: 8px;
      border: 1.5px solid #C8E6C9;
      animation: csDropIn 0.15s ease-out;
    }

    .url-display-text {
      flex: 1;
      color: #2E7D32;
      font-size: 13px;
      word-break: break-all;
      line-height: 1.4;
      min-width: 0;
    }

    .url-open-btn {
      padding: 5px 12px;
      background: linear-gradient(135deg, #66BB6A, #43A047);
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      font-family: inherit;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .url-open-btn:hover {
      box-shadow: 0 2px 8px rgba(76,175,80,0.35);
      transform: translateY(-1px);
    }

    /* ===== Divider ===== */

    .divider {
      width: 7px;
      background: #C8E6C9;
      cursor: col-resize;
      flex-shrink: 0;
      position: relative;
      transition: background 0.2s;
    }

    .divider:hover, .divider.active {
      background: #81C784;
    }

    .divider::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 3px;
      height: 36px;
      background: #66BB6A;
      border-radius: 2px;
    }

    /* ===== Response Panel ===== */

    .response-panel {
      display: flex;
      flex-direction: column;
      min-width: 250px;
      flex: 1;
      background: #FAFFF5;
      border-left: none;
    }

    .response-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid #C8E6C9;
      flex-shrink: 0;
      min-width: 0;
    }

    .response-title {
      font-size: 14px;
      font-weight: 700;
      color: #2E7D32;
      flex-shrink: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .response-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex-shrink: 1;
    }

    .refresh-btn {
      padding: 4px 8px;
      border: 1.5px solid #C8E6C9;
      border-radius: 6px;
      background: #fff;
      color: #43A047;
      font-size: 12px;
      font-family: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .refresh-btn:hover {
      background: #E8F5E9;
      border-color: #81C784;
    }

    .copy-btn {
      padding: 5px 12px;
      border: 1.5px solid #C8E6C9;
      border-radius: 6px;
      background: #fff;
      color: #43A047;
      font-size: 12px;
      font-family: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .copy-btn:hover {
      background: #E8F5E9;
      border-color: #81C784;
    }

    .copy-btn.copied {
      background: #43A047;
      color: #fff;
      border-color: #43A047;
    }

    .response-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    /* ===== Translate ===== */

    .translate-wrapper {
      position: relative;
    }

    .translate-btn {
      padding: 4px 8px;
      border: 1.5px solid #C8E6C9;
      border-radius: 6px;
      background: #fff;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .translate-btn:hover {
      background: #E8F5E9;
      border-color: #81C784;
    }

    .translate-btn img {
      width: 20px;
      height: 20px;
      pointer-events: none;
    }

    .translate-dropdown {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      background: #fff;
      border: 1.5px solid #C8E6C9;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      min-width: 160px;
      z-index: 10;
      overflow: hidden;
      animation: csDropIn 0.15s ease-out;
    }

    @keyframes csDropIn {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .translate-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 14px;
      font-size: 13px;
      font-family: inherit;
      color: #2E3A2E;
      cursor: pointer;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      transition: background 0.15s;
    }

    .translate-option:hover {
      background: #E8F5E9;
    }

    .translate-option .flag {
      font-size: 18px;
      line-height: 1;
    }

    .translate-option .lang-name {
      font-weight: 500;
    }

    /* ===== Input Language Select ===== */

    .lang-select-wrapper {
      position: relative;
    }

    .lang-select-btn {
      padding: 6px 12px;
      border: 2px solid #C8E6C9;
      border-radius: 6px;
      background: #FAFFF5;
      color: #2E3A2E;
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    .lang-select-btn:hover {
      border-color: #81C784;
      background: #E8F5E9;
    }

    .lang-select-dropdown {
      position: absolute;
      bottom: calc(100% + 4px);
      left: 0;
      background: #fff;
      border: 1.5px solid #C8E6C9;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      min-width: 160px;
      z-index: 10;
      overflow: hidden;
      animation: csDropIn 0.15s ease-out;
    }

    .response-content {
      flex: 1;
      overflow: auto;
      padding: 16px;
      line-height: 1.75;
      user-select: text;
      -webkit-user-select: text;
      cursor: text;
    }

    .response-content * {
      user-select: text;
      -webkit-user-select: text;
    }

    .response-content::-webkit-scrollbar { width: 6px; height: 6px; }
    .response-content::-webkit-scrollbar-track { background: transparent; }
    .response-content::-webkit-scrollbar-thumb { background: #C8E6C9; border-radius: 3px; }
    .response-content::-webkit-scrollbar-thumb:hover { background: #A5D6A7; }

    /* ===== Markdown Styles ===== */

    .response-content h1 {
      font-size: 1.5em; margin: 18px 0 8px; color: #1B5E20;
      border-bottom: 2px solid #C8E6C9; padding-bottom: 6px;
    }
    .response-content h2 { font-size: 1.3em; margin: 16px 0 6px; color: #2E7D32; }
    .response-content h3 { font-size: 1.15em; margin: 14px 0 4px; color: #388E3C; }
    .response-content h4 { font-size: 1.05em; margin: 10px 0 4px; color: #43A047; }
    .response-content h5, .response-content h6 { font-size: 1em; margin: 8px 0 4px; color: #558B2F; }
    .response-content p { margin: 8px 0; color: #333; }
    .response-content ul, .response-content ol { margin: 8px 0 8px 4px; padding-left: 22px; }
    .response-content li { margin: 4px 0; color: #333; }
    .response-content li::marker { color: #66BB6A; }
    .response-content strong { color: #1B5E20; }

    .response-content code {
      background: #E8F5E9;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
      font-size: 0.88em;
      color: #2E7D32;
    }

    .response-content pre {
      background: #1B2F1B;
      color: #A5D6A7;
      padding: 14px 16px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 12px 0;
      font-size: 13px;
      line-height: 1.5;
    }

    .response-content pre code {
      background: none;
      color: inherit;
      padding: 0;
      font-size: inherit;
    }

    .response-content blockquote {
      border-left: 4px solid #81C784;
      padding: 8px 16px;
      margin: 10px 0;
      background: #F1F8E9;
      border-radius: 0 8px 8px 0;
      color: #555;
    }

    .response-content table {
      border-collapse: collapse;
      width: 100%;
      margin: 12px 0;
      font-size: 13px;
      line-height: 1.45;
    }

    .response-content th,
    .response-content td {
      border: 1px solid #A5D6A7;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }

    .response-content th {
      background: #E8F5E9;
      color: #1B5E20;
      font-weight: 600;
    }

    .response-content tbody tr:nth-child(even) td {
      background: #FAFFF5;
    }

    .response-content hr {
      border: none;
      border-top: 2px solid #C8E6C9;
      margin: 16px 0;
    }

    .response-content a {
      color: #2E7D32;
      text-decoration: underline;
    }

    .response-content del { color: #999; }

    .placeholder-text {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #A5C4A5;
      font-style: italic;
      text-align: center;
      padding: 24px;
      line-height: 1.6;
    }

    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      height: 100%;
      color: #66BB6A;
    }

    .spinner {
      width: 34px;
      height: 34px;
      border: 3px solid #C8E6C9;
      border-top-color: #43A047;
      border-radius: 50%;
      animation: cs-spin 0.7s linear infinite;
    }

    @keyframes cs-spin {
      to { transform: rotate(360deg); }
    }

    .loading-state span {
      font-size: 13px;
      color: #66BB6A;
      font-weight: 600;
    }

    .error-text {
      color: #c62828;
      background: #FFEBEE;
      border: 1px solid #EF9A9A;
      border-radius: 8px;
      padding: 12px 16px;
      margin: 8px 0;
      font-size: 13px;
      line-height: 1.5;
    }

    /* ===== Edge Resize Handles ===== */

    .resize-handle {
      position: absolute;
      z-index: 10;
    }

    .resize-n  { top: -3px; left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
    .resize-s  { bottom: -3px; left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
    .resize-e  { right: -3px; top: 14px; bottom: 14px; width: 6px; cursor: ew-resize; }
    .resize-w  { left: -3px; top: 14px; bottom: 14px; width: 6px; cursor: ew-resize; }
    .resize-ne { top: -3px; right: -3px; width: 14px; height: 14px; cursor: nesw-resize; }
    .resize-nw { top: -3px; left: -3px; width: 14px; height: 14px; cursor: nwse-resize; }
    .resize-se { bottom: -3px; right: -3px; width: 14px; height: 14px; cursor: nwse-resize; }
    .resize-sw { bottom: -3px; left: -3px; width: 14px; height: 14px; cursor: nesw-resize; }

    .modal-enter {
      animation: cs-fadeIn 0.22s ease-out;
    }

    @keyframes cs-fadeIn {
      from { opacity: 0; transform: scale(0.96); }
      to   { opacity: 1; transform: scale(1); }
    }

    /* ===== Word Explainer ===== */

    .word-explain-popover {
      position: fixed;
      background: #ffffff;
      border: 1.5px solid #1e3a8a;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(26,35,126,0.22), 0 0 0 1px rgba(30,58,138,0.12);
      width: 340px;
      height: 420px;
      display: none;
      flex-direction: column;
      z-index: 2147483648;
      pointer-events: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 13px;
      color: #0f172a;
    }

    .word-explain-popover.visible {
      display: flex;
      animation: csDropIn 0.2s ease-out;
    }

    .word-explain-popover-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(135deg, #1a237e 0%, #283593 100%);
      border-bottom: 1px solid #1e3a8a;
      border-radius: 11px 11px 0 0;
      flex-shrink: 0;
      gap: 8px;
      cursor: move;
      user-select: none;
      -webkit-user-select: none;
    }

    .word-explain-popover-title {
      font-size: 11px;
      font-weight: 600;
      color: rgba(255,255,255,0.65);
      text-transform: uppercase;
      letter-spacing: 0.6px;
      flex-shrink: 0;
    }

    .word-explain-popover-term {
      font-size: 13px;
      font-weight: 700;
      color: #ffffff;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    .word-explain-popover-close {
      width: 22px;
      height: 22px;
      border: none;
      background: rgba(255,255,255,0.15);
      border-radius: 50%;
      color: #ffffff;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s;
      line-height: 1;
    }

    .word-explain-popover-close:hover {
      background: rgba(255,255,255,0.3);
    }

    .word-explain-popover-body {
      flex: 1;
      overflow: auto;
      padding: 14px 16px;
      line-height: 1.75;
      background: #ffffff;
      border-radius: 0 0 11px 11px;
      min-height: 0;
    }

    .word-explain-popover-body::-webkit-scrollbar { width: 5px; }
    .word-explain-popover-body::-webkit-scrollbar-track { background: transparent; }
    .word-explain-popover-body::-webkit-scrollbar-thumb { background: #bfdbfe; border-radius: 3px; }
    .word-explain-popover-body::-webkit-scrollbar-thumb:hover { background: #93c5fd; }

    .word-explain-popover-body h1,
    .word-explain-popover-body h2,
    .word-explain-popover-body h3,
    .word-explain-popover-body h4 {
      color: #1e3a8a;
      margin: 10px 0 6px;
      font-weight: 700;
    }

    .word-explain-popover-body h1 { font-size: 1.15em; border-bottom: 1.5px solid #bfdbfe; padding-bottom: 4px; }
    .word-explain-popover-body h2 { font-size: 1.05em; }
    .word-explain-popover-body h3 { font-size: 1em; }
    .word-explain-popover-body h4 { font-size: 0.95em; color: #3730a3; }

    .word-explain-popover-body p { margin: 6px 0; color: #1e293b; }
    .word-explain-popover-body strong { color: #1e3a8a; }
    .word-explain-popover-body em { color: #3730a3; font-style: italic; }
    .word-explain-popover-body del { color: #94a3b8; }

    .word-explain-popover-body ul,
    .word-explain-popover-body ol { margin: 6px 0; padding-left: 20px; }

    .word-explain-popover-body li { margin: 3px 0; color: #1e293b; }
    .word-explain-popover-body li::marker { color: #2563eb; }

    .word-explain-popover-body code {
      background: #eff6ff;
      color: #1e3a8a;
      padding: 1px 5px;
      border-radius: 3px;
      font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
      font-size: 0.85em;
      border: 1px solid #bfdbfe;
    }

    .word-explain-popover-body pre {
      background: #1e3a8a;
      color: #e0e7ff;
      padding: 10px 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
      font-size: 12px;
    }

    .word-explain-popover-body pre code {
      background: none;
      color: inherit;
      padding: 0;
      border: none;
    }

    .word-explain-popover-body blockquote {
      border-left: 3px solid #3b82f6;
      padding: 6px 12px;
      margin: 8px 0;
      background: #eff6ff;
      border-radius: 0 6px 6px 0;
      color: #1e3a8a;
    }

    .word-explain-popover-body table {
      border-collapse: collapse;
      width: 100%;
      margin: 8px 0;
      font-size: 12px;
      line-height: 1.4;
    }

    .word-explain-popover-body th,
    .word-explain-popover-body td {
      border: 1px solid #bfdbfe;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }

    .word-explain-popover-body th {
      background: #dbeafe;
      color: #1e3a8a;
      font-weight: 600;
    }

    .word-explain-popover-body tbody tr:nth-child(even) td {
      background: #f8fafc;
    }

    .word-explain-popover-body hr {
      border: none;
      border-top: 1.5px solid #bfdbfe;
      margin: 10px 0;
    }

    .word-explain-popover-body a {
      color: #2563eb;
      text-decoration: underline;
    }

    .word-explain-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 24px;
      color: #1e3a8a;
    }

    .word-explain-spinner {
      width: 26px;
      height: 26px;
      border: 2.5px solid #bfdbfe;
      border-top-color: #1e3a8a;
      border-radius: 50%;
      animation: cs-spin 0.7s linear infinite;
    }

    .word-explain-loading span {
      font-size: 12px;
      color: #1e3a8a;
      font-weight: 500;
    }

    /* ===== Summary chat (navy) ===== */

    .summary-chat-popover {
      position: fixed;
      background: #0f172a;
      border: 1.5px solid #1e3a8a;
      border-radius: 14px;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.55), 0 0 0 1px rgba(30, 58, 138, 0.35);
      width: 440px;
      height: 520px;
      min-width: 280px;
      min-height: 200px;
      display: none;
      flex-direction: column;
      z-index: 2147483649;
      pointer-events: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 13px;
      color: #e2e8f0;
      overflow: hidden;
    }

    .summary-chat-popover.visible {
      display: flex;
      animation: csDropIn 0.2s ease-out;
    }

    .summary-chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      background: linear-gradient(135deg, #1e3a8a 0%, #172554 100%);
      border-bottom: 1px solid #1e40af;
      flex-shrink: 0;
      cursor: move;
      user-select: none;
      -webkit-user-select: none;
    }

    .summary-chat-title {
      font-size: 14px;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: 0.02em;
      min-width: 0;
      flex: 1;
    }

    .summary-chat-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
      cursor: default;
    }

    .summary-chat-header-actions button {
      cursor: pointer;
    }

    .summary-chat-copy-json {
      padding: 6px 12px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.12);
      color: #f1f5f9;
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s;
      white-space: nowrap;
    }

    .summary-chat-copy-json:hover {
      background: rgba(255, 255, 255, 0.22);
      border-color: rgba(255, 255, 255, 0.5);
    }

    .summary-chat-copy-json.copied {
      background: #22c55e;
      border-color: #16a34a;
      color: #fff;
    }

    .summary-chat-advisors-wrap {
      flex-shrink: 0;
    }

    .summary-chat-expert-btn {
      width: 32px;
      height: 28px;
      padding: 2px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.12);
      color: #e8eef7;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, border-color 0.2s, opacity 0.2s;
    }

    .summary-chat-expert-btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.22);
      border-color: rgba(255, 255, 255, 0.5);
    }

    .summary-chat-expert-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .summary-chat-expert-btn-icon {
      width: 18px;
      height: 18px;
      display: block;
      flex-shrink: 0;
      pointer-events: none;
    }

    .summary-chat-advisors-panel {
      flex-shrink: 0;
      align-self: stretch;
      width: calc(100% - 20px);
      max-width: calc(100% - 20px);
      margin: 0 10px 10px 10px;
      box-sizing: border-box;
      max-height: min(280px, 45vh);
      padding: 10px 12px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .summary-chat-advisors-panel[hidden] {
      display: none !important;
    }

    .summary-chat-advisors-loading {
      font-size: 12px;
      color: #94a3b8;
    }

    .summary-chat-advisors-error {
      font-size: 12px;
      color: #fca5a5;
      line-height: 1.35;
    }

    .summary-chat-advisors-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 2px;
    }

    .summary-chat-advisors-list {
      width: 100%;
      background: #0f172a;
      border: 1px solid #475569;
      border-radius: 8px;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .summary-chat-advisor-item {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 7px;
      background: #1e293b;
      color: #e2e8f0;
      padding: 7px 8px;
      text-align: left;
      font-family: inherit;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: border-color 0.15s, background 0.15s;
    }

    .summary-chat-advisor-item:hover {
      background: #273449;
    }

    .summary-chat-advisor-item.active {
      border-color: #38bdf8;
      background: #1f3b52;
    }

    .summary-chat-advisor-title {
      font-size: 12px;
      font-weight: 600;
      color: #f8fafc;
      line-height: 1.25;
    }

    .summary-chat-advisor-subtitle {
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.3;
    }

    .summary-chat-advisors-regenerate {
      margin-top: 4px;
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #475569;
      border-radius: 8px;
      background: #334155;
      color: #f1f5f9;
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
    }

    .summary-chat-advisors-regenerate:hover:not(:disabled) {
      background: #475569;
    }

    .summary-chat-advisors-regenerate:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .summary-chat-close {
      width: 28px;
      height: 28px;
      border: none;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 50%;
      color: #fff;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s;
      line-height: 1;
    }

    .summary-chat-close:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .summary-chat-messages {
      flex: 1;
      overflow: auto;
      padding: 14px 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
      min-width: 0;
      background: #0f172a;
    }

    .summary-chat-messages::-webkit-scrollbar { width: 6px; }
    .summary-chat-messages::-webkit-scrollbar-track { background: transparent; }
    .summary-chat-messages::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
    .summary-chat-messages::-webkit-scrollbar-thumb:hover { background: #475569; }

    .summary-chat-msg-assistant {
      width: 100%;
      align-self: stretch;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px 14px;
      line-height: 1.65;
      color: #e2e8f0;
    }

    .summary-chat-msg-assistant .summary-chat-md h1,
    .summary-chat-msg-assistant .summary-chat-md h2,
    .summary-chat-msg-assistant .summary-chat-md h3 {
      color: #93c5fd;
      margin: 10px 0 6px;
      font-weight: 700;
    }

    .summary-chat-msg-assistant .summary-chat-md h1 { font-size: 1.15em; border-bottom: 1px solid #334155; padding-bottom: 4px; }
    .summary-chat-msg-assistant .summary-chat-md p { margin: 6px 0; color: #cbd5e1; }
    .summary-chat-msg-assistant .summary-chat-md strong { color: #f1f5f9; }
    .summary-chat-msg-assistant .summary-chat-md code {
      background: #0f172a;
      color: #7dd3fc;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.88em;
      border: 1px solid #334155;
    }
    .summary-chat-msg-assistant .summary-chat-md pre {
      background: #020617;
      color: #a5f3fc;
      padding: 10px 12px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 8px 0;
      font-size: 12px;
      border: 1px solid #1e3a8a;
    }
    .summary-chat-msg-assistant .summary-chat-md pre code { background: none; border: none; padding: 0; color: inherit; }
    .summary-chat-msg-assistant .summary-chat-md ul,
    .summary-chat-msg-assistant .summary-chat-md ol { margin: 6px 0; padding-left: 20px; }
    .summary-chat-msg-assistant .summary-chat-md a { color: #60a5fa; }

    .summary-chat-msg-assistant .summary-chat-md table {
      border-collapse: collapse;
      width: 100%;
      margin: 8px 0;
      font-size: 12px;
      line-height: 1.4;
    }

    .summary-chat-msg-assistant .summary-chat-md th,
    .summary-chat-msg-assistant .summary-chat-md td {
      border: 1px solid #475569;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }

    .summary-chat-msg-assistant .summary-chat-md th {
      background: #334155;
      color: #e2e8f0;
      font-weight: 600;
    }

    .summary-chat-msg-assistant .summary-chat-md tbody tr:nth-child(even) td {
      background: #0f172a;
    }

    .summary-chat-msg-user-wrap {
      display: flex;
      justify-content: flex-end;
      width: 100%;
    }

    .summary-chat-msg-user {
      max-width: 85%;
      background: linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%);
      border: 1px solid #3b82f6;
      border-radius: 14px 14px 4px 14px;
      padding: 10px 14px;
      line-height: 1.55;
      color: #f8fafc;
      font-size: 13px;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .summary-chat-msg-error {
      width: 100%;
      background: #450a0a;
      border: 1px solid #b91c1c;
      border-radius: 10px;
      padding: 10px 12px;
      color: #fecaca;
      font-size: 12px;
      line-height: 1.5;
    }

    .summary-chat-footer {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #1e3a8a;
      background: #0c1422;
      flex-shrink: 0;
      align-items: flex-end;
    }

    .summary-chat-input {
      flex: 1;
      min-height: 44px;
      max-height: 120px;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 13px;
      font-family: inherit;
      line-height: 1.45;
      resize: vertical;
      background: #1e293b;
      color: #f1f5f9;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .summary-chat-input:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
    }

    .summary-chat-input::placeholder { color: #64748b; }

    .summary-chat-input:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .summary-chat-send {
      padding: 10px 16px;
      border: none;
      border-radius: 10px;
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      flex-shrink: 0;
      transition: opacity 0.2s, transform 0.15s;
    }

    .summary-chat-send:hover:not(:disabled) {
      transform: translateY(-1px);
      opacity: 0.95;
    }

    .summary-chat-send:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none;
    }

    .assistant-chat-btn {
      padding: 4px 8px;
      border: 1.5px solid #C8E6C9;
      border-radius: 6px;
      background: #fff;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .assistant-chat-btn:hover:not(:disabled) {
      background: #E8F5E9;
      border-color: #81C784;
    }

    .assistant-chat-btn img {
      width: 22px;
      height: 22px;
      pointer-events: none;
      display: block;
    }

    .summary-chat-popover .loading-state {
      color: #93c5fd;
      min-height: 72px;
    }

    .summary-chat-popover .loading-state span {
      color: #93c5fd;
    }

    .summary-chat-popover .spinner {
      border-color: #334155;
      border-top-color: #60a5fa;
    }

    /* ===== Minimized floating dock (right edge, draggable by border) ===== */

    .cs-minimized-dock {
      position: fixed;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      left: auto;
      display: none;
      flex-direction: column;
      align-items: stretch;
      box-sizing: border-box;
      background: rgba(255, 255, 255, 0.08);
      border: 1.5px solid rgba(0, 0, 0, 0.18);
      border-radius: 14px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
      z-index: 2147483650;
      pointer-events: auto;
      max-height: calc(100vh - 48px);
    }

    .cs-minimized-dock.cs-minimized-dock--placed {
      right: auto;
      top: auto;
      transform: none;
    }

    .cs-minimized-dock-edge {
      position: absolute;
      z-index: 2;
      box-sizing: border-box;
      user-select: none;
      -webkit-user-select: none;
    }

    .cs-minimized-dock-edge:hover {
      background: rgba(0, 0, 0, 0.06);
    }

    .cs-minimized-dock-edge-n {
      top: 0;
      left: 0;
      right: 0;
      height: 10px;
      cursor: move;
    }

    .cs-minimized-dock-edge-s {
      bottom: 0;
      left: 0;
      right: 0;
      height: 10px;
      cursor: move;
    }

    .cs-minimized-dock-edge-w {
      top: 0;
      left: 0;
      bottom: 0;
      width: 10px;
      cursor: move;
    }

    .cs-minimized-dock-edge-e {
      top: 0;
      right: 0;
      bottom: 0;
      width: 10px;
      cursor: move;
    }

    .cs-minimized-dock-buttons {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 10px 8px;
      max-height: calc(100vh - 48px);
      overflow-x: hidden;
      overflow-y: auto;
      box-sizing: border-box;
    }

    .cs-minimized-dock-buttons::-webkit-scrollbar { width: 4px; }
    .cs-minimized-dock-buttons::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 3px;
    }

    .cs-minimized-btn {
      width: 44px;
      height: 44px;
      border: none;
      border-radius: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      background: rgba(255, 255, 255, 0.95);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
      transition: transform 0.15s, box-shadow 0.15s;
      flex-shrink: 0;
    }

    .cs-minimized-btn:hover {
      transform: scale(1.06);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    }

    .cs-minimized-btn img {
      width: 32px;
      height: 32px;
      object-fit: contain;
      pointer-events: none;
      display: block;
    }

    .cs-minimized-btn-emoji {
      font-size: 24px;
      line-height: 1;
    }

    .word-explain-popover-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .word-explain-popover-minimize {
      width: 22px;
      height: 22px;
      border: none;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 50%;
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s;
      line-height: 1;
    }

    .word-explain-popover-minimize:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .summary-chat-minimize {
      width: 28px;
      height: 28px;
      border: none;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 50%;
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s;
      line-height: 1;
    }

    .summary-chat-minimize:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  `;

  // ===================== State =====================

  let currentProvider = DEFAULT_PROVIDER;
  let apiTokens = {
    openai: '',
    gemini: '',
  };
  let rawResponse = '';
  let originalResponse = '';
  let isLoading = false;
  let hasBeenDragged = false;
  let pendingText = '';
  let lastSelectedText = '';
  let responseCache = {};

  let modalRoot = null;
  let modalShadow = null;
  let modal = null;
  let modalHeader = null;
  let modalBody = null;
  let dropdownClickHandler = null;
  let wordExplainPopover = null;
  let summaryChatPopover = null;
  let minimizedDock = null;

  const MINIMIZED_PANEL_ORDER = ['summary', 'explain', 'chat'];
  const MINIMIZED_PANEL_LABELS = {
    summary: 'Content Summarizer',
    explain: 'Explain',
    chat: 'Chat',
  };
  /** @type {Set<'summary' | 'explain' | 'chat'>} */
  let minimizedPanels = new Set();

  /** Pixel position for minimized dock after first layout or drag; null = use default CSS (right / centered). */
  let minimizedDockPos = null;

  let minimizedDockResizeBound = false;

  /** @type {{ role: 'user' | 'assistant', content: string }[]} */
  let summaryChatMessages = [];
  let summaryChatLoading = false;
  let summaryChatLastError = '';
  const DEFAULT_ADVISOR_VALUE = 'CHAT_SYSTEM_INSTRUCTION';
  /** @type {{ title: string, bio: string, instruction: string, value?: string }[]} */
  let summaryChatAdvisors = [];
  /** @type {{ title: string, bio: string, instruction: string, value?: string } | null} */
  let summaryChatAdvisorPersona = null;
  let summaryChatAdvisorSelectedValue = '';
  let summaryChatAdvisorsLoading = false;
  let summaryChatAdvisorsPanelOpen = false;
  let summaryChatExpertOutsideCloseBound = false;
  /** Last chat window geometry while main modal is open (cleared when main modal closes). */
  let summaryChatRect = null;
  /** True when chat was opened from context menu "Fast Chat" without the main modal. */
  let fastChatStandaloneMode = false;
  let lastContextMenuPos = { x: 100, y: 100 };
  const INIT_W = 560;
  const INIT_H = 500;

  function resetSummaryChatSession() {
    summaryChatMessages = [];
    summaryChatLoading = false;
    summaryChatLastError = '';
    summaryChatRect = null;
    clearSummaryChatExpertAdvisorsUi();
    minimizedPanels.delete('chat');
    if (minimizedDock) updateMinimizedDock();
    if (summaryChatPopover) {
      summaryChatPopover.classList.remove('visible');
      const input = summaryChatPopover.querySelector('.summary-chat-input');
      const msgs = summaryChatPopover.querySelector('.summary-chat-messages');
      if (input) input.value = '';
      if (msgs) msgs.innerHTML = '';
    }
  }

  function clearSummaryChatExpertAdvisorsUi() {
    summaryChatAdvisors = [];
    summaryChatAdvisorPersona = null;
    summaryChatAdvisorSelectedValue = '';
    summaryChatAdvisorsLoading = false;
    summaryChatAdvisorsPanelOpen = false;
    if (!summaryChatPopover) return;
    const panel = summaryChatPopover.querySelector('.summary-chat-advisors-panel');
    const loadingEl = summaryChatPopover.querySelector('.summary-chat-advisors-loading');
    const errEl = summaryChatPopover.querySelector('.summary-chat-advisors-error');
    const bodyEl = summaryChatPopover.querySelector('.summary-chat-advisors-body');
    const list = summaryChatPopover.querySelector('.summary-chat-advisors-list');
    const btn = summaryChatPopover.querySelector('.summary-chat-expert-btn');
    if (panel) panel.hidden = true;
    if (loadingEl) {
      loadingEl.hidden = true;
      loadingEl.textContent = 'Analyzing…';
    }
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = '';
    }
    if (bodyEl) bodyEl.hidden = true;
    if (list) list.innerHTML = '';
    if (btn) btn.setAttribute('aria-expanded', 'false');
    updateSummaryChatExpertButtonState();
  }

  function updateSummaryChatExpertButtonState() {
    if (!summaryChatPopover) return;
    const btn = summaryChatPopover.querySelector('.summary-chat-expert-btn');
    if (!btn) return;
    const ok = !!(rawResponse || '').trim() && !!getActiveApiKey();
    btn.disabled = !ok || summaryChatAdvisorsLoading;
  }

  function syncSummaryChatAdvisorPersonaFromValue(value, resetThread) {
    const safeValue = typeof value === 'string' ? value : '';
    const prevValue = summaryChatAdvisorSelectedValue;
    const row = summaryChatAdvisors.find((item) => item && item.value === safeValue);
    summaryChatAdvisorSelectedValue = row ? safeValue : '';
    summaryChatAdvisorPersona = row
      ? {
          title: row.title,
          bio: row.bio,
          instruction: row.value === DEFAULT_ADVISOR_VALUE ? '' : row.instruction || '',
          value: row.value || '',
        }
      : null;
    if (summaryChatPopover) {
      summaryChatPopover.querySelectorAll('.summary-chat-advisor-item').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.value === summaryChatAdvisorSelectedValue);
      });
    }
    if (resetThread && prevValue !== summaryChatAdvisorSelectedValue) {
      resetSummaryChatThreadForPersonaChange();
    }
  }

  /** Clear chat thread so the next request uses only the current advisor instruction (matches background systemContent / systemBlock). */
  function resetSummaryChatThreadForPersonaChange() {
    summaryChatMessages = [];
    summaryChatLastError = '';
    summaryChatLoading = false;
    if (!summaryChatPopover) return;
    const input = summaryChatPopover.querySelector('.summary-chat-input');
    if (input) input.value = '';
    setSummaryChatInputDisabled(false);
    renderSummaryChatMessages();
  }

  function setSummaryChatAdvisorsPanelOpen(open) {
    summaryChatAdvisorsPanelOpen = open;
    const btn = summaryChatPopover && summaryChatPopover.querySelector('.summary-chat-expert-btn');
    const panel = summaryChatPopover && summaryChatPopover.querySelector('.summary-chat-advisors-panel');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (panel) panel.hidden = !open;
  }

  function bindSummaryChatExpertOutsideClose() {
    if (summaryChatExpertOutsideCloseBound) return;
    summaryChatExpertOutsideCloseBound = true;
    window.addEventListener(
      'mousedown',
      (e) => {
        if (!summaryChatAdvisorsPanelOpen || !summaryChatPopover || !summaryChatPopover.classList.contains('visible')) {
          return;
        }
        const wrap = summaryChatPopover.querySelector('.summary-chat-advisors-wrap');
        const panel = summaryChatPopover.querySelector('.summary-chat-advisors-panel');
        if (!wrap && !panel) return;
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const inside = path.some(
          (n) =>
            n === wrap ||
            n === panel ||
            (wrap && n && wrap.contains(n)) ||
            (panel && n && panel.contains(n))
        );
        if (inside) return;
        setSummaryChatAdvisorsPanelOpen(false);
      },
      true
    );
  }

  async function fetchSummaryChatExpertAdvisors() {
    if (!summaryChatPopover || summaryChatAdvisorsLoading) return;
    const context = (rawResponse || '').trim();
    if (!context) return;
    if (!getActiveApiKey()) {
      const errEl = summaryChatPopover.querySelector('.summary-chat-advisors-error');
      if (errEl) {
        errEl.textContent = 'Add an API key in settings first.';
        errEl.hidden = false;
      }
      return;
    }

    summaryChatAdvisorsLoading = true;
    updateSummaryChatExpertButtonState();

    const loadingEl = summaryChatPopover.querySelector('.summary-chat-advisors-loading');
    const errEl = summaryChatPopover.querySelector('.summary-chat-advisors-error');
    const bodyEl = summaryChatPopover.querySelector('.summary-chat-advisors-body');
    const list = summaryChatPopover.querySelector('.summary-chat-advisors-list');
    const regen = summaryChatPopover.querySelector('.summary-chat-advisors-regenerate');
    if (regen) regen.disabled = true;

    if (loadingEl) loadingEl.hidden = false;
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = '';
    }
    if (bodyEl) bodyEl.hidden = true;
    if (list) list.innerHTML = '';

    try {
      if (!isContextValid()) throw new Error('Extension was reloaded. Please refresh the page.');
      const experts = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'suggest-expert-advisors',
              provider: currentProvider,
              apiKey: getActiveApiKey(),
              summaryContext: context,
            },
            (resp) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (!resp) {
                reject(new Error('No response from background script.'));
                return;
              }
              if (resp.success) resolve(resp.data);
              else reject(new Error(resp.error));
            }
          );
        } catch (e) {
          reject(e);
        }
      });

      const rawAdvisors = Array.isArray(experts) ? experts : [];
      summaryChatAdvisors = rawAdvisors.map((ex, i) => ({
        title: ex?.title || '',
        bio: ex?.bio || '',
        instruction: ex?.instruction || '',
        value:
          typeof ex?.value === 'string' && ex.value.trim()
            ? ex.value.trim()
            : `advisor_${i}`,
      }));
      if (list) {
        list.innerHTML = '';
        summaryChatAdvisors.forEach((ex) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'summary-chat-advisor-item';
          item.dataset.value = ex.value || '';
          item.title = ex.instruction || '';
          const title = document.createElement('span');
          title.className = 'summary-chat-advisor-title';
          title.textContent = ex.title || 'Untitled advisor';
          const subtitle = document.createElement('span');
          subtitle.className = 'summary-chat-advisor-subtitle';
          subtitle.textContent = ex.bio || '';
          item.appendChild(title);
          item.appendChild(subtitle);
          list.appendChild(item);
        });
      }
      const firstValue = summaryChatAdvisors[0] ? summaryChatAdvisors[0].value || '' : '';
      syncSummaryChatAdvisorPersonaFromValue(firstValue, true);
      if (loadingEl) loadingEl.hidden = true;
      if (bodyEl) bodyEl.hidden = false;
    } catch (err) {
      if (loadingEl) loadingEl.hidden = true;
      if (errEl) {
        errEl.textContent = err.message || String(err);
        errEl.hidden = false;
      }
    } finally {
      summaryChatAdvisorsLoading = false;
      if (regen) regen.disabled = false;
      updateSummaryChatExpertButtonState();
    }
  }

  function applyMinimizedDockPosition() {
    if (!minimizedDock || !minimizedDockPos) return;
    const pad = 4;
    const w = minimizedDock.offsetWidth || 60;
    const h = minimizedDock.offsetHeight || 60;
    let l = minimizedDockPos.left;
    let t = minimizedDockPos.top;
    l = Math.max(pad, Math.min(l, window.innerWidth - w - pad));
    t = Math.max(pad, Math.min(t, window.innerHeight - h - pad));
    minimizedDockPos.left = l;
    minimizedDockPos.top = t;
    minimizedDock.classList.add('cs-minimized-dock--placed');
    minimizedDock.style.left = `${l}px`;
    minimizedDock.style.top = `${t}px`;
  }

  function finalizeMinimizedDockDefaultPosition() {
    if (!minimizedDock || minimizedDock.style.display === 'none') return;
    const r = minimizedDock.getBoundingClientRect();
    minimizedDockPos = { left: r.left, top: r.top };
    applyMinimizedDockPosition();
  }

  function updateMinimizedDock() {
    if (!minimizedDock) return;
    const buttonsWrap = minimizedDock.querySelector('.cs-minimized-dock-buttons');
    if (!buttonsWrap) return;
    buttonsWrap.innerHTML = '';
    MINIMIZED_PANEL_ORDER.forEach((key) => {
      if (!minimizedPanels.has(key)) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cs-minimized-btn';
      if (key === 'explain') btn.classList.add('cs-minimized-btn-emoji');
      btn.title = MINIMIZED_PANEL_LABELS[key];
      btn.setAttribute('aria-label', MINIMIZED_PANEL_LABELS[key]);
      if (key === 'summary') {
        const img = document.createElement('img');
        img.alt = '';
        img.src = chrome.runtime.getURL('icons/icon48.png');
        btn.appendChild(img);
      } else if (key === 'chat') {
        const img = document.createElement('img');
        img.alt = '';
        img.src = chrome.runtime.getURL('icons/assistant.png');
        btn.appendChild(img);
      } else {
        btn.textContent = '🔍';
      }
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        restoreMinimizedPanel(key);
      });
      buttonsWrap.appendChild(btn);
    });

    if (minimizedPanels.size > 0) {
      minimizedDock.style.display = 'flex';
      if (minimizedDockPos) {
        minimizedDock.classList.add('cs-minimized-dock--placed');
        requestAnimationFrame(() => applyMinimizedDockPosition());
      } else {
        minimizedDock.classList.remove('cs-minimized-dock--placed');
        minimizedDock.style.left = '';
        minimizedDock.style.top = '';
        minimizedDock.style.right = '';
        minimizedDock.style.transform = '';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => finalizeMinimizedDockDefaultPosition());
        });
      }
    } else {
      minimizedDock.style.display = 'none';
    }
  }

  function initMinimizedDockDrag() {
    if (!minimizedDock) return;
    const edges = minimizedDock.querySelectorAll('.cs-minimized-dock-edge');
    if (!edges.length) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    function onMove(e) {
      if (!dragging || !minimizedDockPos) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      minimizedDockPos.left = startLeft + dx;
      minimizedDockPos.top = startTop + dy;
      applyMinimizedDockPosition();
      e.preventDefault();
    }

    function onUp() {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    edges.forEach((edge) => {
      edge.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (minimizedDockPos === null) {
          finalizeMinimizedDockDefaultPosition();
        }
        if (!minimizedDockPos) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = minimizedDockPos.left;
        startTop = minimizedDockPos.top;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });

    if (!minimizedDockResizeBound) {
      minimizedDockResizeBound = true;
      window.addEventListener('resize', () => {
        if (minimizedDockPos && minimizedDock && minimizedPanels.size > 0) {
          applyMinimizedDockPosition();
        }
      });
    }
  }

  function restoreMinimizedPanel(key) {
    if (!minimizedPanels.has(key)) return;
    minimizedPanels.delete(key);
    updateMinimizedDock();
    if (key === 'summary') {
      modal.style.display = 'flex';
    } else if (key === 'explain') {
      wordExplainPopover.classList.add('visible');
    } else if (key === 'chat') {
      positionSummaryChatPopover();
      summaryChatPopover.classList.add('visible');
      setTimeout(() => summaryChatPopover.querySelector('.summary-chat-input')?.focus(), 50);
    }
  }

  function minimizeSummaryPanel() {
    minimizedPanels.add('summary');
    modal.style.display = 'none';
    updateMinimizedDock();
  }

  function minimizeExplainPanel() {
    wordExplainPopover.classList.remove('visible');
    minimizedPanels.add('explain');
    updateMinimizedDock();
  }

  function minimizeChatPanel() {
    persistSummaryChatLayout();
    summaryChatPopover.classList.remove('visible');
    minimizedPanels.add('chat');
    updateMinimizedDock();
  }

  function persistSummaryChatLayout() {
    if (!summaryChatPopover) return;
    const rect = summaryChatPopover.getBoundingClientRect();
    summaryChatRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function positionSummaryChatPopover() {
    if (!summaryChatPopover) return;
    if (summaryChatRect) {
      summaryChatPopover.style.width = summaryChatRect.width + 'px';
      summaryChatPopover.style.height = summaryChatRect.height + 'px';
      summaryChatPopover.style.left = summaryChatRect.left + 'px';
      summaryChatPopover.style.top = summaryChatRect.top + 'px';
      return;
    }
    const w = 440;
    const h = 520;
    summaryChatPopover.style.width = w + 'px';
    summaryChatPopover.style.height = h + 'px';
    summaryChatPopover.style.left = Math.max(12, (window.innerWidth - w) / 2) + 'px';
    summaryChatPopover.style.top = Math.max(12, (window.innerHeight - h) / 2) + 'px';
  }

  function renderSummaryChatMessages() {
    if (!summaryChatPopover) return;
    const container = summaryChatPopover.querySelector('.summary-chat-messages');
    if (!container) return;
    container.innerHTML = '';
    summaryChatMessages.forEach((m) => {
      if (m.role === 'user') {
        const wrap = document.createElement('div');
        wrap.className = 'summary-chat-msg-user-wrap';
        const bubble = document.createElement('div');
        bubble.className = 'summary-chat-msg-user';
        bubble.textContent = m.content;
        wrap.appendChild(bubble);
        container.appendChild(wrap);
      } else {
        const block = document.createElement('div');
        block.className = 'summary-chat-msg-assistant';
        const md = document.createElement('div');
        md.className = 'summary-chat-md';
        md.innerHTML = parseMarkdown(m.content);
        block.appendChild(md);
        container.appendChild(block);
      }
    });
    if (summaryChatLoading) {
      const loading = document.createElement('div');
      loading.className = 'summary-chat-msg-assistant';
      loading.innerHTML =
        '<div class="loading-state"><div class="spinner"></div><span>Thinking…</span></div>';
      container.appendChild(loading);
    }
    if (summaryChatLastError) {
      const err = document.createElement('div');
      err.className = 'summary-chat-msg-error';
      err.textContent = `Error: ${summaryChatLastError}`;
      container.appendChild(err);
    }
    container.scrollTop = container.scrollHeight;
  }

  function setSummaryChatInputDisabled(disabled) {
    if (!summaryChatPopover) return;
    const input = summaryChatPopover.querySelector('.summary-chat-input');
    const send = summaryChatPopover.querySelector('.summary-chat-send');
    if (input) input.disabled = disabled;
    if (send) send.disabled = disabled;
  }

  function isSummaryChatPopoverVisible() {
    return !!(summaryChatPopover && summaryChatPopover.classList.contains('visible'));
  }

  function openSummaryChatPanel() {
    if (!summaryChatPopover || !rawResponse || !rawResponse.trim()) return;
    minimizedPanels.delete('chat');
    if (minimizedDock) updateMinimizedDock();
    const titleEl = summaryChatPopover.querySelector('.summary-chat-title');
    if (titleEl && !fastChatStandaloneMode) {
      titleEl.textContent = 'Chat about summary';
    }
    positionSummaryChatPopover();
    summaryChatPopover.classList.add('visible');
    updateSummaryChatExpertButtonState();
    renderSummaryChatMessages();
    setTimeout(() => summaryChatPopover.querySelector('.summary-chat-input')?.focus(), 50);
  }

  function renderStandaloneFastChatNeedKey() {
    if (!summaryChatPopover) return;
    const titleEl = summaryChatPopover.querySelector('.summary-chat-title');
    if (titleEl) titleEl.textContent = 'Fast Chat';
    const container = summaryChatPopover.querySelector('.summary-chat-messages');
    const input = summaryChatPopover.querySelector('.summary-chat-input');
    if (container) {
      container.innerHTML = `
        <div class="summary-chat-msg-assistant">
          <div class="summary-chat-md">
            <p>Add your API key first: click the <strong>Content Summarizer</strong> icon on the browser toolbar, enter your key in settings, then run <strong>Fast Chat</strong> again.</p>
          </div>
        </div>`;
    }
    if (input) {
      input.value = '';
      input.placeholder = 'API key required…';
      input.disabled = true;
    }
    const send = summaryChatPopover.querySelector('.summary-chat-send');
    if (send) send.disabled = true;
  }

  function openStandaloneFastChat(selectionText) {
    if (!isContextValid()) return;
    ensureModal();
    fastChatStandaloneMode = true;
    modal.style.display = 'none';
    resetSummaryChatSession();
    rawResponse = selectionText;
    originalResponse = selectionText;
    responseCache = {};

    const finish = () => {
      if (!summaryChatPopover) return;
      const titleEl = summaryChatPopover.querySelector('.summary-chat-title');
      if (titleEl) titleEl.textContent = 'Fast Chat';
      if (!getActiveApiKey()) {
        renderStandaloneFastChatNeedKey();
        positionSummaryChatPopover();
        summaryChatPopover.classList.add('visible');
        return;
      }
      summaryChatMessages = [];
      summaryChatLastError = '';
      const input = summaryChatPopover.querySelector('.summary-chat-input');
      const send = summaryChatPopover.querySelector('.summary-chat-send');
      if (input) {
        input.disabled = false;
        input.placeholder = 'Ask about this summary...';
      }
      if (send) send.disabled = false;
      positionSummaryChatPopover();
      summaryChatPopover.classList.add('visible');
      renderSummaryChatMessages();
      setTimeout(() => input?.focus(), 50);
    };

    try {
      chrome.storage.local.get(
        [
          STORAGE_KEYS.provider,
          STORAGE_KEYS.tokens.openai,
          STORAGE_KEYS.tokens.gemini,
        ],
        (result) => {
          if (!isContextValid()) return;
          currentProvider = normalizeProvider(result[STORAGE_KEYS.provider]);
          setTokenForProvider('openai', result[STORAGE_KEYS.tokens.openai] || '');
          setTokenForProvider('gemini', result[STORAGE_KEYS.tokens.gemini] || '');
          finish();
        }
      );
    } catch {
      finish();
    }
  }

  async function sendSummaryChatTurn() {
    if (!summaryChatPopover || summaryChatLoading) return;
    const input = summaryChatPopover.querySelector('.summary-chat-input');
    const text = (input && input.value ? input.value : '').trim();
    if (!text) return;
    const context = (rawResponse || '').trim();
    if (!context) return;

    summaryChatLastError = '';
    input.value = '';
    summaryChatMessages.push({ role: 'user', content: text });
    summaryChatLoading = true;
    setSummaryChatInputDisabled(true);
    renderSummaryChatMessages();

    try {
      if (!isContextValid()) throw new Error('Extension was reloaded. Please refresh the page.');
      const reply = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'chat-about-summary',
              provider: currentProvider,
              apiKey: getActiveApiKey(),
              summaryContext: context,
              messages: summaryChatMessages,
              advisorPersona: summaryChatAdvisorPersona,
            },
            (resp) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (!resp) {
                reject(new Error('No response from background script.'));
                return;
              }
              if (resp.success) resolve(resp.data);
              else reject(new Error(resp.error));
            }
          );
        } catch (e) {
          reject(e);
        }
      });
      summaryChatMessages.push({ role: 'assistant', content: reply });
    } catch (err) {
      summaryChatLastError = err.message || String(err);
    } finally {
      summaryChatLoading = false;
      setSummaryChatInputDisabled(false);
      renderSummaryChatMessages();
    }
  }

  function normalizeProvider(provider) {
    return PROVIDER_OPTIONS.some((option) => option.value === provider)
      ? provider
      : DEFAULT_PROVIDER;
  }

  function getActiveApiKey(provider = currentProvider) {
    const normalized = normalizeProvider(provider);
    return (apiTokens[normalized] || '').trim();
  }

  function setTokenForProvider(provider, tokenValue) {
    const normalized = normalizeProvider(provider);
    apiTokens[normalized] = (tokenValue || '').trim();
  }

  function getProviderLabel(provider = currentProvider) {
    const normalized = normalizeProvider(provider);
    const option = PROVIDER_OPTIONS.find((item) => item.value === normalized);
    return option ? option.label : 'OpenAI';
  }

  // ===================== Selection Popover =====================
  // NOTE: This feature (highlight text on page → icon to summarize) is disabled.
  // The code is preserved below in case it needs to be re-enabled in the future.

  /*
  function setupPopover() {
    const host = document.createElement('div');
    host.id = POPOVER_ID;
    host.style.cssText =
      'all:initial; position:fixed; top:0; left:0; width:0; height:0; z-index:2147483646; pointer-events:none;';

    const pShadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .cs-popover {
        position: fixed;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: #fff;
        border: 2.5px solid #66BB6A;
        box-shadow: 0 4px 18px rgba(0,0,0,0.14), 0 0 0 1px rgba(102,187,106,0.1);
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0;
        pointer-events: auto;
        transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
      }
      .cs-popover:hover {
        transform: scale(1.15);
        box-shadow: 0 6px 24px rgba(76,175,80,0.35);
        border-color: #43A047;
      }
      .cs-popover.visible {
        display: flex;
        animation: csPop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .cs-popover img {
        width: 22px;
        height: 22px;
        pointer-events: none;
        border-radius: 2px;
      }
      @keyframes csPop {
        from { opacity: 0; transform: scale(0.4); }
        to   { opacity: 1; transform: scale(1); }
      }
    `;
    pShadow.appendChild(style);

    const btn = document.createElement('button');
    btn.className = 'cs-popover';
    btn.title = 'Summarize selection';
    const img = document.createElement('img');
    try {
      img.src = chrome.runtime.getURL('icons/icon48.png');
    } catch {}
    img.alt = 'Summarize';
    btn.appendChild(img);
    pShadow.appendChild(btn);

    document.body.appendChild(host);

    document.addEventListener('mouseup', (e) => {
      if (!isContextValid()) return;
      if (e.composedPath().includes(host)) return;
      if (modalRoot && e.composedPath().includes(modalRoot)) return;

      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : '';

        if (text.length > 2) {
          lastSelectedText = text;
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();

          let left = rect.right + 8;
          let top = rect.top + rect.height / 2 - 19;

          if (left + 42 > window.innerWidth) left = rect.left - 48;
          if (left < 4) left = 4;
          if (top < 4) top = 4;
          if (top + 38 > window.innerHeight) top = window.innerHeight - 42;

          btn.style.left = left + 'px';
          btn.style.top = top + 'px';
          btn.classList.add('visible');
        } else {
          btn.classList.remove('visible');
        }
      }, 10);
    });

    document.addEventListener('mousedown', (e) => {
      if (e.composedPath().includes(host)) return;
      btn.classList.remove('visible');
    });

    document.addEventListener(
      'scroll',
      () => {
        btn.classList.remove('visible');
      },
      true
    );

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isContextValid()) return;
      btn.classList.remove('visible');
      openModal(lastSelectedText);
      lastSelectedText = '';
    });
  }
  */

  // ===================== Modal: Lazy Creation =====================

  function ensureModal() {
    if (modalRoot) return;

    modalRoot = document.createElement('div');
    modalRoot.id = MODAL_ID;
    modalRoot.style.cssText =
      'all:initial; position:fixed; top:0; left:0; width:0; height:0; z-index:2147483647; pointer-events:none;';

    modalShadow = modalRoot.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = MODAL_CSS;
    modalShadow.appendChild(styleEl);

    modal = document.createElement('div');
    modal.className = 'modal modal-enter';
    modal.style.display = 'none';
    modal.style.left = (window.innerWidth - INIT_W) / 2 + 'px';
    modal.style.top = (window.innerHeight - INIT_H) / 2 + 'px';
    modal.style.width = INIT_W + 'px';
    modal.style.height = INIT_H + 'px';

    modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';
    modalHeader.innerHTML = `
      <span class="modal-title">Content Summarizer</span>
      <div class="header-actions">
        <button class="header-btn settings-btn" title="API Key Settings">⚙</button>
        <button type="button" class="header-btn minimize-btn" title="Minimize">−</button>
        <button type="button" class="header-btn close-btn" title="Close">✕</button>
      </div>
    `;
    modal.appendChild(modalHeader);

    modalBody = document.createElement('div');
    modalBody.className = 'modal-body';
    modal.appendChild(modalBody);

    modalShadow.appendChild(modal);
    document.body.appendChild(modalRoot);

    // ===================== Word Explainer Elements =====================

    wordExplainPopover = document.createElement('div');
    wordExplainPopover.className = 'word-explain-popover';
    wordExplainPopover.innerHTML = `
      <div class="word-explain-popover-header">
        <span class="word-explain-popover-title">🔍 Explain</span>
        <span class="word-explain-popover-term"></span>
        <div class="word-explain-popover-header-actions">
          <button type="button" class="word-explain-popover-minimize" title="Minimize">−</button>
          <button type="button" class="word-explain-popover-close" title="Close">✕</button>
        </div>
      </div>
      <div class="word-explain-popover-body"></div>
    `;
    modalShadow.appendChild(wordExplainPopover);

    wordExplainPopover.querySelector('.word-explain-popover-minimize').addEventListener('click', () => {
      minimizeExplainPanel();
    });

    wordExplainPopover.querySelector('.word-explain-popover-close').addEventListener('click', () => {
      minimizedPanels.delete('explain');
      if (minimizedDock) updateMinimizedDock();
      wordExplainPopover.classList.remove('visible');
    });

    initExplainDrag(wordExplainPopover, wordExplainPopover.querySelector('.word-explain-popover-header'));
    initExplainResize(wordExplainPopover);

    // ===================== Summary chat popover =====================

    summaryChatPopover = document.createElement('div');
    summaryChatPopover.className = 'summary-chat-popover';
    summaryChatPopover.innerHTML = `
      <div class="summary-chat-header">
        <span class="summary-chat-title">Chat about summary</span>
        <div class="summary-chat-header-actions">
          <div class="summary-chat-advisors-wrap">
            <button type="button" class="summary-chat-expert-btn" title="Suggest expert advisors for this topic" aria-haspopup="listbox" aria-expanded="false" disabled>
              <svg class="summary-chat-expert-btn-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="1.75"/>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <button type="button" class="summary-chat-copy-json" title="Copy chat as JSON">Copy JSON</button>
          <button type="button" class="summary-chat-minimize" title="Minimize">−</button>
          <button type="button" class="summary-chat-close" title="Close">✕</button>
        </div>
      </div>
      <div class="summary-chat-advisors-panel" hidden>
        <div class="summary-chat-advisors-loading" hidden>Analyzing…</div>
        <div class="summary-chat-advisors-error" hidden></div>
        <div class="summary-chat-advisors-body" hidden>
          <label class="summary-chat-advisors-label">Advisory perspectives</label>
          <div class="summary-chat-advisors-list" role="listbox" aria-label="Pick an expert perspective"></div>
          <button type="button" class="summary-chat-advisors-regenerate">Re-generate</button>
        </div>
      </div>
      <div class="summary-chat-messages"></div>
      <div class="summary-chat-footer">
        <textarea class="summary-chat-input" placeholder="Ask about this summary..." rows="2"></textarea>
        <button type="button" class="summary-chat-send">Send</button>
      </div>
    `;
    modalShadow.appendChild(summaryChatPopover);

    bindSummaryChatExpertOutsideClose();

    const summaryChatAdvisorsPanelEl = summaryChatPopover.querySelector('.summary-chat-advisors-panel');
    if (summaryChatAdvisorsPanelEl) {
      summaryChatAdvisorsPanelEl.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    const summaryChatExpertBtn = summaryChatPopover.querySelector('.summary-chat-expert-btn');
    const summaryChatAdvisorsList = summaryChatPopover.querySelector('.summary-chat-advisors-list');
    const summaryChatAdvisorsRegen = summaryChatPopover.querySelector('.summary-chat-advisors-regenerate');

    if (summaryChatExpertBtn) {
      summaryChatExpertBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (summaryChatExpertBtn.disabled || summaryChatAdvisorsLoading) return;
        const opening = !summaryChatAdvisorsPanelOpen;
        if (opening) {
          setSummaryChatAdvisorsPanelOpen(true);
          if (summaryChatAdvisors.length === 0) {
            fetchSummaryChatExpertAdvisors();
          } else {
            const loadingEl = summaryChatPopover.querySelector('.summary-chat-advisors-loading');
            const errEl = summaryChatPopover.querySelector('.summary-chat-advisors-error');
            const bodyEl = summaryChatPopover.querySelector('.summary-chat-advisors-body');
            if (loadingEl) loadingEl.hidden = true;
            if (errEl) errEl.hidden = true;
            if (bodyEl) bodyEl.hidden = false;
          }
        } else {
          setSummaryChatAdvisorsPanelOpen(false);
        }
      });
    }

    if (summaryChatAdvisorsList) {
      summaryChatAdvisorsList.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target.closest('.summary-chat-advisor-item') : null;
        if (!target) return;
        e.stopPropagation();
        syncSummaryChatAdvisorPersonaFromValue(target.dataset.value || '', true);
        setSummaryChatAdvisorsPanelOpen(false);
      });
    }

    if (summaryChatAdvisorsRegen) {
      summaryChatAdvisorsRegen.addEventListener('click', (e) => {
        e.stopPropagation();
        if (summaryChatAdvisorsLoading) return;
        fetchSummaryChatExpertAdvisors();
      });
    }

    summaryChatPopover.querySelector('.summary-chat-minimize').addEventListener('click', () => {
      minimizeChatPanel();
    });

    summaryChatPopover.querySelector('.summary-chat-close').addEventListener('click', () => {
      fastChatStandaloneMode = false;
      minimizedPanels.delete('chat');
      if (minimizedDock) updateMinimizedDock();
      summaryChatPopover.classList.remove('visible');
    });

    summaryChatPopover.querySelector('.summary-chat-copy-json').addEventListener('click', () => {
      const copyBtn = summaryChatPopover.querySelector('.summary-chat-copy-json');
      const payload = {
        summaryContext: rawResponse || '',
        messages: summaryChatMessages.map((m) => ({ role: m.role, content: m.content })),
      };
      const text = JSON.stringify(payload, null, 2);
      navigator.clipboard.writeText(text).then(
        () => {
          copyBtn.classList.add('copied');
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.textContent = 'Copy JSON';
          }, 1600);
        },
        () => {
          const tmp = document.createElement('textarea');
          tmp.value = text;
          tmp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand('copy');
          document.body.removeChild(tmp);
          copyBtn.classList.add('copied');
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.textContent = 'Copy JSON';
          }, 1600);
        }
      );
    });

    summaryChatPopover.querySelector('.summary-chat-send').addEventListener('click', () => {
      sendSummaryChatTurn();
    });

    const summaryChatInputEl = summaryChatPopover.querySelector('.summary-chat-input');
    summaryChatInputEl.setAttribute('autocomplete', 'off');
    summaryChatInputEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      // IME / CJK / some Thai keyboards: never hijack Enter during composition
      if (e.isComposing || e.keyCode === 229) return;
      // While the model is replying, Enter should insert a newline (default), not call send
      if (summaryChatLoading) return;
      e.preventDefault();
      sendSummaryChatTurn();
    });

    initSummaryChatDrag();
    initSummaryChatEdgeResize();

    // ===================== End Word Explainer Elements =====================

    modalHeader.querySelector('.minimize-btn').addEventListener('click', () => {
      minimizeSummaryPanel();
    });

    modalHeader.querySelector('.close-btn').addEventListener('click', () => {
      minimizedPanels.delete('summary');
      if (minimizedDock) updateMinimizedDock();
      hideModal();
    });

    modalHeader.querySelector('.settings-btn').addEventListener('click', () => {
      if (summaryChatPopover) summaryChatPopover.classList.remove('visible');
      const currentW = parseFloat(modal.style.width);
      if (currentW > INIT_W) {
        modal.style.transition = 'width 0.3s ease';
        modal.style.width = INIT_W + 'px';
        setTimeout(() => (modal.style.transition = ''), 320);
      }
      showKeyView();
    });

    ['keydown', 'keypress', 'keyup'].forEach((evtType) => {
      modal.addEventListener(evtType, (e) => e.stopPropagation());
    });

    initDrag();
    initEdgeResize();

    minimizedDock = document.createElement('div');
    minimizedDock.className = 'cs-minimized-dock';
    minimizedDock.style.display = 'none';
    ['n', 'e', 's', 'w'].forEach((dir) => {
      const edge = document.createElement('div');
      edge.className = `cs-minimized-dock-edge cs-minimized-dock-edge-${dir}`;
      edge.title = 'Drag to move';
      minimizedDock.appendChild(edge);
    });
    const dockButtons = document.createElement('div');
    dockButtons.className = 'cs-minimized-dock-buttons';
    minimizedDock.appendChild(dockButtons);
    modalShadow.appendChild(minimizedDock);
    initMinimizedDockDrag();
    updateMinimizedDock();
  }

  // ===================== Open / Toggle =====================

  function showModal() {
    minimizedPanels.delete('summary');
    if (minimizedDock) updateMinimizedDock();
    modal.style.display = 'flex';
  }

  function hideModal() {
    modal.style.display = 'none';
    fastChatStandaloneMode = false;
    resetSummaryChatSession();
  }

  function isModalVisible() {
    return modal && modal.style.display !== 'none';
  }

  function openModal(prefillText) {
    if (!isContextValid()) return;
    fastChatStandaloneMode = false;
    if (summaryChatPopover) summaryChatPopover.classList.remove('visible');
    pendingText = prefillText || '';
    ensureModal();
    showModal();

    if (getActiveApiKey()) {
      showMainView();
      return;
    }

    showKeyView();

    try {
      chrome.storage.local.get(
        [
          STORAGE_KEYS.provider,
          STORAGE_KEYS.tokens.openai,
          STORAGE_KEYS.tokens.gemini,
        ],
        (result) => {
          if (!isContextValid()) return;
          currentProvider = normalizeProvider(result[STORAGE_KEYS.provider]);
          setTokenForProvider('openai', result[STORAGE_KEYS.tokens.openai] || '');
          setTokenForProvider('gemini', result[STORAGE_KEYS.tokens.gemini] || '');
          if (getActiveApiKey()) showMainView();
        }
      );
    } catch {}
  }

  function toggleModal() {
    if (isModalVisible()) {
      hideModal();
      return;
    }
    if (isSummaryChatPopoverVisible() && fastChatStandaloneMode) {
      fastChatStandaloneMode = false;
      resetSummaryChatSession();
      return;
    }
    openModal('');
  }

  // ===================== Views =====================

  function buildProviderOptions(selectedProvider) {
    return PROVIDER_OPTIONS.map((providerOption) => {
      const isSelected = selectedProvider === providerOption.value ? 'selected' : '';
      return `<option value="${providerOption.value}" ${isSelected}>${providerOption.label}</option>`;
    }).join('');
  }

  function showKeyView(errorMsg) {
    modalBody.innerHTML = '';
    const view = document.createElement('div');
    view.className = 'key-view';
    view.innerHTML = `
      <div class="icon">🔑</div>
      <h2>Set AI Provider API Key</h2>
      <p>Your key is stored locally in your browser and only used for your selected provider.</p>
      <select class="key-input provider-select">${buildProviderOptions(currentProvider)}</select>
      <input type="password" placeholder="Enter API key..." class="key-input" />
      <span class="error-msg">${errorMsg || ''}</span>
      <button class="save-btn">Save & Continue</button>
    `;
    modalBody.appendChild(view);

    const providerSelect = view.querySelector('.provider-select');
    const input = view.querySelector('input.key-input');
    const errSpan = view.querySelector('.error-msg');
    const saveBtn = view.querySelector('.save-btn');

    function syncKeyInputByProvider() {
      const selectedProvider = normalizeProvider(providerSelect.value);
      providerSelect.value = selectedProvider;
      input.value = getActiveApiKey(selectedProvider);
      input.placeholder = selectedProvider === 'gemini' ? 'AIza...' : 'sk-...';
    }

    syncKeyInputByProvider();

    providerSelect.addEventListener('change', () => {
      currentProvider = normalizeProvider(providerSelect.value);
      syncKeyInputByProvider();
    });

    saveBtn.addEventListener('click', () => {
      const selectedProvider = normalizeProvider(providerSelect.value);
      const val = input.value.trim();
      if (!val) {
        errSpan.textContent = `Please enter a valid ${getProviderLabel(selectedProvider)} API key.`;
        return;
      }

      currentProvider = selectedProvider;
      setTokenForProvider(selectedProvider, val);
      try {
        chrome.storage.local.set({
          [STORAGE_KEYS.provider]: currentProvider,
          [STORAGE_KEYS.tokens.openai]: apiTokens.openai,
          [STORAGE_KEYS.tokens.gemini]: apiTokens.gemini,
        });
      } catch {}
      showMainView();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
    });

    setTimeout(() => input.focus(), 50);
  }

  function showMainView() {
    if (dropdownClickHandler) {
      modalShadow.removeEventListener('click', dropdownClickHandler);
      dropdownClickHandler = null;
    }

    modalBody.innerHTML = '';

    const activeProviderLabel = getProviderLabel(currentProvider);
    const inputPanel = document.createElement('div');
    inputPanel.className = 'input-panel';
    inputPanel.innerHTML = `
      <div class="input-toggle-row">
        <div class="input-toggle">
          <button class="toggle-option active" data-mode="text">📝 Text</button>
          <button class="toggle-option" data-mode="url">🔗 URL</button>
        </div>
      </div>
      <textarea class="content-input" placeholder="Paste or type your content here to summarize..."></textarea>
      <div class="url-section" style="display:none">
        <input type="url" class="url-input" placeholder="Enter a URL to summarize (e.g., https://example.com/article)" />
        <div class="url-display" style="display:none">
          <span class="url-display-text"></span>
          <button class="url-open-btn">Open ↗</button>
        </div>
      </div>
      <div class="option-row">
        <label>Provider:</label>
        <span class="hint">${activeProviderLabel}</span>
      </div>
      <div class="option-row">
        <label>Response length:</label>
        <input type="number" class="response-length" placeholder="words" min="1" />
        <span class="hint">(optional)</span>
      </div>
      <div class="option-row">
        <label>Output language:</label>
        <div class="lang-select-wrapper">
          <button type="button" class="lang-select-btn">🌐 Auto ▾</button>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-summarize">Summarize</button>
        <button class="btn btn-clear">Clear</button>
      </div>
    `;
    modalBody.appendChild(inputPanel);

    const divider = document.createElement('div');
    divider.className = 'divider';
    divider.style.display = 'none';
    modalBody.appendChild(divider);

    const responsePanel = document.createElement('div');
    responsePanel.className = 'response-panel';
    responsePanel.style.display = 'none';
    responsePanel.innerHTML = `
      <div class="response-header">
        <div class="response-title-row">
          <span class="response-title">Summary</span>
          <button class="refresh-btn" title="Re-summarize">↻ Refresh</button>
        </div>
        <div class="response-actions">
          <div class="translate-wrapper">
            <button class="translate-btn" title="Translate"></button>
          </div>
          <button type="button" class="assistant-chat-btn" title="Chat about this summary" aria-label="Chat about summary"></button>
          <button class="copy-btn">📋 Copy</button>
        </div>
      </div>
      <div class="response-content">
        <div class="placeholder-text">Your summary will appear here...</div>
      </div>
    `;
    modalBody.appendChild(responsePanel);

    const textarea = inputPanel.querySelector('.content-input');
    const lengthInput = inputPanel.querySelector('.response-length');
    const summarizeBtn = inputPanel.querySelector('.btn-summarize');
    const clearBtn = inputPanel.querySelector('.btn-clear');
    const urlSection = inputPanel.querySelector('.url-section');
    const urlInput = inputPanel.querySelector('.url-input');
    const urlDisplay = inputPanel.querySelector('.url-display');
    const urlDisplayText = inputPanel.querySelector('.url-display-text');
    const urlOpenBtn = inputPanel.querySelector('.url-open-btn');
    const toggleBtns = inputPanel.querySelectorAll('.toggle-option');
    const copyBtn = responsePanel.querySelector('.copy-btn');
    const refreshBtn = responsePanel.querySelector('.refresh-btn');
    const responseContent = responsePanel.querySelector('.response-content');
    const translateBtn = responsePanel.querySelector('.translate-btn');
    const translateWrapper = responsePanel.querySelector('.translate-wrapper');
    const assistantChatBtn = responsePanel.querySelector('.assistant-chat-btn');

    let inputMode = 'text';

    const langSelectBtn = inputPanel.querySelector('.lang-select-btn');
    const langSelectWrapper = inputPanel.querySelector('.lang-select-wrapper');
    let selectedLang = 'auto';
    let langDropdownOpen = false;

    function closeLangDropdown() {
      const dd = langSelectWrapper.querySelector('.lang-select-dropdown');
      if (dd) dd.remove();
      langDropdownOpen = false;
    }

    langSelectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (langDropdownOpen) {
        closeLangDropdown();
        return;
      }
      closeDropdown();

      const dropdown = document.createElement('div');
      dropdown.className = 'lang-select-dropdown';

      const autoOpt = document.createElement('button');
      autoOpt.className = 'translate-option';
      autoOpt.innerHTML = '<span class="flag">🌐</span><span class="lang-name">Auto</span>';
      autoOpt.addEventListener('click', () => {
        selectedLang = 'auto';
        langSelectBtn.textContent = '🌐 Auto ▾';
        closeLangDropdown();
      });
      dropdown.appendChild(autoOpt);

      LANGUAGES.forEach((lang) => {
        const option = document.createElement('button');
        option.className = 'translate-option';
        option.innerHTML = `<span class="flag">${lang.flag}</span><span class="lang-name">${lang.name}</span>`;
        option.addEventListener('click', () => {
          selectedLang = lang.code;
          langSelectBtn.textContent = `${lang.flag} ${lang.name} ▾`;
          closeLangDropdown();
        });
        dropdown.appendChild(option);
      });

      langSelectWrapper.appendChild(dropdown);
      langDropdownOpen = true;
    });

    const translateImg = document.createElement('img');
    try {
      translateImg.src = chrome.runtime.getURL('icons/translate.png');
    } catch {}
    translateImg.alt = 'Translate';
    translateBtn.appendChild(translateImg);

    const assistantImg = document.createElement('img');
    try {
      assistantImg.src = chrome.runtime.getURL('icons/assistant.png');
    } catch {}
    assistantImg.alt = 'Assistant';
    assistantChatBtn.appendChild(assistantImg);
    assistantChatBtn.addEventListener('click', () => openSummaryChatPanel());

    if (pendingText) {
      textarea.value = pendingText;
      pendingText = '';
    }

    toggleBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        toggleBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        inputMode = btn.dataset.mode;
        if (inputMode === 'text') {
          textarea.style.display = '';
          urlSection.style.display = 'none';
        } else {
          textarea.style.display = 'none';
          urlSection.style.display = '';
          if (!urlInput.value && !urlInput.disabled) {
            urlInput.value = window.location.href;
          }
        }
      });
    });

    urlOpenBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (url) window.open(url, '_blank');
    });

    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') summarizeBtn.click();
    });

    if (rawResponse) {
      expandWithResponse(divider, responsePanel);
      responseContent.innerHTML = parseMarkdown(rawResponse);
    }
    assistantChatBtn.disabled = !rawResponse;

    async function runSummarize() {
      let messagePayload;

      if (inputMode === 'text') {
        const content = textarea.value.trim();
        if (!content) {
          textarea.style.borderColor = '#EF5350';
          setTimeout(() => (textarea.style.borderColor = ''), 1500);
          return;
        }
        const activeApiKey = getActiveApiKey();
        messagePayload = {
          type: 'summarize',
          provider: currentProvider,
          apiKey: activeApiKey,
          content,
        };
      } else {
        const url = urlInput.value.trim();
        if (!url) {
          urlInput.style.borderColor = '#EF5350';
          setTimeout(() => (urlInput.style.borderColor = ''), 1500);
          return;
        }
        try {
          new URL(url);
        } catch {
          urlInput.style.borderColor = '#EF5350';
          setTimeout(() => (urlInput.style.borderColor = ''), 1500);
          return;
        }
        urlInput.disabled = true;
        urlDisplayText.textContent = url;
        urlDisplay.style.display = '';
        const activeApiKey = getActiveApiKey();
        messagePayload = {
          type: 'summarize-url',
          provider: currentProvider,
          apiKey: activeApiKey,
          url,
        };
      }

      messagePayload.maxWords = parseInt(lengthInput.value, 10) || 0;

      if (selectedLang !== 'auto') {
        const lang = LANGUAGES.find(l => l.code === selectedLang);
        if (lang) messagePayload.targetLang = lang.name;
      } else {
        messagePayload.sameLanguageAsContent = true;
      }

      responseCache = {};
      isLoading = true;
      setUILocked(true);
      summarizeBtn.textContent = 'Summarizing...';

      expandWithResponse(divider, responsePanel);
      const loadingMsg = inputMode === 'url'
        ? `Fetching & summarizing URL with ${getProviderLabel()}...`
        : `Summarizing with ${getProviderLabel()}...`;
      responseContent.innerHTML = `
        <div class="loading-state">
          <div class="spinner"></div>
          <span>${loadingMsg}</span>
        </div>
      `;

      try {
        if (!isContextValid())
          throw new Error('Extension was reloaded. Please refresh the page.');
        const result = await new Promise((resolve, reject) => {
          try {
            chrome.runtime.sendMessage(messagePayload, (resp) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (!resp) {
                reject(new Error('No response from background script.'));
                return;
              }
              if (resp.success) resolve(resp.data);
              else reject(new Error(resp.error));
            });
          } catch (e) {
            reject(e);
          }
        });
        clearSummaryChatExpertAdvisorsUi();
        rawResponse = result;
        originalResponse = result;
        responseCache['original'] = result;
        responseContent.innerHTML = parseMarkdown(result);
        summaryChatMessages = [];
        summaryChatLastError = '';
        if (summaryChatPopover && summaryChatPopover.classList.contains('visible')) {
          renderSummaryChatMessages();
        }
      } catch (err) {
        responseContent.innerHTML = `<div class="error-text">Error: ${escapeHtml(err.message)}</div>`;
        if (inputMode === 'url') {
          urlInput.disabled = false;
          urlDisplay.style.display = 'none';
        }
      } finally {
        isLoading = false;
        setUILocked(false);
        summarizeBtn.textContent = 'Summarize';
        if (inputMode === 'url' && urlDisplay.style.display !== 'none') {
          urlInput.disabled = true;
        }
      }
    }

    summarizeBtn.addEventListener('click', runSummarize);
    refreshBtn.addEventListener('click', runSummarize);

    clearBtn.addEventListener('click', () => {
      if (inputMode === 'text') {
        textarea.value = '';
        textarea.focus();
      } else {
        urlInput.value = '';
        urlInput.disabled = false;
        urlDisplay.style.display = 'none';
        urlInput.focus();
      }
    });

    copyBtn.addEventListener('click', () => {
      if (!rawResponse) return;
      navigator.clipboard
        .writeText(rawResponse)
        .then(() => {
          showCopiedFeedback(copyBtn);
        })
        .catch(() => {
          const tmp = document.createElement('textarea');
          tmp.value = rawResponse;
          tmp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand('copy');
          document.body.removeChild(tmp);
          showCopiedFeedback(copyBtn);
        });
    });

    let dropdownOpen = false;

    function closeDropdown() {
      const dd = translateWrapper.querySelector('.translate-dropdown');
      if (dd) dd.remove();
      dropdownOpen = false;
    }

    function setUILocked(locked) {
      summarizeBtn.disabled = locked;
      clearBtn.disabled = locked;
      langSelectBtn.disabled = locked;
      translateBtn.disabled = locked;
      assistantChatBtn.disabled = locked || !rawResponse;
      copyBtn.disabled = locked;
      refreshBtn.disabled = locked;
      textarea.disabled = locked;
      lengthInput.disabled = locked;
      toggleBtns.forEach(b => b.disabled = locked);
      if (locked) {
        closeLangDropdown();
        closeDropdown();
      }
      updateSummaryChatExpertButtonState();
    }

    translateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!originalResponse) return;

      if (dropdownOpen) {
        closeDropdown();
        return;
      }

      const dropdown = document.createElement('div');
      dropdown.className = 'translate-dropdown';

      LANGUAGES.forEach((lang) => {
        const option = document.createElement('button');
        option.className = 'translate-option';
        option.innerHTML = `<span class="flag">${lang.flag}</span><span class="lang-name">${lang.name}</span>`;
        option.addEventListener('click', async () => {
          closeDropdown();

          if (responseCache[lang.code]) {
            clearSummaryChatExpertAdvisorsUi();
            rawResponse = responseCache[lang.code];
            responseContent.innerHTML = parseMarkdown(rawResponse);
            return;
          }

          setUILocked(true);
          responseContent.innerHTML = `
            <div class="loading-state">
              <div class="spinner"></div>
              <span>Translating to ${lang.flag} ${lang.name}...</span>
            </div>
          `;

          try {
            if (!isContextValid())
              throw new Error(
                'Extension was reloaded. Please refresh the page.'
              );
            const result = await new Promise((resolve, reject) => {
              try {
                chrome.runtime.sendMessage(
                  {
                    type: 'translate',
                    provider: currentProvider,
                    apiKey: getActiveApiKey(),
                    content: originalResponse,
                    targetLang: lang.name,
                  },
                  (resp) => {
                    if (chrome.runtime.lastError) {
                      reject(new Error(chrome.runtime.lastError.message));
                      return;
                    }
                    if (!resp) {
                      reject(new Error('No response from background script.'));
                      return;
                    }
                    if (resp.success) resolve(resp.data);
                    else reject(new Error(resp.error));
                  }
                );
              } catch (e) {
                reject(e);
              }
            });
            clearSummaryChatExpertAdvisorsUi();
            rawResponse = result;
            responseCache[lang.code] = result;
            responseContent.innerHTML = parseMarkdown(result);
          } catch (err) {
            responseContent.innerHTML = `<div class="error-text">Translation error: ${escapeHtml(err.message)}</div>`;
          } finally {
            setUILocked(false);
            if (inputMode === 'url' && urlDisplay.style.display !== 'none') {
              urlInput.disabled = true;
            }
          }
        });
        dropdown.appendChild(option);
      });

      translateWrapper.appendChild(dropdown);
      dropdownOpen = true;
    });

    dropdownClickHandler = (e) => {
      if (dropdownOpen && !e.composedPath().includes(translateWrapper)) {
        closeDropdown();
      }
      if (langDropdownOpen && !e.composedPath().includes(langSelectWrapper)) {
        closeLangDropdown();
      }
    };
    modalShadow.addEventListener('click', dropdownClickHandler);

    initDividerResize(divider, inputPanel, responsePanel);

    setTimeout(() => {
      if (inputMode === 'text') textarea.focus();
      else urlInput.focus();
    }, 50);
  }

  function showCopiedFeedback(btn) {
    btn.classList.add('copied');
    btn.textContent = '✓ Copied!';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = '📋 Copy';
    }, 1800);
  }

  // ===================== Expand Modal for Response =====================

  function expandWithResponse(divider, responsePanel) {
    if (divider.style.display !== 'none') return;

    const currentLeft = parseFloat(modal.style.left);
    const currentWidth = parseFloat(modal.style.width);
    const newWidth = Math.min(960, window.innerWidth - 40);
    const diff = newWidth - currentWidth;
    const newLeft = Math.max(10, currentLeft - diff / 2);

    modal.style.transition = 'width 0.3s ease, left 0.3s ease';
    modal.style.width = newWidth + 'px';
    modal.style.left = newLeft + 'px';

    divider.style.display = '';
    responsePanel.style.display = '';

    setTimeout(() => {
      modal.style.transition = '';
    }, 320);
  }

  // ===================== Drag =====================

  function initDrag() {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    modalHeader.addEventListener('mousedown', (e) => {
      if (e.target.closest('.header-btn')) return;
      dragging = true;

      const rect = modal.getBoundingClientRect();
      if (!hasBeenDragged) {
        modal.style.left = rect.left + 'px';
        modal.style.top = rect.top + 'px';
        hasBeenDragged = true;
      }

      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      modal.style.left = Math.max(0, e.clientX - offsetX) + 'px';
      modal.style.top = Math.max(0, e.clientY - offsetY) + 'px';
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  // ===================== Edge Resize =====================

  function initEdgeResize() {
    const dirs = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    let resizeDir = null;
    let startX, startY, startW, startH, startLeft, startTop;
    const MIN_W = 420;
    const MIN_H = 280;

    dirs.forEach((dir) => {
      const handle = document.createElement('div');
      handle.className = `resize-handle resize-${dir}`;
      modal.appendChild(handle);

      handle.addEventListener('mousedown', (e) => {
        resizeDir = dir;
        const rect = modal.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startW = rect.width;
        startH = rect.height;
        startLeft = rect.left;
        startTop = rect.top;

        if (!hasBeenDragged) {
          modal.style.left = rect.left + 'px';
          modal.style.top = rect.top + 'px';
          hasBeenDragged = true;
        }

        e.preventDefault();
        e.stopPropagation();
      });
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizeDir) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newW = startW;
      let newH = startH;
      let newLeft = startLeft;
      let newTop = startTop;

      if (resizeDir.includes('e')) newW = Math.max(MIN_W, startW + dx);
      if (resizeDir.includes('w')) {
        newW = Math.max(MIN_W, startW - dx);
        newLeft = startLeft + (startW - newW);
      }
      if (resizeDir.includes('s')) newH = Math.max(MIN_H, startH + dy);
      if (resizeDir.includes('n')) {
        newH = Math.max(MIN_H, startH - dy);
        newTop = startTop + (startH - newH);
      }

      modal.style.width = newW + 'px';
      modal.style.height = newH + 'px';
      modal.style.left = newLeft + 'px';
      modal.style.top = newTop + 'px';
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      resizeDir = null;
    });
  }

  // ===================== Summary chat drag / resize =====================

  function initSummaryChatDrag() {
    if (!summaryChatPopover) return;
    const header = summaryChatPopover.querySelector('.summary-chat-header');
    if (!header) return;

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.summary-chat-header-actions')) return;
      dragging = true;
      const rect = summaryChatPopover.getBoundingClientRect();
      summaryChatPopover.style.left = rect.left + 'px';
      summaryChatPopover.style.top = rect.top + 'px';
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      summaryChatPopover.style.left = Math.max(0, e.clientX - offsetX) + 'px';
      summaryChatPopover.style.top = Math.max(0, e.clientY - offsetY) + 'px';
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      persistSummaryChatLayout();
    });
  }

  function initSummaryChatEdgeResize() {
    if (!summaryChatPopover) return;

    const dirs = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    let resizeDir = null;
    let startX, startY, startW, startH, startLeft, startTop;
    const MIN_W = 320;
    const MIN_H = 200;

    dirs.forEach((dir) => {
      const handle = document.createElement('div');
      handle.className = `resize-handle resize-${dir}`;
      summaryChatPopover.appendChild(handle);

      handle.addEventListener('mousedown', (e) => {
        resizeDir = dir;
        const rect = summaryChatPopover.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startW = rect.width;
        startH = rect.height;
        startLeft = rect.left;
        startTop = rect.top;
        summaryChatPopover.style.left = rect.left + 'px';
        summaryChatPopover.style.top = rect.top + 'px';
        e.preventDefault();
        e.stopPropagation();
      });
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizeDir) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newW = startW;
      let newH = startH;
      let newLeft = startLeft;
      let newTop = startTop;

      if (resizeDir.includes('e')) newW = Math.max(MIN_W, startW + dx);
      if (resizeDir.includes('w')) {
        newW = Math.max(MIN_W, startW - dx);
        newLeft = startLeft + (startW - newW);
      }
      if (resizeDir.includes('s')) newH = Math.max(MIN_H, startH + dy);
      if (resizeDir.includes('n')) {
        newH = Math.max(MIN_H, startH - dy);
        newTop = startTop + (startH - newH);
      }

      summaryChatPopover.style.width = newW + 'px';
      summaryChatPopover.style.height = newH + 'px';
      summaryChatPopover.style.left = newLeft + 'px';
      summaryChatPopover.style.top = newTop + 'px';
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      if (!resizeDir) return;
      resizeDir = null;
      persistSummaryChatLayout();
    });
  }

  // ===================== Divider Resize =====================

  function initDividerResize(divider, leftPanel, rightPanel) {
    let resizing = false;

    divider.addEventListener('mousedown', (e) => {
      resizing = true;
      divider.classList.add('active');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const bodyRect = modalBody.getBoundingClientRect();
      const offset = e.clientX - bodyRect.left;
      const total = bodyRect.width;
      const divW = 7;
      const minPanel = 200;

      const leftW = Math.max(minPanel, Math.min(offset, total - divW - minPanel));
      const rightW = total - leftW - divW;

      leftPanel.style.flex = 'none';
      leftPanel.style.width = leftW + 'px';
      rightPanel.style.flex = 'none';
      rightPanel.style.width = rightW + 'px';
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = false;
        divider.classList.remove('active');
      }
    });
  }

  // ===================== Context Menu Position Tracking =====================

  document.addEventListener('contextmenu', (e) => {
    lastContextMenuPos = { x: e.clientX, y: e.clientY };
  });

  // ===================== Explain Popover Drag =====================

  function initExplainDrag(popover, header) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.word-explain-popover-header-actions')) return;
      dragging = true;
      const rect = popover.getBoundingClientRect();
      popover.style.left = rect.left + 'px';
      popover.style.top = rect.top + 'px';
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      popover.style.left = Math.max(0, e.clientX - offsetX) + 'px';
      popover.style.top = Math.max(0, e.clientY - offsetY) + 'px';
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  // ===================== Explain Popover Resize =====================

  function initExplainResize(popover) {
    const dirs = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    const MIN_W = 260;
    const MIN_H = 180;
    let resizeDir = null;
    let startX, startY, startW, startH, startLeft, startTop;

    dirs.forEach((dir) => {
      const handle = document.createElement('div');
      handle.className = `resize-handle resize-${dir}`;
      popover.appendChild(handle);

      handle.addEventListener('mousedown', (e) => {
        resizeDir = dir;
        const rect = popover.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startW = rect.width;
        startH = rect.height;
        startLeft = rect.left;
        startTop = rect.top;
        popover.style.left = rect.left + 'px';
        popover.style.top = rect.top + 'px';
        e.preventDefault();
        e.stopPropagation();
      });
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizeDir) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newW = startW;
      let newH = startH;
      let newLeft = startLeft;
      let newTop = startTop;

      if (resizeDir.includes('e')) newW = Math.max(MIN_W, startW + dx);
      if (resizeDir.includes('w')) {
        newW = Math.max(MIN_W, startW - dx);
        newLeft = startLeft + (startW - newW);
      }
      if (resizeDir.includes('s')) newH = Math.max(MIN_H, startH + dy);
      if (resizeDir.includes('n')) {
        newH = Math.max(MIN_H, startH - dy);
        newTop = startTop + (startH - newH);
      }

      popover.style.width = newW + 'px';
      popover.style.height = newH + 'px';
      popover.style.left = newLeft + 'px';
      popover.style.top = newTop + 'px';
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      resizeDir = null;
    });
  }

  // ===================== Message Listener =====================

  try {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.type === 'toggle-modal') {
        toggleModal();
        sendResponse({ ok: true });
        return;
      }

      if (request.type === 'summarize-selection') {
        const term = (request.term || '').trim();
        openModal(term);
        sendResponse({ ok: true });
        return;
      }

      if (request.type === 'fast-chat-selection') {
        const text = (request.term || '').trim();
        if (!text) {
          sendResponse({ ok: false });
          return;
        }
        openStandaloneFastChat(text);
        sendResponse({ ok: true });
        return;
      }

      if (request.type === 'explain-selection') {
        const term = (request.term || '').trim();
        if (!term || !rawResponse || !getActiveApiKey()) {
          sendResponse({ ok: false });
          return;
        }

        ensureModal();
        if (!isModalVisible()) showModal();

        const popW = 340;
        const popMaxH = 420;
        let pLeft = lastContextMenuPos.x + 12;
        let pTop = lastContextMenuPos.y;

        if (pLeft + popW > window.innerWidth - 10) pLeft = Math.max(10, lastContextMenuPos.x - popW - 4);
        if (pLeft < 10) pLeft = 10;
        if (pTop < 10) pTop = 10;
        if (pTop + popMaxH > window.innerHeight - 10) pTop = Math.max(10, window.innerHeight - popMaxH - 10);

        const termEl = wordExplainPopover.querySelector('.word-explain-popover-term');
        const bodyEl = wordExplainPopover.querySelector('.word-explain-popover-body');

        wordExplainPopover.style.left = pLeft + 'px';
        wordExplainPopover.style.top = pTop + 'px';
        wordExplainPopover.style.width = '340px';
        wordExplainPopover.style.height = '420px';
        termEl.textContent = `"${term}"`;
        bodyEl.innerHTML = `
          <div class="word-explain-loading">
            <div class="word-explain-spinner"></div>
            <span>Explaining...</span>
          </div>
        `;
        minimizedPanels.delete('explain');
        if (minimizedDock) updateMinimizedDock();
        wordExplainPopover.classList.add('visible');

        (async () => {
          try {
            if (!isContextValid()) throw new Error('Extension was reloaded. Please refresh the page.');
            const result = await new Promise((resolve, reject) => {
              try {
                chrome.runtime.sendMessage(
                  {
                    type: 'explain-word',
                    provider: currentProvider,
                    apiKey: getActiveApiKey(),
                    term,
                    context: rawResponse,
                  },
                  (resp) => {
                    if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
                    if (!resp) { reject(new Error('No response from background script.')); return; }
                    if (resp.success) resolve(resp.data);
                    else reject(new Error(resp.error));
                  }
                );
              } catch (err) { reject(err); }
            });
            if (wordExplainPopover.classList.contains('visible')) {
              bodyEl.innerHTML = parseMarkdown(result);
            }
          } catch (err) {
            if (wordExplainPopover.classList.contains('visible')) {
              bodyEl.innerHTML = `<div class="error-text">Error: ${escapeHtml(err.message)}</div>`;
            }
          }
        })();

        sendResponse({ ok: true });
        return;
      }
    });
  } catch {}

  // ===================== Init =====================

  // setupPopover(); // Disabled: highlight-on-page → icon to summarize feature

  try {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.provider,
        STORAGE_KEYS.tokens.openai,
        STORAGE_KEYS.tokens.gemini,
      ],
      (result) => {
        if (!isContextValid()) return;
        currentProvider = normalizeProvider(result[STORAGE_KEYS.provider]);
        setTokenForProvider('openai', result[STORAGE_KEYS.tokens.openai] || '');
        setTokenForProvider('gemini', result[STORAGE_KEYS.tokens.gemini] || '');
      }
    );
  } catch {}
})();
