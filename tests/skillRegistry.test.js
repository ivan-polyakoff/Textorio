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
    expect(start.rows.flat().map((b) => b.label)).toEqual(['Я — автор', 'Я — продавец', 'Обо мне']);

    const menu = registry.findNavigation('Главное меню');
    expect(menu.isWelcome).toBe(true); // «Главное меню» тоже считается welcome-навигацией
    expect(menu.rows).toEqual(start.rows);
  });

  it('кнопка пака открывает его скиллы + кнопку главного меню', () => {
    const registry = makeRegistry();

    const nav = registry.findNavigation('Я — автор');
    const labels = nav.rows.flat().map((b) => b.label);

    expect(labels).toEqual([
      'Улучшить стиль', 'Создать пост',
      'Пост по фото', 'Поздравление',
      'Благодарность', 'Обучить стилю',
      'Помощь', 'Главное меню'
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

    const labels = registry.findNavigation('Я — автор').rows.flat().map((b) => b.label);
    expect(labels).not.toContain('Пост по фото');
    expect(registry.findSkillByText('Пост по фото')).toBeNull();
    expect(registry.detectIntent('пост по фото')).toBeNull();
    // Остальные скиллы на месте
    expect(registry.findSkillByText('Улучшить стиль')).not.toBeNull();
  });

  it('обо мне: кнопка в главном меню, /помощь — общий текст', () => {
    const registry = makeRegistry();

    expect(registry.findNavigation('/start').rows.flat()).toContainEqual({ label: 'Обо мне', color: 'secondary' });

    const about = registry.findStatic('/помощь');
    expect(about.id).toBe('about');
    expect(about.text).toContain('ИИ-редактор');
    expect(registry.findStatic('Обо мне').id).toBe('about');
    // «Помощь» — метка разделов, вне контекста пака не находится
    expect(registry.findStatic('Помощь')).toBeNull();
  });

  it('интенты: поздравление и благодарность', () => {
    const registry = makeRegistry();

    expect(registry.detectIntent('поздравь коллегу с днём рождения').skill.id).toBe('congrats');
    expect(registry.detectIntent('поздравь коллегу с днём рождения').argument).toBe('коллегу с днём рождения');
    expect(registry.findSkillByText('/поздравление').id).toBe('congrats');
    expect(registry.detectIntent('поблагодари команду за работу').skill.id).toBe('thanks');
    expect(registry.findSkillByText('/благодарность').id).toBe('thanks');
  });

  it('пресеты стиля: раскладка и поиск по кнопке', () => {
    const registry = makeRegistry();

    const labels = registry.presetRows('style_improve').flat().map((b) => b.label);
    expect(labels).toEqual([
      'Строгий', 'Неформальный',
      'Поэтичный', 'Довлатов',
      'Пушкин', 'Бродский',
      'Главное меню'
    ]);

    expect(registry.findPreset('style_improve', 'Довлатов').id).toBe('dovlatov');
    expect(registry.findPreset('style_improve', 'Создать пост')).toBeNull();
    expect(registry.presetRows('post_topic')).toBeNull();
  });

  it('помощь раздела: определяется только в контексте открытого пака', () => {
    const registry = makeRegistry();

    expect(registry.findPackHelp('bloggers', 'Помощь').text).toContain('«Я — автор»');
    expect(registry.findPackHelp('business', 'Помощь').text).toContain('«Я — продавец»');
    expect(registry.findPackHelp('bloggers', 'Обо мне')).toBeNull();
    expect(registry.findPackHelp('unknown', 'Помощь')).toBeNull();
  });

  it('SKILL_PACKS фильтрует паки: только business', () => {
    const registry = createSkillRegistry([businessPack]);

    expect(registry.findNavigation('/start').rows.flat().map((b) => b.label)).toEqual(['Я — продавец', 'Обо мне']);
    expect(registry.findSkillByText('Улучшить стиль')).toBeNull();
    expect(registry.findSkillByText('Рекламный текст').id).toBe('ad_text');
  });
});
