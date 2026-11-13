// Цензура входа и подмена отказов модели.
//
// Многослойная схема:
//   1. Жёсткий блоклист — только однозначные формулировки (суицид, теракт,
//      изготовление бомбы/оружия/наркотиков, порно, инструкции по убийству).
//      Неоднозначные глаголы («убить», «взорвать») сюда НЕ входят: их
//      различает модель по контексту («убить время» — можно).
//   2. Нормализация перед матчингом: регистр, ё→е, латиница/транслит,
//      гомоглифы, пунктуация. Стемы вместо точных словоформ.
//   3. Зелёный список: безопасные фразы, внутри которых совпадение
//      блоклиста игнорируется («убить себя на работе»).
//   4. Распознавание типовых отказов модели — движок подменяет их
//      вежливым шаблоном (для суицида/селфхарма — с телефоном доверия).
//
// Категории: suicide, terrorism, weapons, drugs, sexual, violence.

const {
  HELPLINE,
  GENERAL_REFUSAL_TEXT,
  SUICIDE_REFUSAL_TEXT
} = require('../config/safety');

// --- Нормализация ---

// Латиница → кириллица: транслит и одновременно гомоглифы (c/с, o/о, p/р…).
// Диграфы проверяются раньше одиночных букв.
const TRANSLIT_PAIRS = [
  ['shch', 'щ'],
  ['sch', 'щ'],
  ['dzh', 'дж'],
  ['sh', 'ш'],
  ['ch', 'ч'],
  ['zh', 'ж'],
  ['kh', 'х'],
  ['ts', 'ц'],
  ['yo', 'е'],
  ['yu', 'ю'],
  ['ya', 'я'],
  ['ye', 'е'],
  ['iy', 'ий'],
  ['yy', 'ый'],
  ['a', 'а'],
  ['b', 'б'],
  ['c', 'с'],
  ['d', 'д'],
  ['e', 'е'],
  ['f', 'ф'],
  ['g', 'г'],
  ['h', 'х'],
  ['i', 'и'],
  ['j', 'й'],
  ['k', 'к'],
  ['l', 'л'],
  ['m', 'м'],
  ['n', 'н'],
  ['o', 'о'],
  ['p', 'п'],
  ['q', 'к'],
  ['r', 'р'],
  ['s', 'с'],
  ['t', 'т'],
  ['u', 'у'],
  ['v', 'в'],
  ['w', 'в'],
  ['x', 'кс'],
  ['y', 'й'],
  ['z', 'з']
];

const TRANSLIT_MAP = new Map(TRANSLIT_PAIRS);
const TRANSLIT_MAX_KEY_LENGTH = Math.max(...TRANSLIT_PAIRS.map(([key]) => key.length));

