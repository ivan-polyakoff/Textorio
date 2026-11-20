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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('движок: бизнес-скиллы с опциональным фото', () => {
  it('описание товара по тексту идёт через chat, с фото — через vision', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'textorio-hybrid-'));
    const profileStore = createProfileStore({ dataDir });
    const provider = {
      chat: jest.fn(async () => 'ОПИСАНИЕ ПО ТЕКСТУ'),
      vision: jest.fn(async () => 'ОПИСАНИЕ ПО ФОТО'),
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
    const senderId = 601;
    const photo = [{ type: 'photo', sizes: [{ url: 'http://x/p.jpg', width: 100, height: 100 }] }];

    await engine.handleMessage({ senderId, peerId: senderId, text: 'Создать пост', attachments: [], send });
    await sleep(5);
    await engine.handleMessage({ senderId, peerId: senderId, text: 'тема', attachments: [], send });
    await sleep(5);

    // Текст без фото — chat
    await engine.handleMessage({ senderId, peerId: senderId, text: '/товар эко-сумка из хлопка', attachments: [], send });
    await sleep(5);
    expect(provider.chat).toHaveBeenCalledWith(expect.stringContaining('эко-сумка'));
    expect(provider.vision).not.toHaveBeenCalled();

    // Фото + комментарий — vision (сначала триггер ставит состояние)
    await engine.handleMessage({ senderId, peerId: senderId, text: '/товар', attachments: [], send });
    await sleep(5);
    await engine.handleMessage({ senderId, peerId: senderId, text: 'сумка для маркетов', attachments: photo, send });
    await sleep(5);
    expect(provider.vision).toHaveBeenCalledTimes(1);
    const [buffer, contentType, caption, options] = provider.vision.mock.calls[0];
    expect(caption).toBe('сумка для маркетов');
    expect(options.prompt).toContain('сумка для маркетов');
    expect(buffer).toEqual(Buffer.from('x'));

    // Фото без текста — vision с пустым описанием (триггер ставит состояние)
    await engine.handleMessage({ senderId, peerId: senderId, text: '/товар', attachments: [], send });
    await sleep(5);
    await engine.handleMessage({ senderId, peerId: senderId, text: '', attachments: photo, send });
    await sleep(5);
    expect(provider.vision).toHaveBeenCalledTimes(2);
    expect(provider.vision.mock.calls[1][2]).toBe('');
  });
});

