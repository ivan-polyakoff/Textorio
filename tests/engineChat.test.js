const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBotEngine } = require('../src/core/engine');
const { createSkillRegistry } = require('../src/skills/registry');
const { createProfileStore } = require('../src/storage/profileStore');
const { GENERIC_ERROR_TEXT } = require('../src/providers/errorText');
const { GENERAL_REFUSAL_TEXT } = require('../src/core/moderation');
const bloggersPack = require('../src/skills/packs/bloggers');
const businessPack = require('../src/skills/packs/business');

function makeHarness({ chatReply = 'ОТВЕТ' } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'textorio-chat-'));
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('движок: контекст свободного чата', () => {
  it('второй запрос свободного чата содержит историю диалога', async () => {
    const { engine, provider, message } = makeHarness({ chatReply: 'ПЕРВЫЙ ОТВЕТ' });
    const senderId = 501;

    await engine.handleMessage(message(senderId, 'привет'));
    await sleep(5);
    await engine.handleMessage(message(senderId, 'как дела?'));

    expect(provider.chat).toHaveBeenCalledTimes(2);

    const firstPrompt = provider.chat.mock.calls[0][0];
    const secondPrompt = provider.chat.mock.calls[1][0];

    expect(firstPrompt).not.toContain('История диалога');
    expect(secondPrompt).toContain('История диалога');
    expect(secondPrompt).toContain('Пользователь: привет');
    expect(secondPrompt).toContain('Ассистент: ПЕРВЫЙ ОТВЕТ');
    expect(secondPrompt).toContain('как дела?');
  });

  it('ошибка провайдера не попадает в историю', async () => {
    const { engine, profileStore, message } = makeHarness({ chatReply: GENERIC_ERROR_TEXT });
    const senderId = 502;

    await engine.handleMessage(message(senderId, 'привет'));

    expect(profileStore.load(senderId).chat.messages).toHaveLength(0);
  });

  it('отказ модели не попадает в историю', async () => {
    const { engine, profileStore, message } = makeHarness({ chatReply: GENERAL_REFUSAL_TEXT });
    const senderId = 503;

    await engine.handleMessage(message(senderId, 'привет'));

    expect(profileStore.load(senderId).chat.messages).toHaveLength(0);
  });

  it('/забудь очищает историю', async () => {
    const { engine, profileStore, message } = makeHarness({ chatReply: 'ОТВЕТ' });
    const senderId = 504;

    await engine.handleMessage(message(senderId, 'привет'));
    expect(profileStore.load(senderId).chat.messages).toHaveLength(2);

    const forget = message(senderId, '/забудь');
    await engine.handleMessage(forget);

    expect(profileStore.load(senderId).chat.messages).toHaveLength(0);
    expect(forget.send.mock.calls[0][0]).toContain('чистого листа');
  });

  it('скиллы не пишут историю чата', async () => {
    const { engine, profileStore, message } = makeHarness({ chatReply: 'ПОСТ' });
    const senderId = 505;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await sleep(5);
    await engine.handleMessage(message(senderId, 'тема поста'));
    await sleep(5);

    expect(profileStore.load(senderId).chat.messages).toHaveLength(0);
  });

  it('фото-генерация не получает карточку стиля', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'textorio-chat-photo-'));
    const profileStore = createProfileStore({ dataDir });
    const provider = {
      chat: jest.fn(async () => 'ОТВЕТ'),
      vision: jest.fn(async () => 'ПОСТ ПО ФОТО'),
      capabilities: { vision: true, filesApi: false }
    };
    const registry = createSkillRegistry([bloggersPack, businessPack], { capabilities: provider.capabilities });
    const engine = createBotEngine({
      vk: { api: { messages: { setActivity: jest.fn(async () => {}) } } },
      provider,
      assistant: { downloadImage: jest.fn(async () => ({ buffer: Buffer.from('x'), contentType: 'image/jpeg' })) },
      registry,
      personaId: 'hedgehog',
      profileStore,
      rateLimitMs: 1
    });

    const send = jest.fn(async () => {});
    const senderId = 507;

    await engine.handleMessage({ senderId, peerId: senderId, text: 'привет', attachments: [], send });
    await sleep(5);
    await engine.handleMessage({ senderId, peerId: senderId, text: 'Создать пост', attachments: [], send });
    await sleep(5);
    await engine.handleMessage({ senderId, peerId: senderId, text: 'тема', attachments: [], send });
    await sleep(5);

    const photoSkill = registry.findSkillById('photo_post');

    await engine.handleMessage({ senderId, peerId: senderId, text: photoSkill.button, attachments: [], send });
    await sleep(5);
    await engine.handleMessage({ senderId, peerId: senderId, text: '', attachments: [{ type: 'photo', sizes: [{ url: 'http://x/1.jpg', width: 100, height: 100 }] }], send });
    await sleep(5);

    expect(provider.vision).toHaveBeenCalledTimes(1);
    const visionPrompt = provider.vision.mock.calls[0][3].prompt;
    expect(visionPrompt).not.toContain('Заметки о стиле пользователя');
  });

  it('история персистентна между загрузками хранилища', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'textorio-chat-persist-'));
    const profileStore = createProfileStore({ dataDir });
    const provider = { chat: jest.fn(async () => 'ОТВЕТ'), capabilities: { vision: true, filesApi: false } };
    const registry = createSkillRegistry([bloggersPack, businessPack], { capabilities: provider.capabilities });
    const engine = createBotEngine({
      vk: { api: { messages: { setActivity: jest.fn(async () => {}) } } },
      provider,
      assistant: {},
      registry,
      personaId: 'hedgehog',
      profileStore,
      rateLimitMs: 1
    });

    const context = {
      senderId: 506,
      peerId: 506,
      text: 'привет',
      attachments: [],
      send: jest.fn(async () => {})
    };
    await engine.handleMessage(context);

    const freshStore = createProfileStore({ dataDir });

    expect(freshStore.load(506).chat.messages).toHaveLength(2);
  });
});