function transliterateLatin(word) {
  let result = '';
  let index = 0;

  while (index < word.length) {
    let matched = false;

    for (let length = TRANSLIT_MAX_KEY_LENGTH; length >= 1; length -= 1) {
      const chunk = word.slice(index, index + length);
      const replacement = TRANSLIT_MAP.get(chunk);

      if (replacement !== undefined) {
        result += replacement;
        index += length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      result += word[index];
      index += 1;
    }
  }

  return result;
}

/**
 * Приводит текст к виду для матчинга: нижний регистр, ё→е, латиница→кириллица,
 * только буквы/цифры/'+', одиночные пробелы.
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  let value = String(text || '').toLowerCase();

  if (typeof value.normalize === 'function') {
    value = value.normalize('NFKC');
  }

  value = value
    .replace(/ё/g, 'е')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[a-z]+/g, transliterateLatin)
    .replace(/[^а-я0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return value;
}

// --- Блоклист ---

const BLOCK_RULES = [
  // Суицид и самоповреждение.
  { category: 'suicide', pattern: /суицид/g },
  { category: 'suicide', pattern: /самоубийств/g },
  { category: 'suicide', pattern: /свести\s+счет(?:ы)?\s+с\s+жизн/g },
  { category: 'suicide', pattern: /покончи[а-я]*\s+с\s+собой/g },
  { category: 'suicide', pattern: /убит[а-я]*\s+себя/g },
  { category: 'suicide', pattern: /самоповрежд/g },
  { category: 'suicide', pattern: /селф\s*харм/g },
  { category: 'suicide', pattern: /навреди[а-я]*\s+себе/g },
  { category: 'suicide', pattern: /причини[а-я]*\s+себе\s+(?:вред|боль)/g },
  { category: 'suicide', pattern: /не\s+хочу\s+(?:бол[а-я]*\s+)?жит[а-я]*/g },
  { category: 'suicide', pattern: /хочу\s+(?:умере[а-я]*|сдохн[а-я]*)/g },
  { category: 'suicide', pattern: /(?:по)?резат[а-я]*\s+себя/g },
  { category: 'suicide', pattern: /способ[а-я]*\s+(?:самоубийств|суицид)/g },

  // Терроризм и экстремизм.
  { category: 'terrorism', pattern: /теракт/g },
  { category: 'terrorism', pattern: /терроризм/g },
  { category: 'terrorism', pattern: /террорист/g },
  { category: 'terrorism', pattern: /экстремизм/g },
  { category: 'terrorism', pattern: /экстремист/g },
  { category: 'terrorism', pattern: /захват\s+заложник/g },
  { category: 'terrorism', pattern: /пояс\s+смертник/g },
  { category: 'terrorism', pattern: /джихад/g },
  { category: 'terrorism', pattern: /взорват[а-я]*\s+(?:школ|больниц|метро|аэропорт|самолет|поезд|здани|дом|тц|торгов|автобус)/g },
  { category: 'terrorism', pattern: /(?:сделат|собира|собрат|собер|изготов|смастер)[а-я]*\s+(?:[а-я]+\s+){0,3}(?:бомбу|взрывчатк)/g },
  { category: 'terrorism', pattern: /самодел[а-я]*\s+взрывн[а-я]*\s+устройств/g },
  { category: 'terrorism', pattern: /взрывчатк/g },
  { category: 'terrorism', pattern: /бомба\s+(?:в|для)\s+(?:школ|метро|аэропорт|дом|здани|автобус|поезд)/g },

  // Оружие: покупка/продажа/изготовление, а не упоминание названия.
  { category: 'weapons', pattern: /(?:куп[а-я]*|прода[а-я]*|где|заказ[а-я]*|закаж[а-я]*)\s+(?:[а-я]+\s+){0,4}(?:оруж|пистолет|винтовк|руж[а-я]*)/g },
  { category: 'weapons', pattern: /(?:изготов|сделат|собира|собрат|смастер)[а-я]*\s+(?:[а-я]+\s+){0,3}(?:оруж|пистолет)/g },
  { category: 'weapons', pattern: /оруж[а-я]*\s+(?:без\s+лицензии|нелегал[а-я]*|из\s+под\s+полы)/g },
  { category: 'weapons', pattern: /(?:куп[а-я]*|прода[а-я]*)\s+тротил/g },
  { category: 'weapons', pattern: /(?:нелегал[а-я]*|боевое)\s+оруж/g },
  { category: 'weapons', pattern: /(?:куп[а-я]*|прода[а-я]*|где)\s+(?:[а-я]+\s+){0,2}автомат\s+калашникова/g },

  // Наркотики: приобретение/сбыт/изготовление, а не обсуждение вреда.
  { category: 'drugs', pattern: /(?:куп[а-я]*|прода[а-я]*|где|заказ[а-я]*|закаж[а-я]*)\s+(?:[а-я]+\s+){0,4}(?:наркотик|мефедрон|героин|кокаин|амфетамин|метамфетамин|марихуан|гашиш|спайс|лсд|экстази|мдма|закладк)/g },
  { category: 'drugs', pattern: /(?:как|способ|рецепт)\s+(?:[а-я]+\s+){0,4}(?:сделат|изготов|свар)[а-я]*\s+(?:[а-я]+\s+){0,3}(?:наркотик|мефедрон|амфетамин|метамфетамин)/g },
  { category: 'drugs', pattern: /(?:распространя[а-я]*|сбыва[а-я]*|сбыт)\s+(?:[а-я]+\s+){0,2}наркотик/g },
  { category: 'drugs', pattern: /(?:мефедрон|героин|кокаин|амфетамин|метамфетамин)\s+(?:куп[а-я]*|прода[а-я]*|доста[а-я]*|заказ[а-я]*|закаж[а-я]*)/g },
  { category: 'drugs', pattern: /наркотик[а-я]*\s+(?:закладк|трафик)/g },

  // 18+.
  { category: 'sexual', pattern: /(?<![а-я])порн/g },
  { category: 'sexual', pattern: /18\s*\+/g },
  { category: 'sexual', pattern: /(?:секс|интим|(?:э|е)роти[чк])[а-я]*\s+(?:видео|фото|ролик|контент|чат|переписк|услуг)/g },
  { category: 'sexual', pattern: /(?:откровенн|обнаженн)[а-я]*\s+(?:фото|видео|снимк)/g },
  { category: 'sexual', pattern: /(?:секс|интим)\s+за\s+(?:деньги|денги)/g },

  // Насилие: только явные инструкции/призывы, без неоднозначных глаголов.
  { category: 'violence', pattern: /как\s+(?:убит|зарезат|отравит|удушит|расчлен)[а-я]*\s+(?:человек|мужчин|женщин|ребен|сосед|кого)/g },
  { category: 'violence', pattern: /расчлен[а-я]*\s+(?:труп|тело|человек)/g },
  { category: 'violence', pattern: /изнасилов/g },
  { category: 'violence', pattern: /(?:пыт|истяза)[а-я]*\s+(?:человек|ребен|животн)/g }
];

