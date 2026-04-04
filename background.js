// ===================== Context Menu =====================

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'cs-explain-word',
      title: '🔍 Explain in Summary Context',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'cs-explain-word' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'explain-selection',
      term: info.selectionText.trim(),
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
    callOpenAI(request.apiKey, request.content, request.maxWords, request.targetLang)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'translate') {
    translateContent(request.apiKey, request.content, request.targetLang)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'summarize-url') {
    fetchAndSummarize(request.apiKey, request.url, request.maxWords, request.targetLang)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'explain-word') {
    explainWord(request.apiKey, request.term, request.context)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function callOpenAI(apiKey, content, maxWords, targetLang) {
  let systemPrompt = `You are an expert content analyst and summarizer. Follow this process:

1. **Understand Context First**: Before summarizing, identify the topic, domain (e.g. technology, business, science, education), target audience, and key themes of the content.
2. **Create a Structured Summary**: Based on your understanding of the context, produce a well-organized markdown summary.

Your summary MUST:
- Begin with a concise one-line overview that captures what the content is fundamentally about
- Use clear, descriptive headers (##, ###) to organize different aspects or themes
- Extract key points, important details, insights, and conclusions
- Use bullet points for clarity and readability
- **Bold** critical terms, names, or concepts
- Preserve important numbers, dates, statistics, or specific data accurately
- Capture the author's intent and nuance, not just surface-level information
- Be concise but never sacrifice accuracy or important context`;

  if (maxWords && maxWords > 0) {
    systemPrompt += `\n- Keep your response within ${maxWords} words.`;
  }

  if (targetLang) {
    systemPrompt += `\n- Write the entire summary in ${targetLang}.`;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Analyze the context of the following content, then summarize it:\n\n${content}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.error?.message || `API request failed with status ${response.status}`
    );
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function translateContent(apiKey, content, targetLang) {
  const systemPrompt = `You are a professional translator who specializes in natural, human-friendly translations to ${targetLang}.

Translation rules:
- Write as if a native ${targetLang} speaker wrote it originally — NOT a word-for-word translation
- Use natural idioms, expressions, and sentence structures appropriate for ${targetLang}
- Adapt tone and phrasing so it reads fluently and feels natural to a native reader
- Maintain the exact same markdown formatting: headers, bullet points, bold, code blocks, links, and overall structure
- Keep technical terms that are commonly used in their original English form (e.g. "API", "framework", "database", "commit")
- Do NOT alter code blocks, URLs, file paths, or proper nouns (brand names, product names)
- If a concept doesn't translate well literally, rephrase it in a way that conveys the same meaning naturally`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Translate the following markdown content to ${targetLang} in a human-friendly, natural way:\n\n${content}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.error?.message || `API request failed with status ${response.status}`
    );
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function fetchAndSummarize(apiKey, url, maxWords, targetLang) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError')
      throw new Error('Request timed out while fetching the URL.');
    throw new Error(`Failed to fetch URL: ${err.message}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`Failed to fetch URL (HTTP ${response.status}): ${url}`);
  }

  const html = await response.text();
  const text = extractTextFromHtml(html);

  if (!text || text.trim().length < 20) {
    throw new Error(
      'Could not extract meaningful content from the URL. The page may be empty or require JavaScript to render.'
    );
  }

  return callOpenAI(apiKey, text, maxWords, targetLang);
}

async function explainWord(apiKey, term, context) {
  const systemPrompt = `You are a knowledgeable assistant helping a reader understand a specific word or phrase from a summary they are reading.

Your task is to explain the highlighted term clearly in the context of the provided summary. Your explanation must:
- Clarify what the term means specifically within this context
- Explain its significance or role in relation to the main topic
- Use simple, clear language that a non-expert can understand
- Be concise but thorough (2–4 paragraphs or bullet points at most)
- Use markdown formatting for clarity (bold key concepts, use bullets if listing things)
- Respond in the EXACT SAME LANGUAGE as the provided summary — do NOT switch languages`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Here is the summary context:\n\n${context}\n\n---\n\nPlease explain what **"${term}"** means in the context above.`,
        },
      ],
      temperature: 0.4,
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.error?.message || `API request failed with status ${response.status}`
    );
  }

  const data = await response.json();
  return data.choices[0].message.content;
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
