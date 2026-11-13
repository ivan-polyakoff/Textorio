const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const vkGroupId = Number.parseInt(process.env.GROUP_ID ?? '', 10);

const env = {
  vkToken: process.env.VK_GROUP_TOKEN,
  vkGroupId,
  persona: process.env.BOT_PERSONA || 'hedgehog',
  aiProvider: process.env.AI_PROVIDER || 'gigachat',
  skillPacks: process.env.SKILL_PACKS || '',
  // Каталог данных бота (профили пользователей, память стиля).
  // По умолчанию data/ внутри каталога приложения.
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', '..', 'data'),
  // ID администраторов для ручных санкций (`/админ бан <id>`).
  adminIds: (process.env.ADMIN_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  // Анимация «Думаю…» во время генерации: скорость смены точек.
  animationIntervalMs: Number.parseInt(process.env.ANIMATION_INTERVAL_MS ?? '', 10) || 700,
  // Санкции за однозначные нарушения цензуры.
  moderation: {
    strikeLimit: Number.parseInt(process.env.MODERATION_STRIKE_LIMIT ?? '', 10) || 3,
    strikeWindowHours: Number.parseInt(process.env.MODERATION_STRIKE_WINDOW_HOURS ?? '', 10) || 24,
    blockHours: Number.parseInt(process.env.MODERATION_BLOCK_HOURS ?? '', 10) || 24
  },
  // Настройки фото — политика приложения, общая для всех провайдеров.
  photoDownloadTimeoutMs: Number(process.env.VK_PHOTO_DOWNLOAD_TIMEOUT_MS) || 30000,
  photoMaxSizeMb: Number(process.env.VK_PHOTO_MAX_SIZE_MB) || 5,
  gigachat: {
    timeoutMs: Number(process.env.GIGACHAT_TIMEOUT_MS) || 30000,
    retryAttempts: Number(process.env.GIGACHAT_RETRY_ATTEMPTS) || 3,
    authUrl: process.env.GIGACHAT_AUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    apiUrl: process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
    filesUrl: process.env.GIGACHAT_FILES_URL || 'https://gigachat.devices.sberbank.ru/api/v1/files',
    textModel: process.env.GIGACHAT_TEXT_MODEL || 'GigaChat',
    visionModel: process.env.GIGACHAT_VISION_MODEL || 'GigaChat-Pro',
    scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
    caBundleFile: process.env.GIGACHAT_CA_BUNDLE_FILE,
    rejectUnauthorized: process.env.GIGACHAT_REJECT_UNAUTHORIZED !== 'false',
    apiKey: process.env.GIGACHAT_API_KEY
  },
  openai: {
    baseUrl: process.env.AI_BASE_URL,
    apiKey: process.env.AI_API_KEY,
    textModel: process.env.AI_MODEL,
    visionModel: process.env.AI_VISION_MODEL,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 30000,
    retryAttempts: Number(process.env.AI_RETRY_ATTEMPTS) || 3,
    caBundleFile: process.env.AI_CA_BUNDLE_FILE,
    rejectUnauthorized: process.env.AI_REJECT_UNAUTHORIZED !== 'false'
  }
};

function validateEnv() {
  const missing = [];

  if (!env.vkToken) {
    missing.push('VK_GROUP_TOKEN — токен группы ВКонтакте');
  }

  if (!Number.isFinite(vkGroupId)) {
    missing.push('GROUP_ID — числовой ID группы ВКонтакте');
  }

  // Обязателен ключ того провайдера, который выбран, а не все сразу:
  // тестовый инстанс может работать на openai-совместимом API без GigaChat.
  if (env.aiProvider === 'openai') {
    if (!env.openai.baseUrl) {
      missing.push('AI_BASE_URL — базовый URL OpenAI-совместимого API');
    }

    if (!env.openai.apiKey) {
      missing.push('AI_API_KEY — ключ OpenAI-совместимого API');
    }
  } else if (!env.gigachat.apiKey) {
    missing.push('GIGACHAT_API_KEY — ключ доступа GigaChat');
  }

  return missing;
}

module.exports = {
  ...env,
  validateEnv
};
