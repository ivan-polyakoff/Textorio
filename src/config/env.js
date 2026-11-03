const dotenv = require('dotenv');

dotenv.config();

const vkGroupId = Number.parseInt(process.env.GROUP_ID ?? '', 10);

const env = {
  vkToken: process.env.VK_GROUP_TOKEN,
  vkGroupId,
  gigachat: {
    timeoutMs: Number(process.env.GIGACHAT_TIMEOUT_MS) || 30000,
    retryAttempts: Number(process.env.GIGACHAT_RETRY_ATTEMPTS) || 3,
    authUrl: process.env.GIGACHAT_AUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    apiUrl: process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
    filesUrl: process.env.GIGACHAT_FILES_URL || 'https://gigachat.devices.sberbank.ru/api/v1/files',
    textModel: process.env.GIGACHAT_TEXT_MODEL || 'GigaChat',
    visionModel: process.env.GIGACHAT_VISION_MODEL || 'GigaChat-Pro',
    scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
    photoDownloadTimeoutMs: Number(process.env.VK_PHOTO_DOWNLOAD_TIMEOUT_MS) || 30000,
    photoMaxSizeMb: Number(process.env.VK_PHOTO_MAX_SIZE_MB) || 5,
    caBundleFile: process.env.GIGACHAT_CA_BUNDLE_FILE,
    rejectUnauthorized: process.env.GIGACHAT_REJECT_UNAUTHORIZED !== 'false',
    apiKey: process.env.GIGACHAT_API_KEY
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

  if (!env.gigachat.apiKey) {
    missing.push('GIGACHAT_API_KEY — ключ доступа GigaChat');
  }

  return missing;
}

module.exports = {
  ...env,
  validateEnv
};
