// AI theme generation (delegates to self.AIThemeDesigner from ai_theme.js).
// Depends on globals from background.js: initializeAI, resolveModelSelection.

async function generateAiTheme(provider, apiKey, currentTheme, modelPreference) {
  const client = await initializeAI(provider, apiKey, modelPreference);
  const { model, url } = resolveModelSelection(client.provider, 'theme', client.modelPreference);
  return client.provider === 'gemini'
    ? self.AIThemeDesigner.fetchGemini(client.apiKey, model, url, currentTheme)
    : self.AIThemeDesigner.fetchOpenAI(client.apiKey, model, url, currentTheme);
}
