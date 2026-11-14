const { createSkillRegistry } = require('../src/skills/registry');
const bloggersPack = require('../src/skills/packs/bloggers');
const businessPack = require('../src/skills/packs/business');

function makeRegistry(overrides = {}) {
  return createSkillRegistry([bloggersPack, businessPack], overrides);
}

describe('createSkillRegistry', () => {
  it('главное меню — ряды из паков, /start — welcome-текст', () => {
    const registry = makeRegistry();

    const start = registry.findNavigation('/start');
    expect(start.isWelcome).toBe(true);
    expect(start.text).toContain('Textorio');
    expect(start.rows.flat().map((b) => b.label)).toEqual(['Блогерам', 'Бизнесу', 'Помощь']);

    const menu = registry.findNavigation('Главное меню');
    expect(menu.isWelcome).toBe(true); // «Главное меню» тоже считается welcome-навигацией
    expect(menu.rows).toEqual(start.rows);
  });

  it('кнопка пака открывает его скиллы + кнопку главного меню', () => {
    const registry = makeRegistry();

    const nav = registry.findNavigation('Блогерам');
    const labels = nav.rows.flat().map((b) => b.label);

    expect(labels).toEqual([
      'Улучшить стиль', 'Создать пост',
      'Пост по фото', 'Обучить стилю',
      'Главное меню'
    ]);
  });

  it('точные триггеры: кнопка и слэш-команда находят один скилл', () => {
    const registry = makeRegistry();

    expect(registry.findSkillByText('Улучшить стиль').id).toBe('style_improve');
    expect(registry.findSkillByText('/стиль').id).toBe('style_improve');

    // «Создать пост про котиков» — НЕ точный триггер
    expect(registry.findSkillByText('Создать пост про котиков')).toBeNull();
  });

  it('поиск по префиксу работает только для слэш-команд', () => {
    const registry = makeRegistry();

    expect(registry.findSkillByPrefix('/пост осень в городе')?.id).toBe('post_topic');
    expect(registry.findSkillByPrefix('Создать пост про котиков')).toBeNull();
  });

  it('состояния: waiting:<id> ↔ скилл', () => {
    const registry = makeRegistry();
    const skill = registry.findSkillByText('/товар');

    expect(registry.stateOf(skill)).toBe('waiting:product_description');
    expect(registry.findSkillByState('waiting:product_description').id).toBe('product_description');
    expect(registry.findSkillByState('мусор')).toBeNull();
    expect(registry.findSkillByState(null)).toBeNull();
  });

  it('интенты: «улучши…» → скилл стиля с аргументом', () => {
    const registry = makeRegistry();

    const detected = registry.detectIntent('Улучши текст: Продали дачу');
    expect(detected.skill.id).toBe('style_improve');
    expect(detected.argument).toBe('текст: Продали дачу');

    const noArg = registry.detectIntent('Улучши');
    expect(noArg.skill.id).toBe('style_improve');
    expect(noArg.argument).toBe('');
  });

  it('интенты: «пост по фото» не путается с «пост про…»', () => {
    const registry = makeRegistry();

    expect(registry.detectIntent('пост по фото').skill.id).toBe('photo_post');
    expect(registry.detectIntent('напиши пост про котиков').skill.id).toBe('post_topic');
    expect(registry.detectIntent('Привет!')).toBeNull();
  });

  it('capabilities без vision скрывают фотопост из меню и поиска', () => {
    const registry = makeRegistry({ capabilities: { vision: false, filesApi: false } });

    const labels = registry.findNavigation('Блогерам').rows.flat().map((b) => b.label);
    expect(labels).not.toContain('Пост по фото');
    expect(registry.findSkillByText('Пост по фото')).toBeNull();
    expect(registry.detectIntent('пост по фото')).toBeNull();
    // Остальные скиллы на месте
    expect(registry.findSkillByText('Улучшить стиль')).not.toBeNull();
  });

  it('помощь: кнопка в главном меню, /помощь и текст инструкции', () => {
    const registry = makeRegistry();

    expect(registry.findNavigation('/start').rows.flat()).toContainEqual({ label: 'Помощь', color: 'secondary' });

    const help = registry.findStatic('/помощь');
    expect(help.id).toBe('help');
    expect(help.text).toContain('Как начать');
    expect(registry.findStatic('Помощь').id).toBe('help');
  });

  it('SKILL_PACKS фильтрует паки: только business', () => {
    const registry = createSkillRegistry([businessPack]);

    expect(registry.findNavigation('/start').rows.flat().map((b) => b.label)).toEqual(['Бизнесу', 'Помощь']);
    expect(registry.findSkillByText('Улучшить стиль')).toBeNull();
    expect(registry.findSkillByText('Рекламный текст').id).toBe('ad_text');
  });
});
