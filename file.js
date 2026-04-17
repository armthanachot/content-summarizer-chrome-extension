(function (g) {
  'use strict';

  /**
   * @param {Date} d
   * @returns {string}
   */
  function formatLocaleDateTime(d) {
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  /**
   * @param {{ sourceUrl: string, summaryMarkdown: string, downloadedAt?: Date }} opts
   * @returns {string}
   */
  function buildSummaryMarkdownDocument(opts) {
    const at = opts.downloadedAt instanceof Date ? opts.downloadedAt : new Date();
    const url = (opts.sourceUrl || '').trim() || window.location.href || '';
    const body = (opts.summaryMarkdown || '').trim();
    const dateLine = formatLocaleDateTime(at);
    const sourceLine = url ? `[${url}](${url})` : '';
    return [
      '# Date',
      '',
      dateLine,
      '',
      '# Source',
      '',
      sourceLine,
      '',
      '# Summarize',
      '',
      body,
      '',
    ].join('\n');
  }

  /**
   * @param {Date} [at]
   * @returns {string}
   */
  function makeTimestampFilename(at) {
    const d = at instanceof Date ? at : new Date();
    return `${d.getTime()}.md`;
  }

  /**
   * @param {string} filename
   * @param {string} text
   */
  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  }

  /**
   * @param {{ sourceUrl: string, summaryMarkdown: string }} opts
   */
  function downloadSummaryMarkdownExport(opts) {
    const downloadedAt = new Date();
    const markdown = buildSummaryMarkdownDocument({
      sourceUrl: opts.sourceUrl,
      summaryMarkdown: opts.summaryMarkdown,
      downloadedAt,
    });
    downloadTextFile(makeTimestampFilename(downloadedAt), markdown);
  }

  g.csSummaryFileExport = {
    buildSummaryMarkdownDocument,
    makeTimestampFilename,
    downloadTextFile,
    downloadSummaryMarkdownExport,
  };
})(globalThis);
