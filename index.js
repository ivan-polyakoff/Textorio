const { VK } = require('vk-io');
const env = require('./src/config/env');
const { createGigaChatService } = require('./src/services/gigachat');
const { registerMessageHandler } = require('./src/handlers/messageHandler');

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
    console.error('1. Убедитесь, что в настройках группы ВК (https://vk.com/editapp?id=238319313) в разделе "Работа с API" включен тип сервера "Long Poll API" и он активирован.');
    console.error('2. Проверьте, что GROUP_ID в .env совпадает с ID вашей группы (сейчас: 238319313).');
    console.error('3. Убедитесь, что у токена VK_GROUP_TOKEN есть права на управление сообщениями группы.');
    console.error('4. Проверьте интернет-соединение и доступность API ВКонтакте.');
    console.error('\nПодробнее об ошибке:', error.response?.data || error.message || error);
    process.exit(1);
  }
})();

console.log('Textorio VK Bot запущен и готов к работе!');
