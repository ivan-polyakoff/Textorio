const { VK } = require('vk-io');
const env = require('./src/config/env');
const { createGigaChatService } = require('./src/services/gigachat');
const { registerMessageHandler } = require('./src/handlers/messageHandler');
const { logger, logFilePath } = require('./src/utils/logger');

const missingEnvVars = env.validateEnv();

if (missingEnvVars.length > 0) {
  logger.error('\n❌ Не заданы обязательные переменные окружения (заполните файл .env на основе .env.example):');
  missingEnvVars.forEach((name) => logger.error(`  - ${name}`));
  process.exit(1);
}

const vk = new VK({
  token: env.vkToken,
  pollingGroupId: env.vkGroupId
});

// Критические сбои не должны умирать молча: пишем в лог и в stderr.
process.on('uncaughtException', (error) => {
  logger.error('Необработанная ошибка (uncaughtException):', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Необработанный rejection (unhandledRejection):', reason);
});

const gigachatService = createGigaChatService(env.gigachat);
registerMessageHandler(vk, gigachatService);

(async () => {
  try {
    await vk.updates.start();
    logger.log('Textorio VK Bot успешно подключился к Long Poll API и готов к работе!', `Логи: ${logFilePath}`);
  } catch (error) {
    logger.error('\n❌ Ошибка подключения к Long Poll API:');
    logger.error(`1. Убедитесь, что в настройках группы ВК (https://vk.com/editapp?id=${env.vkGroupId}) в разделе "Работа с API" включен тип сервера "Long Poll API" и он активирован.`);
    logger.error(`2. Проверьте, что GROUP_ID в .env совпадает с ID вашей группы (сейчас: ${env.vkGroupId}).`);
    logger.error('3. Убедитесь, что у токена VK_GROUP_TOKEN есть права на управление сообщениями группы.');
    logger.error('4. Проверьте интернет-соединение и доступность API ВКонтакте.');
    logger.error('\nПодробнее об ошибке:', error.response?.data || error.message || error);
    process.exit(1);
  }
})();
