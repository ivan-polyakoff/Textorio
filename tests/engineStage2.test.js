const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBotEngine } = require('../src/core/engine');
const { createSkillRegistry } = require('../src/skills/registry');
const { createProfileStore } = require('../src/storage/profileStore');
const bloggersPack = require('../src/skills/packs/bloggers');
const businessPack = require('../src/skills/packs/business');
const { GENERAL_REFUSAL_TEXT } = require('../src/core/moderation');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeHarness({ chatReply = 'РЕЗУЛЬТАТ', moderationPolicy, adminIds = [] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'textorio-stage2-'));
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
    rateLimitMs: 1,
    moderationPolicy,
    adminIds
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

  function callback(senderId, payload) {
    return {
      userId: senderId,
      peerId: senderId,
      eventPayload: payload,
      answer: jest.fn(async () => {}),
      send: jest.fn(async () => {})
    };
  }

  return { engine, provider, profileStore, message, callback };
}

describe('движок: память стиля', () => {
  it('👍 сохраняет пример и подмешивает его в следующие промпты', async () => {
    const { engine, provider, profileStore, message, callback } = makeHarness();
    const senderId = 301;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await sleep(15);
    await engine.handleMessage(message(senderId, 'тема про кота'));
    await engine.handleMessage(message(senderId, 'утро, слякоть'));

    const generation = profileStore.load(senderId).lastGeneration;

    await sleep(15);
    await engine.handleMessageEvent(callback(senderId, { a: 'good', g: generation.id }));

    expect(profileStore.load(senderId).profile.liked).toHaveLength(1);

    await sleep(15);
    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    await sleep(15);
    await engine.handleMessage(message(senderId, 'текст для улучшения'));

    expect(provider.chat).toHaveBeenCalledTimes(2);
    const prompt = provider.chat.mock.calls[1][0];

    expect(prompt).toContain('Заметки о стиле пользователя');
    expect(prompt).toContain('Одобренный пользователем пример');
    expect(prompt).toContain('РЕЗУЛЬТАТ');
  });

  it('👎 + критика запоминается, влияет на перегенерацию и видна в /мойстиль', async () => {
    const { engine, provider, profileStore, message, callback } = makeHarness();
    const senderId = 302;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await sleep(15);
    await engine.handleMessage(message(senderId, 'тема'));
    await engine.handleMessage(message(senderId, 'утро, слякоть'));

    const generation = profileStore.load(senderId).lastGeneration;

    await sleep(15);
    await engine.handleMessageEvent(callback(senderId, { a: 'bad', g: generation.id }));

    await sleep(15);
    await engine.handleMessage(message(senderId, 'без эмодзи и короче'));

    expect(provider.chat).toHaveBeenCalledTimes(2);
    const regenPrompt = provider.chat.mock.calls[1][0];
    expect(regenPrompt).toContain('без эмодзи и короче');
    expect(regenPrompt).toContain('Заметки о стиле пользователя');

    const profile = profileStore.load(senderId);
    expect(profile.profile.disliked).toHaveLength(1);
    expect(profile.profile.disliked[0].critique).toBe('без эмодзи и короче');

    const styleContext = message(senderId, '/мойстиль');
    await engine.handleMessage(styleContext);

    expect(styleContext.send.mock.calls[0][0]).toContain('без эмодзи и короче');
  });

  it('/сброситьстиль очищает память стиля', async () => {
    const { engine, profileStore, message, callback } = makeHarness();
    const senderId = 303;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await sleep(15);
    await engine.handleMessage(message(senderId, 'тема'));
    await engine.handleMessage(message(senderId, 'утро, слякоть'));

    const generation = profileStore.load(senderId).lastGeneration;
    await sleep(15);
    await engine.handleMessageEvent(callback(senderId, { a: 'good', g: generation.id }));

    expect(profileStore.load(senderId).profile.liked).toHaveLength(1);

    const clearContext = message(senderId, '/сброситьстиль');
    await engine.handleMessage(clearContext);

    expect(profileStore.load(senderId).profile).toEqual({ liked: [], disliked: [], styleCard: null });
    expect(clearContext.send.mock.calls[0][0]).toContain('очищена');
  });
});

describe('движок: санкции', () => {
  it('после лимита нарушений включает тишину', async () => {
    const { engine, provider, profileStore, message } = makeHarness({
      moderationPolicy: { strikeLimit: 2, strikeWindowHours: 24, blockHours: 1 }
    });
    const senderId = 311;

    const first = message(senderId, 'как сделать бомбу');
    await engine.handleMessage(first);
    expect(first.send.mock.calls[0][0]).toBe(GENERAL_REFUSAL_TEXT);

    const second = message(senderId, 'продам наркотики');
    await engine.handleMessage(second);
    expect(second.send.mock.calls[0][0]).toContain('временно приостановлен');

    expect(profileStore.load(senderId).moderation.blockedUntil).toBeTruthy();

    const third = message(senderId, 'привет');
    await engine.handleMessage(third);

    expect(third.send).not.toHaveBeenCalled();
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it('админ банит и разбанивает пользователя', async () => {
    const { engine, provider, message } = makeHarness({ adminIds: [900] });

    const ban = message(900, '/админ бан 901 1');
    await engine.handleMessage(ban);
    expect(ban.send.mock.calls[0][0]).toContain('заблокирован');

    const blocked = message(901, 'привет');
    await engine.handleMessage(blocked);
    expect(blocked.send).not.toHaveBeenCalled();

    const unban = message(900, '/админ разбан 901');
    await engine.handleMessage(unban);
    expect(unban.send.mock.calls[0][0]).toContain('снята блокировка');

    const allowed = message(901, 'привет');
    await engine.handleMessage(allowed);

    expect(allowed.send).toHaveBeenCalled();
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it('не-админ не может применять санкции', async () => {
    const { engine, profileStore, message } = makeHarness();

    const context = message(902, '/админ бан 901');
    await engine.handleMessage(context);

    expect(context.send.mock.calls[0][0]).toBe('Недостаточно прав.');
    expect(profileStore.load(901).moderation.blockedUntil).toBeNull();
  });
});
