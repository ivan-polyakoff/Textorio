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

describe('assistant.downloadImage: лимит размера фото', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('отклоняет фото больше лимита (error.stage = photo_size)', async () => {
    mockDownload(Buffer.alloc(6 * 1024 * 1024)); // 6 МБ > лимита 5 МБ
    const assistant = createAssistantService(makeConfig());

    await expect(assistant.downloadImage(['https://vk.example/photo.jpg']))
      .rejects.toMatchObject({ stage: 'photo_size', message: expect.stringContaining('6.0 МБ') });
  });

  it('принимает фото ровно на границе лимита (5 МБ включительно)', async () => {
    mockDownload(Buffer.alloc(5 * 1024 * 1024));
    const assistant = createAssistantService(makeConfig());

    const image = await assistant.downloadImage(['https://vk.example/photo.jpg']);
    expect(image.buffer.length).toBe(5 * 1024 * 1024);
    expect(image.contentType).toBe('image/jpeg');
  });

  it('пропускает маленькое фото, отдаёт байты и content-type', async () => {
    mockDownload(Buffer.alloc(100 * 1024)); // 100 КБ
    const assistant = createAssistantService(makeConfig());

    const image = await assistant.downloadImage(['https://vk.example/photo.jpg']);
    expect(image.buffer.length).toBe(100 * 1024);
  });

  it('photoMaxSizeMb доступен движку для текста сообщения', () => {
    expect(createAssistantService(makeConfig()).photoMaxSizeMb).toBe(5);
  });
});
