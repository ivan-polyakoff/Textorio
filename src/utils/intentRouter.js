// Распознавание намерения в свободном тексте: «улучши вот это…», «напиши пост про…»
// работают как аналог нажатия соответствующей кнопки.
// Правила проверяются по порядку: сначала более специфичные (фото раньше темы поста).
// Внимание: \b и \w в JS не работают с кириллицей, поэтому границы слов —
// через lookahead (?![а-яё]).

const WORD_END = '(?![а-яё])';

const INTENT_RULES = [
  {
    intent: 'photo_post',
    patterns: [
      new RegExp(`^(?:напиши|сделай|создай)?\\s*пост\\s+по\\s+(?:фото|картинк[а-яё]*)${WORD_END}`, 'i')
    ]
  },
  {
    intent: 'post_topic',
    patterns: [
      // Исключаем «пост по фото» — это отдельный интент.
      new RegExp(`^(?:напиши|сделай|создай|подготовь)?\\s*пост${WORD_END}(?!\\s+по\\s+(?:фото|картинк[а-яё]*))`, 'i')
    ]
  },
  {
    intent: 'style_improve',
    patterns: [
      // «улучши», «улучшите», «улучшить», но не «улучшение»
      new RegExp(`^улучш(?:и|ите|ить)${WORD_END}`, 'i')
    ]
  },
  {
    intent: 'product_description',
    patterns: [
      new RegExp(`^опиши\\s+товар${WORD_END}`, 'i'),
      new RegExp(`^(?:напиши|сделай|составь|создай)?\\s*описани[ея]\\s+(?:товар[ау]|продукт[ау]?)${WORD_END}`, 'i')
    ]
  },
  {
    intent: 'ad_text',
    patterns: [
      // «реклама», «рекламу», но не «рекламный»
      new RegExp(`^(?:напиши|сделай|создай|составь)?\\s*реклам[ау]${WORD_END}`, 'i')
    ]
  },
  {
    intent: 'client_reply',
    patterns: [
      new RegExp(`^(?:напиши|подготовь|сделай)?\\s*ответ(?:ь|ить|ьте)?${WORD_END}\\s+клиент[уа]${WORD_END}`, 'i')
    ]
  }
];

// Хвост после ключевой фразы считаем аргументом, если он достаточно длинный.
const MIN_ARGUMENT_LENGTH = 2;

function detectIntent(text) {
  const trimmed = (text || '').trim();

  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;

      const rest = trimmed
        .slice(match[0].length)
        .replace(/^[\s:;,.!?—–-]+/, '');

      return {
        intent: rule.intent,
        argument: rest.length >= MIN_ARGUMENT_LENGTH ? rest : ''
      };
    }
  }

  return null;
}

module.exports = {
  detectIntent
};
