// Санкции за нарушения цензуры (этап 2).
//
// Счётчик срабатываний блоклиста хранится в профиле:
//   moderation: { strikes: [{ category, at }], blockedUntil: null }
// N нарушений за окно → временная блокировка (тишина для пользователя).
// Санкции применяются только к однозначным нарушениям (жёсткий блоклист);
// неоднозначные темы, которые решает модель, сюда не попадают.

const HOUR_MS = 60 * 60 * 1000;

const DEFAULT_POLICY = {
  strikeLimit: 3,
  strikeWindowMs: 24 * HOUR_MS,
  blockMs: 24 * HOUR_MS
};

function resolvePolicy(policy = {}) {
  return {
    strikeLimit: policy.strikeLimit || DEFAULT_POLICY.strikeLimit,
    strikeWindowMs: policy.strikeWindowMs || DEFAULT_POLICY.strikeWindowMs,
    blockMs: policy.blockMs || DEFAULT_POLICY.blockMs
  };
}

function ensureModeration(profile) {
  if (!profile.moderation || typeof profile.moderation !== 'object') {
    profile.moderation = {};
  }

  if (!Array.isArray(profile.moderation.strikes)) {
    profile.moderation.strikes = [];
  }

  if (profile.moderation.blockedUntil === undefined) {
    profile.moderation.blockedUntil = null;
  }

  return profile.moderation;
}

function pruneStrikes(moderation, now, windowMs) {
  moderation.strikes = moderation.strikes.filter((strike) => {
    const at = Date.parse(strike?.at || '');
    return Number.isFinite(at) && now - at <= windowMs;
  });
}

/**
 * Заблокирован ли пользователь сейчас.
 * @param {object} profile
 * @param {number} [now]
 * @returns {boolean}
 */
function isBlocked(profile, now = Date.now()) {
  const until = Date.parse(profile?.moderation?.blockedUntil || '');
  return Number.isFinite(until) && until > now;
}

/**
 * Регистрирует нарушение. При достижении лимита ставит временную блокировку
 * и обнуляет счётчик (после блокировки — чистый лист).
 * @param {object} profile
 * @param {string} category
 * @param {object} [policy]
 * @param {number} [now]
 * @returns {{blocked: boolean, until: string|null, count: number}}
 */
function registerStrike(profile, category, policy = DEFAULT_POLICY, now = Date.now()) {
  const config = resolvePolicy(policy);
  const moderation = ensureModeration(profile);

  pruneStrikes(moderation, now, config.strikeWindowMs);
  moderation.strikes.push({
    category,
    at: new Date(now).toISOString()
  });

  if (moderation.strikes.length >= config.strikeLimit) {
    const until = new Date(now + config.blockMs).toISOString();

    moderation.blockedUntil = until;
    moderation.strikes = [];

    return { blocked: true, until, count: config.strikeLimit };
  }

  return { blocked: false, until: null, count: moderation.strikes.length };
}

/**
 * Ручная блокировка администратором.
 * @param {object} profile
 * @param {string} untilIso
 */
function banUser(profile, untilIso) {
  const moderation = ensureModeration(profile);

  moderation.blockedUntil = untilIso;
  moderation.strikes = [];
  return moderation;
}

/**
 * Снятие блокировки.
 * @param {object} profile
 */
function unblockUser(profile) {
  const moderation = ensureModeration(profile);

  moderation.blockedUntil = null;
  moderation.strikes = [];
  return moderation;
}

module.exports = {
  HOUR_MS,
  DEFAULT_POLICY,
  isBlocked,
  registerStrike,
  banUser,
  unblockUser
};