// Безопасные фразы: совпадение блоклиста внутри них не считается нарушением.
// Нужны для случаев, где запрещённый стем встречается в мирном контексте.
const GREEN_RULES = [
  /убит[а-я]*\s+время/g,
  /убит[а-я]*\s+процесс/g,
  /убит[а-я]*\s+пересмешника/g,
  /убит[а-я]*\s+персмешника/g,
  /убит[а-я]*\s+себя\s+на\s+работе/g,
  /убит[а-я]*\s+себя\s+работ[а-я]*/g,
  /убит[а-я]*\s+себя\s+тренировк[а-я]*/g,
  /стреля[а-я]*\s+по\s+воробьям/g,
  /стреля[а-я]*\s+(?:в|по)\s+(?:игр|мишен|тир|воробь)/g,
  /взорват[а-я]*\s+рынок/g,
  /взорват[а-я]*\s+интернет/g,
  /бомба\s+замедленного\s+действия/g
];

function findGreenSpans(normalized) {
  const spans = [];

  for (const pattern of GREEN_RULES) {
    pattern.lastIndex = 0;
    let match = pattern.exec(normalized);

    while (match) {
      spans.push([match.index, match.index + match[0].length]);

      if (match.index === pattern.lastIndex) {
        pattern.lastIndex += 1;
      }

      match = pattern.exec(normalized);
    }
  }

  return spans;
}

function isInsideAnySpan(index, spans) {
  return spans.some(([start, end]) => index >= start && index < end);
}

/**
 * Проверяет текст на однозначно запрещённые темы.
 * @param {string} text
 * @returns {null | {category: string, match: string}}
 */
function checkText(text) {
  const normalized = normalize(text);

  if (!normalized) return null;

  const greenSpans = findGreenSpans(normalized);

  for (const rule of BLOCK_RULES) {
    rule.pattern.lastIndex = 0;
    let match = rule.pattern.exec(normalized);

    while (match) {
      if (!isInsideAnySpan(match.index, greenSpans)) {
        return { category: rule.category, match: match[0] };
      }

      if (match.index === rule.pattern.lastIndex) {
        rule.pattern.lastIndex += 1;
      }

      match = rule.pattern.exec(normalized);
    }
  }

  return null;
}

// --- Отказы модели ---

