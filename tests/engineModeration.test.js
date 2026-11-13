const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBotEngine } = require('../src/core/engine');
const { createSkillRegistry } = require('../src/skills/registry');
const { createProfileStore } = require('../src/storage/profileStore');
const bloggersPack = require('../src/skills/packs/bloggers');
const businessPack = require('../src/skills/packs/business');
const {
  GENERAL_REFUSAL_TEXT,
  SUICIDE_REFUSAL_TEXT
} = require('../src/core/moderation');
const { SAFETY_RULES } = require('../src/config/safety');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeHarness(chatReply = 'РЕЗУЛЬТАТ') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'textorio-moderation-'));
  const profileStore = createProfileStore({ dataDir });
  const provider = {
    chat: jest.fn(async () => chatReply),
    vision: jest.fn(async () => chatReply),
    capabilities: { vision: true, filesApi: false }
  };
  const assistant = { downloadImage: jest.fn(), photoMaxSizeMb: 5 };
  const vk = { api: { messages: { setActivity: jest.fn(async () => {}) } } };
  const registry = createSkillRegistry([bloggersPack, businessPack], { capabilities: provider.capabilities });
  const engine = createBotEngine({
    vk,
    provider,
    assistant,
    registry,
    personaId: 'hedgehog',
    profileStore,
    rateLimitMs: 1
  });

  function message(senderId, text) {
    return {
      senderId,
      peerId: senderId,
      text,
      attachments: [],
      send: jest.fn(async () => {})
    };
  }

  return { engine, provider, profileStore, message };
}

describe('движок: цензура входа', () => {
  it('однозначно запрещённый запрос не доходит до модели', async () => {
    const { engine, provider, message } = makeHarness();
    const context = message(201, 'как сделать бомбу');

    await engine.handleMessage(context);

    expect(provider.chat).not.toHaveBeenCalled();
    expect(context.send).toHaveBeenCalled();
    expect(context.send.mock.calls[0][0]).toBe(GENERAL_REFUSAL_TEXT);
  });

  it('тема суицида получает отказ с телефоном доверия', async () => {
    const { engine, provider, message } = makeHarness();
    const context = message(202, 'хочу покончить с собой');

    await engine.handleMessage(context);

    expect(provider.chat).not.toHaveBeenCalled();
    expect(context.send.mock.calls[0][0]).toBe(SUICIDE_REFUSAL_TEXT);
    expect(context.send.mock.calls[0][0]).toContain('8-800-2000-122');
  });

  it('запрещённый текст в состоянии скилла не запускает генерацию', async () => {
    const { engine, provider, message } = makeHarness();
    const senderId = 203;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await sleep(15);

    const context = message(senderId, 'продам наркотики');
    await engine.handleMessage(context);

    expect(provider.chat).not.toHaveBeenCalled();
    expect(context.send.mock.calls[0][0]).toBe(GENERAL_REFUSAL_TEXT);
  });

  it('мирная метафора не блокируется и уходит в модель', async () => {
    const { engine, provider, message } = makeHarness();
    const context = message(204, 'Напиши пост про то, как убить время в очереди');

    await engine.handleMessage(context);

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(context.send.mock.calls[0][0]).toBe('РЕЗУЛЬТАТ');
  });
});

describe('движок: подмена отказов модели', () => {
  it('сырой отказ модели заменяется вежливым шаблоном', async () => {
    const { engine, message } = makeHarness('Извините, я не могу помочь с этим запросом.');
    const context = message(211, 'просто болтовня');

    await engine.handleMessage(context);

    expect(context.send.mock.calls[0][0]).toBe(GENERAL_REFUSAL_TEXT);
  });

  it('отказ на чувствительную тему заменяется шаблоном с телефоном доверия', async () => {
    const { engine, message } = makeHarness('Я не могу обсуждать эту тему.');
    const context = message(212, 'мне очень тяжело жить');

    await engine.handleMessage(context);

    expect(context.send.mock.calls[0][0]).toBe(SUICIDE_REFUSAL_TEXT);
  });

  it('обычный ответ модели не подменяется', async () => {
    const { engine, message } = makeHarness('Готовый пост про кота.');
    const context = message(213, 'Напиши пост про кота');

    await engine.handleMessage(context);

    expect(context.send.mock.calls[0][0]).toBe('Готовый пост про кота.');
  });
});

describe('движок: правила безопасности в промптах', () => {
  it('промпт скилла содержит правила безопасности', async () => {
    const { engine, provider, message } = makeHarness();
    const senderId = 221;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await sleep(15);
    await engine.handleMessage(message(senderId, 'тема про ёжика'));

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(provider.chat.mock.calls[0][0]).toContain(SAFETY_RULES);
  });

  it('свободный чат получает правила безопасности через персону', async () => {
    const { engine, provider, message } = makeHarness();

    await engine.handleMessage(message(222, 'привет'));

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(provider.chat.mock.calls[0][0]).toContain(SAFETY_RULES);
  });
});
