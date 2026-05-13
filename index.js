// Main entry point for Textorio VK Bot
// Подключаем необходимые модули
const { VK, Keyboard } = require('vk-io');
const dotenv = require('dotenv');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const FormData = require('form-data');
const { randomUUID } = require('crypto');

// Загружаем переменные окружения
dotenv.config();

// Создаем экземпляр VK бота
const vk = new VK({
  token: process.env.VK_GROUP_TOKEN,
  pollingGroupId: process.env.GROUP_ID
});

const BUTTONS = {
  MAIN_MENU: 'Главное меню',
  BLOGGERS: 'Блогерам',
  BUSINESS: 'Бизнесу',
  STYLE: 'Улучшить стиль',
  POST: 'Создать пост',
  PHOTO_POST: 'Пост по фото',
  STYLE_TRAINING: 'Обучить стилю',
  PRODUCT: 'Описание товара',
  AD: 'Рекламный текст',
  CLIENT_REPLY: 'Ответ клиенту'
};

const USER_STATES = {
  WAITING_STYLE_TEXT: 'waiting_style_text',
  WAITING_POST_TOPIC: 'waiting_post_topic',
  WAITING_POST_PHOTO: 'waiting_post_photo',
  WAITING_PRODUCT_DESCRIPTION: 'waiting_product_description',
  WAITING_AD_DESCRIPTION: 'waiting_ad_description',
  WAITING_CLIENT_REPLY_SITUATION: 'waiting_client_reply_situation'
};

const userStates = new Map();

const GIGACHAT_TIMEOUT_MS = Number(process.env.GIGACHAT_TIMEOUT_MS) || 30000;
const GIGACHAT_RETRY_ATTEMPTS = Number(process.env.GIGACHAT_RETRY_ATTEMPTS) || 3;
const GIGACHAT_AUTH_URL = process.env.GIGACHAT_AUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const GIGACHAT_API_URL = process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';
const GIGACHAT_FILES_URL = process.env.GIGACHAT_FILES_URL || 'https://gigachat.devices.sberbank.ru/api/v1/files';
const GIGACHAT_TEXT_MODEL = process.env.GIGACHAT_TEXT_MODEL || 'GigaChat';
const GIGACHAT_VISION_MODEL = process.env.GIGACHAT_VISION_MODEL || 'GigaChat-Pro';
const VK_PHOTO_DOWNLOAD_TIMEOUT_MS = Number(process.env.VK_PHOTO_DOWNLOAD_TIMEOUT_MS) || 30000;
const GIGACHAT_CA_BUNDLE_FILE = process.env.GIGACHAT_CA_BUNDLE_FILE;

const gigachatHttpsAgentOptions = {
  keepAlive: false,
  rejectUnauthorized: process.env.GIGACHAT_REJECT_UNAUTHORIZED !== 'false'
};

if (GIGACHAT_CA_BUNDLE_FILE) {
  gigachatHttpsAgentOptions.ca = fs.readFileSync(GIGACHAT_CA_BUNDLE_FILE);
}

const gigachatClient = axios.create({
  timeout: GIGACHAT_TIMEOUT_MS,
  httpsAgent: new https.Agent(gigachatHttpsAgentOptions)
});

function getMainKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: BUTTONS.BLOGGERS,
      payload: { menu: 'bloggers' },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: BUTTONS.BUSINESS,
      payload: { menu: 'business' },
      color: Keyboard.POSITIVE_COLOR
    })
    .oneTime(false);
}

function getBloggersKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: BUTTONS.STYLE,
      payload: { command: 'style_help' },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: BUTTONS.POST,
      payload: { command: 'post_help' },
      color: Keyboard.PRIMARY_COLOR
    })
    .row()
    .textButton({
      label: BUTTONS.PHOTO_POST,
      payload: { command: 'photo_post_help' },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: BUTTONS.STYLE_TRAINING,
      payload: { command: 'style_training' },
      color: Keyboard.SECONDARY_COLOR
    })
    .row()
    .textButton({
      label: BUTTONS.MAIN_MENU,
      payload: { menu: 'main' },
      color: Keyboard.SECONDARY_COLOR
    })
    .oneTime(false);
}

function getBusinessKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: BUTTONS.PRODUCT,
      payload: { command: 'product_help' },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: BUTTONS.AD,
      payload: { command: 'ad_help' },
      color: Keyboard.POSITIVE_COLOR
    })
    .row()
    .textButton({
      label: BUTTONS.CLIENT_REPLY,
      payload: { command: 'client_reply_help' },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: BUTTONS.MAIN_MENU,
      payload: { menu: 'main' },
      color: Keyboard.SECONDARY_COLOR
    })
    .oneTime(false);
}

async function sendWithOptionalKeyboard(context, text, keyboard) {
  if (!keyboard) {
    return context.send(text);
  }

  try {
    return await context.send(text, { keyboard });
  } catch (error) {
    if (error.code !== 912) {
      throw error;
    }

    console.warn('VK не разрешил отправить клавиатуру. Включите возможности ботов в настройках сообщества. Сообщение отправлено без кнопок.');
    return context.send(text);
  }
}

const retryableNetworkCodes = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ENETUNREACH'
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(error) {
  if (error.response) return false;
  return retryableNetworkCodes.has(error.code) || retryableNetworkCodes.has(error.cause?.code);
}

function formatAxiosError(error) {
  if (error.response) {
    const data = Buffer.isBuffer(error.response.data)
      ? error.response.data.toString('utf8', 0, 500)
      : error.response.data;

    return {
      status: error.response.status,
      data
    };
  }

  return {
    code: error.code,
    causeCode: error.cause?.code,
    syscall: error.syscall || error.cause?.syscall,
    hostname: error.hostname || error.cause?.hostname,
    message: error.message
  };
}

async function requestWithRetry(label, requestFn) {
  let lastError;

  for (let attempt = 1; attempt <= GIGACHAT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;

      if (!isRetryableNetworkError(error) || attempt === GIGACHAT_RETRY_ATTEMPTS) {
        break;
      }

      const delayMs = 500 * attempt;
      console.warn(`${label}: сетевая ошибка ${error.code || error.cause?.code || error.message}. Повтор ${attempt + 1}/${GIGACHAT_RETRY_ATTEMPTS} через ${delayMs} мс.`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

// Функция для получения access token
async function getAccessToken() {
  try {
    if (!process.env.GIGACHAT_API_KEY) {
      throw new Error('Не задан GIGACHAT_API_KEY в .env');
    }

    const body = new URLSearchParams({
      scope: 'GIGACHAT_API_PERS'
    });

    const response = await requestWithRetry('Получение токена GigaChat', () => gigachatClient.post(GIGACHAT_AUTH_URL, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'RqUID': randomUUID(),
        'Authorization': `Bearer ${process.env.GIGACHAT_API_KEY}`
      }
    }));

    if (!response.data?.access_token) {
      throw new Error('GigaChat OAuth не вернул access_token');
    }

    return response.data;
  } catch (error) {
    console.error('Ошибка при получении токена доступа:', formatAxiosError(error));
    throw error;
  }
}

// Кэш для токена
let accessTokenCache = null;
let tokenExpiryTime = 0;

async function getCachedAccessToken() {
  const now = Date.now();

  if (accessTokenCache && now < tokenExpiryTime) {
    return accessTokenCache;
  }

  const tokenData = await getAccessToken();
  accessTokenCache = tokenData.access_token;

  if (typeof tokenData.expires_at === 'number') {
    tokenExpiryTime = tokenData.expires_at - (5 * 60 * 1000);
  } else {
    tokenExpiryTime = now + (25 * 60 * 1000); // Обновляем за 5 минут до истечения
  }

  return accessTokenCache;
}

function getFileExtensionFromContentType(contentType) {
  if (!contentType) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('bmp')) return 'bmp';
  if (contentType.includes('tiff')) return 'tiff';
  return 'jpg';
}