// Мягкие признаки суицидальной темы: для выбора шаблона с телефоном доверия,
// когда явный блоклист не сработал (например, «очень тяжело жить»).
const SUICIDE_SIGNALS = [
  /суицид|самоубийств|самоповрежд/g,
  /покончи[а-я]*\s+с\s+собой|свести\s+счет(?:ы)?\s+с\s+жизн/g,
  /убит[а-я]*\s+себя|навреди[а-я]*\s+себе|причини[а-я]*\s+себе/g,
  /не\s+хочу\s+(?:бол[а-я]*\s+)?жит[а-я]*|хочу\s+(?:умере[а-я]*|сдохн[а-я]*)/g,
  /(?:по)?резат[а-я]*\s+себя|селф\s*харм/g,
  /тяжело\s+жить|нет\s+смысла\s+жить|устал[а]?\s+жить/g
];

const REFUSAL_PATTERNS = [
  /(?:^|[.!?]\s*)(?:извините|простите|прошу прощения|к сожалению)[^.!?]{0,80}(?:я\s+)?(?:не могу|не смогу|не буду|не стану|не имею (?:права|возможности))(?!\s+не)/i,
  /(?:^|[.!?]\s*)я\s+(?:не могу|не смогу|не буду|не стану|не имею (?:права|возможности))(?!\s+не)\s+(?:(?:это|такое|подобное)\s+)?(?:помочь|помогать|создать|создавать|написать|писать|обсуждать|обсудить|участвовать|выполнить|выполнять|генерировать|поддержать|ответить|делать|сделать)/i,
  /(?:^|[.!?]\s*)как\s+(?:ии|искусственный интеллект|языковая модель|ai|ии-ассистент)[^.!?]{0,80}(?:не могу|не имею|не умею|не создаю|не буду)/i,
  /\b(?:i\s+(?:can(?:not|['’]t)|am unable to|won['’]t|will not)|as an ai\b[^.!?]{0,80}(?:cannot|can['’]t|unable))/i,
  /^(?:не\s+(?:могу|смогу|буду|стану|имею\s+(?:права|возможности)))(?!\s+не)\s+(?:(?:это|такое|подобное)\s+)?(?:помочь|помогать|создать|создавать|написать|писать|обсуждать|обсудить|участвовать|выполнить|выполнять|генерировать|поддержать|ответить|делать|сделать)/i,
  /(?:этот|такой|данный)\s+(?:запрос|контент|материал|текст)[^.!?]{0,60}(?:нарушает|противоречит|не\s+соответствует)/i
];

// Длинные осмысленные тексты не считаем отказом: там фраза «не могу»
// может быть частью нормального поста или ответа клиенту.
const MAX_REFUSAL_LENGTH = 700;

/**
 * Похож ли ответ модели на отказ (а не на нормальный текст).
 * @param {string} text
 * @returns {boolean}
 */
function isModelRefusal(text) {
  const value = String(text || '').trim();

  if (!value || value.length > MAX_REFUSAL_LENGTH) return false;

  return REFUSAL_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Категория чувствительной темы для выбора шаблона отказа.
 * @param {string} text
 * @returns {null | 'suicide'}
 */
function sensitiveCategory(text) {
  const normalized = normalize(text);

  if (!normalized) return null;

  const greenSpans = findGreenSpans(normalized);

  for (const pattern of SUICIDE_SIGNALS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(normalized);

    while (match) {
      if (!isInsideAnySpan(match.index, greenSpans)) {
        return 'suicide';
      }

      if (match.index === pattern.lastIndex) {
        pattern.lastIndex += 1;
      }

      match = pattern.exec(normalized);
    }
  }

  return null;
}

/**
 * Вежливый отказ: для суицида/селфхарма — с телефоном доверия.
 * @param {string|null} category — категория блоклиста (или null)
 * @param {string} text — исходный текст пользователя (для мягких признаков)
 * @returns {string}
 */
function refusalFor(category, text) {
  const sensitive = category === 'suicide' ? 'suicide' : sensitiveCategory(text);

  return sensitive === 'suicide' ? SUICIDE_REFUSAL_TEXT : GENERAL_REFUSAL_TEXT;
}

module.exports = {
  normalize,
  checkText,
  isModelRefusal,
  sensitiveCategory,
  refusalFor,
  BLOCK_RULES,
  GREEN_RULES,
  REFUSAL_PATTERNS,
  GENERAL_REFUSAL_TEXT,
  SUICIDE_REFUSAL_TEXT,
  HELPLINE
};
