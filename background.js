importScripts('expert-advisors.js');

// ===================== AI Provider Setup =====================

const DEFAULT_PROVIDER = 'openai';

const PROVIDER_CONFIGS = {
  openai: {
    label: 'OpenAI',
    models: {
      default: 'gpt-4o-mini',
      supported: ['gpt-4o-mini'],
    },
    taskDefaults: {
      summarize: 'gpt-4o-mini',
      translate: 'gpt-4o-mini',
      explain: 'gpt-4o-mini',
      chat: 'gpt-4o-mini',
      advisors: 'gpt-4o-mini',
    },
  },
  // gemini: {
  //   label: 'Gemini',
  //   models: {
  //     default: 'gemini-3-flash-preview',
  //     supported: ['gemini-3-flash-preview'],
  //   },
  //   taskDefaults: {
  //     summarize: 'gemini-3-flash-preview',
  //     translate: 'gemini-3-flash-preview',
  //     explain: 'gemini-3-flash-preview',
  //     chat: 'gemini-3-flash-preview',
  //   },
  // },
  gemini: {
    label: 'Gemini',
    models: {
      default: 'gemini-2.5-flash',
      supported: ['gemini-2.5-flash'],
    },
    taskDefaults: {
      summarize: 'gemini-2.5-flash',
      translate: 'gemini-2.5-flash',
      explain: 'gemini-2.5-flash',
      chat: 'gemini-2.5-flash',
      advisors: 'gemini-2.5-flash',
    },
  },
};

function normalizeProvider(provider) {
  return PROVIDER_CONFIGS[provider] ? provider : DEFAULT_PROVIDER;
}

function getProviderLabel(provider) {
  const normalized = normalizeProvider(provider);
  return PROVIDER_CONFIGS[normalized].label;
}

function getProviderModel(provider, taskType) {
  const normalized = normalizeProvider(provider);
  const config = PROVIDER_CONFIGS[normalized];
  return config.taskDefaults[taskType] || config.models.default;
}

function resolveModelSelection(provider, taskType, requestedModel) {
  const normalized = normalizeProvider(provider);
  const config = PROVIDER_CONFIGS[normalized];
  const safeRequestedModel =
    typeof requestedModel === 'string' ? requestedModel.trim() : '';

  if (safeRequestedModel && config.models.supported.includes(safeRequestedModel)) {
    return safeRequestedModel;
  }

  return getProviderModel(normalized, taskType);
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

async function generateAIContent(client, taskType, systemPrompt, userPrompt) {
  const model = resolveModelSelection(
    client.provider,
    taskType,
    client.modelPreference
  );
  if (client.provider === 'gemini') {
    return callGemini(client.apiKey, model, systemPrompt, userPrompt);
  }
  return callOpenAI(client.apiKey, model, systemPrompt, userPrompt);
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
      request.advisorPersona
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
});

async function summarizeContent(
  provider,
  apiKey,
  content,
  maxWords,
  targetLang,
  modelPreference,
  sameLanguageAsContent
) {
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
  } else if (sameLanguageAsContent) {
    systemPrompt +=
      '\n- Write the entire summary in the same language as the source content (match the dominant language of the input).';
  }

  const client = await initializeAI(provider, apiKey, modelPreference);
  const userPrompt = `Analyze the context of the following content, then summarize it:\n\n${content}`;
  return generateAIContent(client, 'summarize', systemPrompt, userPrompt);
}

async function translateContent(
  provider,
  apiKey,
  content,
  targetLang,
  modelPreference
) {
  const systemPrompt = `You are a professional translator who specializes in natural, human-friendly translations to ${targetLang}.

Translation rules:
- Write as if a native ${targetLang} speaker wrote it originally — NOT a word-for-word translation
- Use natural idioms, expressions, and sentence structures appropriate for ${targetLang}
- Adapt tone and phrasing so it reads fluently and feels natural to a native reader
- Maintain the exact same markdown formatting: headers, bullet points, bold, code blocks, links, and overall structure
- Keep technical terms that are commonly used in their original English form (e.g. "API", "framework", "database", "commit")
- Do NOT alter code blocks, URLs, file paths, or proper nouns (brand names, product names)
- If a concept doesn't translate well literally, rephrase it in a way that conveys the same meaning naturally`;
  const client = await initializeAI(provider, apiKey, modelPreference);
  const userPrompt = `Translate the following markdown content to ${targetLang} in a human-friendly, natural way:\n\n${content}`;
  return generateAIContent(client, 'translate', systemPrompt, userPrompt);
}

