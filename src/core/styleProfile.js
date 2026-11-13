// Память стиля пользователя (этап 2).
//
// 👍 сохраняет одобренный пример текста, 👎/критика — замечание.
// Из последних замечаний и одобренного примера собирается короткий styleCard,
// который движок подмешивает в промпты генерации.
//
// Модуль чистый: получает профиль и меняет его поля, без записи на диск.

const MAX_LIKED = 5;
const MAX_DISLIKED = 5;
const MAX_STYLE_EXCERPTS = 3;
const MAX_EXCERPT_LENGTH = 400;
const MAX_LIKED_IN_HINT = 200;

const nowIso = () => new Date().toISOString();

function excerpt(text, maxLength = MAX_EXCERPT_LENGTH) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();

  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function ensureStyle(profile) {
  if (!profile.profile || typeof profile.profile !== 'object') {
    profile.profile = {};
  }

  if (!Array.isArray(profile.profile.liked)) {
    profile.profile.liked = [];
  }

  if (!Array.isArray(profile.profile.disliked)) {
    profile.profile.disliked = [];
  }

  if (profile.profile.styleCard === undefined) {
    profile.profile.styleCard = null;
  }

  return profile.profile;
}

function rebuildStyleCard(profile) {
  const data = ensureStyle(profile);
  const critiques = [];

  for (const item of data.disliked) {
    const critique = excerpt(item?.critique);
    if (critique && !critiques.includes(critique)) {
      critiques.push(critique);
    }
  }

  const liked = data.liked.length > 0
    ? excerpt(data.liked[data.liked.length - 1].text, MAX_LIKED_IN_HINT)
    : null;

  const parts = [];

  if (critiques.length > 0) {
    const last = critiques.slice(-MAX_STYLE_EXCERPTS).map((item) => `«${item}»`).join('; ');
    parts.push(`Пользователь просил: ${last}.`);
  }

  if (liked) {
    parts.push(`Одобренный пользователем пример стиля: «${liked}».`);
  }

  data.styleCard = parts.length > 0 ? parts.join(' ') : null;
  return data.styleCard;
}

/**
 * Запоминает одобренную генерацию (👍).
 * @param {object} profile
 * @param {object} generation — сохранённая lastGeneration
 */
function recordLike(profile, generation) {
  const data = ensureStyle(profile);

  // Память стиля учит только текстовые генерации: фото-критика описывает
  // содержимое конкретного кадра и не должна попадать в промпты.
  if (generation?.kind === 'photo') return data.styleCard;

  const text = excerpt(generation?.result);

  if (!text) return data.styleCard;

  const generationId = generation?.id || null;

  // Свежая оценка отменяет противоположную по той же генерации.
  if (generationId) {
    data.disliked = data.disliked.filter((item) => item.generationId !== generationId);
  }

  data.liked.push({
    text,
    generationId,
    skillId: generation?.skillId || null,
    at: nowIso()
  });
  data.liked = data.liked.slice(-MAX_LIKED);

  return rebuildStyleCard(profile);
}

/**
 * Запоминает неодобренную генерацию (👎/🔄 или текстовую критику).
 * @param {object} profile
 * @param {object} generation
 * @param {string} [critique] — замечание пользователя, если было
 */
function recordDislike(profile, generation, critique) {
  const data = ensureStyle(profile);

  // См. recordLike: фото-критика — про содержимое кадра, не про стиль текста.
  if (generation?.kind === 'photo') return data.styleCard;

  const note = excerpt(critique);

  const generationId = generation?.id || null;

  if (generationId) {
    data.liked = data.liked.filter((item) => item.generationId !== generationId);
  }

  const existingIndex = generationId
    ? data.disliked.findIndex((item) => item.generationId === generationId)
    : -1;

  if (existingIndex >= 0) {
    // 👎 без замечания и последующая критика — одна и та же реакция.
    if (note) data.disliked[existingIndex].critique = note;
    data.disliked[existingIndex].at = nowIso();
  } else {
    data.disliked.push({
      critique: note || null,
      generationId,
      skillId: generation?.skillId || null,
      at: nowIso()
    });
  }

  data.disliked = data.disliked.slice(-MAX_DISLIKED);

  return rebuildStyleCard(profile);
}

/**
 * Готовая подсказка для промпта или null, если предпочтений ещё нет.
 * @param {object} profile
 * @returns {string|null}
 */
function styleHint(profile) {
  return profile?.profile?.styleCard || null;
}

/**
 * Данные для команды «/мойстиль».
 * @param {object} profile
 */
function describeStyle(profile) {
  const data = ensureStyle(profile);
  const critiques = [];

  for (const item of data.disliked) {
    const critique = excerpt(item?.critique);
    if (critique && !critiques.includes(critique)) {
      critiques.push(critique);
    }
  }

  return {
    likedCount: data.liked.length,
    dislikedCount: data.disliked.length,
    critiques: critiques.slice(-MAX_STYLE_EXCERPTS),
    styleCard: data.styleCard,
    hasStyle: Boolean(data.styleCard)
  };
}

/**
 * Сбрасывает память стиля («/сброситьстиль»).
 * @param {object} profile
 */
function clearStyle(profile) {
  profile.profile = { liked: [], disliked: [], styleCard: null };
  return profile.profile;
}

module.exports = {
  recordLike,
  recordDislike,
  rebuildStyleCard,
  styleHint,
  describeStyle,
  clearStyle,
  excerpt
};
