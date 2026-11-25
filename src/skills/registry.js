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
//   acceptsPhoto: true,              // фото опционально: есть фото — генерация по vision
//   presets: [{ id, button, role?, lexicon?, syntax?, composition?, rhythm?,
//               intonation?, forbidden?, tasks?, form?, verseChoice?, instruction?,
//               title?, help? }],
//                                    // готовые стили (см. style_improve): поля — данные
//                                    // для промпта; form: 'poem' — всегда стихи;
//                                    // verseChoice: true — спросить «стихи или проза?»;
//                                    // tasks: [{ when, instruction }] — правила под тип текста
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

const { ABOUT_TEXT } = require('../config/helpText');

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
  const aboutButton = options.aboutButton || 'О проекте «Тексторио»';
  const sectionHelpButton = options.sectionHelpButton || 'Помощь';
  const welcomeText = options.welcomeText ||
    'Привет! Я Textorio — бот для создания и улучшения текстов.\n\nВыберите, для кого нужен текст:';
  const capabilities = options.capabilities ?? null;

  // «О проекте»: краткое описание сервиса в главном меню и по /помощь.
  // Детальные инструкции разделов — кнопка «Помощь» внутри каждого пака.
  const aboutSkill = {
    id: 'about',
    pack: null,
    kind: 'static',
    button: aboutButton,
    command: '/помощь',
    text: ABOUT_TEXT
  };

  const packById = new Map(packs.map((pack) => [pack.id, pack]));

  const skills = packs
    .flatMap((pack) => pack.skills.map((skill) => ({ ...skill, pack: pack.id })))
    .filter((skill) => {
      if (!capabilities) return true;
      return (skill.requires || []).every((name) => capabilities[name]);
    });

  // Скиллы-кнопки (не static): точные триггеры = метка кнопки + слэш-команда.
  const actionableSkills = skills.filter((skill) => skill.kind !== 'static');
  const staticSkills = [...skills.filter((skill) => skill.kind === 'static'), aboutSkill];

  const packHelpSkills = new Map(packs.map((pack) => [
    pack.id,
    {
      id: `help_${pack.id}`,
      pack: pack.id,
      kind: 'static',
      button: sectionHelpButton,
      text: pack.helpText || ABOUT_TEXT
    }
  ]));

  // --- Раскладки клавиатур (абстрактные ряды: [[{label, color}]]) ---

  // Иконка — чисто оформление надписи: сопоставление текста идёт по button.
  function labeled(item) {
    return item.icon ? `${item.icon} ${item.button}` : item.button;
  }

  function mainMenuRows() {
    return [
      ...chunkRows(packs.map((pack) => ({ label: labeled(pack), color: pack.color || 'primary' }))),
      [{ label: `ℹ️ ${aboutButton}`, color: 'secondary' }]
    ];
  }

  function packRows(packId) {
    const pack = packById.get(packId);
    if (!pack) return null;

    const packSkills = skills.filter((skill) => skill.pack === packId);
    const rows = chunkRows(packSkills.map((skill) => ({
      label: labeled(skill),
      color: skill.color || 'primary'
    })));

    return [...rows, [
      { label: `❓ ${sectionHelpButton}`, color: 'secondary' },
      { label: `🏠 ${mainMenuButton}`, color: 'secondary' }
    ]];
  }

  // --- Поиск по тексту/состоянию/интенту ---

  function findNavigation(text) {
    if (text === '/start' || text === mainMenuButton) {
      return { rows: mainMenuRows(), text: welcomeText, isWelcome: true };
    }

    const pack = packs.find((item) => item.button === text);
    if (pack) {
      // Запоминаем раздел: по нему работает кнопка «Помощь» внутри пака.
      return { rows: packRows(pack.id), text: pack.menuText, pack: pack.id };
    }

    return null;
  }

  function findStatic(text) {
    return staticSkills.find((skill) => skillTriggers(skill).includes(text)) || null;
  }

  // Помощь раздела: метка «Помощь» одинакова во всех паках, поэтому ищем
  // в контексте открытого раздела (движок помнит его по state pack:<id>).
  function findPackHelp(packId, text) {
    const skill = packHelpSkills.get(packId);
    if (!skill || text !== sectionHelpButton) return null;
    return skill;
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

  // Пресет стиля по тексту кнопки (кнопка нажимается внутри скилла).
  function findPreset(skillId, text) {
    const skill = findSkillById(skillId);
    if (!skill?.presets) return null;
    return skill.presets.find((preset) => preset.button === text) || null;
  }

  // Пресет по тексту кнопки среди всех скиллов: { skill, preset } или null.
  function findPresetByText(text) {
    for (const skill of skills) {
      const preset = (skill.presets || []).find((item) => item.button === text);
      if (preset) return { skill, preset };
    }
    return null;
  }

  // Раскладка пресетов стиля: рядами по 2 + возврат в раздел пака.
  function presetRows(skillId) {
    const skill = findSkillById(skillId);
    if (!skill?.presets?.length) return null;

    const rows = chunkRows(skill.presets.map((preset) => ({
      label: labeled(preset),
      color: 'secondary'
    })));

    return [...rows, [{ label: '⬅️ Назад', color: 'secondary' }]];
  }

  function getPack(packId) {
    return packById.get(packId) || null;
  }

  // Справка по готовым стилям: заголовок + краткое описание для каждого.
  function presetHelpText(skillId) {
    const skill = findSkillById(skillId);
    const presets = skill?.presets || skill?.resultPresets || [];
    if (!presets.length) return null;

    const parts = ['Готовые стили:'];

    for (const preset of presets) {
      const block = [preset.title || preset.button, preset.help].filter(Boolean).join('\n');
      if (block) parts.push(block);
    }

    parts.push('Выберите стиль кнопкой — до ввода текста или после результата.');
    return parts.join('\n\n');
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
    helpButton: sectionHelpButton,
    findNavigation,
    findStatic,
    findPackHelp,
    findSkillByText,
    findSkillByPrefix,
    findSkillById,
    findPreset,
    findPresetByText,
    presetRows,
    presetHelpText,
    getPack,
    findSkillByState,
    stateOf,
    detectIntent
  };
}

module.exports = {
  createSkillRegistry
};
