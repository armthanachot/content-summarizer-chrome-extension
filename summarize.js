// Summarize from pasted text and summarize-from-URL (fetch + extract + summarize).
// Depends on background.js: initializeAI, resolveModelSelection, extractTextFromHtml.
// Depends on ai_client.js: callOpenAI, callGemini.

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
  const { model, url } = resolveModelSelection(client.provider, 'summarize', client.modelPreference);

  if (client.provider === 'gemini') {
    const body = {
      contents: [
        { role: 'MODEL', parts: [{ text: systemPrompt }] },
        { role: 'USER', parts: [{ text: userPrompt }] },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 4096,
      },
    };
    const data = await callGemini(client.apiKey, url, body);
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim();
    if (!text) throw new Error('Gemini returned an empty response.');
    return text;
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 4096,
  };
  const data = await callOpenAI(client.apiKey, url, body);
  return data.choices?.[0]?.message?.content || '';
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
