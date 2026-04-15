(function highlightWholePageText() {
  const root = document.body;
  if (!root) return;

  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(root);

  selection.removeAllRanges();
  selection.addRange(range);
})();
