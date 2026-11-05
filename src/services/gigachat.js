const axios = require('axios');
const https = require('https');
const fs = require('fs');
const FormData = require('form-data');
const { randomUUID } = require('crypto');
const { PROMPTS } = require('../config/prompts');
const { getPersona } = require('../config/persona');
const { logger } = require('../utils/logger');

function createGigaChatService(config) {
  // Персонаж свободного диалога (характер бота), выбирается через BOT_PERSONA.
  const persona = getPersona(config.persona);
  const gigachatHttpsAgentOptions = {
    keepAlive: false,
    rejectUnauthorized: config.rejectUnauthorized
  };

  if (config.caBundleFile) {
    gigachatHttpsAgentOptions.ca = fs.readFileSync(config.caBundleFile);
  }

  const gigachatClient = axios.create({
    timeout: config.timeoutMs,
    httpsAgent: new https.Agent(gigachatHttpsAgentOptions)
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

      const response = await requestWithRetry('Получение токена GigaChat', () => gigachatClient.post(config.authUrl, body.toString(), {
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

  function getFileExtensionFromContentType(contentType) {
    if (!contentType) return 'jpg';
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('bmp')) return 'bmp';
    if (contentType.includes('tiff')) return 'tiff';
    return 'jpg';
  }

  async function downloadImage(urls) {
    const list = Array.isArray(urls) ? urls : [urls];
    let lastError;

    for (let urlIndex = 0; urlIndex < list.length; urlIndex += 1) {
      const imageUrl = list[urlIndex];

      // До 3 попыток на URL: 429 у VK CDN обычно краткосрочный.
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: config.photoDownloadTimeoutMs,
            maxRedirects: 5,
            maxContentLength: 20 * 1024 * 1024,
            headers: {
              Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
            },
            validateStatus: (status) => status >= 200 && status < 300
          });

          const contentType = response.headers['content-type'] || 'image/jpeg';

          if (!contentType.startsWith('image/')) {
            throw new Error(`VK вернул не изображение, content-type: ${contentType}`);
          }

          if (urlIndex > 0 || attempt > 1) {
            logger.warn(`Фото скачано с попытки ${attempt}, URL ${urlIndex + 1}/${list.length}`);
          }

          return {
            buffer: Buffer.from(response.data),
            contentType
          };
        } catch (error) {
          lastError = error;
          const url = new URL(imageUrl);
          const details = error.response ? `HTTP ${error.response.status}` : (error.code || error.cause?.code || error.message);

          const isLastAttempt = attempt === 3;
          const isRetryable = !error.response || error.response.status === 429 || error.response.status === 403;

          if (!isRetryable || isLastAttempt) {
            error.stage = 'vk_download';
            error.message = `Не удалось скачать фото из VK (${url.hostname}): ${details}: ${error.message}`;
            throw error;
          }

          const delayMs = 1000 * attempt;
          logger.warn(`Скачивание фото (${url.hostname}): ${details}. Повтор ${attempt + 1}/3 через ${delayMs} мс.`);
          await sleep(delayMs);
        }
      }
    }

    throw lastError;
  }

  async function uploadImageToGigaChat(urls) {
    const image = await downloadImage(urls);
    const maxBytes = config.photoMaxSizeMb * 1024 * 1024;

    if (image.buffer.length > maxBytes) {
      const sizeMb = (image.buffer.length / (1024 * 1024)).toFixed(1);
      const error = new Error(`Фото весит ${sizeMb} МБ, лимит ${config.photoMaxSizeMb} МБ`);
      error.stage = 'photo_size';
      throw error;
    }

    const form = new FormData();
    const extension = getFileExtensionFromContentType(image.contentType);

    form.append('file', image.buffer, {
      filename: `vk-photo-${Date.now()}.${extension}`,
      contentType: image.contentType
    });
    form.append('purpose', 'general');

    const response = await requestWithTokenAuth('Загрузка изображения в GigaChat', (accessToken) => gigachatClient.post(config.filesUrl, form, {
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

  async function generateText(prompt) {
    try {
      const response = await requestWithTokenAuth('Запрос к GigaChat', (accessToken) => gigachatClient.post(config.apiUrl, {
        messages: [{ role: 'user', content: prompt }],
        model: config.textModel,
        stream: false
      }, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`
        }
      }));

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Ошибка при обращении к Гигачат:', formatAxiosError(error));
      return 'Извините, произошла ошибка при генерации текста. Попробуйте позже.';
    }
  }

  async function generatePersonaReply(userMessage) {
    return generateText(persona.replyWrapper(userMessage, persona.system));
  }

  async function generatePostFromPhoto(photoUrls, caption = '') {
    try {
      const fileId = await uploadImageToGigaChat(photoUrls);
      const prompt = PROMPTS.photoPost(caption);

      const response = await requestWithTokenAuth('Запрос к GigaChat Vision', (accessToken) => gigachatClient.post(config.apiUrl, {
        model: config.visionModel,
        messages: [{ role: 'user', content: prompt, attachments: [fileId] }],
        stream: false
      }, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`
        }
      }));

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      if (error.stage === 'photo_size') {
        logger.warn(`Отклонено фото: ${error.message}`);
        return `Фото слишком большое (${error.message.match(/весит ([\d.]+) МБ/)?.[1] || '?'} МБ), максимум ${config.photoMaxSizeMb} МБ. Пришлите, пожалуйста, меньшую версию изображения.`;
      }

      if (error.stage === 'vk_download') {
        logger.error(`Ошибка при генерации поста по фото (этап скачивания фото из VK): ${error.message}`);
      } else if (error.response) {
        logger.error(`Ошибка при генерации поста по фото (этап GigaChat): HTTP ${error.response.status}`, formatAxiosError(error));
      } else {
        logger.error('Ошибка при генерации поста по фото:', formatAxiosError(error));
      }
      return 'Извините, не получилось создать пост по фото. Попробуйте позже или пришлите другое изображение.';
    }
  }

  return {
    generateText,
    generatePersonaReply,
    generatePostFromPhoto
  };
}

module.exports = {
  createGigaChatService
};
