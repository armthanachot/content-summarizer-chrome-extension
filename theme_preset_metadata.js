// Bundled + stored custom theme metadata for AI prompts and storage merge key.
// Loaded via importScripts in the service worker only.

var CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS_KEY = 'CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS';

var THEME_PRESET_INDEX_PATH = 'theme/presets.json';
var THEME_PRESET_DIR = 'theme/';

async function fetchBundledThemePresetDescriptors() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return [];

  let indexData = null;
  let useRemote = false;
  if (typeof CS_THEME_REMOTE !== 'undefined' && CS_THEME_REMOTE.fetchPresetsIndex) {
    indexData = await CS_THEME_REMOTE.fetchPresetsIndex();
    useRemote = await CS_THEME_REMOTE.remoteCatalogAvailable(indexData);
  }
  if (!useRemote) {
    try {
      const res = await fetch(chrome.runtime.getURL(THEME_PRESET_INDEX_PATH));
      if (!res.ok) return [];
      indexData = await res.json();
    } catch {
      return [];
    }
  }

  const files = Array.isArray(indexData?.files) ? indexData.files : [];
  const safeFile =
    typeof CS_THEME_REMOTE !== 'undefined' && CS_THEME_REMOTE.safeThemeFileName
      ? (f) => CS_THEME_REMOTE.safeThemeFileName(f)
      : (f) => {
          const name = typeof f === 'string' ? f.trim() : '';
          if (!name || !name.toLowerCase().endsWith('.json')) return '';
          if (name.toLowerCase() === 'presets.json') return '';
          const sn = name.replace(/^\/+/, '').replace(/\\+/g, '/');
          return sn.includes('..') ? '' : sn;
        };

  async function collectFromFiles(filesList, isRemote) {
    const out = [];
    for (const file of filesList) {
      const safeName = safeFile(file);
      if (!safeName) continue;
      const fallbackKey = safeName.replace(/\.json$/i, '').replace(/_/g, '-');
      try {
        const bundledForest =
          isRemote &&
          typeof CS_THEME_REMOTE !== 'undefined' &&
          typeof CS_THEME_REMOTE.isForestDefaultThemeFile === 'function' &&
          CS_THEME_REMOTE.isForestDefaultThemeFile(safeName);
        const url = bundledForest
          ? chrome.runtime.getURL(THEME_PRESET_DIR + safeName)
          : isRemote
            ? CS_THEME_REMOTE.themeFileUrl(safeName)
            : chrome.runtime.getURL(THEME_PRESET_DIR + safeName);
        const r = await fetch(url, isRemote && !bundledForest ? { credentials: 'omit' } : undefined);
        if (!r.ok) continue;
        const parsed = await r.json();
        const key =
          typeof parsed.key === 'string' && parsed.key.trim() ? parsed.key.trim() : fallbackKey;
        const label =
          typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label.trim() : key;
        out.push({ key, label, sourceFile: safeName });
      } catch {
        /* skip */
      }
    }
    return out;
  }

  let collected = await collectFromFiles(files, useRemote);
  if (!collected.length && useRemote) {
    try {
      const res = await fetch(chrome.runtime.getURL(THEME_PRESET_INDEX_PATH));
      if (res.ok) {
        const localIdx = await res.json();
        const localFiles = Array.isArray(localIdx?.files) ? localIdx.files : [];
        if (localFiles.length) collected = await collectFromFiles(localFiles, false);
      }
    } catch {
      /* keep empty */
    }
  }
  if (
    useRemote &&
    collected.length &&
    !collected.some((e) => e.key === 'forest-default')
  ) {
    const forestOnly = await collectFromFiles(['forest_default.json'], false);
    if (forestOnly.length) collected = [...forestOnly, ...collected];
  }
  return collected;
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
