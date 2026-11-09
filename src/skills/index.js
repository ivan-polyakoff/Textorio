// Загрузчик скиллов: собирает паки по SKILL_PACKS из env.
// По умолчанию — оба встроенных пака (прежнее поведение бота).

const bloggersPack = require('./packs/bloggers');
const businessPack = require('./packs/business');

const PACKS_BY_ID = {
  bloggers: bloggersPack,
  business: businessPack
};

const DEFAULT_PACKS = ['bloggers', 'business'];

function loadSkillPacks(env) {
  const requested = (env.skillPacks || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const ids = requested.length > 0 ? requested : DEFAULT_PACKS;
  const packs = [];

  for (const id of ids) {
    const pack = PACKS_BY_ID[id];
    if (!pack) {
      throw new Error(`Неизвестный пак скиллов: ${id}. Доступно: ${Object.keys(PACKS_BY_ID).join(', ')}`);
    }
    packs.push(pack);
  }

  return packs;
}

module.exports = {
  loadSkillPacks
};
