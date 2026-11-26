// Мокаем axios до require адаптера: chatCompletion использует client (axios.create).
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    ...actual,
    create: jest.fn(() => mockClient())
  };
});

// Заглушка клиента: перехватываем post().
const postMock = jest.fn();
function mockClient() {
  return { post: postMock };
}

const { createOpenAiCompatibleProvider } = require('../src/providers/openai-compatible');

function makeConfig(overrides = {}) {
  return {
    baseUrl: 'https://api.example.ai/v1',
    apiKey: 'test-key',
    textModel: 'test-model',
    visionModel: 'test-vision',
    timeoutMs: 1000,
    retryAttempts: 1,
    ...overrides
  };
}

function mockResponse(content) {
  postMock.mockResolvedValue({
    data: { choices: [{ message: { content } }] }
  });
}

describe('openai-compatible провайдер', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('валидирует конфиг: без baseUrl или ключа падает сразу', () => {
    expect(() => createOpenAiCompatibleProvider(makeConfig({ baseUrl: '' }))).toThrow('AI_BASE_URL');
    expect(() => createOpenAiCompatibleProvider(makeConfig({ apiKey: '' }))).toThrow('AI_API_KEY');
  });

  it('chat() шлёт OpenAI-формат запроса и возвращает текст ответа', async () => {
    mockResponse('  Привет!  ');
    const provider = createOpenAiCompatibleProvider(makeConfig());

    const result = await provider.chat('Вопрос');

    expect(result).toBe('Привет!'); // trim
    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body, options] = postMock.mock.calls[0];
    expect(url).toBe('https://api.example.ai/v1/chat/completions');
    expect(body.model).toBe('test-model');
    expect(body.messages).toEqual([{ role: 'user', content: 'Вопрос' }]);
    expect(body.stream).toBe(false);
    expect(options.headers.Authorization).toBe('Bearer test-key');
  });

  it('vision() передаёт изображение как base64 data URL', async () => {
    mockResponse('описание фото');
    const provider = createOpenAiCompatibleProvider(makeConfig());
    const buffer = Buffer.from('fake-image-bytes');

    const result = await provider.vision(buffer, 'image/png', '', { prompt: 'Опиши фото' });

    expect(result).toBe('описание фото');
    const [, body] = postMock.mock.calls[0];
    expect(body.model).toBe('test-vision');
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: 'Опиши фото' });
    expect(body.messages[0].content[1].type).toBe('image_url');
    expect(body.messages[0].content[1].image_url.url).toBe(
      `data:image/png;base64,${buffer.toString('base64')}`
    );
  });

  it('chat() выносит системный промпт в отдельное сообщение system', async () => {
    mockResponse('ok');
    const provider = createOpenAiCompatibleProvider(makeConfig());

    await provider.chat('Вопрос', { system: 'Правила' });

    const [, body] = postMock.mock.calls[0];
    expect(body.messages).toEqual([
      { role: 'system', content: 'Правила' },
      { role: 'user', content: 'Вопрос' }
    ]);
  });

  it('vision() выносит системный промпт в отдельное сообщение system', async () => {
    mockResponse('описание');
    const provider = createOpenAiCompatibleProvider(makeConfig());
    const buffer = Buffer.from('fake-image-bytes');

    await provider.vision(buffer, 'image/png', '', { prompt: 'Опиши фото', system: 'Правила' });

    const [, body] = postMock.mock.calls[0];
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Правила' });
    expect(body.messages[1].content[0]).toEqual({ type: 'text', text: 'Опиши фото' });
  });

  it('chat() при ошибке возвращает дружелюбный текст, а не бросает', async () => {
    postMock.mockRejectedValue({ response: { status: 500, data: 'boom' } });
    const provider = createOpenAiCompatibleProvider(makeConfig());

    const result = await provider.chat('Вопрос');

    expect(result).toContain('Извините');
  });

  it('capabilities.vision = false, если visionModel не задан', () => {
    const provider = createOpenAiCompatibleProvider(makeConfig({ visionModel: undefined }));
    expect(provider.capabilities.vision).toBe(false);
    expect(provider.capabilities.filesApi).toBe(false);
  });
});
