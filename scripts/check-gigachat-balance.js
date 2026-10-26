/* Проверка баланса GigaChat: node scripts/check-gigachat-balance.js */
require('dotenv').config();
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const { randomUUID } = require('crypto');

async function main() {
  const config = {
    apiKey: process.env.GIGACHAT_API_KEY,
    authUrl: process.env.GIGACHAT_AUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
    baseUrl: (process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1').replace(/\/chat\/completions$/, ''),
    rejectUnauthorized: process.env.GIGACHAT_REJECT_UNAUTHORIZED !== 'false',
    caBundleFile: process.env.GIGACHAT_CA_BUNDLE_FILE
  };

  const agentOptions = { rejectUnauthorized: config.rejectUnauthorized };
  if (config.caBundleFile) agentOptions.ca = fs.readFileSync(config.caBundleFile);
  const client = axios.create({ timeout: 30000, httpsAgent: new https.Agent(agentOptions) });

  const tokenResponse = await client.post(config.authUrl, new URLSearchParams({ scope: config.scope }).toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: randomUUID(),
      Authorization: `Bearer ${config.apiKey}`
    }
  });

  const accessToken = tokenResponse.data.access_token;
  console.log('Токен получен успешно. expires_at:', new Date(tokenResponse.data.expires_at).toISOString());

  try {
    const balance = await client.get(`${config.baseUrl}/balance`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
    });
    console.log('Баланс:', JSON.stringify(balance.data, null, 2));
  } catch (error) {
    console.log('Баланс недоступен:', error.response?.status, typeof error.response?.data === 'string' ? error.response.data.slice(0, 200) : JSON.stringify(error.response?.data));
  }

  try {
    const models = await client.get(`${config.baseUrl}/models`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
    });
    console.log('Доступные модели:', models.data.data?.map((m) => m.id).join(', '));
  } catch (error) {
    console.log('Список моделей недоступен:', error.response?.status);
  }
}

main().catch((error) => {
  console.error('Ошибка:', error.response ? `HTTP ${error.response.status}` : error.message, error.response?.data?.toString?.().slice(0, 200) || '');
  process.exit(1);
});
