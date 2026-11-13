const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBotEngine } = require('../src/core/engine');
const { createSkillRegistry } = require('../src/skills/registry');
const { createProfileStore } = require('../src/storage/profileStore');
const bloggersPack = require('../src/skills/packs/bloggers');
const businessPack = require('../src/skills/packs/business');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeHarness({ chatReply = 'ГОТОВЫЙ ТЕКСТ', rateLimitMs = 1 } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'textorio-anim-'));
  const profileStore = createProfileStore({ dataDir });
  const provider = {
    chat: jest.fn(async () => chatReply),
    vision: jest.fn(async () => chatReply),
    capabilities: { vision: true, filesApi: false }
  };
  const assistant = { downloadImage: jest.fn(), photoMaxSizeMb: 5 };
  const vk = { api: { messages: { setActivity: jest.fn(async () => {}) } } };
  const registry = createSkillRegistry([bloggersPack, businessPack], { capabilities: provider.capabilities });
  const animation = {
    start: jest.fn(async () => ({ id: 1 })),
    stop: jest.fn(async () => {})
  };
  const engine = createBotEngine({
    vk,
    provider,
    assistant,
    registry,
    personaId: 'hedgehog',
    profileStore,
    rateLimitMs,
    animation
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

  return { engine, provider, animation, message };
}

describe('движок: анимация во время генерации', () => {
  it('запускает анимацию до генерации и останавливает после', async () => {
    const { engine, provider, animation, message } = makeHarness();
    const started = [];

    provider.chat.mockImplementation(async () => {
      expect(animation.start).toHaveBeenCalled();
      started.push(true);
      return 'ГОТОВЫЙ ТЕКСТ';
    });

    const context = message(401, 'привет');
    await engine.handleMessage(context);

    expect(started).toHaveLength(1);
    expect(animation.start).toHaveBeenCalledWith(context);
    expect(animation.stop).toHaveBeenCalledWith({ id: 1 });
    expect(context.send.mock.calls.at(-1)[0]).toBe('ГОТОВЫЙ ТЕКСТ');
  });

  it('останавливает анимацию даже при ошибке генерации', async () => {
    const { engine, provider, animation, message } = makeHarness();

    provider.chat.mockRejectedValueOnce(new Error('provider down'));

    const context = message(402, 'привет');
    await engine.handleMessage(context);

    expect(animation.start).toHaveBeenCalledTimes(1);
    expect(animation.stop).toHaveBeenCalledTimes(1);
    expect(context.send.mock.calls.at(-1)[0]).toContain('Произошла ошибка');
  });

  it('не запускает анимацию, если сработал rate limit', async () => {
    const { engine, animation, message } = makeHarness({ rateLimitMs: 60000 });

    await engine.handleMessage(message(403, 'первое'));
    await engine.handleMessage(message(403, 'второе'));

    expect(animation.start).toHaveBeenCalledTimes(1);
  });

  it('работает без переданной анимации (обратная совместимость)', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'textorio-noanim-'));
    const profileStore = createProfileStore({ dataDir });
    const provider = { chat: jest.fn(async () => 'ОТВЕТ'), capabilities: { vision: true, filesApi: false } };
    const registry = createSkillRegistry([bloggersPack, businessPack], { capabilities: provider.capabilities });
    const engine = createBotEngine({
      vk: { api: { messages: { setActivity: jest.fn(async () => {}) } } },
      provider,
      assistant: {},
      registry,
      personaId: 'hedgehog',
      profileStore
    });

    const context = {
      senderId: 404,
      peerId: 404,
      text: 'привет',
      attachments: [],
      send: jest.fn(async () => {})
    };

    await engine.handleMessage(context);

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(context.send.mock.calls.at(-1)[0]).toBe('ОТВЕТ');
  });
});
