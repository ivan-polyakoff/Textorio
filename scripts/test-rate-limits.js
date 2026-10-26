/* Тест частотных лимитов GigaChat: node scripts/test-rate-limits.js */
require('dotenv').config();
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const { randomUUID } = require('crypto');

async function main() {
  const config = {
    apiKey: process.env.GIGACHAT_API_KEY,
    authUrl: process.env.GIGACHAT_AUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    apiUrl: process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
    scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
    textModel: process.env.GIGACHAT_TEXT_MODEL || 'GigaChat',
    rejectUnauthorized: process.env.GIGACHAT_REJECT_UNAUTHORIZED !== 'false',
    caBundleFile: process.env.GIGACHAT_CA_BUNDLE_FILE
  };

  const agentOptions = { rejectUnauthorized: config.rejectUnauthorized };
  if (config.caBundleFile) agentOptions.ca = fs.readFileSync(config.caBundleFile);
  const client = axios.create({ timeout: 60000, httpsAgent: new https.Agent(agentOptions) });

  const tokenResponse = await client.post(config.authUrl, new URLSearchParams({ scope: config.scope }).toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: randomUUID(),
      Authorization: `Bearer ${config.apiKey}`
    }
  });
  const accessToken = tokenResponse.data.access_token;
  console.log('Токен получен');

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` };

  // Серия из 5 подряд простых запросов без пауз — проверяем RPM/одновременные лимиты.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await client.post(config.apiUrl, {
        model: config.textModel,
        messages: [{ role: 'user', content: 'Ответь одним словом: тест' }],
        stream: false
      }, { headers });
      console.log(`Запрос ${attempt}: OK за ${Date.now() - startedAt} мс — ${response.data.choices[0].message.content.trim().slice(0, 40)}`);
    } catch (error) {
      const data = typeof error.response?.data === 'string' ? error.response.data.slice(0, 150).replace(/\s+/g, ' ') : JSON.stringify(error.response?.data);
      console.log(`Запрос ${attempt}: ОШИБКА за ${Date.now() - startedAt} мс — HTTP ${error.response?.status}: ${data}`);
    }
  }
}

main().catch((error) => {
  console.error('Ошибка:', error.response ? `HTTP ${error.response.status}` : error.message);
  process.exit(1);
});
