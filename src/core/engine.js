// Универсальный движок обработки сообщений.
// Знает о скиллах только через реестр (src/skills/registry.js) и о провайдере —
// через контракт (src/providers/provider.js). Ни VK, ни GigaChat здесь не упоминаются.
// Специфика VK (клавиатуры vk-io, скачивание фото) остаётся в transport.

const { sendWithOptionalKeyboard, getPhotoUrls, withTyping } = require('../utils/vk');
const { createRateLimiter } = require('../utils/rateLimiter');
const { getPersona } = require('../config/persona');
const { logger } = require('../utils/logger');

const RATE_LIMIT_MS = 3000;
const USER_STATE_TTL_MS = 30 * 60 * 1000;

function createBotEngine({ vk, provider, assistant, registry, personaId }) {
  const persona = getPersona(personaId);
  const rateLimiter = createRateLimiter(RATE_LIMIT_MS);
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

  async function send(context, text, rows = null) {
    const keyboard = rows ? buildVkKeyboard(rows) : undefined;
    await sendWithOptionalKeyboard(context, text, keyboard);
  }

  // Абстрактные ряды [[{label, color}]] → клавиатура vk-io.
  function buildVkKeyboard(rows) {
    const { Keyboard } = require('vk-io');
    const colors = {
      primary: Keyboard.PRIMARY_COLOR,
      positive: Keyboard.POSITIVE_COLOR,
      secondary: Keyboard.SECONDARY_COLOR
    };

    const builder = Keyboard.builder();
    rows.forEach((row, index) => {
      if (index > 0) builder.row();
      row.forEach(({ label, color }) => {
        builder.textButton({
          label,
          payload: { command: label },
          color: colors[color] || colors.primary
        });
      });
    });
    builder.oneTime(false);
    return builder;
  }

  async function runGeneration(context, rows, task) {
    if (rateLimiter.isLimited(context.senderId)) {
      await send(context, 'Слишком часто — подождите пару секунд и попробуйте ещё раз.', rows);
      return;
    }

    const reply = await withTyping(vk, context, task);
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
      await runGeneration(context, registry.packRows(skill.pack), () => runSkill(skill, context, { photoUrls, caption }));
      return;
    }

    if (!context.text) {
      await send(context, skill.emptyAsk, registry.packRows(skill.pack));
      return;
    }

    deleteUserState(context.senderId);
    await runGeneration(context, registry.packRows(skill.pack), () => runSkill(skill, context, { text: context.text }));
  }

  async function handleSkillArg(skill, context, arg) {
    if (skill.kind === 'photo') {
      const photoUrls = getPhotoUrls(context);

      if (photoUrls.length === 0) {
        setUserState(context.senderId, registry.stateOf(skill), { caption: arg });
        await send(context, skill.argNoPhoto, registry.packRows(skill.pack));
        return;
      }

      await runGeneration(context, registry.packRows(skill.pack), () => runSkill(skill, context, { photoUrls, caption: arg }));
      return;
    }

    deleteUserState(context.senderId);
    await runGeneration(context, registry.packRows(skill.pack), () => runSkill(skill, context, { text: arg }));
  }

  // --- Главная точка входа: обработка одного сообщения ---

  async function handleMessage(context) {
    try {
      const text = context.text?.trim() || '';
      const hasAttachments = context.attachments.length > 0;
      if (!text && !hasAttachments) return;

      // Не логируем содержимое сообщений пользователей.
      logger.log(`Сообщение от ${context.senderId}: длина ${text.length}${hasAttachments ? `, вложений: ${context.attachments.length}` : ''}`);

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

  return {
    handleMessage
  };
}

module.exports = {
  createBotEngine
};
