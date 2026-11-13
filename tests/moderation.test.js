const {
  normalize,
  checkText,
  isModelRefusal,
  sensitiveCategory,
  refusalFor,
  GENERAL_REFUSAL_TEXT,
  SUICIDE_REFUSAL_TEXT,
  HELPLINE
} = require('../src/core/moderation');

describe('moderation: нормализация', () => {
  it('приводит регистр, ё и пунктуацию', () => {
    expect(normalize('  СУИЦИД!  ')).toBe('суицид');
    expect(normalize('Свести счёты — с жизнью?')).toBe('свести счеты с жизнью');
  });

  it('понимает латиницу, гомоглифы и транслит', () => {
    expect(normalize('cуицид')).toBe('суицид');
    expect(normalize('samoubiystvo')).toBe('самоубийство');
    expect(normalize('tерроризм')).toBe('терроризм');
    expect(normalize('kak sdelat bombu')).toBe('как сделат бомбу');
  });
});

describe('moderation: блоклист', () => {
  const blocked = [
    ['суицид', 'suicide'],
    ['Как свести счёты с жизнью?', 'suicide'],
    ['хочу покончить с собой', 'suicide'],
    ['не хочу больше жить', 'suicide'],
    ['как сделать бомбу', 'terrorism'],
    ['взорвать школу', 'terrorism'],
    ['теракт в метро', 'terrorism'],
    ['захват заложников', 'terrorism'],
    ['где купить оружие без лицензии', 'weapons'],
    ['продам наркотики', 'drugs'],
    ['как изготовить наркотик', 'drugs'],
    ['порно', 'sexual'],
    ['18+', 'sexual'],
    ['как убить человека', 'violence']
  ];

  it.each(blocked)('%s → %s', (text, category) => {
    expect(checkText(text)).toEqual(expect.objectContaining({ category }));
  });

  it('обходы через регистр, латиницу и транслит тоже блокируются', () => {
    expect(checkText('СУИЦИД')).toEqual(expect.objectContaining({ category: 'suicide' }));
    expect(checkText('cуицид')).toEqual(expect.objectContaining({ category: 'suicide' }));
    expect(checkText('pokonchit s soboy')).toEqual(expect.objectContaining({ category: 'suicide' }));
    expect(checkText('ne hochu bolshe zhit')).toEqual(expect.objectContaining({ category: 'suicide' }));
    expect(checkText('kak sdelat bombu')).toEqual(expect.objectContaining({ category: 'terrorism' }));
    expect(checkText('vzorvat shkolu')).toEqual(expect.objectContaining({ category: 'terrorism' }));
    expect(checkText('kupit oruzhie bez licenzii')).toEqual(expect.objectContaining({ category: 'weapons' }));
    expect(checkText('prodam narkotiki')).toEqual(expect.objectContaining({ category: 'drugs' }));
    expect(checkText('kak izgotovit narkotik')).toEqual(expect.objectContaining({ category: 'drugs' }));
  });

  it('неоднозначные глаголы без опасного контекста проходят', () => {
    expect(checkText('убить')).toBeNull();
    expect(checkText('убить соседа в детективе')).toBeNull();
  });

  it('не блокирует мирные слова, в которых встречаются стемы', () => {
    expect(checkText('это спорный вопрос')).toBeNull();
    expect(checkText('купить гранаты в магазине')).toBeNull();
    expect(checkText('купить патроны для лампы')).toBeNull();
    expect(checkText('купить автомат для газировки')).toBeNull();
  });
});

describe('moderation: зелёный список', () => {
  const allowed = [
    'убить время',
    'убить процесс',
    'убить персмешника',
    'убить пересмешника',
    'убить себя на работе',
    'убить себя работой',
    'ubit sebya na rabote',
    'стрелять по воробьям',
    'взорвать рынок',
    'бомба замедленного действия',
    'обсудим вред наркотиков',
    'как улучшить текст'
  ];

  it.each(allowed)('%s проходит фильтр', (text) => {
    expect(checkText(text)).toBeNull();
  });

  it('зелёная фраза не прикрывает опасную часть сообщения', () => {
    expect(checkText('убить время, а потом покончить с собой')).toEqual(
      expect.objectContaining({ category: 'suicide' })
    );
  });
});

describe('moderation: отказы модели', () => {
  const refusals = [
    'Извините, я не могу помочь с этим запросом.',
    'К сожалению, я не могу обсуждать эту тему.',
    'Я не могу создавать контент, который пропагандирует насилие.',
    'Как языковая модель, я не могу помочь с этим.',
    'Не могу помочь с этим запросом.',
    'Я не буду это делать.',
    "I'm sorry, but I can't help with that."
  ];

  it.each(refusals)('узнаёт отказ: %s', (text) => {
    expect(isModelRefusal(text)).toBe(true);
  });

  const normal = [
    'Не могу не отметить, как хорошо написан этот текст.',
    'К сожалению, мы не можем помочь с этим заказом.',
    'Твой текст стал живее, но добавь примеры.',
    'Извините за задержку, вот готовый пост.',
    'Извините, произошла ошибка при генерации текста. Попробуйте позже.'
  ];

  it.each(normal)('не считает отказом нормальный текст: %s', (text) => {
    expect(isModelRefusal(text)).toBe(false);
  });
});

describe('moderation: шаблоны отказов', () => {
  it('для суицида/селфхарма добавляет телефон доверия', () => {
    expect(refusalFor('suicide')).toBe(SUICIDE_REFUSAL_TEXT);
    expect(SUICIDE_REFUSAL_TEXT).toContain(HELPLINE);
    expect(HELPLINE).toBe('8-800-2000-122');
  });

  it('мягкие признаки темы тоже ведут к телефону доверия', () => {
    expect(sensitiveCategory('мне очень тяжело жить')).toBe('suicide');
    expect(refusalFor(null, 'мне очень тяжело жить')).toContain(HELPLINE);
  });

  it('безопасная метафора не включает суицидальный шаблон', () => {
    expect(sensitiveCategory('убить себя на работе')).toBeNull();
    expect(refusalFor(null, 'убить себя на работе')).toBe(GENERAL_REFUSAL_TEXT);
  });

  it('остальные категории получают общий вежливый отказ', () => {
    expect(refusalFor('terrorism')).toBe(GENERAL_REFUSAL_TEXT);
    expect(refusalFor(null, 'обычный текст')).toBe(GENERAL_REFUSAL_TEXT);
  });
});
