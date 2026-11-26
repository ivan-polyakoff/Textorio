// Адаптер AI-провайдера GigaChat (Sber).
// Контракт провайдера см. в src/providers/provider.js:
//   chat(text, options) → string
//   vision(buffer, contentType, caption, options) → string
//   capabilities → { vision, filesApi }
// Вся специфика GigaChat (OAuth, CA, Files API) живёт только здесь.

const axios = require('axios');
const https = require('https');
const fs = require('fs');
const FormData = require('form-data');
const { randomUUID } = require('crypto');
const { logger } = require('../utils/logger');

const { GENERIC_ERROR_TEXT } = require('./errorText');
const GENERIC_VISION_ERROR_TEXT = 'Извините, не получилось создать пост по фото. Попробуйте позже или пришлите другое изображение.';

function createGigaChatProvider(config) {
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

  const retryableNetworkCodes = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNABORTED',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ENETUNREACH'
  ]);

  let accessTokenCache = null;
  let tokenExpiryTime = 0;
  let tokenRequestPromise = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isRetryableNetworkError(error) {
    if (error.response) return false;
    return retryableNetworkCodes.has(error.code) || retryableNetworkCodes.has(error.cause?.code);
  }

  function formatAxiosError(error) {
    if (error.response) {
      const data = Buffer.isBuffer(error.response.data)
        ? error.response.data.toString('utf8', 0, 500)
        : error.response.data;

      return {
        status: error.response.status,
        data
      };
    }

    return {
      code: error.code,
      causeCode: error.cause?.code,
      syscall: error.syscall || error.cause?.syscall,
      hostname: error.hostname || error.cause?.hostname,
      message: error.message
    };
  }

  async function requestWithRetry(label, requestFn) {
    let lastError;

    for (let attempt = 1; attempt <= config.retryAttempts; attempt += 1) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;

        if (!isRetryableNetworkError(error) || attempt === config.retryAttempts) {
          break;
        }

        const delayMs = 500 * attempt;
        logger.warn(`${label}: сетевая ошибка ${error.code || error.cause?.code || error.message}. Повтор ${attempt + 1}/${config.retryAttempts} через ${delayMs} мс.`);
        await sleep(delayMs);
      }
    }

    throw lastError;
  }

  async function getAccessToken() {
    try {
      if (!config.apiKey) {
        throw new Error('Не задан GIGACHAT_API_KEY в .env');
      }

      const body = new URLSearchParams({ scope: config.scope });

      const response = await requestWithRetry('Получение токена GigaChat', () => client.post(config.authUrl, body.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          RqUID: randomUUID(),
          Authorization: `Bearer ${config.apiKey}`
        }
      }));

      if (!response.data?.access_token) {
        throw new Error('GigaChat OAuth не вернул access_token');
      }

      return response.data;
    } catch (error) {
      logger.error('Ошибка при получении токена доступа:', formatAxiosError(error));
      throw error;
    }
  }

  function invalidateAccessToken() {
    accessTokenCache = null;
    tokenExpiryTime = 0;
  }

  async function getCachedAccessToken() {
    const now = Date.now();

    if (accessTokenCache && now < tokenExpiryTime) {
      return accessTokenCache;
    }

    // Защита от параллельных обновлений: все запросы ждут один OAuth-запрос.
    if (!tokenRequestPromise) {
      tokenRequestPromise = getAccessToken()
        .then((tokenData) => {
          accessTokenCache = tokenData.access_token;

          if (typeof tokenData.expires_at === 'number') {
            tokenExpiryTime = tokenData.expires_at - (5 * 60 * 1000);
          } else {
            tokenExpiryTime = Date.now() + (25 * 60 * 1000);
          }

          return accessTokenCache;
        })
        .finally(() => {
          tokenRequestPromise = null;
        });
    }

    return tokenRequestPromise;
  }

  // Обертка для запросов с Bearer-токеном: при 401 обновляет токен и повторяет запрос один раз.
  async function requestWithTokenAuth(label, requestFn) {
    try {
      const accessToken = await getCachedAccessToken();
      return await requestWithRetry(label, () => requestFn(accessToken));
    } catch (error) {
      if (error?.response?.status !== 401) {
        throw error;
      }

      logger.warn(`${label}: GigaChat вернул 401, обновляю access token и повторяю запрос.`);
      invalidateAccessToken();
      const accessToken = await getCachedAccessToken();
      return requestWithRetry(label, () => requestFn(accessToken));
    }
  }

  async function chatCompletion(messages, model, label) {
    const response = await requestWithTokenAuth(label, (accessToken) => client.post(config.apiUrl, {
      messages,
      model,
      stream: false
    }, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      }
    }));

    return response.data.choices[0].message.content.trim();
  }

  // --- Публичный контракт провайдера ---

  /**
   * Генерация текста. Ошибки не бросаются наружу — возвращается
   * дружелюбное сообщение (поведение прежнего generateText).
   */
  // system-сообщение идёт отдельно от пользовательского текста: строгие
  // фильтры моделей не принимают правила безопасности за саму просьбу.
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
        options.model || config.textModel,
        'Запрос к GigaChat'
      );
    } catch (error) {
      logger.error('Ошибка при обращении к Гигачат:', formatAxiosError(error));
      return GENERIC_ERROR_TEXT;
    }
  }

  function getFileExtensionFromContentType(contentType) {
    if (!contentType) return 'jpg';
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('bmp')) return 'bmp';
    if (contentType.includes('tiff')) return 'tiff';
    return 'jpg';
  }

  async function uploadImageToFilesApi(image) {
    const form = new FormData();
    const extension = getFileExtensionFromContentType(image.contentType);

    form.append('file', image.buffer, {
      filename: `photo-${Date.now()}.${extension}`,
      contentType: image.contentType
    });
    form.append('purpose', 'general');

    const response = await requestWithTokenAuth('Загрузка изображения в GigaChat', (accessToken) => client.post(config.filesUrl, form, {
      headers: {
        ...form.getHeaders(),
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    }));

    if (!response.data?.id) {
      throw new Error('GigaChat Files API не вернул id загруженного файла');
    }

    return response.data.id;
  }

  /**
   * Анализ изображения (vision). Получает проверенные байты — лимит размера
   * проверен вызывающей стороной (assistant). Бросает сетевые/HTTP-ошибки.
   */
  async function vision(buffer, contentType, caption = '', options = {}) {
    const fileId = await uploadImageToFilesApi({ buffer, contentType });
    const promptText = options.prompt || 'Опиши изображение.';

    const messages = [];
    if (options.system) messages.push({ role: 'system', content: options.system });
    messages.push({ role: 'user', content: promptText, attachments: [fileId] });

    return chatCompletion(
      messages,
      options.model || config.visionModel,
      'Запрос к GigaChat Vision'
    );
  }

  return {
    chat,
    vision,
    capabilities: {
      vision: true,
      filesApi: true
    }
  };
}

module.exports = {
  createGigaChatProvider
};
