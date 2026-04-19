// Explain a word or phrase in the context of the current summary.
// Depends on background.js: initializeAI, resolveModelSelection.
// Depends on ai_client.js: callOpenAI, callGemini, callVertex.

async function explainWord(provider, apiKey, term, context, modelPreference, vertexProjectId) {
  const systemPrompt = `You are a knowledgeable assistant helping a reader understand a specific word or phrase from a summary they are reading.

Your task is to explain the highlighted term clearly in the context of the provided summary. Your explanation must:
- Clarify what the term means specifically within this context
- Explain its significance or role in relation to the main topic
- Use simple, clear language that a non-expert can understand
- Be concise but thorough (2–4 paragraphs or bullet points at most)
- Use markdown formatting for clarity (bold key concepts, use bullets if listing things)
- Respond in the EXACT SAME LANGUAGE as the provided summary — do NOT switch languages`;
  const client = await initializeAI(provider, apiKey, modelPreference, vertexProjectId);
  const userPrompt = `Here is the summary context:\n\n${context}\n\n---\n\nPlease explain what **"${term}"** means in the context above.`;
  const { model, url } = resolveModelSelection(
    client.provider,
    'explain',
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
