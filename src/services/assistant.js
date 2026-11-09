// Сервис-ассистент: транспортные операции над фото (скачивание из VK),
// общие для всех скиллов. Генерация переехала в core/engine.js и провайдер.

const axios = require('axios');
const { logger } = require('../utils/logger');

const VK_PHOTO_MAX_BYTES = 20 * 1024 * 1024; // ограничение axios при скачивании

function createAssistantService(config) {
  const photoMaxSizeMb = config.photoMaxSizeMb;

  // Скачивание фото из VK — транспортная задача, провайдеру передаются байты.
  // Размер проверяется здесь же: лимит — политика приложения, а не шлюза.
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

          const downloaded = {
            buffer: Buffer.from(response.data),
            contentType
          };

          const maxBytes = config.photoMaxSizeMb * 1024 * 1024;

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

  return {
    downloadImage,
    photoMaxSizeMb
  };
}

module.exports = {
  createAssistantService
};
