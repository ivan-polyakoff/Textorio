const { VK } = require('vk-io');
const env = require('./src/config/env');
const { createGigaChatService } = require('./src/services/gigachat');
const { registerMessageHandler } = require('./src/handlers/messageHandler');

const missingEnvVars = env.validateEnv();

if (missingEnvVars.length > 0) {
  console.error('\n❌ Не заданы обязательные переменные окружения (заполните файл .env на основе .env.example):');
  missingEnvVars.forEach((name) => console.error(`  - ${name}`));
  process.exit(1);
}

const vk = new VK({
  token: env.vkToken,
  pollingGroupId: env.vkGroupId
});

const gigachatService = createGigaChatService(env.gigachat);
registerMessageHandler(vk, gigachatService);

(async () => {
  try {
    await vk.updates.start();
    console.log('Textorio VK Bot успешно подключился к Long Poll API и готов к работе!');
  } catch (error) {
    console.error('\n❌ Ошибка подключения к Long Poll API:');
    console.error(`1. Убедитесь, что в настройках группы ВК (https://vk.com/editapp?id=${env.vkGroupId}) в разделе "Работа с API" включен тип сервера "Long Poll API" и он активирован.`);
    console.error(`2. Проверьте, что GROUP_ID в .env совпадает с ID вашей группы (сейчас: ${env.vkGroupId}).`);
    console.error('3. Убедитесь, что у токена VK_GROUP_TOKEN есть права на управление сообщениями группы.');
    console.error('4. Проверьте интернет-соединение и доступность API ВКонтакте.');
    console.error('\nПодробнее об ошибке:', error.response?.data || error.message || error);
    process.exit(1);
  }
})();
