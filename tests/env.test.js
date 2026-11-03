// Мокаем dotenv, чтобы тесты не подхватывали реальный .env проекта.
jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('validateEnv', () => {
  const loadEnv = (envVars) => {
    jest.resetModules();
    const saved = { ...process.env };
    // Убираем переменные, влияющие на валидацию.
    delete process.env.VK_GROUP_TOKEN;
    delete process.env.GROUP_ID;
    delete process.env.GIGACHAT_API_KEY;
    Object.assign(process.env, envVars);
    return { module: require('../src/config/env'), saved };
  };

  const restoreEnv = (saved) => {
    for (const key of ['VK_GROUP_TOKEN', 'GROUP_ID', 'GIGACHAT_API_KEY']) {
      if (key in saved) process.env[key] = saved[key];
      else delete process.env[key];
    }
  };

  it('возвращает список всех отсутствующих переменных', () => {
    const { module, saved } = loadEnv({});
    try {
      expect(module.validateEnv()).toEqual([
        'VK_GROUP_TOKEN — токен группы ВКонтакте',
        'GROUP_ID — числовой ID группы ВКонтакте',
        'GIGACHAT_API_KEY — ключ доступа GigaChat'
      ]);
    } finally {
      restoreEnv(saved);
    }
  });

  it('не ругается, когда все переменные заданы корректно', () => {
    const { module, saved } = loadEnv({
      VK_GROUP_TOKEN: 'token',
      GROUP_ID: '12345',
      GIGACHAT_API_KEY: 'key'
    });
    try {
      expect(module.validateEnv()).toEqual([]);
    } finally {
      restoreEnv(saved);
    }
  });

  it('ругается на нечисловой GROUP_ID', () => {
    const { module, saved } = loadEnv({
      VK_GROUP_TOKEN: 'token',
      GROUP_ID: 'abc',
      GIGACHAT_API_KEY: 'key'
    });
    try {
      expect(module.validateEnv()).toEqual(['GROUP_ID — числовой ID группы ВКонтакте']);
    } finally {
      restoreEnv(saved);
    }
  });

  it('принимает пустые строки как отсутствующие значения', () => {
    const { module, saved } = loadEnv({
      VK_GROUP_TOKEN: '',
      GROUP_ID: '',
      GIGACHAT_API_KEY: ''
    });
    try {
      expect(module.validateEnv().length).toBe(3);
    } finally {
      restoreEnv(saved);
    }
  });
});
