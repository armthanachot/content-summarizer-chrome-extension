(function () {
  'use strict';

  const STORAGE_KEY = 'CONTENT_SUMMARIZER_OPENAI_TOKEN';
  const INJECTED_ID = 'cs-ext-injected';
  const POPOVER_ID = 'cs-ext-popover';
  const MODAL_ID = 'cs-ext-modal';

  const LANGUAGES = [
    { code: 'th', name: 'ไทย', flag: '🇹🇭' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
  ];

  if (document.getElementById(INJECTED_ID)) return;

  const marker = document.createElement('div');
  marker.id = INJECTED_ID;
  marker.style.display = 'none';
  document.body.appendChild(marker);

  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function cleanup() {
    [INJECTED_ID, POPOVER_ID, MODAL_ID].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

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
      overflow: hidden;
      z-index: 2147483647;
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

    .key-view input {
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
      transition: border-color 0.2s;
    }

    .key-view input:focus { border-color: #43A047; }

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

    .btn-clear:hover {
      background: #F1F8E9;
      border-color: #81C784;
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
    }

    .response-title {
      font-size: 14px;
      font-weight: 700;
      color: #2E7D32;
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

    .response-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      line-height: 1.75;
    }

    .response-content::-webkit-scrollbar { width: 6px; }
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

    .modal-enter {
      animation: cs-fadeIn 0.22s ease-out;
    }

    @keyframes cs-fadeIn {
      from { opacity: 0; transform: scale(0.96); }
      to   { opacity: 1; transform: scale(1); }
    }
  `;

  // ===================== State =====================

  let apiKey = '';
  let rawResponse = '';
  let originalResponse = '';
  let isLoading = false;
  let hasBeenDragged = false;
  let pendingText = '';
  let lastSelectedText = '';

  // Modal DOM refs (created lazily)
  let modalRoot = null;
  let modalShadow = null;
  let modal = null;
  let modalHeader = null;
  let modalBody = null;
  const INIT_W = 560;
  const INIT_H = 500;

  // ===================== Selection Popover =====================

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
    try { img.src = chrome.runtime.getURL('icons/icon48.png'); } catch { /* context invalidated */ }
    img.alt = 'Summarize';
    btn.appendChild(img);
    pShadow.appendChild(btn);

    document.body.appendChild(host);

    // --- Show popover near selection on mouseup ---
    document.addEventListener('mouseup', (e) => {
      if (!isContextValid()) { cleanup(); return; }
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

    // --- Hide popover on mousedown elsewhere ---
    document.addEventListener('mousedown', (e) => {
      if (e.composedPath().includes(host)) return;
      btn.classList.remove('visible');
    });

    // --- Hide on scroll ---
    document.addEventListener('scroll', () => {
      btn.classList.remove('visible');
    }, true);

    // --- Click popover → open modal with selected text ---
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isContextValid()) { cleanup(); return; }
      btn.classList.remove('visible');
      openModal(lastSelectedText);
      lastSelectedText = '';
    });
  }

  // ===================== Modal: Lazy Creation =====================

  function ensureModal() {
    if (modalRoot) return;

    modalRoot = document.createElement('div');
    modalRoot.id = MODAL_ID;
    modalRoot.style.cssText =
      'all:initial; position:fixed; top:0; left:0; width:0; height:0; z-index:2147483647;';
    modalRoot.style.display = 'none';

    modalShadow = modalRoot.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = MODAL_CSS;
    modalShadow.appendChild(styleEl);

    modal = document.createElement('div');
    modal.className = 'modal modal-enter';
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
        <button class="header-btn close-btn" title="Close">✕</button>
      </div>
    `;
    modal.appendChild(modalHeader);

    modalBody = document.createElement('div');
    modalBody.className = 'modal-body';
    modal.appendChild(modalBody);

    modalShadow.appendChild(modal);
    document.body.appendChild(modalRoot);

    // Header events
    modalHeader.querySelector('.close-btn').addEventListener('click', () => {
      modalRoot.style.display = 'none';
    });

    modalHeader.querySelector('.settings-btn').addEventListener('click', () => {
      const currentW = parseFloat(modal.style.width);
      if (currentW > INIT_W) {
        modal.style.transition = 'width 0.3s ease';
        modal.style.width = INIT_W + 'px';
        setTimeout(() => (modal.style.transition = ''), 320);
      }
      showKeyView();
    });

    initDrag();
  }

  // ===================== Open / Toggle =====================

  function openModal(prefillText) {
    if (!isContextValid()) { cleanup(); return; }
    pendingText = prefillText || '';
    ensureModal();
    modalRoot.style.display = '';

    try {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (!isContextValid()) return;
        apiKey = result[STORAGE_KEY] || '';
        if (apiKey) {
          showMainView();
        } else {
          showKeyView();
        }
      });
    } catch { cleanup(); }
  }

  function toggleModal() {
    if (!modalRoot || modalRoot.style.display === 'none') {
      openModal('');
    } else {
      modalRoot.style.display = 'none';
    }
  }

  // ===================== Views =====================

  function showKeyView(errorMsg) {
    modalBody.innerHTML = '';
    const view = document.createElement('div');
    view.className = 'key-view';
    view.innerHTML = `
      <div class="icon">🔑</div>
      <h2>Enter your OpenAI API Key</h2>
      <p>Your key is stored locally in your browser and never sent anywhere except OpenAI.</p>
      <input type="password" placeholder="sk-..." class="key-input" />
      <span class="error-msg">${errorMsg || ''}</span>
      <button class="save-btn">Save & Continue</button>
    `;
    modalBody.appendChild(view);

    const input = view.querySelector('.key-input');
    const errSpan = view.querySelector('.error-msg');
    const saveBtn = view.querySelector('.save-btn');

    if (apiKey) input.value = apiKey;

    saveBtn.addEventListener('click', () => {
      const val = input.value.trim();
      if (!val) {
        errSpan.textContent = 'Please enter a valid API key.';
        return;
      }
      apiKey = val;
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: val }, () => {
          if (!isContextValid()) return;
          showMainView();
        });
      } catch { cleanup(); }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
    });

    setTimeout(() => input.focus(), 50);
  }

  function showMainView() {
    modalBody.innerHTML = '';

    // --- Input panel ---
    const inputPanel = document.createElement('div');
    inputPanel.className = 'input-panel';
    inputPanel.innerHTML = `
      <textarea class="content-input" placeholder="Paste or type your content here to summarize..."></textarea>
      <div class="option-row">
        <label>Response length:</label>
        <input type="number" class="response-length" placeholder="words" min="1" />
        <span class="hint">(optional)</span>
      </div>
      <div class="btn-row">
        <button class="btn btn-summarize">Summarize</button>
        <button class="btn btn-clear">Clear</button>
      </div>
    `;
    modalBody.appendChild(inputPanel);

    // --- Divider ---
    const divider = document.createElement('div');
    divider.className = 'divider';
    divider.style.display = 'none';
    modalBody.appendChild(divider);

    // --- Response panel ---
    const responsePanel = document.createElement('div');
    responsePanel.className = 'response-panel';
    responsePanel.style.display = 'none';
    responsePanel.innerHTML = `
      <div class="response-header">
        <span class="response-title">Summary</span>
        <div class="response-actions">
          <div class="translate-wrapper">
            <button class="translate-btn" title="Translate"></button>
          </div>
          <button class="copy-btn">📋 Copy</button>
        </div>
      </div>
      <div class="response-content">
        <div class="placeholder-text">Your summary will appear here...</div>
      </div>
    `;
    modalBody.appendChild(responsePanel);

    // --- Refs ---
    const textarea = inputPanel.querySelector('.content-input');
    const lengthInput = inputPanel.querySelector('.response-length');
    const summarizeBtn = inputPanel.querySelector('.btn-summarize');
    const clearBtn = inputPanel.querySelector('.btn-clear');
    const copyBtn = responsePanel.querySelector('.copy-btn');
    const responseContent = responsePanel.querySelector('.response-content');
    const translateBtn = responsePanel.querySelector('.translate-btn');
    const translateWrapper = responsePanel.querySelector('.translate-wrapper');

    // Set translate icon image
    const translateImg = document.createElement('img');
    try { translateImg.src = chrome.runtime.getURL('icons/translate.png'); } catch { /* context invalidated */ }
    translateImg.alt = 'Translate';
    translateBtn.appendChild(translateImg);

    // Prefill textarea with selected text if available
    if (pendingText) {
      textarea.value = pendingText;
      pendingText = '';
    }

    // Restore previous response if exists
    if (rawResponse) {
      expandWithResponse(divider, responsePanel);
      responseContent.innerHTML = parseMarkdown(rawResponse);
    }

    // --- Summarize ---
    summarizeBtn.addEventListener('click', async () => {
      const content = textarea.value.trim();
      if (!content) {
        textarea.style.borderColor = '#EF5350';
        setTimeout(() => (textarea.style.borderColor = ''), 1500);
        return;
      }

      const maxWords = parseInt(lengthInput.value, 10) || 0;

      isLoading = true;
      summarizeBtn.disabled = true;
      summarizeBtn.textContent = 'Summarizing...';

      expandWithResponse(divider, responsePanel);
      responseContent.innerHTML = `
        <div class="loading-state">
          <div class="spinner"></div>
          <span>Summarizing with GPT-4o mini...</span>
        </div>
      `;

      try {
        if (!isContextValid()) throw new Error('Extension was reloaded. Please refresh the page.');
        const result = await new Promise((resolve, reject) => {
          try {
            chrome.runtime.sendMessage(
              { type: 'summarize', apiKey, content, maxWords },
              (resp) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                if (resp.success) resolve(resp.data);
                else reject(new Error(resp.error));
              }
            );
          } catch (e) { reject(e); }
        });
        rawResponse = result;
        originalResponse = result;
        responseContent.innerHTML = parseMarkdown(result);
      } catch (err) {
        responseContent.innerHTML = `<div class="error-text">Error: ${escapeHtml(err.message)}</div>`;
      } finally {
        isLoading = false;
        summarizeBtn.disabled = false;
        summarizeBtn.textContent = 'Summarize';
      }
    });

    // --- Clear (only input, NOT response) ---
    clearBtn.addEventListener('click', () => {
      textarea.value = '';
      textarea.focus();
    });

    // --- Copy ---
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

    // --- Translate dropdown ---
    let dropdownOpen = false;

    function closeDropdown() {
      const existing = translateWrapper.querySelector('.translate-dropdown');
      if (existing) existing.remove();
      dropdownOpen = false;
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

          responseContent.innerHTML = `
            <div class="loading-state">
              <div class="spinner"></div>
              <span>Translating to ${lang.flag} ${lang.name}...</span>
            </div>
          `;

          try {
            if (!isContextValid()) throw new Error('Extension was reloaded. Please refresh the page.');
            const result = await new Promise((resolve, reject) => {
              try {
                chrome.runtime.sendMessage(
                  { type: 'translate', apiKey, content: originalResponse, targetLang: lang.name },
                  (resp) => {
                    if (chrome.runtime.lastError) {
                      reject(new Error(chrome.runtime.lastError.message));
                      return;
                    }
                    if (resp.success) resolve(resp.data);
                    else reject(new Error(resp.error));
                  }
                );
              } catch (e) { reject(e); }
            });
            rawResponse = result;
            responseContent.innerHTML = parseMarkdown(result);
          } catch (err) {
            responseContent.innerHTML = `<div class="error-text">Translation error: ${escapeHtml(err.message)}</div>`;
          }
        });
        dropdown.appendChild(option);
      });

      translateWrapper.appendChild(dropdown);
      dropdownOpen = true;
    });

    // Close dropdown when clicking outside
    modalShadow.addEventListener('click', (e) => {
      if (dropdownOpen && !e.composedPath().includes(translateWrapper)) {
        closeDropdown();
      }
    });

    // --- Resizable divider ---
    initDividerResize(divider, inputPanel, responsePanel);

    setTimeout(() => textarea.focus(), 50);
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

      let leftW = Math.max(minPanel, Math.min(offset, total - divW - minPanel));
      let rightW = total - leftW - divW;

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

  // ===================== Message Listener =====================

  try {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.type === 'toggle-modal') {
        toggleModal();
        sendResponse({ ok: true });
      }
    });
  } catch { /* context invalidated on load — page needs refresh */ }

  // ===================== Init =====================

  setupPopover();

  try {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (!isContextValid()) return;
      apiKey = result[STORAGE_KEY] || '';
    });
  } catch { /* context invalidated */ }
})();