describe('движок: пресеты стиля', () => {
  function labelsOf(options) {
    const keyboard = JSON.parse(options.keyboard.toString());
    return keyboard.buttons.flat().map((button) => button.action.label);
  }

  it('кнопка скилла показывает стили, выбор до текста учитывается и в правках', async () => {
    const { engine, provider, profileStore, message } = makeHarness();
    const senderId = 801;

    const trigger = message(senderId, 'Улучшить стиль');
    await engine.handleMessage(trigger);
    const triggerKeyboard = JSON.parse(trigger.send.mock.calls[0][1].keyboard.toString());
    expect(triggerKeyboard.inline).toBe(true);
    expect(labelsOf(trigger.send.mock.calls[0][1])).toEqual([
      'Строгий', 'Неформальный', 'Поэтичный', 'Довлатов', 'Пушкин', 'Бродский', 'Я — автор'
    ]);

    const presetMessage = message(senderId, 'Строгий');
    await engine.handleMessage(presetMessage);
    expect(presetMessage.send.mock.calls[0][0]).toContain('Стиль «Строгий» выбрал');

    const textMessage = message(senderId, 'Продали дачу. Звоните.');
    await engine.handleMessage(textMessage);

    expect(provider.chat).toHaveBeenCalledTimes(1);
    const prompt = provider.chat.mock.calls[0][0];
    expect(prompt).toContain('строгий деловой стиль');
    expect(prompt).toContain('Продали дачу. Звоните.');

    const keyboard = JSON.parse(textMessage.send.mock.calls[0][1].keyboard.toString());
    expect(keyboard.inline).toBe(true);
    const presetButtons = keyboard.buttons.flat().filter((b) => {
      const payload = typeof b.action.payload === 'string' ? JSON.parse(b.action.payload) : b.action.payload;
      return payload.a === 'preset';
    });
    expect(presetButtons.map((b) => b.action.label)).toEqual([
      'Строгий', 'Неформальный', 'Поэтичный', 'Довлатов', 'Пушкин', 'Бродский'
    ]);

    const generation = profileStore.load(senderId).lastGeneration;
    expect(generation.input.preset).toBe('strict');

    await sleep(5);
    await engine.handleMessageEvent({ userId: senderId, peerId: senderId, eventPayload: { a: 'regen', g: generation.id }, answer: jest.fn(async () => {}), send: jest.fn(async () => {}) });

    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(provider.chat.mock.calls[1][0]).toContain('строгий деловой стиль');
  });

  it('кнопка стиля после результата переделывает исходный текст, а не предыдущий вариант', async () => {
    const { engine, provider, profileStore, message } = makeHarness({ chatReply: 'Первый вариант' });
    const senderId = 802;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    await engine.handleMessage(message(senderId, 'Продали дачу. Звоните.'));

    await sleep(5);
    await engine.handleMessage(message(senderId, 'Пушкин'));

    expect(provider.chat).toHaveBeenCalledTimes(2);
    const firstRestyle = provider.chat.mock.calls[1][0];
    expect(firstRestyle).toContain('манера Александра Пушкина');
    expect(firstRestyle).toContain('Форма (обязательна): стихотворение');
    expect(firstRestyle).toContain('Продали дачу. Звоните.');
    expect(firstRestyle).not.toContain('Предыдущий вариант');
    expect(firstRestyle).not.toContain('Первый вариант');

    await sleep(5);
    await engine.handleMessage(message(senderId, 'Довлатов'));

    expect(provider.chat).toHaveBeenCalledTimes(3);
    const secondRestyle = provider.chat.mock.calls[2][0];
    expect(secondRestyle).toContain('манера Сергея Довлатова');
    expect(secondRestyle).not.toContain('стихотворение');
    expect(secondRestyle).toContain('Продали дачу. Звоните.');
    expect(secondRestyle).not.toContain('Первый вариант');

    const generation = profileStore.load(senderId).lastGeneration;
    expect(generation.input.preset).toBe('dovlatov');
    expect(generation.input.text).toBe('Продали дачу. Звоните.');
  });

  it('инлайн-кнопка стиля переделывает результат', async () => {
    const { engine, provider, profileStore, message } = makeHarness({ chatReply: 'Первый вариант' });
    const senderId = 803;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    await engine.handleMessage(message(senderId, 'Продали дачу. Звоните.'));

    const generation = profileStore.load(senderId).lastGeneration;
    await sleep(5);
    await engine.handleMessageEvent({
      userId: senderId,
      peerId: senderId,
      eventPayload: { a: 'preset', p: 'dovlatov', g: generation.id },
      answer: jest.fn(async () => {}),
      send: jest.fn(async () => {})
    });

    expect(provider.chat).toHaveBeenCalledTimes(2);
    const prompt = provider.chat.mock.calls[1][0];
    expect(prompt).toContain('манера Сергея Довлатова');
    expect(prompt).toContain('Продали дачу. Звоните.');
    expect(prompt).not.toContain('Первый вариант');
    expect(profileStore.load(senderId).lastGeneration.input.preset).toBe('dovlatov');
  });

  it('инлайн-кнопка стиля до текста запоминает стиль, «Я — автор» возвращает в раздел', async () => {
    const { engine, provider, message, callback } = makeHarness();
    const senderId = 806;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));

    const backEvent = callback(senderId, { a: 'back', pk: 'bloggers' });
    await engine.handleMessageEvent(backEvent);
    expect(backEvent.send.mock.calls[0][0]).toContain('Раздел для авторов');

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    await engine.handleMessageEvent(callback(senderId, { a: 'style', s: 'style_improve', p: 'poetic' }));

    await engine.handleMessage(message(senderId, 'Продали дачу. Звоните.'));
    expect(provider.chat.mock.calls[0][0]).toContain('поэтичный образный стиль');
  });

  it('кнопка стиля без результата запускает «Улучшить стиль» с выбранным стилем', async () => {
    const { engine, provider, message } = makeHarness();
    const senderId = 804;

    const presetMessage = message(senderId, 'Бродский');
    await engine.handleMessage(presetMessage);
    expect(presetMessage.send.mock.calls[0][0]).toContain('Стиль «Бродский» выбрал');

    await engine.handleMessage(message(senderId, 'Продали дачу. Звоните.'));
    const prompt = provider.chat.mock.calls[0][0];
    expect(prompt).toContain('манера Иосифа Бродского');
    expect(prompt).toContain('Форма (обязательна): стихотворение');
  });

  it('без пресета промпт не содержит блок стиля', async () => {
    const { engine, provider, message } = makeHarness();
    const senderId = 805;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    await engine.handleMessage(message(senderId, 'Продали дачу. Звоните.'));

    const prompt = provider.chat.mock.calls[0][0];
    expect(prompt).not.toContain('Стиль оформления');
  });
});

describe('движок: помощь по разделам', () => {
  it('«Помощь» после входа в раздел выдаёт инструкцию этого раздела', async () => {
    const { engine, message } = makeHarness();

    await engine.handleMessage(message(701, 'Я — автор'));
    const sectionHelp = message(701, 'Помощь');
    await engine.handleMessage(sectionHelp);
    expect(sectionHelp.send.mock.calls[0][0]).toContain('«Я — автор»');

    await engine.handleMessage(message(701, 'Главное меню'));
    const about = message(701, 'Помощь');
    await engine.handleMessage(about);
    expect(about.send.mock.calls[0][0]).toContain('ИИ-редактор');

    const directAbout = message(701, '/помощь');
    await engine.handleMessage(directAbout);
    expect(directAbout.send.mock.calls[0][0]).toContain('ИИ-редактор');
  });
});

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

  it('свободный чат прикладывает главное меню даже без /start', async () => {
    const { engine, message } = makeHarness();
    const context = message(608, 'привет');

    await engine.handleMessage(context);

    const options = context.send.mock.calls.at(-1)[1];
    const serialized = JSON.parse(options.keyboard.toString());
    const labels = serialized.buttons.flat().map((b) => b.action.label);

    expect(labels).toEqual(['Я — автор', 'Я — продавец', 'Обо мне']);
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
