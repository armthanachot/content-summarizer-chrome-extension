/**
 * Expert advisor suggestions: shared JSON schema, prompts, and API helpers for the service worker.
 * OpenAI: POST /v1/responses with text.format json_schema (see note/structure_output_openAI.md).
 * Gemini: v1beta generateContent with responseMimeType + responseJsonSchema (see note/structure_output_gemini.md).
 */

(function expertAdvisorsModule() {
  const postOpenAI = callOpenAI;
  const postGemini = callGemini;
  const postVertex = callVertex;
  const SCHEMA_NAME = 'expert_advisors';

  function getExpertAdvisorsJsonSchema() {
    return {
      type: 'object',
      properties: {
        experts: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description:
                  'Concise professional role or expert label (e.g. Senior AI Engineer, Climate Scientist).',
              },
              bio: {
                type: 'string',
                description:
                  'One-line bio of at most 20 words, same dominant language as the summary.',
              },
              instruction: {
                type: 'string',
                description:
                  'Concrete behavioral instruction for the chat assistant: how to think, prioritize, and respond when this expert is chosen. Same dominant language as the summary. Will be appended to the base chat system prompt as: act as [instruction].',
              },
            },
            required: ['title', 'bio', 'instruction'],
            additionalProperties: false,
          },
        },
      },
      required: ['experts'],
      additionalProperties: false,
    };
  }

  function buildSystemInstruction() {
    return [
      'You analyze a markdown summary and name exactly three distinct professional expert roles who would give the strongest, most relevant advice about the topics in that summary.',
      '',
      'Requirements:',
      '- Each role must be a genuine senior professional or domain expert (e.g. principal, lead, director, professor, attending physician, recognized specialist). Do not suggest hobbyists, students, or vague "enthusiasts".',
      '- The three experts must be complementary (different angles: technical, business, scientific, legal, financial, clinical, etc.) and grounded in what the summary actually discusses.',
      '- If the summary is thin or generic, still pick plausible expert types that fit the domain implied by the text.',
      '- Each bio must be at most 20 words, in the same dominant language as the summary.',
      '- For each expert, "instruction" must be a short imperative-style directive (1–3 sentences) telling an assistant exactly how to act for that role (priorities, tone, analytical lens). It will be combined with the app system prompt using the prefix: act as ',
      '- Do not invent specific people, companies, or credentials; describe role types only.',
      '- Return only JSON matching the schema.',
    ].join('\n');
  }

  function buildUserContent(summaryMarkdown) {
    return [
      'Here is the markdown summary:',
      '',
      '---',
      summaryMarkdown.trim(),
      '---',
      '',
      'Propose the three expert roles, bios, and per-role instruction strings as specified.',
    ].join('\n');
  }

  function truncateToWords(text, maxWords) {
    const s = (text || '').trim();
    if (!s) return '';
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length <= maxWords) return parts.join(' ');
    return parts.slice(0, maxWords).join(' ');
  }

  /**
   * @param {unknown} parsed
   * @returns {{ title: string, bio: string, instruction: string }[]}
   */
  function normalizeExperts(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid expert advisors payload.');
    }
    const experts = parsed.experts;
    if (!Array.isArray(experts) || experts.length !== 3) {
      throw new Error('Expected exactly three expert advisors.');
    }
    return experts.map((row, i) => {
      if (!row || typeof row !== 'object') {
        throw new Error(`Invalid expert entry at index ${i}.`);
      }
      const title = typeof row.title === 'string' ? row.title.trim() : '';
      let bio = typeof row.bio === 'string' ? row.bio.trim() : '';
      const instructionRaw = typeof row.instruction === 'string' ? row.instruction.trim() : '';
      if (!title) {
        throw new Error(`Missing title for expert at index ${i}.`);
      }
      if (!instructionRaw) {
        throw new Error(`Missing instruction for expert at index ${i}.`);
      }
      bio = truncateToWords(bio, 20);
      return { title, bio, instruction: instructionRaw };
    });
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

  /**
   * @returns {Promise<{ title: string, bio: string, instruction: string }[]>}
   */
  async function fetchOpenAI(apiKey, model, url, summaryMarkdown) {
    const body = {
      model,
      input: [
        { role: 'system', content: buildSystemInstruction() },
        { role: 'user', content: buildUserContent(summaryMarkdown) },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: SCHEMA_NAME,
          strict: true,
          schema: getExpertAdvisorsJsonSchema(),
        },
      },
    };
    const raw = await postOpenAI(apiKey, url, body);
    const parsed = parseOpenAIResponsesStructuredJson(raw);
    return normalizeExperts(parsed);
  }

  /**
   * @returns {Promise<{ title: string, bio: string, instruction: string }[]>}
   */
  async function fetchGemini(apiKey, model, url, summaryMarkdown) {
    const systemText = buildSystemInstruction();
    const userText = buildUserContent(summaryMarkdown);

    const body = {
      contents: [
        {
          role: 'MODEL',
          parts: [{ text: systemText }],
        },
        {
          role: 'USER',
          parts: [{ text: userText }],
        },
      ],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseJsonSchema: getExpertAdvisorsJsonSchema(),
      },
    };
    const data = await postGemini(apiKey, url, body);
    const jsonText = extractGeminiJsonText(data);
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      throw new Error('Gemini returned JSON that could not be parsed.');
    }
    return normalizeExperts(parsed);
  }

  /**
   * @returns {Promise<{ title: string, bio: string, instruction: string }[]>}
   */
  async function fetchVertex(apiKey, model, url, summaryMarkdown) {
    const systemText = buildSystemInstruction();
    const userText = buildUserContent(summaryMarkdown);

    const body = {
      contents: [
        {
          role: 'MODEL',
          parts: [{ text: systemText }],
        },
        {
          role: 'USER',
          parts: [{ text: userText }],
        },
      ],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseJsonSchema: getExpertAdvisorsJsonSchema(),
      },
    };
    const data = await postVertex(apiKey, url, body);
    const jsonText = extractGeminiJsonText(data);
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      throw new Error('Vertex AI returned JSON that could not be parsed.');
    }
    return normalizeExperts(parsed);
  }

  self.ExpertAdvisors = {
    fetchOpenAI,
    fetchGemini,
    fetchVertex,
    normalizeExperts,
    truncateToWords,
  };
})();
