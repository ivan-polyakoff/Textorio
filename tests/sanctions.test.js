const {
  HOUR_MS,
  registerStrike,
  isBlocked,
  banUser,
  unblockUser
} = require('../src/core/sanctions');

const POLICY = {
  strikeLimit: 3,
  strikeWindowMs: 24 * HOUR_MS,
  blockMs: 2 * HOUR_MS
};

function blank() {
  return { moderation: { strikes: [], blockedUntil: null } };
}

describe('санкции', () => {
  it('блокирует после лимита и обнуляет счётчик', () => {
    const profile = blank();
    const now = Date.now();

    expect(registerStrike(profile, 'terrorism', POLICY, now)).toEqual({
      blocked: false,
      until: null,
      count: 1
    });
    expect(registerStrike(profile, 'drugs', POLICY, now + 1).count).toBe(2);

    const third = registerStrike(profile, 'weapons', POLICY, now + 2);

    expect(third.blocked).toBe(true);
    expect(third.until).toBeTruthy();
    expect(isBlocked(profile, now + 3)).toBe(true);
    expect(profile.moderation.strikes).toEqual([]);

    // После окончания блокировки снова можно писать.
    expect(isBlocked(profile, now + POLICY.blockMs + 10)).toBe(false);
  });

  it('старые нарушения вне окна не считаются', () => {
    const profile = blank();
    const now = Date.now();

    registerStrike(profile, 'terrorism', POLICY, now);
    registerStrike(profile, 'terrorism', POLICY, now + 1);

    const later = now + POLICY.strikeWindowMs + HOUR_MS;
    const result = registerStrike(profile, 'terrorism', POLICY, later);

    expect(result.blocked).toBe(false);
    expect(result.count).toBe(1);
  });

  it('ручной бан и разбан', () => {
    const profile = blank();
    const until = new Date(Date.now() + HOUR_MS).toISOString();

    banUser(profile, until);
    expect(isBlocked(profile)).toBe(true);
    expect(profile.moderation.strikes).toEqual([]);

    unblockUser(profile);
    expect(isBlocked(profile)).toBe(false);
  });

  it('пустой/повреждённый профиль не роняет проверки', () => {
    expect(isBlocked({})).toBe(false);
    expect(isBlocked({ moderation: { blockedUntil: 'не дата' } })).toBe(false);

    const profile = {};
    const result = registerStrike(profile, 'terrorism', POLICY);

    expect(result.count).toBe(1);
    expect(Array.isArray(profile.moderation.strikes)).toBe(true);
  });
});
