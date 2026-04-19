// AI theme generation (delegates to self.AIThemeDesigner from ai_theme.js).
// Depends on background.js: initializeAI, resolveModelSelection.
// Depends on theme_preset_metadata.js: loadThemePresetDescriptorForAiPrompt, CONTENT_SUMMARIZER_CUSTOM_THEME_PRESETS_KEY,
//   THEME_PRESET_INDEX_PATH.

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

  return {
    snakeFile: sourceFile,
    key,
    storageSaved: true,
    presetsExportDownloaded: !!mergedPresetsBody,
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
