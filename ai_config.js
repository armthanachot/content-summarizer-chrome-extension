// AI provider defaults: each task has { model, url } (URLs may repeat per task).

const DEFAULT_PROVIDER = 'openai';

const OPENAI_CHAT_COMPLETIONS = 'https://api.openai.com/v1/chat/completions';
const OPENAI_RESPONSES = 'https://api.openai.com/v1/responses';

function geminiV1ModelUrl(modelId) {
  return `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(modelId)}:generateContent`;
}

function geminiV1BetaModelUrl(modelId) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
}

/** Vertex AI (Google publisher models, global). URL completed in resolveModelSelection with project + model. */
function vertexGenerateContentUrl(projectId, modelId) {
  const pid = encodeURIComponent((projectId || '').trim());
  const mid = encodeURIComponent(modelId);
  return `https://aiplatform.googleapis.com/v1/projects/${pid}/locations/global/publishers/google/models/${mid}:generateContent`;
}

const PROVIDER_CONFIGS = {
  openai: {
    label: 'OpenAI',
    models: {
      default: { model: 'gpt-4o-mini', url: OPENAI_CHAT_COMPLETIONS },
      supported: ['gpt-4o-mini'],
    },
    taskDefaults: {
      summarize: { model: 'gpt-4o-mini', url: OPENAI_CHAT_COMPLETIONS },
      translate: { model: 'gpt-4o-mini', url: OPENAI_CHAT_COMPLETIONS },
      explain: { model: 'gpt-4o-mini', url: OPENAI_CHAT_COMPLETIONS },
      chat: { model: 'gpt-4o-mini', url: OPENAI_RESPONSES },
      advisors: { model: 'gpt-4o-mini', url: OPENAI_RESPONSES },
      theme: { model: 'gpt-4o-mini', url: OPENAI_RESPONSES },
    },
  },
  gemini: {
    label: 'Gemini',
    models: {
      default: { model: 'gemini-2.5-flash', url: geminiV1ModelUrl('gemini-2.5-flash') },
      supported: ['gemini-2.5-flash'],
    },
    taskDefaults: {
      summarize: { model: 'gemini-2.5-flash', url: geminiV1ModelUrl('gemini-2.5-flash') },
      translate: { model: 'gemini-2.5-flash', url: geminiV1ModelUrl('gemini-2.5-flash') },
      explain: { model: 'gemini-2.5-flash', url: geminiV1ModelUrl('gemini-2.5-flash') },
      chat: { model: 'gemini-2.5-pro', url: geminiV1ModelUrl('gemini-2.5-pro') },
      advisors: { model: 'gemini-2.5-flash', url: geminiV1BetaModelUrl('gemini-2.5-flash') },
      theme: { model: 'gemini-3-flash-preview', url: geminiV1BetaModelUrl('gemini-3-flash-preview') },
    },
  },
  vertex_ai: {
    label: 'Vertex AI',
    models: {
      default: { model: 'gemini-2.5-flash', url: vertexGenerateContentUrl('_', 'gemini-2.5-flash') },
      supported: ['gemini-2.5-flash'],
    },
    taskDefaults: {
      summarize: { model: 'gemini-2.5-flash', url: vertexGenerateContentUrl('_', 'gemini-2.5-flash') },
      translate: { model: 'gemini-2.5-flash', url: vertexGenerateContentUrl('_', 'gemini-2.5-flash') },
      explain: { model: 'gemini-2.5-flash', url: vertexGenerateContentUrl('_', 'gemini-2.5-flash') },
      chat: { model: 'gemini-2.5-pro', url: vertexGenerateContentUrl('_', 'gemini-2.5-pro') },
      advisors: { model: 'gemini-2.5-flash', url: vertexGenerateContentUrl('_', 'gemini-2.5-flash') },
      theme: { model: 'gemini-3-flash-preview', url: vertexGenerateContentUrl('_', 'gemini-3-flash-preview') },
    },
  },
};
