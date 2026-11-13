const { createThinkingAnimation } = require('../src/services/thinkingAnimation');

function makeVk({ messageId = 77 } = {}) {
  return {
    api: {
      messages: {
        send: jest.fn(async () => messageId),
        edit: jest.fn(async () => 1),
        delete: jest.fn(async () => 1)
      }
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

  it('отправляет «Думаю.» и бегает точками по таймеру', async () => {
    jest.useFakeTimers();
    const vk = makeVk();
    const animation = createThinkingAnimation({ vk, intervalMs: 700 });

    const state = await animation.start(CONTEXT);

    expect(state.messageId).toBe(77);
    expect(vk.api.messages.send).toHaveBeenCalledWith(expect.objectContaining({
      peer_id: 5,
      message: 'Думаю.'
    }));

    jest.advanceTimersByTime(700);
    await flush();
    expect(vk.api.messages.edit).toHaveBeenLastCalledWith(expect.objectContaining({
      message_id: 77,
      message: 'Думаю..'
    }));

    jest.advanceTimersByTime(700);
    await flush();
    expect(vk.api.messages.edit).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'Думаю...'
    }));

    jest.advanceTimersByTime(700);
    await flush();
    expect(vk.api.messages.edit).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'Думаю.'
    }));

    await animation.stop(state);

    expect(vk.api.messages.delete).toHaveBeenCalledWith(expect.objectContaining({
      peer_id: 5,
      message_ids: 77,
      delete_for_all: 1
    }));
  });

  it('останавливает таймер после stop — правок больше нет', async () => {
    jest.useFakeTimers();
    const vk = makeVk();
    const animation = createThinkingAnimation({ vk, intervalMs: 700 });

    const state = await animation.start(CONTEXT);
    await animation.stop(state);

    const editsAfterStop = vk.api.messages.edit.mock.calls.length;

    jest.advanceTimersByTime(3000);
    await flush();

    expect(vk.api.messages.edit.mock.calls.length).toBe(editsAfterStop);
  });

  it('прекращает правки после первой ошибки редактирования', async () => {
    jest.useFakeTimers();
    const vk = makeVk();
    vk.api.messages.edit.mockRejectedValueOnce(new Error('edit failed'));
    const animation = createThinkingAnimation({ vk, intervalMs: 700 });

    const state = await animation.start(CONTEXT);

    jest.advanceTimersByTime(700);
    await flush();
    jest.advanceTimersByTime(7000);
    await flush();

    expect(vk.api.messages.edit).toHaveBeenCalledTimes(1);

    await animation.stop(state);
    expect(state.stopped).toBe(true);
  });

  it('возвращает null, если не удалось отправить заглушку', async () => {
    const vk = makeVk();
    vk.api.messages.send.mockRejectedValueOnce(new Error('send failed'));
    const animation = createThinkingAnimation({ vk, intervalMs: 700 });

    await expect(animation.start(CONTEXT)).resolves.toBeNull();
  });

  it('при ошибке удаления заменяет заглушку на «Готово»', async () => {
    const vk = makeVk();
    vk.api.messages.delete.mockRejectedValueOnce(new Error('delete failed'));
    const animation = createThinkingAnimation({ vk, intervalMs: 700 });

    const state = await animation.start(CONTEXT);
    await animation.stop(state);

    expect(vk.api.messages.edit).toHaveBeenCalledWith(expect.objectContaining({
      message_id: 77,
      message: 'Готово ✅'
    }));
  });

  it('работает без messages.edit (старое поведение — только typing)', async () => {
    const vk = makeVk();
    delete vk.api.messages.edit;
    const animation = createThinkingAnimation({ vk });

    await expect(animation.start(CONTEXT)).resolves.toBeNull();
    expect(vk.api.messages.send).not.toHaveBeenCalled();
  });
});
