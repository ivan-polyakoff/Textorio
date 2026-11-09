// Живая проверка AI-провайдера: node scripts/check-provider.js
// Берёт конфиг из .env (или из переменных окружения), шлёт тестовый запрос.
// Использование:
//   node scripts/check-provider.js              — текст (chat)
//   node scripts/check-provider.js --vision file.jpg — vision (опционально)

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const env = require('../src/config/env');
const { createAiProvider } = require('../src/providers');
const fs = require('fs');

(async () => {
  console.log(`AI_PROVIDER=${env.aiProvider}`);

  const provider = createAiProvider(env);
  console.log('capabilities:', JSON.stringify(provider.capabilities));

  const visionArg = process.argv.indexOf('--vision');

  if (visionArg > -1 && process.argv[visionArg + 1]) {
    const filePath = process.argv[visionArg + 1];
    const buffer = fs.readFileSync(filePath);
    console.log(`vision: отправляю ${filePath} (${(buffer.length / 1024).toFixed(0)} КБ)...`);
    const answer = await provider.vision(buffer, 'image/jpeg', '', { prompt: 'Что на картинке? Ответь одним предложением.' });
    console.log('Ответ vision:', answer);
    return;
  }

  console.log('chat: отправляю тестовый запрос...');
  const started = Date.now();
  const answer = await provider.chat('Ответь ровно одним словом: работает');
  console.log(`Ответ chat (${Date.now() - started} мс):`, answer);
})().catch((error) => {
  console.error('ПРОВАЛ:', error.message || error);
  process.exit(1);
});
