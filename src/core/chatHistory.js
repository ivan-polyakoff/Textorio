const HOUR_MS = 60 * 60 * 1000;

// Сколько последних реплик (пользователь + бот) уходит в промпт.
const MAX_HISTORY_MESSAGES = 6;
// Ответы бота храним укороченными: для контекста достаточно начала.
const MAX_STORED_BOT_CHARS = 300;
// Реплики старше этого возраста из истории выпадают.
const HISTORY_TTL_MS = 2 * HOUR_MS;

const { excerpt } = require('./styleProfile');

const nowIso = () => new Date().toISOString();

function ensureChat(profile) {
  if (!profile.chat || !Array.isArray(profile.chat.messages)) {
    profile.chat = { messages: [] };
  }
  return profile.chat.messages;
}

// Отрезаем протухшие реплики; возвращает живой хвост истории.
function pruneExpired(profile, ttlMs = HISTORY_TTL_MS) {
  const messages = ensureChat(profile);
  const now = Date.now();

  profile.chat.messages = messages.filter((item) => {
    const at = Date.parse(item.at);
    return Number.isFinite(at) && now - at <= ttlMs;
  });

  return profile.chat.messages;
}

/**
 * Сохраняет пару «пользователь — бот» в историю чата.
 * @param {object} profile
 * @param {string} userText
 * @param {string} botText — финальный ответ (без отказов и ошибок)
 */
function appendPair(profile, userText, botText) {
  const messages = ensureChat(profile);
  const user = excerpt(userText, MAX_STORED_BOT_CHARS);
  const bot = excerpt(botText, MAX_STORED_BOT_CHARS);

  if (!user || !bot) return;

  messages.push({ role: 'user', text: user, at: nowIso() });
  messages.push({ role: 'bot', text: bot, at: nowIso() });
}

/**
 * История для промпта: живые реплики, не длиннее maxMessages.
 * @returns {Array<{role: 'user'|'bot', text: string}>}
 */
function getHistory(profile, { maxMessages = MAX_HISTORY_MESSAGES, ttlMs = HISTORY_TTL_MS } = {}) {
  const messages = pruneExpired(profile, ttlMs);
  return messages
    .slice(-maxMessages)
    .map(({ role, text }) => ({ role, text }));
}

/**
 * Транскрипт истории для вставки в промпт.
 */
function buildTranscript(messages) {
  return messages
    .map((item) => `${item.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${item.text}`)
    .join('\n');
}

function clearChat(profile) {
  profile.chat = { messages: [] };
}

module.exports = {
  appendPair,
  getHistory,
  buildTranscript,
  clearChat,
  pruneExpired,
  MAX_HISTORY_MESSAGES,
  MAX_STORED_BOT_CHARS,
  HISTORY_TTL_MS
};
