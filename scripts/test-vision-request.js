/* Тест Vision-запроса: node scripts/test-vision-request.js <imageUrl> */
require('dotenv').config();
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const FormData = require('form-data');
const { randomUUID } = require('crypto');

const imageUrl = process.argv[2];

async function main() {
  if (!imageUrl) {
    console.error('Использование: node scripts/test-vision-request.js <URL фото>');
    process.exit(1);
  }

  const config = {
    apiKey: process.env.GIGACHAT_API_KEY,
    authUrl: process.env.GIGACHAT_AUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    apiUrl: process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
    filesUrl: process.env.GIGACHAT_FILES_URL || 'https://gigachat.devices.sberbank.ru/api/v1/files',
    scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
    visionModel: process.env.GIGACHAT_VISION_MODEL || 'GigaChat-Pro',
    rejectUnauthorized: process.env.GIGACHAT_REJECT_UNAUTHORIZED !== 'false',
    caBundleFile: process.env.GIGACHAT_CA_BUNDLE_FILE
  };

  const agentOptions = { rejectUnauthorized: config.rejectUnauthorized };
  if (config.caBundleFile) agentOptions.ca = fs.readFileSync(config.caBundleFile);
  const client = axios.create({ timeout: 60000, httpsAgent: new https.Agent(agentOptions) });

  // 1. Токен
  const tokenResponse = await client.post(config.authUrl, new URLSearchParams({ scope: config.scope }).toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: randomUUID(),
      Authorization: `Bearer ${config.apiKey}`
    }
  });
  const accessToken = tokenResponse.data.access_token;
  console.log('1. Токен получен');

  // 2. Скачиваем фото
  const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 20 * 1024 * 1024 });
  console.log(`2. Фото скачано: ${(imageResponse.data.length / 1024).toFixed(0)} КБ, content-type: ${imageResponse.headers['content-type']}`);

  // 3. Загружаем в GigaChat
  const form = new FormData();
  form.append('file', Buffer.from(imageResponse.data), { filename: 'test.jpg', contentType: imageResponse.headers['content-type'] || 'image/jpeg' });
  form.append('purpose', 'general');
  let uploadResponse;
  try {
    uploadResponse = await client.post(config.filesUrl, form, {
      headers: { ...form.getHeaders(), Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
    console.log('3. Фото загружено в GigaChat, fileId:', uploadResponse.data.id);
  } catch (error) {
    console.error('3. ОШИБКА загрузки файла:', error.response?.status, typeof error.response?.data === 'string' ? error.response.data.slice(0, 300) : JSON.stringify(error.response?.data));
    process.exit(1);
  }

  // 4. Vision-запрос
  try {
    const chatResponse = await client.post(config.apiUrl, {
      model: config.visionModel,
      messages: [{ role: 'user', content: 'Опиши это изображение одним предложением.', attachments: [uploadResponse.data.id] }],
      stream: false
    }, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
    });
    console.log('4. Vision-ответ получен:', chatResponse.data.choices[0].message.content.trim().slice(0, 200));
  } catch (error) {
    console.error('4. ОШИБКА Vision-запроса:', error.response?.status, typeof error.response?.data === 'string' ? error.response.data.slice(0, 300) : JSON.stringify(error.response?.data));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Ошибка:', error.response ? `HTTP ${error.response.status}` : error.message);
  process.exit(1);
});
