// Мокаем axios до require сервиса: downloadImage использует axios.get.
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    ...actual,
    get: jest.fn()
  };
});

const axios = require('axios');
const { createGigaChatService } = require('../src/services/gigachat');

function makeConfig(overrides = {}) {
  return {
    timeoutMs: 1000,
    retryAttempts: 1,
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

describe('generatePostFromPhoto: лимит размера фото', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('отклоняет фото больше лимита и возвращает дружелюбное сообщение', async () => {
    mockDownload(Buffer.alloc(6 * 1024 * 1024)); // 6 МБ > лимита 5 МБ
    const service = createGigaChatService(makeConfig());

    const result = await service.generatePostFromPhoto(['https://vk.example/photo.jpg']);

    expect(result).toContain('слишком большое');
    expect(result).toContain('6.0 МБ');
    expect(result).toContain('5 МБ');
  });

  it('принимает фото ровно на границе лимита (5 МБ включительно)', async () => {
    mockDownload(Buffer.alloc(5 * 1024 * 1024));
    const service = createGigaChatService(makeConfig());

    // Дальше размера не пройдёт (нет токена), но ошибка должна быть НЕ про размер.
    const result = await service.generatePostFromPhoto(['https://vk.example/photo.jpg']);

    expect(result).not.toContain('слишком большое');
  });

  it('пропускает маленькое фото дальше — падает уже на OAuth, не на размере', async () => {
    mockDownload(Buffer.alloc(100 * 1024)); // 100 КБ
    const service = createGigaChatService(makeConfig());

    const result = await service.generatePostFromPhoto(['https://vk.example/photo.jpg']);

    expect(result).not.toContain('слишком большое');
  });
});
