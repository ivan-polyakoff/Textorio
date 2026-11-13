const {
  appendPair,
  getHistory,
  buildTranscript,
  clearChat,
  pruneExpired,
  MAX_HISTORY_MESSAGES,
  MAX_STORED_BOT_CHARS,
  HISTORY_TTL_MS
} = require('../src/core/chatHistory');

function blank() {
  return { chat: { messages: [] } };
}

describe('история свободного чата', () => {
  it('сохраняет пары пользователь—бот и собирает транскрипт', () => {
    const profile = blank();

    appendPair(profile, 'привет', 'Привет! Чем помочь?');
    appendPair(profile, 'напиши слоган', 'Вот вариант…');

    expect(profile.chat.messages).toHaveLength(4);
    expect(profile.chat.messages[0]).toEqual({ role: 'user', text: 'привет', at: expect.any(String) });

    const transcript = buildTranscript(getHistory(profile));

    expect(transcript).toContain('Пользователь: привет');
    expect(transcript).toContain('Ассистент: Привет! Чем помочь?');
  });

  it('обрезает сохраняемые ответы до 300 символов', () => {
    const profile = blank();

    appendPair(profile, 'вопрос', 'б'.repeat(500));

    expect(profile.chat.messages[1].text.length).toBe(MAX_STORED_BOT_CHARS);
  });

  it('не сохраняет пустые реплики', () => {
    const profile = blank();

    appendPair(profile, '', 'ответ');
    appendPair(profile, 'вопрос', '');

    expect(profile.chat.messages).toHaveLength(0);
  });

  it('getHistory отдаёт не больше 6 последних реплик', () => {
    const profile = blank();

    for (let index = 0; index < 5; index += 1) {
      appendPair(profile, `вопрос ${index}`, `ответ ${index}`);
    }

    const history = getHistory(profile);

    expect(history).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(history[0].text).toBe('вопрос 2');
  });

  it('реплики старше TTL выпадают', () => {
    const profile = blank();
    const old = new Date(Date.now() - HISTORY_TTL_MS - 1000).toISOString();

    profile.chat.messages.push({ role: 'user', text: 'древнее', at: old });
    profile.chat.messages.push({ role: 'bot', text: 'древний ответ', at: old });

    appendPair(profile, 'свежее', 'свежий ответ');

    const history = getHistory(profile);

    expect(history).toHaveLength(2);
    expect(history[0].text).toBe('свежее');
  });

  it('повреждённые метки времени отбрасываются, профиль не роняется', () => {
    const profile = { chat: { messages: [{ role: 'user', text: 'битая', at: 'не дата' }] } };

    expect(getHistory(profile)).toEqual([]);
  });

  it('clearChat очищает историю', () => {
    const profile = blank();

    appendPair(profile, 'вопрос', 'ответ');
    clearChat(profile);

    expect(profile.chat.messages).toHaveLength(0);
    expect(getHistory(profile)).toEqual([]);
  });

  it('pruneExpired чистит протухшее на месте', () => {
    const profile = blank();
    const old = new Date(Date.now() - HISTORY_TTL_MS - 1000).toISOString();

    profile.chat.messages.push({ role: 'user', text: 'древнее', at: old });

    pruneExpired(profile);

    expect(profile.chat.messages).toHaveLength(0);
  });
});
