// Service worker entry: load all worker scripts first, then shared helpers, then Chrome listeners.
// Order: ai_client before expert-advisors / ai_theme (they use callOpenAI / callGemini).

importScripts(
  'ai_config.js',
  'ai_client.js',
  'expert-advisors.js',
  'ai_theme.js',
  'theme_remote.js',
  'theme_preset_metadata.js',
  'theme_generator.js',
  'summarize.js',
  'translator.js',
  'explain.js',
  'chat.js'
);

function normalizeProvider(provider) {
  return PROVIDER_CONFIGS[provider] ? provider : DEFAULT_PROVIDER;
}

function getProviderLabel(provider) {
  const normalized = normalizeProvider(provider);
  return PROVIDER_CONFIGS[normalized].label;
}

/**
 * @returns {{ model: string, url: string }}
 */
function getProviderTaskConfig(provider, taskType) {
  const normalized = normalizeProvider(provider);
  const config = PROVIDER_CONFIGS[normalized];
  const entry = config.taskDefaults[taskType];
  if (entry && typeof entry === 'object' && entry.model && entry.url) {
    return { model: entry.model, url: entry.url };
  }
  const fallback = config.models.default;
  if (fallback && typeof fallback === 'object' && fallback.model && fallback.url) {
    return { model: fallback.model, url: fallback.url };
  }
  throw new Error(`Invalid AI config for provider "${normalized}" task "${taskType}".`);
}

/**
 * @returns {{ model: string, url: string }}
 */
function resolveModelSelection(provider, taskType, requestedModel) {
  const normalized = normalizeProvider(provider);
  const config = PROVIDER_CONFIGS[normalized];
  const safeRequestedModel =
    typeof requestedModel === 'string' ? requestedModel.trim() : '';
  const base = getProviderTaskConfig(normalized, taskType);

  if (safeRequestedModel && config.models.supported.includes(safeRequestedModel)) {
    if (normalized === 'gemini') {
      const isV1Beta = base.url.includes('/v1beta/');
      const url = isV1Beta
        ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(safeRequestedModel)}:generateContent`
        : `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(safeRequestedModel)}:generateContent`;
      return { model: safeRequestedModel, url };
    }
    return { model: safeRequestedModel, url: base.url };
  }

  return base;
}

async function initializeAI(provider, apiKey, modelPreference) {
  const normalized = normalizeProvider(provider);
  if (!apiKey || !apiKey.trim()) {
    throw new Error(`Missing API key for ${getProviderLabel(normalized)}.`);
  }
  return {
    provider: normalized,
    apiKey: apiKey.trim(),
    modelPreference,
  };
}

function extractTextFromHtml(html) {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(
    /<\/(p|div|h[1-6]|li|tr|br|hr|section|article)[^>]*>/gi,
    '\n'
  );
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(
    /&#x([0-9a-fA-F]+);/g,
    (_, hex) => String.fromCharCode(parseInt(hex, 16))
  );
  text = text.replace(/&#(\d+);/g, (_, num) =>
    String.fromCharCode(parseInt(num))
  );
  text = text.replace(/&\w+;/g, ' ');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]*/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  const MAX_CHARS = 30000;
  if (text.length > MAX_CHARS) {
    text = text.substring(0, MAX_CHARS) + '\n\n[Content truncated...]';
  }

  return text;
}

// ===================== Context Menu =====================

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'cs-summarize-selection',
      title: '🔄 Summarize',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'cs-fast-chat',
      title: '💬 Fast Chat',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'cs-explain-word',
      title: '🔍 Explain in Summary Context',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'cs-content-selecting',
      title: '📋 content selecting',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === 'cs-content-selecting') {
    chrome.scripting
      .executeScript({
        target: { tabId: tab.id },
        files: ['content_selected.js'],
      })
      .catch(() => {});
    return;
  }

  if (!info.selectionText) return;
  const selectionText = info.selectionText.trim();
  if (!selectionText) return;

  if (info.menuItemId === 'cs-summarize-selection') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'summarize-selection',
      term: selectionText,
    }).catch(() => {});
    return;
  }

  if (info.menuItemId === 'cs-fast-chat') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'fast-chat-selection',
      term: selectionText,
    }).catch(() => {});
    return;
  }

  if (info.menuItemId === 'cs-explain-word') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'explain-selection',
      term: selectionText,
    }).catch(() => {});
  }
});

// ===================== Action =====================

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
  } catch {}

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-modal' });
  } catch (err) {
    console.warn('Content Summarizer: Cannot run on this page.', err.message);
  }
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'summarize') {
    summarizeContent(
      request.provider,
      request.apiKey,
      request.content,
      request.maxWords,
      request.targetLang,
      request.model,
      request.sameLanguageAsContent
    )
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'translate') {
    translateContent(
      request.provider,
      request.apiKey,
      request.content,
      request.targetLang,
      request.model
    )
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'summarize-url') {
    fetchAndSummarize(
      request.provider,
      request.apiKey,
      request.url,
      request.maxWords,
      request.targetLang,
      request.model,
      request.sameLanguageAsContent
    )
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'explain-word') {
    explainWord(
      request.provider,
      request.apiKey,
      request.term,
      request.context,
      request.model
    )
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'chat-about-summary') {
    chatAboutSummary(
      request.provider,
      request.apiKey,
      request.summaryContext,
      request.messages,
      request.model,
      request.advisorPersona,
      request.sourceUrl
    )
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'suggest-expert-advisors') {
    suggestExpertAdvisors(
      request.provider,
      request.apiKey,
      request.summaryContext,
      request.model
    )
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'generate-ai-theme') {
    generateAiTheme(
      request.provider,
      request.apiKey,
      request.currentTheme,
      request.model
    )
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