function getPhotoUrl(context) {
  const photo = context.attachments.find((attachment) => attachment.type === 'photo' || attachment.largeSizeUrl || attachment.payload?.sizes);

  if (!photo) return null;

  const sizes = photo.sizes || photo.payload?.sizes || [];
  const biggestSize = sizes
    .filter((size) => size.url)
    .sort((first, second) => (second.width * second.height) - (first.width * first.height))[0];

  return biggestSize?.url || photo.largeSizeUrl || photo.mediumSizeUrl || photo.smallSizeUrl || null;
}

async function downloadImage(imageUrl) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: VK_PHOTO_DOWNLOAD_TIMEOUT_MS,
      maxRedirects: 5,
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 TextorioBot/0.1'
      },
      validateStatus: (status) => status >= 200 && status < 300
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';

    if (!contentType.startsWith('image/')) {
      throw new Error(`VK вернул не изображение, content-type: ${contentType}`);
    }

    return {
      buffer: Buffer.from(response.data),
      contentType
    };
  } catch (error) {
    const url = new URL(imageUrl);
    error.message = `Не удалось скачать фото из VK (${url.hostname}): ${error.message}`;
    throw error;
  }
}

async function uploadImageToGigaChat(imageUrl) {
  const accessToken = await getCachedAccessToken();
  const image = await downloadImage(imageUrl);
  const form = new FormData();
  const extension = getFileExtensionFromContentType(image.contentType);

  form.append('file', image.buffer, {
    filename: `vk-photo-${Date.now()}.${extension}`,
    contentType: image.contentType
  });
  form.append('purpose', 'general');

  const response = await requestWithRetry('Загрузка изображения в GigaChat', () => gigachatClient.post(GIGACHAT_FILES_URL, form, {
    headers: {
      ...form.getHeaders(),
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  }));

  if (!response.data?.id) {
    throw new Error('GigaChat Files API не вернул id загруженного файла');
  }

  return response.data.id;
}

// Функция для генерации текста через Гигачат
async function generateText(prompt) {
  try {
    const accessToken = await getCachedAccessToken();

    const response = await requestWithRetry('Запрос к GigaChat', () => gigachatClient.post(GIGACHAT_API_URL, {
      messages: [
        { role: 'user', content: prompt }
      ],
      model: GIGACHAT_TEXT_MODEL,
      stream: false
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    }));
    
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Ошибка при обращении к Гигачат:', formatAxiosError(error));
    return 'Извините, произошла ошибка при генерации текста. Попробуйте позже.';
  }
}

async function generatePostFromPhoto(imageUrl, caption = '') {
  try {
    const accessToken = await getCachedAccessToken();
    const fileId = await uploadImageToGigaChat(imageUrl);
    const prompt = [
      'Напиши готовый пост для социальной сети по приложенному фото.',
      'Опиши, что видно на изображении, найди цепляющий угол подачи, добавь короткий заголовок и основной текст.',
      'Стиль: живой, понятный, без штампов и чрезмерных обещаний.',
      caption ? `Дополнительный комментарий пользователя: ${caption}` : ''
    ].filter(Boolean).join('\n');

    const response = await requestWithRetry('Запрос к GigaChat Vision', () => gigachatClient.post(GIGACHAT_API_URL, {
      model: GIGACHAT_VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: prompt,
          attachments: [fileId]
        }
      ],
      stream: false
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    }));

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Ошибка при генерации поста по фото:', formatAxiosError(error));
    return 'Извините, не получилось создать пост по фото. Попробуйте позже или пришлите другое изображение.';
  }
}