async function fetchAndSummarize(
  provider,
  apiKey,
  url,
  maxWords,
  targetLang,
  modelPreference,
  sameLanguageAsContent
) {
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
    if (err.name === 'AbortError') {
      throw new Error('Request timed out while fetching the URL.');
    }
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

  return summarizeContent(
    provider,
    apiKey,
    text,
    maxWords,
    targetLang,
    modelPreference,
    sameLanguageAsContent
  );
}

// let CHAT_SYSTEM_INSTRUCTION = `You are a helpful assistant. The user is discussing a summary they generated. Use the provided summary as your primary context. Answer questions based on that summary; if something is not covered in the summary, say so clearly. Be concise and use markdown when it helps (headings, bullets, bold). Respond in the same language the user writes in unless they ask otherwise. Stay accurate and grounded in the summary—do not invent credentials or affiliations.`;
let CHAT_SYSTEM_INSTRUCTION = `
Role & Identity:
You are a highly capable AI Assistant. Your primary goal is to support the user by leveraging the provided User Summary as your foundational context. You must act as a knowledgeable peer who understands the user's background, professional expertise, and personal interests.

Operational Guidelines:

Primary Context (The Summary):

Always refer to the User Summary first for any personal details, preferences, or history.

Strictly adhere to the facts in the summary regarding the user's identity and past actions. Do not invent affiliations or credentials.

Contextual Knowledge Expansion:

If a question relates to a topic mentioned in the summary (e.g., Backend Development, Tech Investing, Specialty Coffee, or Aquarium Care) but the specific answer is not in the summary, do not simply state that you don't have the information.

Instead, use the summary as a "topic guide" and utilize your broader knowledge base and search capabilities to provide a comprehensive answer.

Fact-Checking & Analysis:

For information outside the summary, you must verify the data. Perform real-time searches to ensure the information is current (especially for stocks, tech frameworks, or news).

Analyze the retrieved data for accuracy and relevance before presenting it. Your responses must be grounded in reality and high-quality evidence.

Tone & Style:

Conciseness: Be direct and avoid unnecessary fluff.

Formatting: Use Markdown (Headings, Bullets, Bold) to ensure the response is scannable and clear.

Language: Respond in the same language the user uses.

Handling "Out-of-Scope" Queries:

If a query is completely unrelated to both the summary and the user’s known interests, answer it based on objective facts but maintain the persona of an assistant who respects the user's established profile.
`;
const DEFAULT_ADVISOR_VALUE = 'CHAT_SYSTEM_INSTRUCTION';

function buildChatSystemBlock(summaryContext, advisorPersona) {
  const isDefaultAdvisor =
    advisorPersona &&
    typeof advisorPersona.value === 'string' &&
    advisorPersona.value === DEFAULT_ADVISOR_VALUE;
  const instructionRaw =
    !isDefaultAdvisor && advisorPersona && typeof advisorPersona.instruction === 'string'
      ? advisorPersona.instruction.trim()
      : '';
  let systemPreamble = CHAT_SYSTEM_INSTRUCTION;
  if (instructionRaw) {
    systemPreamble += `\n\nact as ${instructionRaw}`;
  }
  return `${systemPreamble}\n\n---\nSummary (markdown):\n${summaryContext}\n---`;
}

async function suggestExpertAdvisors(provider, apiKey, summaryContext, modelPreference) {
  const trimmed = (summaryContext || '').trim();
  if (!trimmed) {
    throw new Error('No summary context available for expert suggestions.');
  }
  const client = await initializeAI(provider, apiKey, modelPreference);
  const model = resolveModelSelection(client.provider, 'advisors', client.modelPreference);
  const experts =
    client.provider === 'gemini'
      ? await self.ExpertAdvisors.fetchGemini(client.apiKey, model, trimmed)
      : await self.ExpertAdvisors.fetchOpenAI(client.apiKey, model, trimmed);
  return [
    {
      title: 'default',
      bio: 'default instruction',
      instruction: CHAT_SYSTEM_INSTRUCTION,
      value: DEFAULT_ADVISOR_VALUE,
    },
    ...experts,
  ];
}

async function chatAboutSummary(
  provider,
  apiKey,
  summaryContext,
  messages,
  modelPreference,
  advisorPersona
) {
  const trimmedSummary = (summaryContext || '').trim();
  if (!trimmedSummary) {
    throw new Error('No summary context available for chat.');
  }
  const history = Array.isArray(messages) ? messages : [];
  if (
    !history.length ||
    history[history.length - 1].role !== 'user' ||
    !(history[history.length - 1].content || '').trim()
  ) {
    throw new Error('Invalid chat messages: last message must be a non-empty user message.');
  }

  const client = await initializeAI(provider, apiKey, modelPreference);
  const model = resolveModelSelection(client.provider, 'chat', client.modelPreference);

  if (client.provider === 'gemini') {
    return callGeminiChat(client.apiKey, model, trimmedSummary, history, advisorPersona);
  }
  return callOpenAIChat(client.apiKey, model, trimmedSummary, history, advisorPersona);
}

