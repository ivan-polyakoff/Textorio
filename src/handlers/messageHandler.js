const { BUTTONS, USER_STATES } = require('../config/constants');
const { PROMPTS } = require('../config/prompts');
const { getMainKeyboard, getBloggersKeyboard, getBusinessKeyboard } = require('../keyboards');
const { sendWithOptionalKeyboard, getPhotoUrl, withTyping } = require('../utils/vk');

function registerMessageHandler(vk, services) {
  const { generateText, generateHedgehogReply, generatePostFromPhoto } = services;
  const userStates = new Map();

  // Ограничение частоты: не более одного платного запроса к GigaChat на пользователя в RATE_LIMIT_MS.
  const RATE_LIMIT_MS = 3000;
  const lastRequestAt = new Map();

  // Состояния пользователей устаревают, чтобы Map не рос бесконечно.
  const USER_STATE_TTL_MS = 30 * 60 * 1000;
  const USER_STATE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  const stateCleanupIntervalId = setInterval(() => {
    const now = Date.now();
    for (const [senderId, state] of userStates) {
      if (now - state.updatedAt > USER_STATE_TTL_MS) {
        userStates.delete(senderId);
      }
    }
    for (const [senderId, timestamp] of lastRequestAt) {
      if (now - timestamp > RATE_LIMIT_MS) {
        lastRequestAt.delete(senderId);
      }
    }
  }, USER_STATE_CLEANUP_INTERVAL_MS);
  stateCleanupIntervalId.unref?.();

  function getUserState(senderId) {
    const state = userStates.get(senderId);
    if (!state) return null;
    if (Date.now() - state.updatedAt > USER_STATE_TTL_MS) {
      userStates.delete(senderId);
      return null;
    }
    return state;
  }

  function setUserState(senderId, value, extra = {}) {
    userStates.set(senderId, { value, updatedAt: Date.now(), ...extra });
  }

  function deleteUserState(senderId) {
    userStates.delete(senderId);
  }

  function isRateLimited(senderId) {
    const now = Date.now();
    const last = lastRequestAt.get(senderId) || 0;

    if (now - last < RATE_LIMIT_MS) {
      return true;
    }

    lastRequestAt.set(senderId, now);
    return false;
  }

  async function runGeneration(context, keyboard, task) {
    if (isRateLimited(context.senderId)) {
      await sendWithOptionalKeyboard(context, 'Слишком часто — подождите пару секунд и попробуйте ещё раз.', keyboard);
      return;
    }

    const reply = await withTyping(vk, context, task);
    await sendWithOptionalKeyboard(context, reply, keyboard);
  }

  vk.updates.on('message_new', async (context) => {
    try {
      const text = context.text?.trim() || '';
      const hasAttachments = context.attachments.length > 0;
      if (!text && !hasAttachments) return;

      // Не логируем содержимое сообщений пользователей.
      console.log(`Сообщение от ${context.senderId}: длина ${text.length}${hasAttachments ? `, вложений: ${context.attachments.length}` : ''}`);

      if (text === '/start' || text === BUTTONS.MAIN_MENU) {
        deleteUserState(context.senderId);
        await sendWithOptionalKeyboard(context, 'Привет! Я Textorio — бот для создания и улучшения текстов.\n\nВыберите, для кого нужен текст:', getMainKeyboard());
        return;
      }

      if (text === BUTTONS.BLOGGERS) {
        deleteUserState(context.senderId);
        await sendWithOptionalKeyboard(context, 'Раздел для блогеров. Выберите задачу.', getBloggersKeyboard());
        return;
      }

      if (text === BUTTONS.BUSINESS) {
        deleteUserState(context.senderId);
        await sendWithOptionalKeyboard(context, 'Раздел для малого бизнеса. Выберите задачу.', getBusinessKeyboard());
        return;
      }

      if (text === BUTTONS.STYLE) {
        setUserState(context.senderId, USER_STATES.WAITING_STYLE_TEXT);
        await sendWithOptionalKeyboard(context, 'Пришлите текст, который нужно улучшить.', getBloggersKeyboard());
        return;
      }

      if (text === BUTTONS.POST) {
        setUserState(context.senderId, USER_STATES.WAITING_POST_TOPIC);
        await sendWithOptionalKeyboard(context, 'Напишите тему поста.', getBloggersKeyboard());
        return;
      }

      if (text === BUTTONS.PHOTO_POST) {
        setUserState(context.senderId, USER_STATES.WAITING_POST_PHOTO);
        await sendWithOptionalKeyboard(context, 'Пришлите фото, по которому нужно написать пост. Можно добавить короткий комментарий к фото.', getBloggersKeyboard());
        return;
      }

      if (text === BUTTONS.STYLE_TRAINING || text === '/обучить') {
        await sendWithOptionalKeyboard(context, 'Обучение стилю пока в разработке. Скоро можно будет прислать примеры текстов, а я буду писать в похожей манере.', getBloggersKeyboard());
        return;
      }

      if (text === BUTTONS.PRODUCT) {
        setUserState(context.senderId, USER_STATES.WAITING_PRODUCT_DESCRIPTION);
        await sendWithOptionalKeyboard(context, 'Опишите товар: что продаем, для кого и какие главные преимущества.', getBusinessKeyboard());
        return;
      }

      if (text === BUTTONS.AD) {
        setUserState(context.senderId, USER_STATES.WAITING_AD_DESCRIPTION);
        await sendWithOptionalKeyboard(context, 'Опишите вводные для рекламы: продукт, аудитория, акция или главный оффер.', getBusinessKeyboard());
        return;
      }

      if (text === BUTTONS.CLIENT_REPLY) {
        setUserState(context.senderId, USER_STATES.WAITING_CLIENT_REPLY_SITUATION);
        await sendWithOptionalKeyboard(context, 'Опишите ситуацию: что написал клиент и какой тон ответа нужен.', getBusinessKeyboard());
        return;
      }

      const userState = getUserState(context.senderId);
      const stateValue = userState?.value;

      if (stateValue === USER_STATES.WAITING_STYLE_TEXT) {
        if (!text) {
          await sendWithOptionalKeyboard(context, 'Пришлите текст, который нужно улучшить.', getBloggersKeyboard());
          return;
        }

        deleteUserState(context.senderId);
        await runGeneration(context, getBloggersKeyboard(), () => generateText(PROMPTS.styleImprove(text)));
        return;
      }

      if (stateValue === USER_STATES.WAITING_POST_TOPIC) {
        if (!text) {
          await sendWithOptionalKeyboard(context, 'Напишите тему поста текстом или выберите "Пост по фото".', getBloggersKeyboard());
          return;
        }

        deleteUserState(context.senderId);
        await runGeneration(context, getBloggersKeyboard(), () => generateText(PROMPTS.postByTopic(text)));
        return;
      }

      if (stateValue === USER_STATES.WAITING_POST_PHOTO) {
        const photoUrl = getPhotoUrl(context);

        if (!photoUrl) {
          if (text) {
            // Пользователь прислал комментарий раньше фото — сохраняем его.
            setUserState(context.senderId, USER_STATES.WAITING_POST_PHOTO, { caption: text });
            await sendWithOptionalKeyboard(context, 'Комментарий сохранил. Теперь пришлите фото, по которому нужно написать пост.', getBloggersKeyboard());
            return;
          }

          await sendWithOptionalKeyboard(context, 'Не вижу фото в сообщении. Пришлите изображение одним сообщением.', getBloggersKeyboard());
          return;
        }

        const caption = text || userState.caption || '';
        deleteUserState(context.senderId);
        await runGeneration(context, getBloggersKeyboard(), () => generatePostFromPhoto(photoUrl, caption));
        return;
      }

      if (stateValue === USER_STATES.WAITING_PRODUCT_DESCRIPTION) {
        if (!text) {
          await sendWithOptionalKeyboard(context, 'Опишите товар текстом: что продаем, для кого и какие главные преимущества.', getBusinessKeyboard());
          return;
        }

        deleteUserState(context.senderId);
        await runGeneration(context, getBusinessKeyboard(), () => generateText(PROMPTS.productDescription(text)));
        return;
      }

      if (stateValue === USER_STATES.WAITING_AD_DESCRIPTION) {
        if (!text) {
          await sendWithOptionalKeyboard(context, 'Опишите вводные для рекламы текстом: продукт, аудитория, акция или главный оффер.', getBusinessKeyboard());
          return;
        }

        deleteUserState(context.senderId);
        await runGeneration(context, getBusinessKeyboard(), () => generateText(PROMPTS.adText(text)));
        return;
      }

      if (stateValue === USER_STATES.WAITING_CLIENT_REPLY_SITUATION) {
        if (!text) {
          await sendWithOptionalKeyboard(context, 'Опишите ситуацию текстом: что написал клиент и какой тон ответа нужен.', getBusinessKeyboard());
          return;
        }

        deleteUserState(context.senderId);
        await runGeneration(context, getBusinessKeyboard(), () => generateText(PROMPTS.clientReply(text)));
        return;
      }

      if (text === '/стиль') {
        setUserState(context.senderId, USER_STATES.WAITING_STYLE_TEXT);
        await sendWithOptionalKeyboard(context, 'Пришлите текст, который нужно улучшить.', getBloggersKeyboard());
        return;
      }

      if (text.startsWith('/стиль ')) {
        const inputText = text.slice(7).trim();
        await runGeneration(context, getBloggersKeyboard(), () => generateText(PROMPTS.styleImprove(inputText)));
        return;
      }

      if (text === '/пост') {
        setUserState(context.senderId, USER_STATES.WAITING_POST_TOPIC);
        await sendWithOptionalKeyboard(context, 'Напишите тему поста.', getBloggersKeyboard());
        return;
      }

      if (text.startsWith('/пост ')) {
        const topic = text.slice(6).trim();
        await runGeneration(context, getBloggersKeyboard(), () => generateText(PROMPTS.postByTopic(topic)));
        return;
      }

      if (text === '/фотопост') {
        setUserState(context.senderId, USER_STATES.WAITING_POST_PHOTO);
        await sendWithOptionalKeyboard(context, 'Пришлите фото, по которому нужно написать пост. Можно добавить короткий комментарий к фото.', getBloggersKeyboard());
        return;
      }

      if (text.startsWith('/фотопост ')) {
        const photoUrl = getPhotoUrl(context);

        if (!photoUrl) {
          setUserState(context.senderId, USER_STATES.WAITING_POST_PHOTO, { caption: text.slice(10).trim() });
          await sendWithOptionalKeyboard(context, 'Пришлите фото следующим сообщением. Комментарий я учту.', getBloggersKeyboard());
          return;
        }

        const caption = text.slice(10).trim();
        await runGeneration(context, getBloggersKeyboard(), () => generatePostFromPhoto(photoUrl, caption));
        return;
      }

      if (text === '/товар') {
        setUserState(context.senderId, USER_STATES.WAITING_PRODUCT_DESCRIPTION);
        await sendWithOptionalKeyboard(context, 'Опишите товар: что продаем, для кого и какие главные преимущества.', getBusinessKeyboard());
        return;
      }

      if (text.startsWith('/товар ')) {
        const description = text.slice(7).trim();
        await runGeneration(context, getBusinessKeyboard(), () => generateText(PROMPTS.productDescription(description)));
        return;
      }

      if (text === '/реклама') {
        setUserState(context.senderId, USER_STATES.WAITING_AD_DESCRIPTION);
        await sendWithOptionalKeyboard(context, 'Опишите вводные для рекламы: продукт, аудитория, акция или главный оффер.', getBusinessKeyboard());
        return;
      }

      if (text.startsWith('/реклама ')) {
        const description = text.slice(9).trim();
        await runGeneration(context, getBusinessKeyboard(), () => generateText(PROMPTS.adText(description)));
        return;
      }

      if (text === '/ответ') {
        setUserState(context.senderId, USER_STATES.WAITING_CLIENT_REPLY_SITUATION);
        await sendWithOptionalKeyboard(context, 'Опишите ситуацию: что написал клиент и какой тон ответа нужен.', getBusinessKeyboard());
        return;
      }

      if (text.startsWith('/ответ ')) {
        const situation = text.slice(7).trim();
        await runGeneration(context, getBusinessKeyboard(), () => generateText(PROMPTS.clientReply(situation)));
        return;
      }

      if (text) {
        await runGeneration(context, getMainKeyboard(), () => generateHedgehogReply(text));
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
