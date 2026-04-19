// Translate markdown summary to a target language.
// Depends on background.js: initializeAI, resolveModelSelection.
// Depends on ai_client.js: callOpenAI, callGemini, callVertex.

async function translateContent(
  provider,
  apiKey,
  content,
  targetLang,
  modelPreference,
  vertexProjectId
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
  const client = await initializeAI(provider, apiKey, modelPreference, vertexProjectId);
  const userPrompt = `Translate the following markdown content to ${targetLang} in a human-friendly, natural way:\n\n${content}`;
  const { model, url } = resolveModelSelection(
    client.provider,
    'translate',
    client.modelPreference,
    client.vertexProjectId
  );

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

  if (client.provider === 'vertex_ai') {
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
    const data = await callVertex(client.apiKey, url, body);
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim();
    if (!text) throw new Error('Vertex AI returned an empty response.');
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
