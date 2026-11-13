const { createThinkingAnimation } = require('../src/services/thinkingAnimation');

function makeVk({ attachment = 'doc1_2', messageId = 77 } = {}) {
  return {
    api: {
      messages: {
        send: jest.fn(async () => messageId),
        edit: jest.fn(async () => 1),
        delete: jest.fn(async () => 1)
      }
    },
    upload: {
      messageDocument: jest.fn(async () => ({
        toString: () => attachment
      }))
    }
  };
}

const CONTEXT = { peerId: 5 };

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('анимация генерации', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('отправляет GIF-заглушку и меняет подписи по таймеру', async () => {
    jest.useFakeTimers();
    const vk = makeVk();
    const animation = createThinkingAnimation({ vk, gifPath: 'assets/thinking.gif', intervalMs: 2500 });

    const state = await animation.start(CONTEXT);

    expect(state.messageId).toBe(77);
    expect(vk.upload.messageDocument).toHaveBeenCalledTimes(1);
    expect(vk.api.messages.send).toHaveBeenCalledWith(expect.objectContaining({
      peer_id: 5,
      message: 'Думаю…',
      attachment: 'doc1_2'
    }));

    jest.advanceTimersByTime(2500);
    await flush();

    expect(vk.api.messages.edit).toHaveBeenCalledWith(expect.objectContaining({
      peer_id: 5,
      message_id: 77,
      message: 'Подбираю слова…',
      attachment: 'doc1_2'
    }));

    jest.advanceTimersByTime(2500);
    await flush();

    expect(vk.api.messages.edit).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'Вот так лучше…'
    }));

    await animation.stop(state);

    expect(vk.api.messages.delete).toHaveBeenCalledWith(expect.objectContaining({
      peer_id: 5,
      message_ids: 77,
      delete_for_all: 1
    }));
  });

  it('не перезагружает GIF при следующих генерациях', async () => {
    const vk = makeVk();
    const animation = createThinkingAnimation({ vk, gifPath: 'assets/thinking.gif', intervalMs: 60000 });

    const first = await animation.start({ peerId: 5 });
    await animation.stop(first);
    const second = await animation.start({ peerId: 6 });
    await animation.stop(second);

    expect(vk.upload.messageDocument).toHaveBeenCalledTimes(1);
    expect(vk.api.messages.send).toHaveBeenCalledTimes(2);
  });

  it('работает без GIF: только смена текста', async () => {
    const vk = makeVk();
    delete vk.upload;
    const animation = createThinkingAnimation({ vk, gifPath: 'assets/thinking.gif' });

    const state = await animation.start(CONTEXT);

    expect(state.messageId).toBe(77);
    expect(vk.api.messages.send.mock.calls[0][0].attachment).toBeUndefined();

    await animation.stop(state);
  });

  it('продолжает генерацию, если GIF не загрузился', async () => {
    const vk = makeVk();
    vk.upload.messageDocument.mockRejectedValueOnce(new Error('upload failed'));
    const animation = createThinkingAnimation({ vk, gifPath: 'assets/thinking.gif' });

    const state = await animation.start(CONTEXT);

    expect(state).not.toBeNull();
    expect(vk.api.messages.send.mock.calls[0][0].attachment).toBeUndefined();

    await animation.stop(state);
  });

  it('возвращает null, если не удалось отправить заглушку', async () => {
    const vk = makeVk();
    vk.api.messages.send.mockRejectedValueOnce(new Error('send failed'));
    const animation = createThinkingAnimation({ vk, gifPath: 'assets/thinking.gif' });

    await expect(animation.start(CONTEXT)).resolves.toBeNull();
  });

  it('при ошибке удаления заменяет заглушку на «Готово»', async () => {
    const vk = makeVk();
    vk.api.messages.delete.mockRejectedValueOnce(new Error('delete failed'));
    const animation = createThinkingAnimation({ vk, gifPath: 'assets/thinking.gif' });

    const state = await animation.start(CONTEXT);
    await animation.stop(state);

    expect(vk.api.messages.edit).toHaveBeenCalledWith(expect.objectContaining({
      message_id: 77,
      message: 'Готово ✅',
      attachment: 'doc1_2'
    }));
  });
});
