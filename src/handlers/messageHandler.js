const { BUTTONS, USER_STATES } = require('../config/constants');
const { PROMPTS } = require('../config/prompts');
const { getMainKeyboard, getBloggersKeyboard, getBusinessKeyboard } = require('../keyboards');
const { sendWithOptionalKeyboard, getPhotoUrl, withTyping } = require('../utils/vk');

function registerMessageHandler(vk, services) {
  const { generateText, generateHedgehogReply, generatePostFromPhoto } = services;
  const userStates = new Map();

  vk.updates.on('message_new', async (context) => {
    try {
      const text = context.text?.trim() || '';
      const hasAttachments = context.attachments.length > 0;
      if (!text && !hasAttachments) return;

      console.log(`Получено сообщение от ${context.senderId}: ${text}`);

      if (text === '/start' || text === BUTTONS.MAIN_MENU) {
        userStates.delete(context.senderId);
        await sendWithOptionalKeyboard(context, 'Привет! Я Textorio — бот для создания и улучшения текстов.\n\nВыберите, для кого нужен текст:', getMainKeyboard());
        return;
      }

      if (text === BUTTONS.BLOGGERS) {
        userStates.delete(context.senderId);
        await sendWithOptionalKeyboard(context, 'Раздел для блогеров. Выберите задачу.', getBloggersKeyboard());
        return;
      }

      if (text === BUTTONS.BUSINESS) {
        userStates.delete(context.senderId);
        await sendWithOptionalKeyboard(context, 'Раздел для малого бизнеса. Выберите задачу.', getBusinessKeyboard());
        return;
      }

      if (text === BUTTONS.STYLE) {
        userStates.set(context.senderId, USER_STATES.WAITING_STYLE_TEXT);
        await sendWithOptionalKeyboard(context, 'Пришлите текст, который нужно улучшить.', getBloggersKeyboard());
        return;
      }

      if (text === BUTTONS.POST) {
        userStates.set(context.senderId, USER_STATES.WAITING_POST_TOPIC);
        await sendWithOptionalKeyboard(context, 'Напишите тему поста.', getBloggersKeyboard());
        return;
      }

      if (text === BUTTONS.PHOTO_POST) {
        userStates.set(context.senderId, USER_STATES.WAITING_POST_PHOTO);
        await sendWithOptionalKeyboard(context, 'Пришлите фото, по которому нужно написать пост. Можно добавить короткий комментарий к фото.', getBloggersKeyboard());
        return;
      }

      if (text === BUTTONS.STYLE_TRAINING || text === '/обучить') {
        await sendWithOptionalKeyboard(context, 'Обучение стилю пока в разработке. Скоро можно будет прислать примеры текстов, а я буду писать в похожей манере.', getBloggersKeyboard());
        return;
      }

      if (text === BUTTONS.PRODUCT) {
        userStates.set(context.senderId, USER_STATES.WAITING_PRODUCT_DESCRIPTION);
        await sendWithOptionalKeyboard(context, 'Опишите товар: что продаем, для кого и какие главные преимущества.', getBusinessKeyboard());
        return;
      }

      if (text === BUTTONS.AD) {
        userStates.set(context.senderId, USER_STATES.WAITING_AD_DESCRIPTION);
        await sendWithOptionalKeyboard(context, 'Опишите вводные для рекламы: продукт, аудитория, акция или главный оффер.', getBusinessKeyboard());
        return;
      }

      if (text === BUTTONS.CLIENT_REPLY) {
        userStates.set(context.senderId, USER_STATES.WAITING_CLIENT_REPLY_SITUATION);
        await sendWithOptionalKeyboard(context, 'Опишите ситуацию: что написал клиент и какой тон ответа нужен.', getBusinessKeyboard());
        return;
      }

      const userState = userStates.get(context.senderId);

      if (userState === USER_STATES.WAITING_STYLE_TEXT) {
        if (!text) {
          await sendWithOptionalKeyboard(context, 'Пришлите текст, который нужно улучшить.', getBloggersKeyboard());
          return;
        }

        userStates.delete(context.senderId);
        const improvedText = await withTyping(vk, context, () => generateText(PROMPTS.styleImprove(text)));
        await sendWithOptionalKeyboard(context, improvedText, getBloggersKeyboard());
        return;
      }

      if (userState === USER_STATES.WAITING_POST_TOPIC) {
        if (!text) {
          await sendWithOptionalKeyboard(context, 'Напишите тему поста текстом или выберите "Пост по фото".', getBloggersKeyboard());
          return;
        }

        userStates.delete(context.senderId);
        const postText = await withTyping(vk, context, () => generateText(PROMPTS.postByTopic(text)));
        await sendWithOptionalKeyboard(context, postText, getBloggersKeyboard());
        return;
      }

      if (userState === USER_STATES.WAITING_POST_PHOTO) {
        const photoUrl = getPhotoUrl(context);

        if (!photoUrl) {
          await sendWithOptionalKeyboard(context, 'Не вижу фото в сообщении. Пришлите изображение одним сообщением.', getBloggersKeyboard());
          return;
        }

        userStates.delete(context.senderId);
        const postText = await withTyping(vk, context, () => generatePostFromPhoto(photoUrl, text));
        await sendWithOptionalKeyboard(context, postText, getBloggersKeyboard());
        return;
      }

      if (userState === USER_STATES.WAITING_PRODUCT_DESCRIPTION) {
        if (!text) {
          await sendWithOptionalKeyboard(context, 'Опишите товар текстом: что продаем, для кого и какие главные преимущества.', getBusinessKeyboard());
          return;
        }

        userStates.delete(context.senderId);
        const productText = await withTyping(vk, context, () => generateText(PROMPTS.productDescription(text)));
        await sendWithOptionalKeyboard(context, productText, getBusinessKeyboard());
        return;
      }

      if (userState === USER_STATES.WAITING_AD_DESCRIPTION) {
        if (!text) {
          await sendWithOptionalKeyboard(context, 'Опишите вводные для рекламы текстом: продукт, аудитория, акция или главный оффер.', getBusinessKeyboard());
          return;
        }

        userStates.delete(context.senderId);
        const adText = await withTyping(vk, context, () => generateText(PROMPTS.adText(text)));
        await sendWithOptionalKeyboard(context, adText, getBusinessKeyboard());
        return;
      }

      if (userState === USER_STATES.WAITING_CLIENT_REPLY_SITUATION) {
        if (!text) {
          await sendWithOptionalKeyboard(context, 'Опишите ситуацию текстом: что написал клиент и какой тон ответа нужен.', getBusinessKeyboard());
          return;
        }

        userStates.delete(context.senderId);
        const replyText = await withTyping(vk, context, () => generateText(PROMPTS.clientReply(text)));
        await sendWithOptionalKeyboard(context, replyText, getBusinessKeyboard());
        return;
      }

      if (text === '/стиль') {
        userStates.set(context.senderId, USER_STATES.WAITING_STYLE_TEXT);
        await sendWithOptionalKeyboard(context, 'Пришлите текст, который нужно улучшить.', getBloggersKeyboard());
        return;
      }

      if (text.startsWith('/стиль ')) {
        const inputText = text.slice(7).trim();
        const improvedText = await withTyping(vk, context, () => generateText(PROMPTS.styleImprove(inputText)));
        await sendWithOptionalKeyboard(context, improvedText, getBloggersKeyboard());
        return;
      }

      if (text === '/пост') {
        userStates.set(context.senderId, USER_STATES.WAITING_POST_TOPIC);
        await sendWithOptionalKeyboard(context, 'Напишите тему поста.', getBloggersKeyboard());
        return;
      }

      if (text.startsWith('/пост ')) {
        const topic = text.slice(6).trim();
        const postText = await withTyping(vk, context, () => generateText(PROMPTS.postByTopic(topic)));
        await sendWithOptionalKeyboard(context, postText, getBloggersKeyboard());
        return;
      }

      if (text === '/фотопост') {
        userStates.set(context.senderId, USER_STATES.WAITING_POST_PHOTO);
        await sendWithOptionalKeyboard(context, 'Пришлите фото, по которому нужно написать пост. Можно добавить короткий комментарий к фото.', getBloggersKeyboard());
        return;
      }

      if (text.startsWith('/фотопост ')) {
        const photoUrl = getPhotoUrl(context);

        if (!photoUrl) {
          userStates.set(context.senderId, USER_STATES.WAITING_POST_PHOTO);
          await sendWithOptionalKeyboard(context, 'Пришлите фото следующим сообщением. Комментарий я учту.', getBloggersKeyboard());
          return;
        }

        const caption = text.slice(10).trim();
        const postText = await withTyping(vk, context, () => generatePostFromPhoto(photoUrl, caption));
        await sendWithOptionalKeyboard(context, postText, getBloggersKeyboard());
        return;
      }

      if (text === '/товар') {
        userStates.set(context.senderId, USER_STATES.WAITING_PRODUCT_DESCRIPTION);
        await sendWithOptionalKeyboard(context, 'Опишите товар: что продаем, для кого и какие главные преимущества.', getBusinessKeyboard());
        return;
      }

      if (text.startsWith('/товар ')) {
        const description = text.slice(7).trim();
        const productText = await withTyping(vk, context, () => generateText(PROMPTS.productDescription(description)));
        await sendWithOptionalKeyboard(context, productText, getBusinessKeyboard());
        return;
      }

      if (text === '/реклама') {
        userStates.set(context.senderId, USER_STATES.WAITING_AD_DESCRIPTION);
        await sendWithOptionalKeyboard(context, 'Опишите вводные для рекламы: продукт, аудитория, акция или главный оффер.', getBusinessKeyboard());
        return;
      }

      if (text.startsWith('/реклама ')) {
        const description = text.slice(9).trim();
        const adText = await withTyping(vk, context, () => generateText(PROMPTS.adText(description)));
        await sendWithOptionalKeyboard(context, adText, getBusinessKeyboard());
        return;
      }

      if (text === '/ответ') {
        userStates.set(context.senderId, USER_STATES.WAITING_CLIENT_REPLY_SITUATION);
        await sendWithOptionalKeyboard(context, 'Опишите ситуацию: что написал клиент и какой тон ответа нужен.', getBusinessKeyboard());
        return;
      }

      if (text.startsWith('/ответ ')) {
        const situation = text.slice(7).trim();
        const replyText = await withTyping(vk, context, () => generateText(PROMPTS.clientReply(situation)));
        await sendWithOptionalKeyboard(context, replyText, getBusinessKeyboard());
        return;
      }

      if (text) {
        const hedgehogReply = await withTyping(vk, context, () => generateHedgehogReply(text));
        await sendWithOptionalKeyboard(context, hedgehogReply, getMainKeyboard());
        return;
      }

      await sendWithOptionalKeyboard(context, 'Нажмите кнопку меню или используйте /start.', getMainKeyboard());
    } catch (error) {
      console.error('Ошибка обработки сообщения:', error);
      try {
        await context.send('Произошла ошибка при обработке вашего запроса. Попробуйте позже.');
      } catch (sendError) {
        console.error('Не удалось отправить сообщение:', sendError);
      }
    }
  });
}

module.exports = {
  registerMessageHandler
};
