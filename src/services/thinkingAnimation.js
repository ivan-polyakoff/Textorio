const { logger } = require('../utils/logger');

const DEFAULT_INTERVAL_MS = 700;

function randomId() {
  return Math.floor(Math.random() * 0x7fffffff);
}

function createThinkingAnimation({ vk, intervalMs } = {}) {
  const delay = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_INTERVAL_MS;

  function canAnimate() {
    return Boolean(vk?.api?.messages?.send && vk?.api?.messages?.edit);
  }

  async function edit(state, message) {
    await vk.api.messages.edit({
      peer_id: state.peerId,
      message_id: state.messageId,
      message
    });
  }

  async function tick(state) {
    if (state.stopped || state.busy) return;

    state.busy = true;
    try {
      state.dots = (state.dots % 3) + 1;
      await edit(state, `Думаю${'.'.repeat(state.dots)}`);
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

    const state = {
      peerId: context.peerId,
      messageId: null,
      dots: 1,
      timer: null,
      busy: false,
      stopped: false
    };

    try {
      const sent = await vk.api.messages.send({
        peer_id: context.peerId,
        message: 'Думаю.',
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
  createThinkingAnimation
};
