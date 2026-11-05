const { detectIntent } = require('../src/utils/intentRouter');

describe('detectIntent', () => {
  it('«Привет!» — интента нет, отвечает Ежик', () => {
    expect(detectIntent('Привет!')).toBeNull();
    expect(detectIntent('Как дела?')).toBeNull();
  });

  it('«улучши текст» → style_improve с аргументом', () => {
    const result = detectIntent('Улучши текст: Продали дачу, все счастливы.');
    expect(result.intent).toBe('style_improve');
    expect(result.argument).toBe('текст: Продали дачу, все счастливы.');
  });

  it('«улучши» без аргумента → пустой аргумент (бот попросит ввод)', () => {
    const result = detectIntent('Улучши');
    expect(result.intent).toBe('style_improve');
    expect(result.argument).toBe('');
  });

  it('«напиши пост про котиков» → post_topic', () => {
    const result = detectIntent('Напиши пост про котиков');
    expect(result.intent).toBe('post_topic');
    expect(result.argument).toBe('про котиков');
  });

  it('«пост по фото» не путается с post_topic', () => {
    const result = detectIntent('пост по фото');
    expect(result.intent).toBe('photo_post');
    expect(result.argument).toBe('');
  });

  it('«напиши пост по картинке с котом» → photo_post, аргумент-комментарий', () => {
    const result = detectIntent('напиши пост по картинке с котом');
    expect(result.intent).toBe('photo_post');
    expect(result.argument).toBe('с котом');
  });

  it('«опиши товар: кресло-мешок» → product_description', () => {
    const result = detectIntent('Опиши товар: кресло-мешок');
    expect(result.intent).toBe('product_description');
    expect(result.argument).toBe('кресло-мешок');
  });

  it('«напиши рекламу кофеварки» → ad_text', () => {
    const result = detectIntent('напиши рекламу кофеварки');
    expect(result.intent).toBe('ad_text');
    expect(result.argument).toBe('кофеварки');
  });

  it('«ответь клиенту, что задерживаемся» → client_reply', () => {
    const result = detectIntent('ответь клиенту, что задерживаемся');
    expect(result.intent).toBe('client_reply');
    expect(result.argument).toBe('что задерживаемся');
  });

  it('«рекламный текст» не триггерит ad_text (это не просьба)', () => {
    expect(detectIntent('Рекламный текст — это жанр')).toBeNull();
  });

  it('регистр и пробелы не важны', () => {
    const result = detectIntent('  УЛУЧШИ    этот текст  ');
    expect(result.intent).toBe('style_improve');
    expect(result.argument).toBe('этот текст');
  });
});
