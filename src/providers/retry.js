// Общие сетевые хелперы для AI-провайдеров: retry сетевых ошибок и форматирование.

const { logger } = require('../utils/logger');

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ENETUNREACH'
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(error) {
  if (error.response) return false;
  return RETRYABLE_NETWORK_CODES.has(error.code) || RETRYABLE_NETWORK_CODES.has(error.cause?.code);
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

/**
 * Повторяет requestFn при сетевых ошибках (не HTTP-ответах).
 * @param {object} options
 * @param {string} options.label — имя операции для логов
 * @param {number} options.attempts — всего попыток
 * @param {Function} options.requestFn — запрос
 */
async function requestWithRetry({ label, attempts, requestFn }) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;

      if (!isRetryableNetworkError(error) || attempt === attempts) {
        break;
      }

      const delayMs = 500 * attempt;
      logger.warn(`${label}: сетевая ошибка ${error.code || error.cause?.code || error.message}. Повтор ${attempt + 1}/${attempts} через ${delayMs} мс.`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

module.exports = {
  requestWithRetry,
  isRetryableNetworkError,
  formatAxiosError,
  sleep
};
