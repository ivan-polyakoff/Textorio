// Контракт AI-провайдера. Каждый адаптер в src/providers/ возвращает объект:
//
// {
//   // Генерация текста по промпту. Возвращает строку.
//   // Не бросает ошибок наружу: при сбое возвращает дружелюбный текст
//   // (пользователь всегда получает ответ).
//   async chat(text, { model }?) → string
//
//   // Анализ изображения. Получает уже скачанные байты.
//   // Бросает ошибки: у ошибок лимита размера error.stage = 'photo_size'.
//   async vision(buffer, contentType, caption?, { model, prompt }?) → string
//
//   // Возможности провайдера — скиллы сверяются перед показом в меню:
//   // скилл с requires: ['vision'] скрывается, если capabilities.vision = false.
//   capabilities: { vision: boolean, filesApi: boolean }
// }
//
// Выбор провайдера: AI_PROVIDER в .env (см. createAiProvider ниже).

const { createGigaChatProvider } = require('./gigachat');

/**
 * Создаёт AI-провайдер по конфигу.
 * @param {object} env — общий env из src/config/env.js
 */
function createAiProvider(env) {
  switch (env.aiProvider) {
    case 'gigachat':
    case undefined:
    case '':
      return createGigaChatProvider(env.gigachat);

    default:
      throw new Error(`Неизвестный AI_PROVIDER: ${env.aiProvider}. Доступно: gigachat`);
  }
}

module.exports = {
  createAiProvider
};
