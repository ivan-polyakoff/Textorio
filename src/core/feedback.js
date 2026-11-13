// Распознавание короткой текстовой реакции на последний пост
// («плохо», «ещё раз», «переделай …») — в дополнение к кнопкам 👍/👎/🔄.
//
// Правила, чтобы не цеплять обычную болтовню:
//   - фраза должна начинаться с ключевого слова (или быть одиночным словом с ним);
//   - ≤ 2 слов — вариация без критики; длиннее — вся фраза считается критикой.

const FEEDBACK_PATTERNS = [
  'плохо',
  'не то',
  'не нравится',
  'не понравилось',
  'не годится',
  'не заходит',
  'заново',
  'заного',
  'ещё раз',
  'еще раз',
  'снова',
  'переделай',
  'переделать',
  'перепиши',
  'попробуй ещё раз'
];

const VARIATION_MAX_WORDS = 2;

/**
 * @param {string} text — сообщение пользователя
 * @returns {null | {type: 'variation'|'critique', critique: string|null}}
 *          null — это не реакция на генерацию
 */
function detectFeedback(text) {
  const value = String(text || '').trim();

  if (!value) return null;

  const lower = value.toLowerCase();
  const startsWithHit = FEEDBACK_PATTERNS.find((pattern) => lower.startsWith(pattern));

  if (!startsWithHit) {
    // «плохо», «заново» — одиночное слово-реакция без точки старта фразы.
    const words = lower.split(/\s+/);
    const singleWordHit = words.length === 1 && FEEDBACK_PATTERNS.some((p) => words[0].includes(p));

    return singleWordHit ? { type: 'variation', critique: null } : null;
  }

  const wordCount = lower.split(/\s+/).length;

  if (wordCount <= VARIATION_MAX_WORDS) {
    return { type: 'variation', critique: null };
  }

  return { type: 'critique', critique: value };
}

module.exports = {
  detectFeedback,
  FEEDBACK_PATTERNS
};
