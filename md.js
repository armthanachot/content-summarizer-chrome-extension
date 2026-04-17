(function (g) {
  'use strict';

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

  g.Md = { escapeHtml, inlineFormat, parseMarkdown };
})(globalThis);
