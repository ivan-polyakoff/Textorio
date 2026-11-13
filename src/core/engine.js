// Универсальный движок обработки сообщений.
// Знает о скиллах только через реестр (src/skills/registry.js) и о провайдере —
// через контракт (src/providers/provider.js). Ни VK, ни GigaChat здесь не упоминаются.
// Специфика VK (клавиатуры vk-io, скачивание фото) остаётся в transport.

const { sendWithOptionalKeyboard, getPhotoUrls, withTyping, buildKeyboard, buildInlineFeedbackKeyboard } = require('../utils/vk');
const { createRateLimiter } = require('../utils/rateLimiter');
const { getPersona } = require('../config/persona');
const { detectFeedback } = require('./feedback');
const { logger } = require('../utils/logger');
const RATE_LIMIT_MS = 3000;
const USER_STATE_TTL_MS = 30 * 60 * 1000;
// Сколько времени доступна правка/перегенерация последнего результата.
const GENERATION_TTL_MS = 30 * 60 * 1000;
const MAX_SAVED_FEEDBACKS = 5;

function createBotEngine({ vk, provider, assistant, registry, personaId, profileStore, rateLimitMs }) {
  const persona = getPersona(personaId);
  const rateLimiter = createRateLimiter(rateLimitMs || RATE_LIMIT_MS);
  const userStates = new Map();

  // Состояния пользователей устаревают, чтобы Map не рос бесконечно.
  const stateCleanupIntervalId = setInterval(() => {
    const now = Date.now();
    for (const [senderId, state] of userStates) {
      if (now - state.updatedAt > USER_STATE_TTL_MS) {
        userStates.delete(senderId);
      }
    }
    rateLimiter.prune(now);
  }, 5 * 60 * 1000);
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

  async function send(context, text, rows = null, keyboardOverride = undefined) {
    const keyboard = keyboardOverride !== undefined ? keyboardOverride : (rows ? buildKeyboard(rows) : undefined);
    await sendWithOptionalKeyboard(context, text, keyboard);
  }

  const nowIso = () => new Date().toISOString();

  // Активная (не устаревшая) последняя генерация — по ней работают правки и кнопки.
  function getActiveGeneration(senderId) {
    if (!profileStore) return null;

    const generation = profileStore.load(senderId).lastGeneration;

    if (!generation) return null;
    if (Date.now() - Date.parse(generation.createdAt) > GENERATION_TTL_MS) return null;
    return generation;
  }

  // Запоминаем последний результат: по нему работают 👍/👎/🔄 и текстовые правки.
  function saveGeneration(senderId, meta, result, feedbacks) {
    if (!profileStore) return null;

    const profile = profileStore.load(senderId);
    const generation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      skillId: meta.skillId,
      kind: meta.kind,
      input: meta.input,
      result,
      feedbacks: (feedbacks || []).slice(-MAX_SAVED_FEEDBACKS),
      createdAt: nowIso()
    };

    profile.lastGeneration = generation;
    profileStore.save(profile);
    return generation;
  }

  // Промпт перегенерации: исходная задача + предыдущий результат + правка.
  // Для фото-скиллов правим текст результата (ссылки на фото ВК протухают).
  function buildRevisionPrompt(skill, generation, critique) {
    const parts = [];

    if (skill.kind === 'photo') {
      parts.push('Перепиши пост для социальной сети по правке пользователя. Исходное фото больше недоступно — опирайся на предыдущий вариант поста.');
      parts.push(`Предыдущий вариант поста:\n${generation.result}`);
    } else {
      parts.push(skill.prompt(generation.input.text));
      parts.push(`Предыдущий вариант:\n${generation.result}`);
    }

    if (critique) {
      parts.push(`Пользователь недоволен результатом. Замечание: «${critique}». Перепиши, полностью учтя замечание, и сохрани достоинства предыдущего варианта.`);
    } else {
      parts.push('Сделай другой вариант: измени угол подачи и формулировки. Не повторяй предыдущий вариант дословно, сохрани качество и смысл.');
    }

    return parts.join('\n\n');
  }

  // Перегенерация по сохранённому результату: вариация или правка по критике.
  async function regenerateFromGeneration(context, generation, critique) {
    const skill = registry.findSkillById(generation.skillId);

    if (!skill) {
      await send(context, 'Не нашёл исходную задачу — запустите её заново из меню.', registry.mainMenuRows());
      return;
    }

    const feedbacks = [...(generation.feedbacks || [])];

    if (critique) feedbacks.push(critique);

    await runGeneration(context, null, () => provider.chat(buildRevisionPrompt(skill, generation, critique)), {
      skillId: skill.id,
      kind: skill.kind,
      input: generation.input,
      feedbacks
    });
  }

  async function runGeneration(context, rows, task, meta = null) {
    if (rateLimiter.isLimited(context.senderId)) {
      await send(context, 'Слишком часто — подождите пару секунд и попробуйте ещё раз.', rows);
      return;
    }

    const reply = await withTyping(vk, context, task);

    if (meta) {
      const generation = saveGeneration(context.senderId, meta, reply, meta.feedbacks);
      await send(context, reply, null, generation ? buildInlineFeedbackKeyboard(generation.id) : undefined);
      return;
    }

    await send(context, reply, rows);
  }

  // --- Генерация по типам скиллов ---

  async function generateByText(skill, input) {
    return provider.chat(skill.prompt(input));
  }

  async function generateByPhoto(skill, photoUrls, caption) {
    try {
      const image = await assistant.downloadImage(photoUrls);
      return await provider.vision(image.buffer, image.contentType, caption, { prompt: skill.prompt(caption) });
    } catch (error) {
      if (error.stage === 'photo_size') {
        logger.warn(`Отклонено фото: ${error.message}`);
        return `Фото слишком большое (${error.message.match(/весит ([\d.]+) МБ/)?.[1] || '?'} МБ), максимум ${assistant.photoMaxSizeMb} МБ. Пришлите, пожалуйста, меньшую версию изображения.`;
      }
      if (error.stage === 'vk_download') {
        logger.error(`Ошибка при генерации поста по фото (этап скачивания фото из VK): ${error.message}`);
      } else {
        logger.error('Ошибка при генерации поста по фото:', error.message || error);
      }
      return 'Извините, не получилось создать пост по фото. Попробуйте позже или пришлите другое изображение.';
    }
  }

  function runSkill(skill, context, input) {
    if (skill.kind === 'photo') {
      return generateByPhoto(skill, input.photoUrls, input.caption);
    }
    return generateByText(skill, input.text);
  }

  // --- Обработчики сценариев ---

  async function handleSkillTriggered(skill, context) {
    setUserState(context.senderId, registry.stateOf(skill));
    await send(context, skill.ask, registry.packRows(skill.pack));
  }

  async function handleSkillStateMessage(skill, context, userState) {
    if (skill.kind === 'photo') {
      const photoUrls = getPhotoUrls(context);

      if (photoUrls.length === 0) {
        if (context.text) {
          // Пользователь прислал комментарий раньше фото — сохраняем его.
          setUserState(context.senderId, registry.stateOf(skill), { caption: context.text });
          await send(context, skill.stateCaptionSaved, registry.packRows(skill.pack));
          return;
        }

        await send(context, skill.stateNoPhoto, registry.packRows(skill.pack));
        return;
      }

      const caption = context.text || userState.caption || '';
      deleteUserState(context.senderId);
      await runGeneration(
        context,
        registry.packRows(skill.pack),
        () => runSkill(skill, context, { photoUrls, caption }),
        { skillId: skill.id, kind: skill.kind, input: { caption }, feedbacks: [] }
      );
      return;
    }

    if (!context.text) {
      await send(context, skill.emptyAsk, registry.packRows(skill.pack));
      return;
    }

    deleteUserState(context.senderId);
    await runGeneration(
      context,
      registry.packRows(skill.pack),
      () => runSkill(skill, context, { text: context.text }),
      { skillId: skill.id, kind: skill.kind, input: { text: context.text }, feedbacks: [] }
    );
  }

  async function handleSkillArg(skill, context, arg) {
    if (skill.kind === 'photo') {
      const photoUrls = getPhotoUrls(context);

      if (photoUrls.length === 0) {
        setUserState(context.senderId, registry.stateOf(skill), { caption: arg });
        await send(context, skill.argNoPhoto, registry.packRows(skill.pack));
        return;
      }

      await runGeneration(
        context,
        registry.packRows(skill.pack),
        () => runSkill(skill, context, { photoUrls, caption: arg }),
        { skillId: skill.id, kind: skill.kind, input: { caption: arg }, feedbacks: [] }
      );
      return;
    }

    deleteUserState(context.senderId);
    await runGeneration(
      context,
      registry.packRows(skill.pack),
      () => runSkill(skill, context, { text: arg }),
      { skillId: skill.id, kind: skill.kind, input: { text: arg }, feedbacks: [] }
    );
  }

  // --- Главная точка входа: обработка одного сообщения ---

  async function handleMessage(context) {
    try {
      const text = context.text?.trim() || '';
      const hasAttachments = context.attachments.length > 0;
      if (!text && !hasAttachments) return;

      // Не логируем содержимое сообщений пользователей.
      logger.log(`Сообщение от ${context.senderId}: длина ${text.length}${hasAttachments ? `, вложений: ${context.attachments.length}` : ''}`);

      // Фиксируем активность пользователя (ретеншен неактивных профилей).
      profileStore?.touch?.(context.senderId);

      // 1. Навигация: сбрасывает состояние. При /start персонаж представляется.
      const navigation = registry.findNavigation(text);
      if (navigation) {
        deleteUserState(context.senderId);
        const greeting = navigation.isWelcome ? `${navigation.text}\n\n${persona.intro}` : navigation.text;
        await send(context, greeting, navigation.rows);
        return;
      }

      // 2. Скиллы-заглушки (без генерации).
      const staticSkill = registry.findStatic(text);
      if (staticSkill) {
        await send(context, staticSkill.text, registry.packRows(staticSkill.pack));
        return;
      }

      // 3. Точное совпадение кнопки/команды: ставим состояние и просим ввод.
      const triggeredSkill = registry.findSkillByText(text);
      if (triggeredSkill) {
        await handleSkillTriggered(triggeredSkill, context);
        return;
      }

      const userState = getUserState(context.senderId);

      // 3.5 Пользователь нажал 👎 и обещал правку: следующий текст = критика.
      if (userState?.value === 'awaiting_critique' && text) {
        deleteUserState(context.senderId);
        const generation = getActiveGeneration(context.senderId);

        if (!generation) {
          await send(context, 'Контекст устарел — запустите задачу заново из меню.', registry.mainMenuRows());
          return;
        }

        await regenerateFromGeneration(context, generation, text);
        return;
      }

      // 4. Сообщение в состоянии ожидания ввода.
      const stateSkill = userState ? registry.findSkillByState(userState.value) : null;
      if (stateSkill) {
        await handleSkillStateMessage(stateSkill, context, userState);
        return;
      }

      // 5. Команда с аргументом: "/команда текст" — генерация без состояния.
      const argSkill = registry.findSkillByPrefix(text);
      if (argSkill) {
        const trigger = [argSkill.button, argSkill.command].find((item) => item?.startsWith('/') && text.startsWith(`${item} `));
        const arg = text.slice(trigger.length + 1).trim();
        await handleSkillArg(argSkill, context, arg);
        return;
      }

      // 5.5 Короткая текстовая реакция на последний пост: «плохо», «ещё раз»,
      // «переделай …» — то же, что 👎/🔄, но словами.
      const feedback = text ? detectFeedback(text) : null;
      if (feedback) {
        const generation = getActiveGeneration(context.senderId);

        if (generation) {
          await regenerateFromGeneration(context, generation, feedback.critique);
          return;
        }

        await send(context, 'Сначала сгенерируйте текст — тогда я смогу его переделать. Выберите задачу в меню.');
        return;
      }

      // 6. Интенты в свободном тексте: «улучши …», «напиши пост про …» —
      // работают как нажатие соответствующей кнопки.
      const detected = text ? registry.detectIntent(text) : null;
      if (detected) {
        if (detected.argument) {
          // Аргумент уже есть — генерируем сразу, без состояния.
          await handleSkillArg(detected.skill, context, detected.argument);
          return;
        }

        // Аргумента нет — как при нажатии кнопки: просим ввод.
        await handleSkillTriggered(detected.skill, context);
        return;
      }

      // 7. Остальной свободный текст — отвечает персонаж бота.
      // Клавиатуру не прикладываем: в VK показывается последняя отправленная,
      // поэтому меню пользователя не «сваливается» в главное.
      if (text) {
        await runGeneration(context, null, () => provider.chat(persona.replyWrapper(text, persona.system)));
        return;
      }

      await send(context, 'Нажмите кнопку меню или используйте /start.', registry.mainMenuRows());
    } catch (error) {
      logger.error('Ошибка обработки сообщения:', error);
      try {
        await context.send('Произошла ошибка при обработке вашего запроса. Попробуйте позже.');
      } catch (sendError) {
        logger.error('Не удалось отправить сообщение:', sendError);
      }
    }
  }

  // --- Обработка инлайн-кнопок реакций (message_event) ---

  async function handleMessageEvent(context) {
    try {
      const payload = context.eventPayload || {};

      // Чужие/неопознанные события игнорируем.
      if (!payload.a || !payload.g) return;

      const senderId = context.userId ?? context.senderId;
      const generation = getActiveGeneration(senderId);

      // Кнопка со старого сообщения или контекст истёк.
      if (!generation || String(generation.id) !== String(payload.g)) {
        await safeAnswer(context, 'Контекст устарел — сгенерируйте заново');
        return;
      }

      if (payload.a === 'good') {
        profileStore?.touch?.(senderId);
        await safeAnswer(context, 'Спасибо! Учту, что такой стиль нравится.');
        return;
      }

      if (payload.a === 'bad') {
        await safeAnswer(context, 'Сейчас спрошу правку');
        setUserState(senderId, 'awaiting_critique');
        await context.send('Понял. Что не так? Напишите, что поправить, — и я переделаю текст.');
        return;
      }

      if (payload.a === 'regen') {
        await safeAnswer(context, 'Генерирую другой вариант');
        await regenerateFromGeneration({ senderId }, generation, null);
        return;
      }
    } catch (error) {
      logger.error('Ошибка обработки callback-кнопки:', error);
    }
  }

  // Показ снекбара под кнопкой; событие живёт минуту, ошибки глотаем.
  async function safeAnswer(context, text) {
    try {
      await context.answer({ type: 'show_snackbar', text });
    } catch (error) {
      logger.warn('Не удалось показать снекбар:', error.message || error);
    }
  }

  return {
    handleMessage,
    handleMessageEvent
  };
}

module.exports = {
  createBotEngine
};
