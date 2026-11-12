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
    delete process.env.AI_PROVIDER;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    Object.assign(process.env, envVars);
    return { module: require('../src/config/env'), saved };
  };

  const restoreEnv = (saved) => {
    for (const key of [
      'VK_GROUP_TOKEN',
      'GROUP_ID',
      'GIGACHAT_API_KEY',
      'AI_PROVIDER',
      'AI_BASE_URL',
      'AI_API_KEY'
    ]) {
      if (key in saved) process.env[key] = saved[key];
      else delete process.env[key];
    }
  };

  it('возвращает список всех отсутствующих переменных (провайдер gigachat по умолчанию)', () => {
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

  it('при AI_PROVIDER=openai требует AI_BASE_URL и AI_API_KEY вместо GigaChat', () => {
    const { module, saved } = loadEnv({
      AI_PROVIDER: 'openai',
      VK_GROUP_TOKEN: 'token',
      GROUP_ID: '12345'
    });
    try {
      expect(module.validateEnv()).toEqual([
        'AI_BASE_URL — базовый URL OpenAI-совместимого API',
        'AI_API_KEY — ключ OpenAI-совместимого API'
      ]);
    } finally {
      restoreEnv(saved);
    }
  });

  it('при AI_PROVIDER=openai GigaChat-ключ не обязателен', () => {
    const { module, saved } = loadEnv({
      AI_PROVIDER: 'openai',
      VK_GROUP_TOKEN: 'token',
      GROUP_ID: '12345',
      AI_BASE_URL: 'https://api.example.ai/v1',
      AI_API_KEY: 'key'
    });
    try {
      expect(module.validateEnv()).toEqual([]);
    } finally {
      restoreEnv(saved);
    }
  });
});
