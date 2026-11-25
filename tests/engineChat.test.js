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

function makeHarness({ chatReply = 'ОТВЕТ', logPrompts = false } = {}) {
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
    rateLimitMs: 1,
    logPrompts
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
    const cleared = JSON.parse(trigger.send.mock.calls[0][1].keyboard.toString());
    expect(cleared.buttons || []).toEqual([]);
    const triggerKeyboard = JSON.parse(trigger.send.mock.calls[1][1].keyboard.toString());
    expect(triggerKeyboard.inline).toBe(true);
    expect(labelsOf(trigger.send.mock.calls[1][1])).toEqual([
      '💼 Деловой', '☕ Неформальный', '🤝 Дружеский', '🌙 Поэтичный', '🔥 Патетический', '🚬 Довлатов', '📜 Пушкин', '🌊 Бродский', '❓ Помощь', '⬅️ Назад'
    ]);

    const presetMessage = message(senderId, 'Деловой');
    await engine.handleMessage(presetMessage);
    expect(presetMessage.send.mock.calls[0][0]).toContain('Стиль «Деловой» выбрал');

    const textMessage = message(senderId, 'Продали дачу. Звоните.');
    await engine.handleMessage(textMessage);

    expect(provider.chat).toHaveBeenCalledTimes(1);
    const prompt = provider.chat.mock.calls[0][0];
    expect(prompt).toContain('Ты — высококвалифицированный корпоративный секретарь');
    expect(prompt).toContain('Пунктуация и оформление');
    expect(prompt).toContain('Задачи (подстрой под текст');
    expect(prompt).toContain('Продали дачу. Звоните.');

    const resultKeyboard = JSON.parse(textMessage.send.mock.calls[0][1].keyboard.toString());
    expect(resultKeyboard.inline).toBe(true);
    expect(resultKeyboard.buttons.flat().some((b) => {
      const payload = typeof b.action.payload === 'string' ? JSON.parse(b.action.payload) : b.action.payload;
      return payload.a === 'preset';
    })).toBe(false);

    expect(textMessage.send.mock.calls[1][0]).toContain('другом стиле');
    const keyboard = JSON.parse(textMessage.send.mock.calls[1][1].keyboard.toString());
    expect(keyboard.inline).toBe(true);
    expect(keyboard.buttons.flat().length).toBeLessThanOrEqual(10);
    const presetButtons = keyboard.buttons.flat().filter((b) => {
      const payload = typeof b.action.payload === 'string' ? JSON.parse(b.action.payload) : b.action.payload;
      return payload.a === 'style';
    });
    expect(presetButtons.map((b) => b.action.label)).toEqual([
      '💼 Деловой', '☕ Неформальный', '🤝 Дружеский', '🌙 Поэтичный', '🔥 Патетический', '🚬 Довлатов', '📜 Пушкин', '🌊 Бродский'
    ]);

    const generation = profileStore.load(senderId).lastGeneration;
    expect(generation.input.preset).toBe('strict');

    await sleep(5);
    await engine.handleMessageEvent({ userId: senderId, peerId: senderId, eventPayload: { a: 'regen', g: generation.id }, answer: jest.fn(async () => {}), send: jest.fn(async () => {}) });

    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(provider.chat.mock.calls[1][0]).toContain('Ты — высококвалифицированный корпоративный секретарь');
  });

  it('кнопка стиля после результата переделывает исходный текст, а не предыдущий вариант', async () => {
    const { engine, provider, profileStore, message, callback } = makeHarness({ chatReply: 'Первый вариант' });
    const senderId = 802;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    await engine.handleMessage(message(senderId, 'Продали дачу. Звоните.'));

    await sleep(5);
    const pushkinMessage = message(senderId, 'Пушкин');
    await engine.handleMessage(pushkinMessage);
    expect(pushkinMessage.send.mock.calls[0][0]).toContain('Стихами или прозой');

    const firstGeneration = profileStore.load(senderId).lastGeneration;
    await engine.handleMessageEvent(callback(senderId, {
      a: 'verse', v: 'poem', s: 'style_improve', p: 'pushkin', g: firstGeneration.id
    }));

    expect(provider.chat).toHaveBeenCalledTimes(2);
    const firstRestyle = provider.chat.mock.calls[1][0];
    expect(firstRestyle).toContain('Ты — Александр Сергеевич Пушкин');
    expect(firstRestyle).toContain('Лексика:');
    expect(firstRestyle).toContain('Синтаксис:');
    expect(firstRestyle).toContain('Задачи (подстрой под текст');
    expect(firstRestyle).toContain('Милостивый государь');
    expect(firstRestyle).toContain('Форма (обязательна): стихотворение');
    expect(firstRestyle).toContain('Продали дачу. Звоните.');
    expect(firstRestyle).not.toContain('Предыдущий вариант');
    expect(firstRestyle).not.toContain('Первый вариант');

    expect(profileStore.load(senderId).lastGeneration.input.verse).toBe(true);

    await sleep(5);
    await engine.handleMessage(message(senderId, 'Довлатов'));

    expect(provider.chat).toHaveBeenCalledTimes(3);
    const secondRestyle = provider.chat.mock.calls[2][0];
    expect(secondRestyle).toContain('Ты — Сергей Донатович Довлатов');
    expect(secondRestyle).toContain('Композиция и оптика');
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
    expect(prompt).toContain('Ты — Сергей Донатович Довлатов');
    expect(prompt).toContain('Продали дачу. Звоните.');
    expect(prompt).not.toContain('Первый вариант');
    expect(profileStore.load(senderId).lastGeneration.input.preset).toBe('dovlatov');
  });

  it('кнопка «Помощь» в меню стилей показывает описания', async () => {
    const { engine, message, callback } = makeHarness();
    const senderId = 808;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));

    const helpEvent = callback(senderId, { a: 'styleHelp', s: 'style_improve' });
    await engine.handleMessageEvent(helpEvent);

    const text = helpEvent.send.mock.calls[0][0];
    expect(text).toContain('Готовые стили');
    expect(text).toContain('Неформальный деловой стиль (Human-to-Human)');
    expect(text).toContain('Стиль Пушкина');
    expect(text).toContain('Дружеский стиль (Personal / Casual)');
  });

  it('инлайн-кнопка стиля до текста запоминает стиль, «Назад» возвращает в раздел', async () => {
    const { engine, provider, message, callback } = makeHarness();
    const senderId = 806;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));

    const backEvent = callback(senderId, { a: 'back', pk: 'bloggers' });
    await engine.handleMessageEvent(backEvent);
    expect(backEvent.send.mock.calls[0][0]).toContain('Раздел для авторов');

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    await engine.handleMessageEvent(callback(senderId, { a: 'style', s: 'style_improve', p: 'poetic' }));

    await engine.handleMessage(message(senderId, 'Продали дачу. Звоните.'));
    expect(provider.chat.mock.calls[0][0]).toContain('увеличительное стекло');
  });

  it('эхо промпта от модели не показывается, просим текст заново', async () => {
    const { engine, message, callback } = makeHarness({
      chatReply: 'Ты — Сергей Донатович Довлатов.\n\nЧитатель спросил про безопасность.'
    });
    const senderId = 811;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    await engine.handleMessageEvent(callback(senderId, { a: 'style', s: 'style_improve', p: 'dovlatov' }));
    const textMessage = message(senderId, 'Продали дачу. Звоните.');
    await engine.handleMessage(textMessage);

    const reply = textMessage.send.mock.calls[0][0];
    expect(reply).toContain('Пришлите, пожалуйста, свой текст ещё раз');
    expect(reply).not.toContain('Сергей Донатович');
  });

  it('роль в конце ответа тоже ловится — просим текст заново', async () => {
    const { engine, message, callback } = makeHarness({
      chatReply: 'Выпало задание — обработай запрос, не вышло никак. Пробуем ещё раз — вот так правильней!\n\n___\n\nТы — Сергей Донатович Довлатов.'
    });
    const senderId = 812;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    await engine.handleMessageEvent(callback(senderId, { a: 'style', s: 'style_improve', p: 'dovlatov' }));
    const textMessage = message(senderId, 'Продали дачу. Звоните.');
    await engine.handleMessage(textMessage);

    const reply = textMessage.send.mock.calls[0][0];
    expect(reply).toContain('Пришлите, пожалуйста, свой текст ещё раз');
    expect(reply).not.toContain('Сергей Донатович');
  });

  it('кнопка стиля под результатом сразу переделывает текст, не прося новый', async () => {
    const { engine, provider, message, callback } = makeHarness({ chatReply: 'Первый вариант' });
    const senderId = 810;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    await engine.handleMessage(message(senderId, 'Продали дачу. Звоните.'));
    expect(provider.chat).toHaveBeenCalledTimes(1);

    await sleep(5);
    const styleEvent = callback(senderId, { a: 'style', s: 'style_improve', p: 'casual' });
    await engine.handleMessageEvent(styleEvent);

    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(provider.chat.mock.calls[1][0]).toContain('тимлид');
    expect(styleEvent.send.mock.calls.every((call) => !String(call[0]).includes('пришлите текст'))).toBe(true);
  });

  it('Пушкин спрашивает форму: проза даёт прозаический промпт', async () => {
    const { engine, provider, message, callback } = makeHarness();
    const senderId = 807;

    await engine.handleMessage(message(senderId, 'Улучшить стиль'));
    const pushkin = message(senderId, 'Пушкин');
    await engine.handleMessage(pushkin);
    expect(pushkin.send.mock.calls[0][0]).toContain('Стихами или прозой');

    await engine.handleMessageEvent(callback(senderId, { a: 'verse', v: 'prose', s: 'style_improve', p: 'pushkin' }));
    await engine.handleMessage(message(senderId, 'Продали дачу. Звоните.'));

    const prompt = provider.chat.mock.calls[0][0];
    expect(prompt).toContain('Ты — Александр Сергеевич Пушкин');
    expect(prompt).toContain('Форма (обязательна): проза');
    expect(prompt).not.toContain('Форма (обязательна): стихотворение');
  });

  it('кнопка стиля без результата запускает «Улучшить стиль» с выбранным стилем', async () => {
    const { engine, provider, message } = makeHarness();
    const senderId = 804;

    const presetMessage = message(senderId, 'Бродский');
    await engine.handleMessage(presetMessage);
    expect(presetMessage.send.mock.calls[0][0]).toContain('Стихами или прозой');

    await engine.handleMessageEvent({ userId: senderId, peerId: senderId, eventPayload: { a: 'verse', v: 'poem', s: 'style_improve', p: 'brodsky' }, answer: jest.fn(async () => {}), send: jest.fn(async () => {}) });
    await engine.handleMessage(message(senderId, 'Продали дачу. Звоните.'));
    const prompt = provider.chat.mock.calls[0][0];
    expect(prompt).toContain('Ты — Иосиф Бродский');
    expect(prompt).toContain('Композиция и оптика');
    expect(prompt).toContain('Задачи (подстрой под текст');
    expect(prompt).toContain('Форма (обязательна): стихотворение');
  });

  it('logPrompts: промпт пишется в журнал только при включённом флаге', async () => {
    const { engine, message } = makeHarness({ logPrompts: true });
    const senderId = 830;
    const logSpy = jest.spyOn(require('../src/utils/logger').logger, 'log');

    await engine.handleMessage(message(senderId, '/пост тема про ёжика'));
    await sleep(5);

    const promptLines = logSpy.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('Промпт ['));

    expect(promptLines).toHaveLength(1);
    expect(promptLines[0]).toContain('post_topic');
    expect(promptLines[0]).toContain('тема про ёжика');
    logSpy.mockRestore();
  });

  it('по умолчанию промпты в журнал не пишутся', async () => {
    const { engine, message } = makeHarness();
    const senderId = 831;
    const logSpy = jest.spyOn(require('../src/utils/logger').logger, 'log');

    await engine.handleMessage(message(senderId, '/пост тема про ёжика'));
    await sleep(5);

    expect(logSpy.mock.calls.map((call) => String(call[0])).some((line) => line.startsWith('Промпт ['))).toBe(false);
    logSpy.mockRestore();
  });

  it('пост: тема → вопрос деталей; текст с деталями попадает в промпт', async () => {
    const { engine, provider, message, callback } = makeHarness({ chatReply: 'Уронил пульт с утра' });
    const senderId = 820;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    const topicMessage = message(senderId, 'Сегодня всё успел');
    await engine.handleMessage(topicMessage);

    const kb = JSON.parse(topicMessage.send.mock.calls[0][1].keyboard.toString());
    const labels = kb.buttons.flat().map((b) => b.action.label);
    expect(labels).toEqual(['🎲 Придумай сам']);

    await engine.handleMessage(message(senderId, 'проспал, за окном слякоть'));
    expect(provider.chat).toHaveBeenCalledTimes(1);
    const prompt = provider.chat.mock.calls[0][0];
    expect(prompt).toContain('личного блога');
    expect(prompt).toContain('Введение (состояние "до")');
    expect(prompt).toContain('проспал, за окном слякоть');
    expect(prompt).not.toContain('вопрос читателю');
  });

  it('пост: «Придумай сам» генерит по теме без деталей', async () => {
    const { engine, provider, message, callback } = makeHarness({ chatReply: 'Уронил пульт с утра' });
    const senderId = 821;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await engine.handleMessage(message(senderId, 'Сегодня всё успел'));
    await engine.handleMessageEvent(callback(senderId, { a: 'postctx', s: 'post_topic' }));

    expect(provider.chat).toHaveBeenCalledTimes(1);
    const prompt = provider.chat.mock.calls[0][0];
    expect(prompt).toContain('Сегодня всё успел');
    expect(prompt).toContain('Пиши строго по теме');
    // Никаких предустановленных деталей сцены в промпте быть не должно.
    expect(prompt).not.toContain('недосыпа');
    expect(prompt).not.toContain('кружк');
    expect(prompt).not.toContain('слякоть');
  });

  it('пост: после генерации сразу предложено меню стилей', async () => {
    const { engine, message } = makeHarness({ chatReply: 'Готовый пост' });
    const senderId = 834;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await engine.handleMessage(message(senderId, 'Сегодня всё успел'));
    const resultMessage = message(senderId, 'проспал, слякоть');
    await engine.handleMessage(resultMessage);

    const stylesMessage = resultMessage.send.mock.calls.find((call) => String(call[0]).startsWith('Можно переделать'));
    expect(stylesMessage).toBeTruthy();

    const keyboard = JSON.parse(stylesMessage[1].keyboard.toString());
    const labels = keyboard.buttons.flat().map((b) => b.action.label);
    expect(labels).toContain('💼 Деловой');
    expect(labels).toContain('❓ Помощь');
    expect(labels).not.toContain('⬅️ Назад');
  });

  it('пост: кнопка стиля под результатом перегенерирует пост в этом стиле', async () => {
    const { engine, provider, profileStore, message, callback } = makeHarness({ chatReply: 'Готовый пост' });
    const senderId = 835;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await engine.handleMessage(message(senderId, 'Сегодня всё успел'));
    await engine.handleMessage(message(senderId, 'проспал, слякоть'));

    const generation = profileStore.load(senderId).lastGeneration;
    await sleep(10);
    await engine.handleMessageEvent(callback(senderId, { a: 'preset', p: 'dovlatov', g: generation.id }));
    await sleep(10);

    expect(provider.chat).toHaveBeenCalledTimes(2);
    const restylePrompt = provider.chat.mock.calls[1][0];
    expect(restylePrompt).toContain('Стиль оформления (обязателен)');
    expect(restylePrompt).toContain('проспал, слякоть');
    expect(restylePrompt).toContain('Сегодня всё успел');

    const updated = profileStore.load(senderId).lastGeneration;
    expect(updated.input.preset).toBe('dovlatov');
    expect(updated.skillId).toBe('post_topic');
  });

  it('пост: правка после смены стиля сохраняет стиль', async () => {
    const { engine, provider, profileStore, message, callback } = makeHarness({ chatReply: 'Готовый пост' });
    const senderId = 837;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await engine.handleMessage(message(senderId, 'Сегодня всё успел'));
    await engine.handleMessage(message(senderId, 'проспал, слякоть'));

    const generation = profileStore.load(senderId).lastGeneration;
    await sleep(10);
    await engine.handleMessageEvent(callback(senderId, { a: 'preset', p: 'dovlatov', g: generation.id }));
    await sleep(10);

    const restyled = profileStore.load(senderId).lastGeneration;
    await sleep(10);
    await engine.handleMessageEvent(callback(senderId, { a: 'regen', g: restyled.id }));
    await sleep(10);

    const revisionPrompt = provider.chat.mock.calls[2][0];
    expect(revisionPrompt).toContain('Стиль оформления (обязателен)');
    expect(revisionPrompt).toContain('Довлатов');
  });

  it('пост: справка по стилям доступна под результатом', async () => {
    const { engine, message, callback } = makeHarness({ chatReply: 'Готовый пост' });
    const senderId = 836;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await engine.handleMessage(message(senderId, 'Сегодня всё успел'));
    await engine.handleMessage(message(senderId, 'проспал, слякоть'));

    const help = callback(senderId, { a: 'styleHelp', s: 'post_topic' });
    await engine.handleMessageEvent(help);

    const helpText = help.send.mock.calls.map((call) => call[0]).find((text) => String(text).includes('Готовые стили'));
    expect(helpText).toBeTruthy();
  });

  it('пост: «Придумай сам» → генерация сохранена под пользователем, 🔄 работает', async () => {
    const { engine, provider, profileStore, message, callback } = makeHarness({ chatReply: 'Первый вариант' });
    const senderId = 832;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await engine.handleMessage(message(senderId, 'Сегодня всё успел'));
    await engine.handleMessageEvent(callback(senderId, { a: 'postctx', s: 'post_topic' }));

    const generation = profileStore.load(senderId).lastGeneration;
    expect(generation).toBeTruthy();
    expect(profileStore.load(undefined).lastGeneration).toBeFalsy();

    await sleep(10);
    const regen = callback(senderId, { a: 'regen', g: generation.id });
    await engine.handleMessageEvent(regen);
    await sleep(10);

    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(regen.answer.mock.calls.map((call) => call[0])).not.toContain('Контекст устарел — сгенерируйте заново');
  });

  it('пост: перегенерация сохраняет вводные автора', async () => {
    const { engine, provider, message, callback, profileStore } = makeHarness({ chatReply: 'Первый вариант' });
    const senderId = 833;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await engine.handleMessage(message(senderId, 'Сегодня всё успел'));
    await engine.handleMessage(message(senderId, 'проспал, за окном слякоть'));

    const generation = profileStore.load(senderId).lastGeneration;
    await sleep(10);
    await engine.handleMessageEvent(callback(senderId, { a: 'regen', g: generation.id }));
    await sleep(10);

    const revisionPrompt = provider.chat.mock.calls[1][0];
    expect(revisionPrompt).toContain('проспал, за окном слякоть');
  });

  it('пост: «/пост тема» генерит сразу, тема идёт вводными', async () => {
    const { engine, provider, message } = makeHarness({ chatReply: 'Уронил пульт с утра' });
    const senderId = 822;

    await engine.handleMessage(message(senderId, '/пост сегодня всё успел'));

    expect(provider.chat).toHaveBeenCalledTimes(1);
    const prompt = provider.chat.mock.calls[0][0];
    expect(prompt).toContain('сегодня всё успел');
    expect(prompt).toContain('личного блога');
  });

  it('под результатом нет «Назад» — только реакции', async () => {
    const { engine, message } = makeHarness();
    const senderId = 809;

    await engine.handleMessage(message(senderId, 'Создать пост'));
    await engine.handleMessage(message(senderId, 'тема про ёжика'));
    const resultMessage = message(senderId, 'утро, слякоть');
    await engine.handleMessage(resultMessage);

    const keyboard = JSON.parse(resultMessage.send.mock.calls[0][1].keyboard.toString());
    const hasBack = keyboard.buttons.flat().some((b) => {
      const payload = typeof b.action.payload === 'string' ? JSON.parse(b.action.payload) : b.action.payload;
      return payload.a === 'back';
    });
    expect(hasBack).toBe(false);
    expect(keyboard.buttons.flat().map((b) => b.action.label)).toEqual(['👍', '👎', '🔄 Заново']);
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

    expect(labels).toEqual(['✍️ Я — автор', '🛒 Я — продавец', 'ℹ️ О проекте «Тексторио»']);
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
