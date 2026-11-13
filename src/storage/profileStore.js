// Хранилище пользовательских профилей: один JSON-файл на пользователя
// в каталоге data/profiles/. Запись атомарная (tmp + rename), чтение
// кэшируется в памяти на время жизни процесса.
//
// Схема профиля:
// {
//   userId, createdAt, lastActiveAt,
//   tier: { level: 'premium'|'free', source: 'legacy'|'manual'|'donut', grantedAt },
//   lastGeneration: { id, skillId, kind, input, result, feedbacks, createdAt } | null,
//   profile: { liked: [], disliked: [], styleCard: null },   // память стиля
//   chat: { messages: [{ role, text, at }] },                // история свободного чата
//   moderation: { strikes: [], blockedUntil: null }          // санкции за нарушения
// }
//
// Пока все новые пользователи получают legacy-премиум (первая волна);
// главный выключатель и free-тир — следующий этап.

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const nowIso = () => new Date().toISOString();

function blankProfile(userId) {
  const at = nowIso();

  return {
    userId,
    createdAt: at,
    lastActiveAt: at,
    tier: { level: 'premium', source: 'legacy', grantedAt: at },
    lastGeneration: null,
    profile: { liked: [], disliked: [], styleCard: null },
    chat: { messages: [] },
    moderation: { strikes: [], blockedUntil: null }
  };
}

function createProfileStore({ dataDir }) {
  if (!dataDir) {
    throw new Error('createProfileStore: dataDir обязателен');
  }

  const dir = path.join(dataDir, 'profiles');
  const cache = new Map();

  function fileFor(userId) {
    return path.join(dir, `${userId}.json`);
  }

  function load(userId) {
    const key = String(userId);

    if (cache.has(key)) {
      return cache.get(key);
    }

    let profile;

    try {
      const raw = fs.readFileSync(fileFor(key), 'utf8');
      const data = JSON.parse(raw);
      const fresh = blankProfile(key);

      profile = {
        ...fresh,
        ...data,
        tier: { ...fresh.tier, ...(data.tier || {}) },
        profile: { ...fresh.profile, ...(data.profile || {}) },
        chat: { ...fresh.chat, ...(data.chat || {}) },
        moderation: { ...fresh.moderation, ...(data.moderation || {}) }
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Повреждённый файл не должен ронять бота: начинаем с чистого профиля.
        logger.warn(`Профиль ${key} не читается (${error.message}), начинаю с чистого.`);
      }
      profile = blankProfile(key);
    }

    cache.set(key, profile);
    return profile;
  }

  function save(profile) {
    fs.mkdirSync(dir, { recursive: true });

    const file = fileFor(String(profile.userId));
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;

    fs.writeFileSync(tmp, JSON.stringify(profile, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    cache.set(String(profile.userId), profile);
  }

  // Фиксируем активность (для ретеншена неактивных профилей).
  function touch(userId) {
    const profile = load(userId);
    profile.lastActiveAt = nowIso();
    save(profile);
    return profile;
  }

  function deleteContent(userId) {
    const profile = load(userId);
    const fresh = blankProfile(String(profile.userId));

    profile.lastGeneration = null;
    profile.profile = { ...fresh.profile };
    profile.chat = { ...fresh.chat };
    save(profile);
    return profile;
  }

  function forget(userId) {
    cache.delete(String(userId));
    try {
      fs.unlinkSync(fileFor(String(userId)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  // Обход всех сохранённых профилей (для фоновых задач: ретеншен, напоминания).
  // Файлы в каталоге — единственный источник истины: кэш может быть неполным.
  function forEach(callback) {
    let entries = [];

    try {
      entries = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }

    for (const name of entries) {
      const userId = name.replace(/\.json$/, '');

      try {
        const raw = fs.readFileSync(path.join(dir, name), 'utf8');
        callback(JSON.parse(raw), userId);
      } catch (error) {
        logger.warn(`Профиль ${name} пропущен при обходе: ${error.message}`);
      }
    }
  }

  function count() {
    try {
      return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).length;
    } catch (error) {
      if (error.code === 'ENOENT') return 0;
      throw error;
    }
  }

  return {
    load,
    save,
    touch,
    deleteContent,
    forget,
    forEach,
    count,
    dir
  };
}

module.exports = {
  createProfileStore,
  blankProfile
};
