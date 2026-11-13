const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBotEngine } = require('../src/core/engine');
const { createSkillRegistry } = require('../src/skills/registry');
const { createProfileStore } = require('../src/storage/profileStore');
const bloggersPack = require('../src/skills/packs/bloggers');
const businessPack = require('../src/skills/packs/business');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeHarness() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'textorio-engine-'));
  const profileStore = createProfileStore({ dataDir });
  const provider = {
    chat: jest.fn(async () => 'РЕЗУЛЬТАТ'),
    vision: jest.fn(async () => 'РЕЗУЛЬТАТ'),
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

describe('движок: обратная связь по генерациям', () => {
  it('генерация сохраняет lastGeneration и прикрепляет инлайн-кнопки; 🔄 делает вариацию', async () => {
    const { engine, provider, profileStore, message, callback } = makeHarness();
    const senderId = 101;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    expect(provider.chat).not.toHaveBeenCalled();

    await sleep(15);
    await engine.handleMessage(message(senderId, 'тема про ёжика'));

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(provider.chat.mock.calls[0][0]).toContain('тема про ёжика');

    const first = profileStore.load(senderId).lastGeneration;
    expect(first.skillId).toBe('post_topic');
    expect(first.input).toEqual({ text: 'тема про ёжика' });
    expect(first.feedbacks).toEqual([]);
    expect(first.id).toBeTruthy();

    await sleep(15);
    const regen = callback(senderId, { a: 'regen', g: first.id });
    await engine.handleMessageEvent(regen);

    expect(provider.chat).toHaveBeenCalledTimes(2);
    const variationPrompt = provider.chat.mock.calls[1][0];
    expect(variationPrompt).toContain('другой вариант');
    expect(variationPrompt).toContain('РЕЗУЛЬТАТ');

    const second = profileStore.load(senderId).lastGeneration;
    expect(second.id).not.toBe(first.id);
  });

  it('👎 спрашивает правку; следующий текст перегенерирует с критикой и копит feedbacks', async () => {
    const { engine, provider, profileStore, message, callback } = makeHarness();
    const senderId = 102;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await sleep(15);
    await engine.handleMessage(message(senderId, 'тема'));
    const first = profileStore.load(senderId).lastGeneration;

    await sleep(15);
    const bad = callback(senderId, { a: 'bad', g: first.id });
    await engine.handleMessageEvent(bad);
    expect(bad.send).toHaveBeenCalledTimes(1);
    expect(bad.send.mock.calls[0][0]).toContain('Что не так');

    await sleep(15);
    await engine.handleMessage(message(senderId, 'сделай короче и живее'));

    expect(provider.chat).toHaveBeenCalledTimes(2);
    const critiquePrompt = provider.chat.mock.calls[1][0];
    expect(critiquePrompt).toContain('сделай короче и живее');
    expect(critiquePrompt).toContain('РЕЗУЛЬТАТ');

    const second = profileStore.load(senderId).lastGeneration;
    expect(second.feedbacks).toContain('сделай короче и живее');
  });

  it('👍 только подтверждает — новой генерации нет, контекст сохранён', async () => {
    const { engine, provider, profileStore, message, callback } = makeHarness();
    const senderId = 103;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await sleep(15);
    await engine.handleMessage(message(senderId, 'тема'));
    const first = profileStore.load(senderId).lastGeneration;

    await sleep(15);
    const good = callback(senderId, { a: 'good', g: first.id });
    await engine.handleMessageEvent(good);

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(good.answer).toHaveBeenCalledWith(expect.objectContaining({ type: 'show_snackbar' }));
    expect(profileStore.load(senderId).lastGeneration.id).toBe(first.id);
  });

  it('кнопка со старым genId/устаревший контекст — снекбар, генерации нет', async () => {
    const { engine, provider, message, callback } = makeHarness();
    const senderId = 104;

    const stale = callback(senderId, { a: 'regen', g: 'несуществующий' });
    await engine.handleMessageEvent(stale);

    expect(provider.chat).not.toHaveBeenCalled();
    expect(stale.answer).toHaveBeenCalledWith(expect.objectContaining({
      type: 'show_snackbar',
      text: expect.stringContaining('устарел')
    }));
  });

  it('текстовые реакции: «плохо» — вариация, «переделай …» — критика', async () => {
    const { engine, provider, profileStore, message } = makeHarness();
    const senderId = 105;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    await sleep(15);
    await engine.handleMessage(message(senderId, 'текст на улучшение'));
    expect(provider.chat).toHaveBeenCalledTimes(1);

    await sleep(15);
    await engine.handleMessage(message(senderId, 'плохо'));
    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(provider.chat.mock.calls[1][0]).toContain('другой вариант');

    await sleep(15);
    await engine.handleMessage(message(senderId, 'переделай без воды'));
    expect(provider.chat).toHaveBeenCalledTimes(3);
    expect(provider.chat.mock.calls[2][0]).toContain('без воды');

    const generation = profileStore.load(senderId).lastGeneration;
    expect(generation.skillId).toBe('style_improve');
    expect(generation.feedbacks).toContain('переделай без воды');
  });

  it('реакция без сохранённой генерации — подсказка, не генерация', async () => {
    const { engine, provider, message } = makeHarness();

    await engine.handleMessage(message(106, 'плохо'));

    expect(provider.chat).not.toHaveBeenCalled();
  });

  it('навигация сбрасывает состояние сценария, но не lastGeneration', async () => {
    const { engine, provider, profileStore, message } = makeHarness();
    const senderId = 107;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await sleep(15);
    await engine.handleMessage(message(senderId, 'тема'));
    const generationId = profileStore.load(senderId).lastGeneration.id;

    await engine.handleMessage(message(senderId, '/start'));
    expect(profileStore.load(senderId).lastGeneration.id).toBe(generationId);

    await sleep(15);
    await engine.handleMessage(message(senderId, 'просто болтовня'));
    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(provider.chat.mock.calls[1][0]).toContain('просто болтовня');
    // Свободный чат не перезаписывает lastGeneration.
    expect(profileStore.load(senderId).lastGeneration.id).toBe(generationId);
  });

  it('чужие payload без маркера игнорируются', async () => {
    const { engine, callback } = makeHarness();

    const foreign = callback(108, { command: 'что-то' });
    await engine.handleMessageEvent(foreign);

    expect(foreign.answer).not.toHaveBeenCalled();
  });
});
