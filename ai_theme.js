/**
 * AI theme generation helpers with strict structured JSON output.
 * OpenAI: POST /v1/responses with text.format json_schema.
 * Gemini: generateContent with responseMimeType + responseJsonSchema.
 */
(function aiThemeDesignerModule() {
  const postOpenAI = callOpenAI;
  const postGemini = callGemini;
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
    'assistantMdHeading',
    'assistantMdH1Underline',
    'assistantMdParagraph',
    'assistantMdStrong',
    'assistantMdCodeBg',
    'assistantMdCodeText',
    'assistantMdCodeBorder',
    'assistantMdPreBg',
    'assistantMdPreText',
    'assistantMdPreBorder',
    'assistantMdLink',
    'assistantMdTableBorder',
    'assistantMdThBg',
    'assistantMdThText',
    'assistantMdEvenRowBg',
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
      '- Your themeName and overall palette must be clearly distinct from any existing presets supplied in a separate user message (JSON object).',
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

  function buildExistingPresetsUserContent(presetDescriptor) {
    const safe = presetDescriptor && typeof presetDescriptor === 'object' ? presetDescriptor : {};
    const entries = Array.isArray(safe.entries) ? safe.entries : [];
    const labels = Array.isArray(safe.labels) ? safe.labels : [];
    const payload = {
      existing_theme_presets: entries,
      existing_theme_labels: labels,
    };
    return [
      'Constraint JSON — existing bundled and saved-in-browser themes (do not duplicate these names or mimic these palettes):',
      JSON.stringify(payload),
      '',
      'You must invent a new themeName and colors that are clearly different from every entry in existing_theme_presets / existing_theme_labels.',
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

  async function fetchOpenAI(apiKey, model, url, currentTheme, presetDescriptor) {
    const presetMeta =
      presetDescriptor && typeof presetDescriptor === 'object'
        ? presetDescriptor
        : { entries: [], labels: [] };
    const body = {
      model,
      input: [
        { role: 'system', content: buildSystemInstruction() },
        { role: 'user', content: buildUserContent(currentTheme) },
        { role: 'user', content: buildExistingPresetsUserContent(presetMeta) },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: SCHEMA_NAME,
          strict: true,
          schema: getThemeJsonSchema(),
        },
      },
    };
    const raw = await postOpenAI(apiKey, url, body);
    const parsed = parseOpenAIResponsesStructuredJson(raw);
    return normalizeThemePayload(parsed);
  }

  async function fetchGemini(apiKey, model, url, currentTheme, presetDescriptor) {
    const presetMeta =
      presetDescriptor && typeof presetDescriptor === 'object'
        ? presetDescriptor
        : { entries: [], labels: [] };
    const body = {
      system_instruction: {
        parts: [{ text: buildSystemInstruction() }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildUserContent(currentTheme) },
            { text: buildExistingPresetsUserContent(presetMeta) },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        responseJsonSchema: getThemeJsonSchema(),
      },
    };
    const data = await postGemini(apiKey, url, body);
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
