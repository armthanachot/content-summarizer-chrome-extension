chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
  } catch (err) {
    console.warn('Content Summarizer: Cannot inject into this page.', err.message);
  }
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'summarize') {
    callOpenAI(request.apiKey, request.content, request.maxWords)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function callOpenAI(apiKey, content, maxWords) {
  let systemPrompt =
    'You are a content summarizer. Summarize the provided content in a clear, well-structured markdown format. Use headers, bullet points, and formatting to make the summary easy to read and visually appealing.';

  if (maxWords && maxWords > 0) {
    systemPrompt += ` Keep your response within ${maxWords} words.`;
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
        { role: 'user', content: `Please summarize the following content:\n\n${content}` },
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
