/**
 * AI theme generation helpers with strict structured JSON output.
 * OpenAI: POST /v1/responses with text.format json_schema.
 * Gemini: generateContent with responseMimeType + responseJsonSchema.
 */
(function aiThemeDesignerModule() {
  const SCHEMA_NAME = 'content_summarizer_theme';

  const SUMMARY_KEYS = [
    'modalBackground',
    'textColor',
    'headerStart',
    'headerEnd',
    'headerText',
    'inputBackground',
    'inputBorder',
    'primaryStart',
    'primaryEnd',
    'summaryPanelBackground',
    'summaryPanelBorder',
    'summaryTitleColor',
    'summaryMarkdownText',
    'summaryMarkdownAccent',
  ];
  const EXPLAIN_KEYS = [
    'panelBackground',
    'borderColor',
    'headerStart',
    'headerEnd',
    'headerText',
    'bodyText',
    'accentColor',
  ];
  const CHAT_KEYS = [
    'panelBackground',
    'borderColor',
    'textColor',
    'headerStart',
    'headerEnd',
    'headerText',
    'messageAssistantBackground',
    'messageUserStart',
    'messageUserEnd',
    'inputBackground',
    'chatInputText',
    'sendButtonStart',
    'sendButtonEnd',
  ];

  function colorSchema(description) {
    return {
      type: 'string',
      pattern: '^#[0-9A-Fa-f]{6}$',
      description,
    };
  }

  function makeSectionSchema(keys, sectionName) {
    const properties = {};
    keys.forEach((key) => {
      properties[key] = colorSchema(`${sectionName}.${key} in hex format like #12ABEF`);
    });
    return {
      type: 'object',
      properties,
      required: keys,
      additionalProperties: false,
    };
  }

  function getThemeJsonSchema() {
    return {
      type: 'object',
      properties: {
        themeName: {
          type: 'string',
          minLength: 2,
          maxLength: 48,
          description: 'Short, memorable theme name.',
        },
        theme: {
          type: 'object',
          properties: {
            summary: makeSectionSchema(SUMMARY_KEYS, 'summary'),
            explain: makeSectionSchema(EXPLAIN_KEYS, 'explain'),
            chat: makeSectionSchema(CHAT_KEYS, 'chat'),
          },
          required: ['summary', 'explain', 'chat'],
          additionalProperties: false,
        },
      },
      required: ['themeName', 'theme'],
      additionalProperties: false,
    };
  }

  function buildSystemInstruction() {
    return [
      'You are an elite UI theme designer for a chrome extension called Content Summarizer.',
      'Create a cohesive, modern, playful but readable color theme across three sections: summary, explain, and chat.',
      '',
      'Hard rules:',
      '- Return only JSON that matches the schema exactly.',
      '- Every color must be HEX format #RRGGBB.',
      '- Keep text/background contrast readable.',
      '- Keep the three sections stylistically consistent as one theme family.',
      '- Theme name should be short and creative.',
    ].join('\n');
  }

  function buildUserContent(currentTheme) {
    const serialized = JSON.stringify(currentTheme || {}, null, 2);
    return [
      'Current theme (you can use it as inspiration and improve it):',
      '---',
      serialized,
      '---',
      'Generate one fresh theme with all required properties.',
    ].join('\n');
  }

  function parseOpenAIResponsesStructuredJson(data) {
    if (data && data.refusal) {
      throw new Error(typeof data.refusal === 'string' ? data.refusal : 'Model refused the request.');
    }
    const output = data && data.output;
    if (Array.isArray(output)) {
      for (let i = 0; i < output.length; i += 1) {
        const item = output[i];
        if (item && item.type === 'message' && Array.isArray(item.content)) {
          for (let j = 0; j < item.content.length; j += 1) {
            const block = item.content[j];
            if (block && block.type === 'refusal' && block.refusal) {
              throw new Error(String(block.refusal));
            }
            if (block && block.type === 'output_text' && typeof block.text === 'string') {
              return JSON.parse(block.text);
            }
          }
        }
      }
    }
    if (data && typeof data.output_text === 'string' && data.output_text.trim()) {
      return JSON.parse(data.output_text);
    }
    throw new Error('Could not read structured JSON from OpenAI Responses output.');
  }

  function extractGeminiJsonText(data) {
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim();
    if (!text) throw new Error('Gemini returned an empty structured response.');
    return text;
  }

  function ensureColor(value, fieldLabel) {
    const s = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!/^#[0-9A-F]{6}$/.test(s)) {
      throw new Error(`Invalid color for ${fieldLabel}`);
    }
    return s;
  }

  function normalizeSection(section, keys, sectionName) {
    if (!section || typeof section !== 'object') {
      throw new Error(`Missing section: ${sectionName}`);
    }
    const result = {};
    keys.forEach((key) => {
      result[key] = ensureColor(section[key], `${sectionName}.${key}`);
    });
    return result;
  }

  function normalizeThemePayload(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid theme payload.');
    }
    const themeNameRaw = typeof parsed.themeName === 'string' ? parsed.themeName.trim() : '';
    if (!themeNameRaw) throw new Error('Missing theme name.');
    const theme = parsed.theme;
    if (!theme || typeof theme !== 'object') {
      throw new Error('Missing theme object.');
    }
    return {
      themeName: themeNameRaw.slice(0, 48),
      theme: {
        summary: normalizeSection(theme.summary, SUMMARY_KEYS, 'summary'),
        explain: normalizeSection(theme.explain, EXPLAIN_KEYS, 'explain'),
        chat: normalizeSection(theme.chat, CHAT_KEYS, 'chat'),
      },
    };
  }

  async function fetchOpenAI(apiKey, model, currentTheme) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: buildSystemInstruction() },
          { role: 'user', content: buildUserContent(currentTheme) },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: SCHEMA_NAME,
            strict: true,
            schema: getThemeJsonSchema(),
          },
        },
      }),
    });

    const raw = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        raw.error?.message || `OpenAI Responses request failed with status ${response.status}`
      );
    }
    const parsed = parseOpenAIResponsesStructuredJson(raw);
    return normalizeThemePayload(parsed);
  }

  async function fetchGemini(apiKey, model, currentTheme) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            { role: 'MODEL', parts: [{ text: buildSystemInstruction() }] },
            { role: 'USER', parts: [{ text: buildUserContent(currentTheme) }] },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            responseJsonSchema: getThemeJsonSchema(),
          },
        }),
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        data.error?.message || `Gemini API request failed with status ${response.status}`
      );
    }
    const jsonText = extractGeminiJsonText(data);
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error('Gemini returned JSON that could not be parsed.');
    }
    return normalizeThemePayload(parsed);
  }

  self.AIThemeDesigner = {
    fetchOpenAI,
    fetchGemini,
    normalizeThemePayload,
  };
})();
