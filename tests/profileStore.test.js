const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProfileStore, blankProfile } = require('../src/storage/profileStore');

function makeStore() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'textorio-store-'));
  return { store: createProfileStore({ dataDir }), dataDir };
}

describe('createProfileStore', () => {
  it('новый профиль — blank: legacy-премиум, пустые память и lastGeneration', () => {
    const { store } = makeStore();

    const profile = store.load(42);

    expect(profile.userId).toBe('42');
    expect(profile.tier.level).toBe('premium');
    expect(profile.tier.source).toBe('legacy');
    expect(profile.lastGeneration).toBeNull();
    expect(profile.profile).toEqual({ liked: [], disliked: [], styleCard: null });
  });

  it('save пишет файл атомарно, другой экземпляр store читает с диска', () => {
    const { store, dataDir } = makeStore();

    const profile = store.load(7);
    profile.lastGeneration = { id: 'abc', skillId: 'post_topic', kind: 'text', input: { text: 'тема' }, result: 'текст', feedbacks: [], createdAt: new Date().toISOString() };
    store.save(profile);

    expect(fs.existsSync(path.join(dataDir, 'profiles', '7.json'))).toBe(true);

    const secondStore = createProfileStore({ dataDir });
    const reloaded = secondStore.load(7);
    expect(reloaded.lastGeneration.id).toBe('abc');
    expect(reloaded.tier.level).toBe('premium');
  });

  it('touch обновляет lastActiveAt', () => {
    const { store } = makeStore();

    const before = store.load(3).lastActiveAt;
    // Гарантируем различие меток времени.
    const sleep = Date.now() + 5;
    while (Date.now() < sleep) { /* busy wait 5мс */ }

    const after = store.touch(3).lastActiveAt;

    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('deleteContent чистит контент, но сохраняет tier и даты', () => {
    const { store } = makeStore();

    const profile = store.load(9);
    profile.lastGeneration = { id: 'x', skillId: 's', kind: 'text', input: {}, result: 'r', feedbacks: [], createdAt: new Date().toISOString() };
    profile.profile.liked.push({ text: 'нравится' });
    profile.profile.styleCard = 'короткий стиль';
    store.save(profile);

    store.deleteContent(9);

    const cleaned = store.load(9);
    expect(cleaned.lastGeneration).toBeNull();
    expect(cleaned.profile).toEqual({ liked: [], disliked: [], styleCard: null });
    expect(cleaned.tier.level).toBe('premium');
    expect(cleaned.createdAt).toBeTruthy();
  });

  it('forEach и count обходят файлы; forget удаляет профиль', () => {
    const { store } = makeStore();

    store.touch(1);
    store.touch(2);
    expect(store.count()).toBe(2);

    const seen = [];
    store.forEach((profile) => seen.push(profile.userId));
    expect(seen.sort()).toEqual(['1', '2']);

    store.forget(1);
    expect(store.count()).toBe(1);
  });

  it('повреждённый файл не роняет load — выдаётся чистый профиль', () => {
    const { store, dataDir } = makeStore();
    fs.mkdirSync(path.join(dataDir, 'profiles'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'profiles', '13.json'), '{ это не json');

    const profile = store.load(13);

    expect(profile.lastGeneration).toBeNull();
    expect(profile.tier.level).toBe('premium');
  });

  it('blankProfile возвращает независимые объекты', () => {
    const first = blankProfile('a');
    const second = blankProfile('b');

    first.profile.liked.push('x');

    expect(second.profile.liked).toEqual([]);
  });
});
