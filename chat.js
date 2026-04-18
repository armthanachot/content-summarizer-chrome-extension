// Chat about summary (OpenAI / Gemini), optional source enrichment, expert advisor suggestions.
// Depends on background.js: initializeAI, resolveModelSelection, extractTextFromHtml.
// Depends on ai_client.js: callOpenAI, callGemini.
// Depends on self.ExpertAdvisors from expert-advisors.js.

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

function buildChatSystemBlock(summaryContext, advisorPersona, sourceContextBlock) {
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
  const sourceSection = sourceContextBlock
    ? `\n\n---\nOptional source details (only use when the user asks to reference/fetch from source):\n${sourceContextBlock}\n---`
    : '';
  return `${systemPreamble}\n\n---\nSummary (markdown):\n${summaryContext}\n---${sourceSection}`;
}

function sanitizeSourceUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function shouldEnrichFromSource(lastUserMessage) {
  const text = (lastUserMessage || '').toLowerCase();
  if (!text) return false;
  const sourceIntentHints = [
    '@source',
    '#source',
    'from source',
    'source url',
    'original page',
    'from docs',
    'documentation',
    'reference',
    'quote',
    'extract code',
    'code snippet',
    'show code',
    'อ้างอิงต้นฉบับ',
    'จากต้นฉบับ',
    'จาก source',
    'จาก url',
    'จากลิงก์',
    'จาก docs',
    'ดึงโค้ด',
    'ยกโค้ด',
  ];
  return sourceIntentHints.some((hint) => text.includes(hint));
}

async function fetchSourceContextSnippet(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    const text = extractTextFromHtml(html);
    if (!text || text.trim().length < 20) return '';
    const MAX_SOURCE_CONTEXT_CHARS = 8000;
    return text.length > MAX_SOURCE_CONTEXT_CHARS
      ? `${text.slice(0, MAX_SOURCE_CONTEXT_CHARS)}\n\n[Source content truncated...]`
      : text;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function suggestExpertAdvisors(provider, apiKey, summaryContext, modelPreference) {
  const trimmed = (summaryContext || '').trim();
  if (!trimmed) {
    throw new Error('No summary context available for expert suggestions.');
  }
  const client = await initializeAI(provider, apiKey, modelPreference);
  const resolved = resolveModelSelection(client.provider, 'advisors', client.modelPreference);
  const experts =
    client.provider === 'gemini'
      ? await self.ExpertAdvisors.fetchGemini(
          client.apiKey,
          resolved.model,
          resolved.url,
          trimmed
        )
      : await self.ExpertAdvisors.fetchOpenAI(
          client.apiKey,
          resolved.model,
          resolved.url,
          trimmed
        );
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
  advisorPersona,
  sourceUrl
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
  const lastUserMessage = typeof history[history.length - 1].content === 'string'
    ? history[history.length - 1].content
    : '';
  const normalizedSourceUrl = sanitizeSourceUrl(sourceUrl);
  let sourceContextBlock = '';
  if (normalizedSourceUrl && shouldEnrichFromSource(lastUserMessage)) {
    try {
      const snippet = await fetchSourceContextSnippet(normalizedSourceUrl);
      if (snippet) {
        sourceContextBlock = `Source URL: ${normalizedSourceUrl}\n\n${snippet}`;
      }
    } catch (err) {
      console.warn('Content Summarizer: source enrichment skipped.', err?.message || err);
    }
  }

  const client = await initializeAI(provider, apiKey, modelPreference);
  const resolved = resolveModelSelection(client.provider, 'chat', client.modelPreference);

  if (client.provider === 'gemini') {
    return callGeminiChat(
      client.apiKey,
      resolved.model,
      resolved.url,
      trimmedSummary,
      history,
      advisorPersona,
      sourceContextBlock
    );
  }
  return callOpenAIChat(
    client.apiKey,
    resolved.model,
    resolved.url,
    trimmedSummary,
    history,
    advisorPersona,
    sourceContextBlock
  );
}

async function callOpenAIChat(
  apiKey,
  model,
  url,
  summaryContext,
  history,
  advisorPersona,
  sourceContextBlock
) {
  const systemContent = buildChatSystemBlock(summaryContext, advisorPersona, sourceContextBlock);
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

  const body = {
    model,
    input,
    temperature: 0.4,
    max_output_tokens: 4096,
  };
  const data = await callOpenAI(apiKey, url, body);
  return extractOpenAIResponseText(data);
}

async function callGeminiChat(
  apiKey,
  model,
  url,
  summaryContext,
  history,
  advisorPersona,
  sourceContextBlock
) {
  const systemBlock = buildChatSystemBlock(summaryContext, advisorPersona, sourceContextBlock);
  const body = {
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
  };

  const data = await callGemini(apiKey, url, body);
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