async function callOpenAIChat(apiKey, model, summaryContext, history, advisorPersona) {
  const systemContent = buildChatSystemBlock(summaryContext, advisorPersona);
  const input = [
    {
      role: 'assistant',
      content: systemContent,
    },
    ...history.map((m) => {
      const role = m.role === 'user' ? 'user' : 'assistant';
      if (role !== 'user') {
        return { role, content: m.content || '' };
      }
      const textContent = typeof m.content === 'string' ? m.content : '';
      const contentParts = [];
      if (textContent.trim()) {
        contentParts.push({
          type: 'input_text',
          text: textContent,
        });
      }
      const images = Array.isArray(m.images) ? m.images : [];
      images.forEach((image) => {
        if (!image || !image.data || !image.mimeType) return;
        contentParts.push({
          type: 'input_image',
          image_url: `data:${image.mimeType};base64,${image.data}`,
        });
      });
      return {
        role,
        content: contentParts.length ? contentParts : [{ type: 'input_text', text: textContent }],
      };
    }),
  ];

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
      temperature: 0.4,
      max_output_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.error?.message || `API request failed with status ${response.status}`
    );
  }

  const data = await response.json();
  return extractOpenAIResponseText(data);
}

async function callGeminiChat(apiKey, model, summaryContext, history, advisorPersona) {
  const systemBlock = buildChatSystemBlock(summaryContext, advisorPersona);
  const response = await fetch(
    // `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'MODEL',
            parts: [{ text: systemBlock }],
          },
          ...history.map((m) => ({
            role: m.role === 'user' ? 'USER' : 'MODEL',
            parts:
              m.role === 'user'
                ? buildGeminiUserParts(m.content || '', m.images)
                : [{ text: m.content || '' }],
          })),
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.error?.message || `Gemini API request failed with status ${response.status}`
    );
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

function buildGeminiUserParts(text, images) {
  const parts = [];
  const safeText = typeof text === 'string' ? text : '';
  if (safeText.trim()) {
    parts.push({ text: safeText });
  }
  const safeImages = Array.isArray(images) ? images : [];
  safeImages.forEach((image) => {
    if (!image || !image.data || !image.mimeType) return;
    parts.push({
      inline_data: {
        mime_type: image.mimeType,
        data: image.data,
      },
    });
  });
  return parts.length ? parts : [{ text: safeText }];
}

function extractOpenAIResponseText(responseData) {
  const output = Array.isArray(responseData?.output) ? responseData.output : [];
  const chunks = [];
  output.forEach((item) => {
    if (!item || item.type !== 'message') return;
    const content = Array.isArray(item.content) ? item.content : [];
    content.forEach((part) => {
      if (!part) return;
      if (part.type === 'output_text' && typeof part.text === 'string') {
        chunks.push(part.text);
      }
    });
  });
  return chunks.join('').trim();
}

async function explainWord(provider, apiKey, term, context, modelPreference) {
  const systemPrompt = `You are a knowledgeable assistant helping a reader understand a specific word or phrase from a summary they are reading.

Your task is to explain the highlighted term clearly in the context of the provided summary. Your explanation must:
- Clarify what the term means specifically within this context
- Explain its significance or role in relation to the main topic
- Use simple, clear language that a non-expert can understand
- Be concise but thorough (2–4 paragraphs or bullet points at most)
- Use markdown formatting for clarity (bold key concepts, use bullets if listing things)
- Respond in the EXACT SAME LANGUAGE as the provided summary — do NOT switch languages`;
  const client = await initializeAI(provider, apiKey, modelPreference);
  const userPrompt = `Here is the summary context:\n\n${context}\n\n---\n\nPlease explain what **"${term}"** means in the context above.`;
  return generateAIContent(client, 'explain', systemPrompt, userPrompt);
}

async function callOpenAI(apiKey, model, systemPrompt, userPrompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
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
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(apiKey, model, systemPrompt, userPrompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`,
    // `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'MODEL',
            parts: [{ text: systemPrompt }],
          },
          {
            role: 'USER',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.error?.message || `Gemini API request failed with status ${response.status}`
    );
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
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
