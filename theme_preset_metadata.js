// Bundled + stored custom theme metadata for AI prompts and storage merge key.
// Loaded via importScripts in the service worker only.

var CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS_KEY = 'CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS';

var THEME_PRESET_INDEX_PATH = 'theme/presets.json';
var THEME_PRESET_DIR = 'theme/';

async function fetchBundledThemePresetDescriptors() {
  const entries = [];
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return entries;
  try {
    const res = await fetch(chrome.runtime.getURL(THEME_PRESET_INDEX_PATH));
    if (!res.ok) return entries;
    const indexData = await res.json();
    const files = Array.isArray(indexData?.files) ? indexData.files : [];
    for (const file of files) {
      const name = typeof file === 'string' ? file.trim() : '';
      if (!name || !name.toLowerCase().endsWith('.json')) continue;
      if (name.toLowerCase() === 'presets.json') continue;
      const safeName = name.replace(/^\/+/, '').replace(/\\+/g, '/');
      if (safeName.includes('..')) continue;
      const fallbackKey = safeName.replace(/\.json$/i, '').replace(/_/g, '-');
      try {
        const r = await fetch(chrome.runtime.getURL(THEME_PRESET_DIR + safeName));
        if (!r.ok) continue;
        const parsed = await r.json();
        const key =
          typeof parsed.key === 'string' && parsed.key.trim() ? parsed.key.trim() : fallbackKey;
        const label =
          typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label.trim() : key;
        entries.push({ key, label, sourceFile: safeName });
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
  return entries;
}

async function getCustomThemePresetsFromStorage() {
  try {
    const got = await chrome.storage.local.get(CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS_KEY);
    const raw = got[CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS_KEY];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/**
 * @returns {Promise<{ entries: { key: string, label: string }[], labels: string[] }>}
 */
async function loadThemePresetDescriptorForAiPrompt() {
  const bundled = await fetchBundledThemePresetDescriptors();
  const customRows = await getCustomThemePresetsFromStorage();
  const customMeta = customRows
    .map((c) => ({
      key: typeof c.key === 'string' && c.key.trim() ? c.key.trim() : '',
      label: typeof c.label === 'string' && c.label.trim() ? c.label.trim() : '',
    }))
    .filter((x) => x.key);

  const byKey = new Map();
  bundled.forEach((e) => byKey.set(e.key, { key: e.key, label: e.label }));
  customMeta.forEach((e) => byKey.set(e.key, { key: e.key, label: e.label || e.key }));

  const entries = Array.from(byKey.values());
  const labels = entries.map((e) => e.label);
  return { entries, labels };
}
