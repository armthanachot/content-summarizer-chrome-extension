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
    callOpenAI(request.apiKey, request.content, request.maxWords)
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
});

async function callOpenAI(apiKey, content, maxWords) {
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