// Обработка новых сообщений
vk.updates.on('message_new', async (context) => {
  try {
    const text = context.text?.trim() || '';
    const hasAttachments = context.attachments.length > 0;
    if (!text && !hasAttachments) return;

    console.log(`Получено сообщение от ${context.senderId}: ${text}`);

    // Пример простой команды
    if (text === '/start' || text === BUTTONS.MAIN_MENU) {
      userStates.delete(context.senderId);
      await sendWithOptionalKeyboard(
        context,
        'Привет! Я Textorio — бот для создания и улучшения текстов.\n\nВыберите, для кого нужен текст:',
        getMainKeyboard()
      );
      return;
    }

    if (text === BUTTONS.BLOGGERS) {
      userStates.delete(context.senderId);
      await sendWithOptionalKeyboard(
        context,
        'Раздел для блогеров. Выберите задачу.',
        getBloggersKeyboard()
      );
      return;
    }

    if (text === BUTTONS.BUSINESS) {
      userStates.delete(context.senderId);
      await sendWithOptionalKeyboard(
        context,
        'Раздел для малого бизнеса. Выберите задачу.',
        getBusinessKeyboard()
      );
      return;
    }

    if (text === BUTTONS.STYLE) {
      userStates.set(context.senderId, USER_STATES.WAITING_STYLE_TEXT);
      await sendWithOptionalKeyboard(
        context,
        'Пришлите текст, который нужно улучшить.',
        getBloggersKeyboard()
      );
      return;
    }

    if (text === BUTTONS.POST) {
      userStates.set(context.senderId, USER_STATES.WAITING_POST_TOPIC);
      await sendWithOptionalKeyboard(
        context,
        'Напишите тему поста.',
        getBloggersKeyboard()
      );
      return;
    }

    if (text === BUTTONS.PHOTO_POST) {
      userStates.set(context.senderId, USER_STATES.WAITING_POST_PHOTO);
      await sendWithOptionalKeyboard(
        context,
        'Пришлите фото, по которому нужно написать пост. Можно добавить короткий комментарий к фото.',
        getBloggersKeyboard()
      );
      return;
    }

    if (text === BUTTONS.STYLE_TRAINING || text === '/обучить') {
      await sendWithOptionalKeyboard(
        context,
        'Обучение стилю пока в разработке. Скоро можно будет прислать примеры текстов, а я буду писать в похожей манере.',
        getBloggersKeyboard()
      );
      return;
    }

    if (text === BUTTONS.PRODUCT) {
      userStates.set(context.senderId, USER_STATES.WAITING_PRODUCT_DESCRIPTION);
      await sendWithOptionalKeyboard(
        context,
        'Опишите товар: что продаем, для кого и какие главные преимущества.',
        getBusinessKeyboard()
      );
      return;
    }

    if (text === BUTTONS.AD) {
      userStates.set(context.senderId, USER_STATES.WAITING_AD_DESCRIPTION);
      await sendWithOptionalKeyboard(
        context,
        'Опишите вводные для рекламы: продукт, аудитория, акция или главный оффер.',
        getBusinessKeyboard()
      );
      return;
    }

    if (text === BUTTONS.CLIENT_REPLY) {
      userStates.set(context.senderId, USER_STATES.WAITING_CLIENT_REPLY_SITUATION);
      await sendWithOptionalKeyboard(
        context,
        'Опишите ситуацию: что написал клиент и какой тон ответа нужен.',
        getBusinessKeyboard()
      );
      return;
    }

    const userState = userStates.get(context.senderId);

    if (userState === USER_STATES.WAITING_STYLE_TEXT) {
      if (!text) {
        await sendWithOptionalKeyboard(context, 'Пришлите текст, который нужно улучшить.', getBloggersKeyboard());
        return;
      }

      userStates.delete(context.senderId);
      const improvedText = await generateText(`Улучши стиль следующего текста, сделай его более живым и вовлекающим для аудитории: ${text}`);
      await sendWithOptionalKeyboard(context, improvedText, getBloggersKeyboard());
      return;
    }

    if (userState === USER_STATES.WAITING_POST_TOPIC) {
      if (!text) {
        await sendWithOptionalKeyboard(context, 'Напишите тему поста текстом или выберите "Пост по фото".', getBloggersKeyboard());
        return;
      }

      userStates.delete(context.senderId);
      const postText = await generateText(`Создай интересный и цепляющий пост для социальной сети на тему: ${text}`);
      await sendWithOptionalKeyboard(context, postText, getBloggersKeyboard());
      return;
    }

    if (userState === USER_STATES.WAITING_POST_PHOTO) {
      const photoUrl = getPhotoUrl(context);

      if (!photoUrl) {
        await sendWithOptionalKeyboard(context, 'Не вижу фото в сообщении. Пришлите изображение одним сообщением.', getBloggersKeyboard());
        return;
      }

      userStates.delete(context.senderId);
      const postText = await generatePostFromPhoto(photoUrl, text);
      await sendWithOptionalKeyboard(context, postText, getBloggersKeyboard());
      return;
    }

    if (userState === USER_STATES.WAITING_PRODUCT_DESCRIPTION) {
      if (!text) {
        await sendWithOptionalKeyboard(context, 'Опишите товар текстом: что продаем, для кого и какие главные преимущества.', getBusinessKeyboard());
        return;
      }

      userStates.delete(context.senderId);
      const productText = await generateText(`Напиши продающее и подробное описание товара для интернет-магазина на основе следующей информации: ${text}`);
      await sendWithOptionalKeyboard(context, productText, getBusinessKeyboard());
      return;
    }

    if (userState === USER_STATES.WAITING_AD_DESCRIPTION) {
      if (!text) {
        await sendWithOptionalKeyboard(context, 'Опишите вводные для рекламы текстом: продукт, аудитория, акция или главный оффер.', getBusinessKeyboard());
        return;
      }

      userStates.delete(context.senderId);
      const adText = await generateText(`Напиши рекламный текст для малого бизнеса. Сделай его понятным, убедительным и без агрессивных обещаний. Вводные: ${text}`);
      await sendWithOptionalKeyboard(context, adText, getBusinessKeyboard());
      return;
    }

    if (userState === USER_STATES.WAITING_CLIENT_REPLY_SITUATION) {
      if (!text) {
        await sendWithOptionalKeyboard(context, 'Опишите ситуацию текстом: что написал клиент и какой тон ответа нужен.', getBusinessKeyboard());
        return;
      }

      userStates.delete(context.senderId);
      const replyText = await generateText(`Подготовь вежливый и полезный ответ клиенту от имени малого бизнеса. Сохрани спокойный профессиональный тон. Ситуация: ${text}`);
      await sendWithOptionalKeyboard(context, replyText, getBusinessKeyboard());
      return;
    }

    // Интеграция с Гигачат
    if (text === '/стиль') {
      userStates.set(context.senderId, USER_STATES.WAITING_STYLE_TEXT);
      await sendWithOptionalKeyboard(context, 'Пришлите текст, который нужно улучшить.', getBloggersKeyboard());
      return;
    }

    if (text.startsWith('/стиль ')) {
      const inputText = text.slice(7).trim();
      const improvedText = await generateText(`Улучши стиль следующего текста, сделай его более живым и вовлекающим для аудитории: ${inputText}`);
      await sendWithOptionalKeyboard(context, improvedText, getBloggersKeyboard());
      return;
    }

    // Генерация поста по теме
    if (text === '/пост') {
      userStates.set(context.senderId, USER_STATES.WAITING_POST_TOPIC);
      await sendWithOptionalKeyboard(context, 'Напишите тему поста.', getBloggersKeyboard());
      return;
    }

    if (text.startsWith('/пост ')) {
      const topic = text.slice(6).trim();
      const postText = await generateText(`Создай интересный и цепляющий пост для социальной сети на тему: ${topic}`);
      await sendWithOptionalKeyboard(context, postText, getBloggersKeyboard());
      return;
    }

    if (text === '/фотопост') {
      userStates.set(context.senderId, USER_STATES.WAITING_POST_PHOTO);
      await sendWithOptionalKeyboard(context, 'Пришлите фото, по которому нужно написать пост. Можно добавить короткий комментарий к фото.', getBloggersKeyboard());
      return;
    }

    if (text.startsWith('/фотопост ')) {
      const photoUrl = getPhotoUrl(context);

      if (!photoUrl) {
        userStates.set(context.senderId, USER_STATES.WAITING_POST_PHOTO);
        await sendWithOptionalKeyboard(context, 'Пришлите фото следующим сообщением. Комментарий я учту.', getBloggersKeyboard());
        return;
      }

      const caption = text.slice(10).trim();
      const postText = await generatePostFromPhoto(photoUrl, caption);
      await sendWithOptionalKeyboard(context, postText, getBloggersKeyboard());
      return;
    }

    // Генерация описания товара
    if (text === '/товар') {
      userStates.set(context.senderId, USER_STATES.WAITING_PRODUCT_DESCRIPTION);
      await sendWithOptionalKeyboard(context, 'Опишите товар: что продаем, для кого и какие главные преимущества.', getBusinessKeyboard());
      return;
    }

    if (text.startsWith('/товар ')) {
      const description = text.slice(7).trim();
      const productText = await generateText(`Напиши продающее и подробное описание товара для интернет-магазина на основе следующей информации: ${description}`);
      await sendWithOptionalKeyboard(context, productText, getBusinessKeyboard());
      return;
    }

    // Генерация рекламного текста
    if (text === '/реклама') {
      userStates.set(context.senderId, USER_STATES.WAITING_AD_DESCRIPTION);
      await sendWithOptionalKeyboard(context, 'Опишите вводные для рекламы: продукт, аудитория, акция или главный оффер.', getBusinessKeyboard());
      return;
    }

    if (text.startsWith('/реклама ')) {
      const description = text.slice(9).trim();
      const adText = await generateText(`Напиши рекламный текст для малого бизнеса. Сделай его понятным, убедительным и без агрессивных обещаний. Вводные: ${description}`);
      await sendWithOptionalKeyboard(context, adText, getBusinessKeyboard());
      return;
    }

    // Генерация ответа клиенту
    if (text === '/ответ') {
      userStates.set(context.senderId, USER_STATES.WAITING_CLIENT_REPLY_SITUATION);
      await sendWithOptionalKeyboard(context, 'Опишите ситуацию: что написал клиент и какой тон ответа нужен.', getBusinessKeyboard());
      return;
    }

    if (text.startsWith('/ответ ')) {
      const situation = text.slice(7).trim();
      const replyText = await generateText(`Подготовь вежливый и полезный ответ клиенту от имени малого бизнеса. Сохрани спокойный профессиональный тон. Ситуация: ${situation}`);
      await sendWithOptionalKeyboard(context, replyText, getBusinessKeyboard());
      return;
    }

    // Ответ по умолчанию
    await sendWithOptionalKeyboard(
      context,
      'Я пока не понял запрос. Нажмите кнопку меню или используйте /start.',
      getMainKeyboard()
    );
  } catch (error) {
    console.error('Ошибка обработки сообщения:', error);
    try {
      await context.send('Произошла ошибка при обработке вашего запроса. Попробуйте позже.');
    } catch (sendError) {
      console.error('Не удалось отправить сообщение:', sendError);
    }
  }
});

// Запускаем прослушивание обновлений через Long Poll
(async () => {
  try {
    await vk.updates.start();
    console.log('Textorio VK Bot успешно подключился к Long Poll API и готов к работе!');
  } catch (error) {
    console.error('\n❌ Ошибка подключения к Long Poll API:');
    console.error('1. Убедитесь, что в настройках группы ВК (https://vk.com/editapp?id=238319313) в разделе "Работа с API" включен тип сервера "Long Poll API" и он активирован.');
    console.error('2. Проверьте, что GROUP_ID в .env совпадает с ID вашей группы (сейчас: 238319313).');
    console.error('3. Убедитесь, что у токена VK_GROUP_TOKEN есть права на управление сообщениями группы.');
    console.error('4. Проверьте интернет-соединение и доступность API ВКонтакте.');
    console.error('\nПодробнее об ошибке:', error.response?.data || error.message || error);
    process.exit(1);
  }
})();

console.log('Textorio VK Bot запущен и готов к работе!');
