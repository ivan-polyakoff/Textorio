// Мокаем axios до require сервиса: downloadImage использует axios.get.
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    ...actual,
    get: jest.fn()
  };
});

const axios = require('axios');
const { createAssistantService } = require('../src/services/assistant');

function makeConfig(overrides = {}) {
  return {
    photoDownloadTimeoutMs: 1000,
    photoMaxSizeMb: 5,
    ...overrides
  };
}

function mockDownload(buffer, contentType = 'image/jpeg') {
  axios.get.mockResolvedValue({
    data: buffer,
    headers: { 'content-type': contentType }
  });
}

// Фейковый провайдер по контракту src/providers/provider.js.
function makeFakeProvider(overrides = {}) {
  return {
    chat: jest.fn().mockResolvedValue('генерация ок'),
    vision: jest.fn().mockResolvedValue('vision ок'),
    capabilities: { vision: true, filesApi: true },
    ...overrides
  };
}

describe('generatePostFromPhoto: лимит размера фото', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('отклоняет фото больше лимита и возвращает дружелюбное сообщение', async () => {
    mockDownload(Buffer.alloc(6 * 1024 * 1024)); // 6 МБ > лимита 5 МБ
    const provider = makeFakeProvider();
    const service = createAssistantService(provider, makeConfig());

    const result = await service.generatePostFromPhoto(['https://vk.example/photo.jpg']);

    expect(result).toContain('слишком большое');
    expect(result).toContain('6.0 МБ');
    expect(result).toContain('5 МБ');
    // Провайдер не должен вызываться для слишком большого фото.
    expect(provider.vision).not.toHaveBeenCalled();
  });

  it('принимает фото ровно на границе лимита (5 МБ включительно)', async () => {
    mockDownload(Buffer.alloc(5 * 1024 * 1024));
    const provider = makeFakeProvider();
    const service = createAssistantService(provider, makeConfig());

    const result = await service.generatePostFromPhoto(['https://vk.example/photo.jpg']);

    expect(result).toBe('vision ок');
    expect(provider.vision).toHaveBeenCalledTimes(1);
  });

  it('пропускает маленькое фото дальше — провайдер получает байты и промпт', async () => {
    mockDownload(Buffer.alloc(100 * 1024)); // 100 КБ
    const provider = makeFakeProvider();
    const service = createAssistantService(provider, makeConfig());

    const result = await service.generatePostFromPhoto(['https://vk.example/photo.jpg'], 'комментарий');

    expect(result).toBe('vision ок');
    expect(provider.vision).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/jpeg',
      'комментарий',
      { prompt: expect.stringContaining('комментарий') }
    );
  });
});

