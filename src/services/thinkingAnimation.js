const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const DEFAULT_PHRASES = [
  'Думаю…',
  'Подбираю слова…',
  'Вот так лучше…',
  'Почти готово…',
  'Ещё чуть-чуть…'
];

const DEFAULT_INTERVAL_MS = 2500;

function randomId() {
  return Math.floor(Math.random() * 0x7fffffff);
}

function createThinkingAnimation({ vk, gifPath, phrases, intervalMs } = {}) {
  const phraseList = Array.isArray(phrases) && phrases.length > 0 ? phrases : DEFAULT_PHRASES;
  const delay = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_INTERVAL_MS;
  let attachmentPromise = null;

  function canAnimate() {
    return Boolean(vk?.api?.messages?.send && vk?.api?.messages?.edit);
  }

  async function ensureAttachment(peerId) {
    if (!vk?.upload?.messageDocument || !gifPath) return null;
    if (!attachmentPromise) {
      attachmentPromise = (async () => {
        try {
          const buffer = await fs.promises.readFile(gifPath);
          const document = await vk.upload.messageDocument({
            source: { value: buffer, filename: path.basename(gifPath) },
            peer_id: peerId
          });
          return document ? document.toString() : null;
        } catch (error) {
          logger.warn(`Не удалось загрузить GIF для анимации: ${error.message || error}`);
          return null;
        }
      })();
    }
    return attachmentPromise;
  }

  async function edit(state, message) {
    await vk.api.messages.edit({
      peer_id: state.peerId,
      message_id: state.messageId,
      message,
      attachment: state.attachment || undefined
    });
  }

  async function tick(state) {
    if (state.stopped || state.busy) return;

    state.busy = true;
    try {
      const phrase = phraseList[state.index % phraseList.length];
      state.index += 1;
      await edit(state, phrase);
    } catch (error) {
      logger.warn(`Не удалось обновить анимацию генерации: ${error.message || error}`);
      state.stopped = true;
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
    } finally {
      state.busy = false;
    }
  }

  async function start(context) {
    if (!canAnimate() || !context?.peerId) return null;

    const attachment = await ensureAttachment(context.peerId);
    const state = {
      peerId: context.peerId,
      messageId: null,
      attachment,
      index: 1,
      timer: null,
      busy: false,
      stopped: false
    };

    try {
      const sent = await vk.api.messages.send({
        peer_id: context.peerId,
        message: phraseList[0],
        attachment: attachment || undefined,
        random_id: randomId()
      });
      state.messageId = Array.isArray(sent) ? sent[0] : sent;
    } catch (error) {
      logger.warn(`Не удалось отправить анимацию генерации: ${error.message || error}`);
      return null;
    }

    state.timer = setInterval(() => {
      void tick(state);
    }, delay);
    state.timer.unref?.();

    return state;
  }

  async function stop(state) {
    if (!state) return;

    state.stopped = true;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;

    if (!state.messageId) return;

    try {
      await vk.api.messages.delete({
        peer_id: state.peerId,
        message_ids: state.messageId,
        delete_for_all: 1
      });
    } catch (error) {
      logger.warn(`Не удалось убрать анимацию генерации: ${error.message || error}`);

      try {
        await edit(state, 'Готово ✅');
      } catch (editError) {
        logger.warn(`Не удалось заменить анимацию: ${editError.message || editError}`);
      }
    }
  }

  return {
    start,
    stop
  };
}

module.exports = {
  createThinkingAnimation,
  DEFAULT_PHRASES
};
