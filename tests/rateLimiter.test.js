const { createRateLimiter } = require('../src/utils/rateLimiter');

describe('createRateLimiter', () => {
  it('бросает ошибку при некорректном интервале', () => {
    expect(() => createRateLimiter(0)).toThrow();
    expect(() => createRateLimiter(-100)).toThrow();
    expect(() => createRateLimiter('abc')).toThrow();
  });

  it('первый запрос проходит, повторный сразу же — ограничен', () => {
    const limiter = createRateLimiter(3000);
    let now = 1000000;
    const tick = (ms) => { now += ms; };

    expect(limiter.isLimited('user1', now)).toBe(false);
    expect(limiter.isLimited('user1', now)).toBe(true);
    expect(limiter.isLimited('user1', now)).toBe(true);

    tick(2999);
    expect(limiter.isLimited('user1', now)).toBe(true);

    tick(1); // ровно intervalMs
    expect(limiter.isLimited('user1', now)).toBe(false);
  });

  it('окно скользящее от момента последнего пропущенного запроса', () => {
    const limiter = createRateLimiter(3000);
    let now = 0;

    expect(limiter.isLimited('user1', now)).toBe(false);
    now += 2999;
    // Заблокированные запросы не сбрасывают окно
    expect(limiter.isLimited('user1', now)).toBe(true);
    now += 1; // ровно intervalMs после пропущенного
    expect(limiter.isLimited('user1', now)).toBe(false);
    // Окно отсчитывается от момента нового пропущенного запроса
    now += 2999;
    expect(limiter.isLimited('user1', now)).toBe(true);
    now += 1;
    expect(limiter.isLimited('user1', now)).toBe(false);
  });

  it('пользователи не влияют друг на друга', () => {
    const limiter = createRateLimiter(3000);
    const now = Date.now();

    expect(limiter.isLimited('user1', now)).toBe(false);
    expect(limiter.isLimited('user2', now)).toBe(false);
    expect(limiter.isLimited('user1', now)).toBe(true);
    expect(limiter.isLimited('user2', now)).toBe(true);
  });

  it('clear сбрасывает ограничение для пользователя', () => {
    const limiter = createRateLimiter(3000);
    let now = Date.now();

    expect(limiter.isLimited('user1', now)).toBe(false);
    expect(limiter.isLimited('user1', now)).toBe(true);

    limiter.clear('user1');
    expect(limiter.isLimited('user1', now)).toBe(false);
  });

  it('prune удаляет устаревшие записи и не трогает свежие', () => {
    const limiter = createRateLimiter(3000);
    const now = Date.now();

    limiter.isLimited('user1', now);
    limiter.isLimited('user2', now);
    expect(limiter.size()).toBe(2);

    limiter.prune(now + 3000);
    expect(limiter.size()).toBe(0);
  });

  it('prune не удаляет свежие записи', () => {
    const limiter = createRateLimiter(3000);
    const now = Date.now();

    limiter.isLimited('user1', now);
    limiter.isLimited('user2', now + 1000);
    limiter.prune(now + 2000);

    expect(limiter.size()).toBe(2);
  });
});
