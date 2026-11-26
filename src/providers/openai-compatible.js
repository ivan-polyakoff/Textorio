// Адаптер AI-провайдера для OpenAI-совместимых шлюзов.
// Покрывает: YandexGPT (OpenAI-совместимый режим), DeepSeek, OpenRouter,
// Ollama, vLLM и прочие API с POST {base}/chat/completions.
// Контракт провайдера см. в src/providers/provider.js.

const axios = require('axios');
const https = require('https');
const fs = require('fs');
const { logger } = require('../utils/logger');
const { requestWithRetry, formatAxiosError } = require('./retry');

const { GENERIC_ERROR_TEXT } = require('./errorText');

// Vision у OpenAI-совместимых API: изображение передаётся base64-дата URL
// прямо в сообщении (Files API не используется).
function toDataUrl(buffer, contentType) {
  const type = contentType || 'image/jpeg';
  return `data:${type};base64,${buffer.toString('base64')}`;
}

function createOpenAiCompatibleProvider(config) {
  const httpsAgentOptions = {
    keepAlive: false,
    rejectUnauthorized: config.rejectUnauthorized
  };

  if (config.caBundleFile) {
    httpsAgentOptions.ca = fs.readFileSync(config.caBundleFile);
  }

  const client = axios.create({
    timeout: config.timeoutMs,
    httpsAgent: new https.Agent(httpsAgentOptions)
  });

  const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');

  if (!baseUrl) {
    throw new Error('Не задан AI_BASE_URL для openai-провайдера');
  }

  if (!config.apiKey) {
    throw new Error('Не задан AI_API_KEY для openai-провайдера');
  }

  const completionsUrl = `${baseUrl}/chat/completions`;

  async function chatCompletion(messages, model) {
    if (!model) {
      throw new Error('Не задана модель (AI_MODEL / AI_VISION_MODEL в .env)');
    }

    const response = await requestWithRetry({
      label: 'Запрос к ' + baseUrl,
      attempts: config.retryAttempts,
      requestFn: () => client.post(completionsUrl, {
        messages,
        model,
        stream: false
      }, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        }
      })
    });

    return response.data.choices[0].message.content.trim();
  }

  /**
   * Генерация текста. Ошибки не бросаются наружу — возвращается
   * дружелюбное сообщение (единое поведение всех провайдеров).
   */
  function buildMessages(content, system) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content });
    return messages;
  }

  async function chat(text, options = {}) {
    try {
      return await chatCompletion(
        buildMessages(text, options.system),
        options.model || config.textModel
      );
    } catch (error) {
      logger.error(`Ошибка при обращении к ${baseUrl}:`, formatAxiosError(error));
      return GENERIC_ERROR_TEXT;
    }
  }

  /**
   * Анализ изображения (vision). Получает проверенные байты — лимит размера
   * проверен вызывающей стороной (assistant). Бросает сетевые/HTTP-ошибки.
   */
  async function vision(buffer, contentType, caption = '', options = {}) {
    const promptText = options.prompt || 'Опиши изображение.';

    return chatCompletion(buildMessages([
      { type: 'text', text: promptText },
      { type: 'image_url', image_url: { url: toDataUrl(buffer, contentType) } }
    ], options.system), options.model || config.visionModel);
  }

  return {
    chat,
    vision,
    capabilities: {
      vision: Boolean(config.visionModel),
      filesApi: false
    }
  };
}

module.exports = {
  createOpenAiCompatibleProvider
};
