const {
  recordLike,
  recordDislike,
  styleHint,
  describeStyle,
  clearStyle,
  excerpt
} = require('../src/core/styleProfile');

function blank() {
  return { profile: { liked: [], disliked: [], styleCard: null } };
}

describe('память стиля', () => {
  it('👍 сохраняет одобренный пример и собирает styleCard', () => {
    const profile = blank();

    recordLike(profile, { id: 'g1', result: 'Живой текст про кота', skillId: 'post_topic' });

    expect(profile.profile.liked).toHaveLength(1);
    expect(profile.profile.liked[0]).toEqual(expect.objectContaining({
      text: 'Живой текст про кота',
      generationId: 'g1',
      skillId: 'post_topic'
    }));

    const hint = styleHint(profile);
    expect(hint).toContain('Одобренный пользователем пример');
    expect(hint).toContain('Живой текст про кота');
  });

  it('👎 с критикой формирует предпочтения для промпта', () => {
    const profile = blank();

    recordDislike(profile, { id: 'g1', skillId: 'post_topic' }, 'без эмодзи и короче');

    expect(profile.profile.disliked[0].critique).toBe('без эмодзи и короче');
    expect(styleHint(profile)).toContain('без эмодзи и короче');
  });

  it('👎 без замечания не попадает в styleCard, но учитывается в счётчике', () => {
    const profile = blank();

    recordDislike(profile, { id: 'g1' }, null);

    expect(styleHint(profile)).toBeNull();
    expect(describeStyle(profile).dislikedCount).toBe(1);
  });

  it('критика обновляет ту же реакцию 👎, а не дублирует её', () => {
    const profile = blank();
    const generation = { id: 'g1', skillId: 'post_topic' };

    recordDislike(profile, generation, null);
    recordDislike(profile, generation, 'добавь конкретики');

    expect(profile.profile.disliked).toHaveLength(1);
    expect(profile.profile.disliked[0].critique).toBe('добавь конкретики');
  });

  it('свежая оценка отменяет противоположную по той же генерации', () => {
    const profile = blank();
    const generation = { id: 'g1', result: 'текст', skillId: 'post_topic' };

    recordDislike(profile, generation, 'плохо');
    recordLike(profile, generation);

    expect(profile.profile.liked).toHaveLength(1);
    expect(profile.profile.disliked).toHaveLength(0);
    expect(styleHint(profile)).not.toContain('плохо');
  });

  it('фото-генерации не попадают в память стиля', () => {
    const profile = blank();

    recordLike(profile, { id: 'p1', kind: 'photo', result: 'пост про ВДНХ' });
    recordDislike(profile, { id: 'p1', kind: 'photo' }, 'это павильон космос');

    expect(profile.profile.liked).toHaveLength(0);
    expect(profile.profile.disliked).toHaveLength(0);
    expect(styleHint(profile)).toBeNull();
  });

  it('гибридные генерации «текст + фото» тоже не учат память стиля', () => {
    const profile = blank();
    const generation = {
      id: 'h1',
      kind: 'text',
      input: { text: 'описание товара', photoUrls: ['https://example/photo.jpg'] },
      result: 'рекламный текст'
    };

    recordLike(profile, generation);
    recordDislike(profile, generation, 'На фото дорожный набор с тапочками');

    expect(profile.profile.liked).toHaveLength(0);
    expect(profile.profile.disliked).toHaveLength(0);
    expect(styleHint(profile)).toBeNull();
  });

  it('хранит только последние 5 примеров', () => {
    const profile = blank();

    for (let index = 0; index < 7; index += 1) {
      recordLike(profile, { id: `g${index}`, result: `текст ${index}` });
    }

    expect(profile.profile.liked).toHaveLength(5);
    expect(profile.profile.liked[4].text).toBe('текст 6');
  });

  it('describeStyle отдаёт счётчики, замечания и памятку', () => {
    const profile = blank();

    recordLike(profile, { id: 'g1', result: 'одобренный текст' });
    recordDislike(profile, { id: 'g2' }, 'короче');
    recordDislike(profile, { id: 'g3' }, 'без штампов');

    const info = describeStyle(profile);

    expect(info.likedCount).toBe(1);
    expect(info.dislikedCount).toBe(2);
    expect(info.critiques).toEqual(['короче', 'без штампов']);
    expect(info.hasStyle).toBe(true);
    expect(info.styleCard).toContain('короче');
  });

  it('clearStyle очищает память стиля', () => {
    const profile = blank();

    recordLike(profile, { id: 'g1', result: 'текст' });
    recordDislike(profile, { id: 'g2' }, 'замечание');
    clearStyle(profile);

    expect(profile.profile).toEqual({ liked: [], disliked: [], styleCard: null });
  });

  it('excerpt обрезает длинные тексты и схлопывает пробелы', () => {
    expect(excerpt('  много   пробелов  ')).toBe('много пробелов');
    expect(excerpt('x'.repeat(500)).length).toBe(400);
  });
});
