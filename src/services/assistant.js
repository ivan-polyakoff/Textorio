// Сервис-ассистент: связывает персону, промпты скиллов и AI-провайдер.
// Провайдер — любой, отвечающий контракту src/providers/provider.js
// (chat / vision / capabilities). Специфика шлюза сюда не просачивается.

const { PROMPTS } = require('../config/prompts');
const { getPersona } = require('../config/persona');
const { logger } = require('../utils/logger');

const VK_PHOTO_MAX_BYTES = 20 * 1024 * 1024; // ограничение axios при скачивании

function createAssistantService(provider, config) {
  // Персонаж свободного диалога (характер бота), выбирается через BOT_PERSONA.
  const persona = getPersona(config.persona);
  // Настройки фото лежат на верхнем уровне env (общие для всех провайдеров).
  const photoConfig = {
    downloadTimeoutMs: config.photoDownloadTimeoutMs,
    maxSizeMb: config.photoMaxSizeMb
  };

  async function generateText(prompt) {
    return provider.chat(prompt);
  }

  async function generatePersonaReply(userMessage) {
    return provider.chat(persona.replyWrapper(userMessage, persona.system));
  }

  // Скачивание фото из VK — транспортная задача, провайдеру передаются байты.
  // Размер проверяется здесь же: лимит — политика приложения, а не шлюза.
  async function downloadImage(urls) {
    const axios = require('axios');
    const list = Array.isArray(urls) ? urls : [urls];
    let lastError;
    let downloaded = null;

    for (let urlIndex = 0; urlIndex < list.length; urlIndex += 1) {
      const imageUrl = list[urlIndex];

      // До 3 попыток на URL: 429 у VK CDN обычно краткосрочный.
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: photoConfig.downloadTimeoutMs,
            maxRedirects: 5,
            maxContentLength: VK_PHOTO_MAX_BYTES,
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

          downloaded = {
            buffer: Buffer.from(response.data),
            contentType
          };

          const maxBytes = photoConfig.maxSizeMb * 1024 * 1024;

          if (downloaded.buffer.length > maxBytes) {
            const sizeMb = (downloaded.buffer.length / (1024 * 1024)).toFixed(1);
            const error = new Error(`Фото весит ${sizeMb} МБ, лимит ${config.photoMaxSizeMb} МБ`);
            error.stage = 'photo_size';
            throw error;
          }

          return downloaded;
        } catch (error) {
          lastError = error;

          if (error.stage === 'photo_size') {
            throw error;
          }

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
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError;
  }

  async function generatePostFromPhoto(photoUrls, caption = '') {
    try {
      const image = await downloadImage(photoUrls);
      const prompt = PROMPTS.photoPost(caption);

      return await provider.vision(image.buffer, image.contentType, caption, { prompt });
    } catch (error) {
      if (error.stage === 'photo_size') {
        logger.warn(`Отклонено фото: ${error.message}`);
        return `Фото слишком большое (${error.message.match(/весит ([\d.]+) МБ/)?.[1] || '?'} МБ), максимум ${photoConfig.maxSizeMb} МБ. Пришлите, пожалуйста, меньшую версию изображения.`;
      }

      if (error.stage === 'vk_download') {
        logger.error(`Ошибка при генерации поста по фото (этап скачивания фото из VK): ${error.message}`);
      } else if (error.response) {
        logger.error(`Ошибка при генерации поста по фото (этап AI): HTTP ${error.response.status}`);
      } else {
        logger.error('Ошибка при генерации поста по фото:', error.message || error);
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
  createAssistantService
};
