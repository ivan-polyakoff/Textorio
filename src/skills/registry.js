// Реестр скиллов: собирает из пак-деклараций всё, что нужно движку —
// навигацию, кнопки, состояния, интенты, раскладки клавиатур (абстрактные ряды).
//
// Контракт скилла:
// {
//   id: 'style_improve',             // уникальный в рамках всех пако́в
//   pack: 'bloggers',                // id пака
//   button: 'Улучшить стиль',        // текст кнопки (триггер)
//   command: '/стиль',               // слэш-команда (триггер), опционально
//   intents: [/.../i],               // регулярки свободного текста, опционально
//   requires: ['vision'],            // требования к capabilities провайдера
//   color: 'primary',                // цвет кнопки VK (primary|positive|secondary)
//
//   kind: 'text' (по умолчанию):
//   ask: '...',                      // что спросить после нажатия кнопки
//   emptyAsk: '...',                 // если в состоянии пришло не текстовое сообщение
//   prompt: (input) => '...',        // промпт для провайдера
//
//   kind: 'photo':
//   ask, argNoPhoto, stateCaptionSaved, stateNoPhoto,
//   prompt: (caption) => '...',
//
//   kind: 'static':
//   text: '...'                      // ответ без генерации
// }
//
// Контракт пака:
// {
//   id: 'bloggers',
//   button: 'Блогерам',              // кнопка в главном меню
//   color: 'primary',
//   menuText: 'Раздел для блогеров. Выберите задачу.',
//   skills: [ ... ]
// }

const MAIN_MENU_ROW_SPAN = 2; // кнопок в ряду

function chunkRows(labels) {
  const rows = [];
  for (let i = 0; i < labels.length; i += MAIN_MENU_ROW_SPAN) {
    rows.push(labels.slice(i, i + MAIN_MENU_ROW_SPAN));
  }
  return rows;
}

/**
 * @param {Array} packs — пак-декларации
 * @param {object} options
 * @param {string} [options.mainMenuButton]
 * @param {string} [options.welcomeText]
 * @param {object|null} [options.capabilities] — возможности провайдера;
 *        null = считать все требования выполненными
 */
function createSkillRegistry(packs, options = {}) {
  const mainMenuButton = options.mainMenuButton || 'Главное меню';
  const welcomeText = options.welcomeText ||
    'Привет! Я Textorio — бот для создания и улучшения текстов.\n\nВыберите, для кого нужен текст:';
  const capabilities = options.capabilities ?? null;

  const packById = new Map(packs.map((pack) => [pack.id, pack]));

  const skills = packs
    .flatMap((pack) => pack.skills.map((skill) => ({ ...skill, pack: pack.id })))
    .filter((skill) => {
      if (!capabilities) return true;
      return (skill.requires || []).every((name) => capabilities[name]);
    });

  // Скиллы-кнопки (не static): точные триггеры = метка кнопки + слэш-команда.
  const actionableSkills = skills.filter((skill) => skill.kind !== 'static');
  const staticSkills = skills.filter((skill) => skill.kind === 'static');

  // --- Раскладки клавиатур (абстрактные ряды: [[{label, color}]]) ---

  function mainMenuRows() {
    return chunkRows(packs.map((pack) => ({ label: pack.button, color: pack.color || 'primary' })));
  }

  function packRows(packId) {
    const pack = packById.get(packId);
    if (!pack) return null;

    const packSkills = skills.filter((skill) => skill.pack === packId);
    const rows = chunkRows(packSkills.map((skill) => ({
      label: skill.button,
      color: skill.color || 'primary'
    })));

    return [...rows, [{ label: mainMenuButton, color: 'secondary' }]];
  }

  // --- Поиск по тексту/состоянию/интенту ---

  function findNavigation(text) {
    if (text === '/start' || text === mainMenuButton) {
      return { rows: mainMenuRows(), text: welcomeText, isWelcome: true };
    }

    const pack = packs.find((item) => item.button === text);
    if (pack) {
      return { rows: packRows(pack.id), text: pack.menuText };
    }

    return null;
  }

  function findStatic(text) {
    return staticSkills.find((skill) => skillTriggers(skill).includes(text)) || null;
  }

  function findSkillByText(text) {
    return actionableSkills.find((skill) => skillTriggers(skill).includes(text)) || null;
  }

  // По префиксу ищем только слэш-команды, чтобы обычный текст
  // вида «Создать пост про котиков» не перехватывался кнопкой.
  function findSkillByPrefix(text) {
    return actionableSkills.find((skill) =>
      skillTriggers(skill).some((trigger) => trigger.startsWith('/') && text.startsWith(`${trigger} `))
    ) || null;
  }

  function findSkillById(skillId) {
    return skills.find((skill) => skill.id === skillId) || null;
  }

  function stateOf(skill) {
    return `waiting:${skill.id}`;
  }

  function findSkillByState(stateValue) {
    if (!stateValue?.startsWith?.('waiting:')) return null;
    return findSkillById(stateValue.slice('waiting:'.length));
  }

  // Интенты: регулярки скиллов в порядке объявления.
  // Хвост после ключевой фразы — аргумент, если он достаточно длинный.
  const MIN_ARGUMENT_LENGTH = 2;

  function detectIntent(text) {
    const trimmed = (text || '').trim();

    for (const skill of actionableSkills) {
      for (const pattern of skill.intents || []) {
        const match = trimmed.match(pattern);
        if (!match) continue;

        const rest = trimmed
          .slice(match[0].length)
          .replace(/^[\s:;,.!?—–-]+/, '');

        return {
          skill,
          argument: rest.length >= MIN_ARGUMENT_LENGTH ? rest : ''
        };
      }
    }

    return null;
  }

  function skillTriggers(skill) {
    return skill.command ? [skill.button, skill.command] : [skill.button];
  }

  return {
    mainMenuButton,
    packs,
    skills,
    mainMenuRows,
    packRows,
    findNavigation,
    findStatic,
    findSkillByText,
    findSkillByPrefix,
    findSkillById,
    findSkillByState,
    stateOf,
    detectIntent
  };
}

module.exports = {
  createSkillRegistry
};
