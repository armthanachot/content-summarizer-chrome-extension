// AI theme generation (delegates to self.AIThemeDesigner from ai_theme.js).
// Depends on background.js: initializeAI, resolveModelSelection.
// Depends on theme_preset_metadata.js: loadThemePresetDescriptorForAiPrompt, CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS_KEY,
//   THEME_PRESET_INDEX_PATH.

const THEME_JSON_UPLOAD_URL =
  'https://content-summarizer-api-production.up.railway.app/api/v1/s3/upload-json-theme';

/**
 * POST theme JSON to the production catalog (same contract as note/upload_json_theme.sh).
 * @param {{ key: string, label: string, summary: object, explain: object, chat: object, sourceFile: string }} fileObj
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function uploadThemeJsonToCatalogApi(fileObj) {
  try {
    const res = await fetch(THEME_JSON_UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fileObj),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let detail = text.trim() || `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text);
        if (j && typeof j.message === 'string') detail = j.message;
        else if (j && typeof j.error === 'string') detail = j.error;
      } catch {
        /* keep detail */
      }
      throw new Error(detail);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function themeNameToSnakeCase(name) {
  const raw = typeof name === 'string' ? name : '';
  let s = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/['\u2019]/g, '');
  s = s
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  return s || 'ai_generated_theme';
}

async function persistAiGeneratedThemeAssets(normalized) {
  const themeName = normalized.themeName;
  const theme = normalized.theme;
  const snake = themeNameToSnakeCase(themeName);
  const key = snake.replace(/_/g, '-');
  const sourceFile = `${snake}.json`;
  const fileObj = {
    key,
    label: themeName,
    summary: theme.summary,
    explain: theme.explain,
    chat: theme.chat,
    sourceFile,
  };

  const got = await chrome.storage.local.get(CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS_KEY);
  const list = Array.isArray(got[CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS_KEY])
    ? [...got[CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS_KEY]]
    : [];
  const idx = list.findIndex((x) => (x.key || '').toLowerCase() === key.toLowerCase());
  if (idx >= 0) list[idx] = fileObj;
  else list.push(fileObj);
  await chrome.storage.local.set({
    [CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS_KEY]: list,
  });

  let mergedPresetsBody = '';
  try {
    let idxData = null;
    if (typeof CS_THEME_REMOTE !== 'undefined' && CS_THEME_REMOTE.fetchPresetsIndex) {
      idxData = await CS_THEME_REMOTE.fetchPresetsIndex();
    }
    if (!idxData || !Array.isArray(idxData.files)) {
      const res = await fetch(chrome.runtime.getURL(THEME_PRESET_INDEX_PATH));
      if (res.ok) idxData = await res.json();
    }
    if (idxData && Array.isArray(idxData.files)) {
      const files = [...idxData.files];
      if (!files.includes(sourceFile)) files.push(sourceFile);
      mergedPresetsBody = JSON.stringify({ files }, null, 2);
    }
  } catch {
    /* ignore */
  }

  if (typeof chrome.downloads?.download === 'function') {
    try {
      await chrome.downloads.download({
        url:
          'data:application/json;charset=utf-8,' +
          encodeURIComponent(JSON.stringify(fileObj, null, 2)),
        filename: `content-summarizer-theme-export/${sourceFile}`,
        saveAs: false,
      });
      if (mergedPresetsBody) {
        await chrome.downloads.download({
          url:
            'data:application/json;charset=utf-8,' +
            encodeURIComponent(mergedPresetsBody),
          filename: 'content-summarizer-theme-export/presets.json',
          saveAs: false,
        });
      }
    } catch {
      /* downloads may fail without permission or quota */
    }
  }

  const uploadResult = await uploadThemeJsonToCatalogApi(fileObj);

  return {
    snakeFile: sourceFile,
    key,
    storageSaved: true,
    presetsExportDownloaded: !!mergedPresetsBody,
    remoteUploadOk: uploadResult.ok,
    remoteUploadError: uploadResult.ok ? undefined : uploadResult.error,
  };
}

async function generateAiTheme(provider, apiKey, currentTheme, modelPreference, vertexProjectId) {
  const presetDescriptor = await loadThemePresetDescriptorForAiPrompt();
  const client = await initializeAI(provider, apiKey, modelPreference, vertexProjectId);
  const { model, url } = resolveModelSelection(
    client.provider,
    'theme',
    client.modelPreference,
    client.vertexProjectId
  );
  const normalized =
    client.provider === 'gemini'
      ? await self.AIThemeDesigner.fetchGemini(
          client.apiKey,
          model,
          url,
          currentTheme,
          presetDescriptor
        )
      : client.provider === 'vertex_ai'
        ? await self.AIThemeDesigner.fetchVertex(
            client.apiKey,
            model,
            url,
            currentTheme,
            presetDescriptor
          )
        : await self.AIThemeDesigner.fetchOpenAI(
            client.apiKey,
            model,
            url,
            currentTheme,
            presetDescriptor
          );

  let persistResult = null;
  try {
    persistResult = await persistAiGeneratedThemeAssets(normalized);
  } catch (err) {
    persistResult = { error: err && err.message ? err.message : String(err) };
  }

  return {
    themeName: normalized.themeName,
    theme: normalized.theme,
    persistResult,
  };
}
