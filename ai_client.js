// Central HTTP for OpenAI, Gemini, and Vertex AI: caller supplies url + body (object or JSON string).

async function callOpenAI(apiKey, url, body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: bodyStr,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data.error?.message || `OpenAI request failed with status ${response.status}`
    );
  }
  return data;
}

async function callGemini(apiKey, url, body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: bodyStr,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data.error?.message || `Gemini request failed with status ${response.status}`
    );
  }
  return data;
}

/** Vertex AI: API key is sent as query parameter `key` (same as user-facing Gemini API key). */
async function callVertex(apiKey, url, body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const sep = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${sep}key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: bodyStr,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data.error?.message || `Vertex AI request failed with status ${response.status}`
    );
  }
  return data;
}
