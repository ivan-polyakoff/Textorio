const { BUTTONS, USER_STATES } = require('../config/constants');
const { PROMPTS } = require('../config/prompts');
const { getMainKeyboard, getBloggersKeyboard, getBusinessKeyboard } = require('../keyboards');
const { sendWithOptionalKeyboard, getPhotoUrls, withTyping } = require('../utils/vk');
const { createRateLimiter } = require('../utils/rateLimiter');
const { detectIntent } = require('../utils/intentRouter');
const { logger } = require('../utils/logger');

function registerMessageHandler(vk, services) {
  const { generateText, generateHedgehogReply, generatePostFromPhoto } = services;
  const userStates = new Map();

  // Ограничение частоты: не более одного платного запроса к GigaChat на пользователя в RATE_LIMIT_MS.
  const RATE_LIMIT_MS = 3000;
  const rateLimiter = createRateLimiter(RATE_LIMIT_MS);

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
    rateLimiter.prune(now);
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

  async function runGeneration(context, keyboard, task) {
    if (rateLimiter.isLimited(context.senderId)) {
      await sendWithOptionalKeyboard(context, 'Слишком часто — подождите пару секунд и попробуйте ещё раз.', keyboard);
      return;
    }

    const reply = await withTyping(vk, context, task);
    await sendWithOptionalKeyboard(context, reply, keyboard);
  }

  // --- Декларативные таблицы команд и состояний ---

  const NAVIGATION = [
    {
      triggers: ['/start', BUTTONS.MAIN_MENU],
      keyboard: getMainKeyboard,
      text: 'Привет! Я Textorio — бот для создания и улучшения текстов.\n\nВыберите, для кого нужен текст:'
    },
    {
      triggers: [BUTTONS.BLOGGERS],
      keyboard: getBloggersKeyboard,
      text: 'Раздел для блогеров. Выберите задачу.'
    },
    {
      triggers: [BUTTONS.BUSINESS],
      keyboard: getBusinessKeyboard,
      text: 'Раздел для малого бизнеса. Выберите задачу.'
    }
  ];

  // Кнопки и команды, не приводящие к запросу к GigaChat.
  const STATIC_REPLIES = [
    {
      triggers: [BUTTONS.STYLE_TRAINING, '/обучить'],
      keyboard: getBloggersKeyboard,
      text: 'Обучение стилю пока в разработке. Скоро можно будет прислать примеры текстов, а я буду писать в похожей манере.'
    }
  ];

  // Основные сценарии: кнопка/команда → состояние → генерация.
  // ask — что писать после нажатия кнопки; emptyAsk — если в состоянии пришёл не текст.
  const FEATURES = [
    {
      triggers: [BUTTONS.STYLE, '/стиль'],
      intent: 'style_improve',
      state: USER_STATES.WAITING_STYLE_TEXT,
      keyboard: getBloggersKeyboard,
      ask: 'Пришлите текст, который нужно улучшить.',
      emptyAsk: 'Пришлите текст, который нужно улучшить.',
      generate: (input) => generateText(PROMPTS.styleImprove(input))
    },
    {
      triggers: [BUTTONS.POST, '/пост'],
      intent: 'post_topic',
      state: USER_STATES.WAITING_POST_TOPIC,
      keyboard: getBloggersKeyboard,
      ask: 'Напишите тему поста.',
      emptyAsk: 'Напишите тему поста текстом или выберите "Пост по фото".',
      generate: (input) => generateText(PROMPTS.postByTopic(input))
    },
    {
      triggers: [BUTTONS.PHOTO_POST, '/фотопост'],
      intent: 'photo_post',
      state: USER_STATES.WAITING_POST_PHOTO,
      keyboard: getBloggersKeyboard,
      ask: 'Пришлите фото, по которому нужно написать пост. Можно добавить короткий комментарий к фото.',
      handleState: handlePhotoStateMessage,
      handleArg: handlePhotoArg
    },
    {
      triggers: [BUTTONS.PRODUCT, '/товар'],
      intent: 'product_description',
      state: USER_STATES.WAITING_PRODUCT_DESCRIPTION,
      keyboard: getBusinessKeyboard,
      ask: 'Опишите товар: что продаем, для кого и какие главные преимущества.',
      emptyAsk: 'Опишите товар текстом: что продаем, для кого и какие главные преимущества.',
      generate: (input) => generateText(PROMPTS.productDescription(input))
    },
    {
      triggers: [BUTTONS.AD, '/реклама'],
      intent: 'ad_text',
      state: USER_STATES.WAITING_AD_DESCRIPTION,
      keyboard: getBusinessKeyboard,
      ask: 'Опишите вводные для рекламы: продукт, аудитория, акция или главный оффер.',
      emptyAsk: 'Опишите вводные для рекламы текстом: продукт, аудитория, акция или главный оффер.',
      generate: (input) => generateText(PROMPTS.adText(input))
    },
    {
      triggers: [BUTTONS.CLIENT_REPLY, '/ответ'],
      intent: 'client_reply',
      state: USER_STATES.WAITING_CLIENT_REPLY_SITUATION,
      keyboard: getBusinessKeyboard,
      ask: 'Опишите ситуацию: что написал клиент и какой тон ответа нужен.',
      emptyAsk: 'Опишите ситуацию текстом: что написал клиент и какой тон ответа нужен.',
      generate: (input) => generateText(PROMPTS.clientReply(input))
    }
  ];

  function findFeatureByText(text) {
    return FEATURES.find((feature) => feature.triggers.includes(text));
  }

  function findFeatureByPrefix(text) {
    // По префиксу ищем только среди слэш-команд, чтобы обычный текст
    // вида «Создать пост про котиков» не перехватывался кнопкой.
    return FEATURES.find((feature) => feature.triggers.some((trigger) => trigger.startsWith('/') && text.startsWith(`${trigger} `)));
  }

  function findFeatureByState(stateValue) {
    return FEATURES.find((feature) => feature.state === stateValue);
  }

  async function handlePhotoArg(context, arg) {
    const photoUrls = getPhotoUrls(context);

    if (photoUrls.length === 0) {
      setUserState(context.senderId, USER_STATES.WAITING_POST_PHOTO, { caption: arg });
      await sendWithOptionalKeyboard(context, 'Пришлите фото следующим сообщением. Комментарий я учту.', getBloggersKeyboard());
      return;
    }

    await runGeneration(context, getBloggersKeyboard(), () => generatePostFromPhoto(photoUrls, arg));
  }

  async function handlePhotoStateMessage(context, userState) {
    const photoUrls = getPhotoUrls(context);

    if (photoUrls.length === 0) {
      if (context.text) {
        // Пользователь прислал комментарий раньше фото — сохраняем его.
        setUserState(context.senderId, USER_STATES.WAITING_POST_PHOTO, { caption: context.text });
        await sendWithOptionalKeyboard(context, 'Комментарий сохранил. Теперь пришлите фото, по которому нужно написать пост.', getBloggersKeyboard());
        return;
      }

      await sendWithOptionalKeyboard(context, 'Не вижу фото в сообщении. Пришлите изображение одним сообщением.', getBloggersKeyboard());
      return;
    }

    const caption = context.text || userState.caption || '';
    deleteUserState(context.senderId);
    await runGeneration(context, getBloggersKeyboard(), () => generatePostFromPhoto(photoUrls, caption));
  }

  vk.updates.on('message_new', async (context) => {
    try {
      const text = context.text?.trim() || '';
      const hasAttachments = context.attachments.length > 0;
      if (!text && !hasAttachments) return;

      // Не логируем содержимое сообщений пользователей.
      logger.log(`Сообщение от ${context.senderId}: длина ${text.length}${hasAttachments ? `, вложений: ${context.attachments.length}` : ''}`);

      // 1. Навигация: сбрасывает состояние.
      const navigation = NAVIGATION.find((item) => item.triggers.includes(text));
      if (navigation) {
        deleteUserState(context.senderId);
        await sendWithOptionalKeyboard(context, navigation.text, navigation.keyboard());
        return;
      }

      // 2. Кнопки без генерации.
      const staticReply = STATIC_REPLIES.find((item) => item.triggers.includes(text));
      if (staticReply) {
        await sendWithOptionalKeyboard(context, staticReply.text, staticReply.keyboard());
        return;
      }

      // 3. Точное совпадение кнопки/команды: ставим состояние и просим ввод.
      const triggeredFeature = findFeatureByText(text);
      if (triggeredFeature) {
        setUserState(context.senderId, triggeredFeature.state);
        await sendWithOptionalKeyboard(context, triggeredFeature.ask, triggeredFeature.keyboard());
        return;
      }

      const userState = getUserState(context.senderId);

      // 4. Сообщение в состоянии ожидания ввода.
      const stateFeature = userState ? findFeatureByState(userState.value) : null;
      if (stateFeature) {
        if (stateFeature.handleState) {
          await stateFeature.handleState(context, userState);
          return;
        }

        if (!text) {
          await sendWithOptionalKeyboard(context, stateFeature.emptyAsk, stateFeature.keyboard());
          return;
        }

        deleteUserState(context.senderId);
        await runGeneration(context, stateFeature.keyboard(), () => stateFeature.generate(text));
        return;
      }

      // 5. Команда с аргументом: "/команда текст" — генерация без состояния.
      const argFeature = findFeatureByPrefix(text);
      if (argFeature) {
        const trigger = argFeature.triggers.find((item) => text.startsWith(`${item} `));
        const arg = text.slice(trigger.length + 1).trim();

        if (argFeature.handleArg) {
          await argFeature.handleArg(context, arg);
          return;
        }

        await runGeneration(context, argFeature.keyboard(), () => argFeature.generate(arg));
        return;
      }

      // 6. Интенты в свободном тексте: «улучши …», «напиши пост про …» —
      // работают как нажатие соответствующей кнопки.
      const detected = text ? detectIntent(text) : null;
      if (detected) {
        const intentFeature = findFeatureByState(
          FEATURES.find((feature) => feature.intent === detected.intent)?.state
        );

        if (intentFeature) {
          if (detected.argument) {
            // Аргумент уже есть — генерируем сразу, без состояния.
            if (intentFeature.handleArg && detected.intent === 'photo_post') {
              await intentFeature.handleArg(context, detected.argument);
              return;
            }

            deleteUserState(context.senderId);
            await runGeneration(context, intentFeature.keyboard(), () => intentFeature.generate(detected.argument));
            return;
          }

          // Аргумента нет — как при нажатии кнопки: просим ввод.
          setUserState(context.senderId, intentFeature.state);
          await sendWithOptionalKeyboard(context, intentFeature.ask, intentFeature.keyboard());
          return;
        }
      }

      // 7. Остальной свободный текст — отвечает Ежик.
      if (text) {
        await runGeneration(context, getMainKeyboard(), () => generateHedgehogReply(text));
        return;
      }

      await sendWithOptionalKeyboard(context, 'Нажмите кнопку меню или используйте /start.', getMainKeyboard());
    } catch (error) {
      logger.error('Ошибка обработки сообщения:', error);
      try {
        await context.send('Произошла ошибка при обработке вашего запроса. Попробуйте позже.');
      } catch (sendError) {
        logger.error('Не удалось отправить сообщение:', sendError);
      }
    }
  });
}

module.exports = {
  registerMessageHandler
};
