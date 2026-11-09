const { logger } = require('./logger');

const VK_MESSAGE_MAX_LENGTH = 4096;

// Единое место построения клавиатур: core двигает только данные.
// vk-io требуется лениво: модуль использует dynamic import,
// который ломает Jest без --experimental-vm-modules.
let cachedKeyboardModule = null;

function getKeyboardModule() {
  if (!cachedKeyboardModule) {
    cachedKeyboardModule = require('vk-io');
  }
  return cachedKeyboardModule.Keyboard;
}

function buildKeyboard(rows) {
  const Keyboard = getKeyboardModule();

  const colors = {
    primary: Keyboard.PRIMARY_COLOR,
    positive: Keyboard.POSITIVE_COLOR,
    secondary: Keyboard.SECONDARY_COLOR
  };

  const builder = Keyboard.builder();
  rows.forEach((row, index) => {
    if (index > 0) builder.row();
    row.forEach(({ label, color }) => {
      builder.textButton({
        label,
        payload: { command: label },
        color: colors[color] || colors.primary
      });
    });
  });
  builder.oneTime(false);
  return builder;
}

function splitMessage(text, maxLength = VK_MESSAGE_MAX_LENGTH) {
  const source = String(text ?? '');

  if (source.length <= maxLength) {
    return [source];
  }

  const parts = [];
  let remaining = source;

  while (remaining.length > maxLength) {
    // Сначала пробуем резать по переводам строк, затем по пробелам,
    // и только в крайнем случае — жёстко по лимиту.
    let cutIndex = remaining.lastIndexOf('\n', maxLength - 1);

    if (cutIndex < maxLength * 0.5) {
      cutIndex = remaining.lastIndexOf(' ', maxLength - 1);
    }

    if (cutIndex < maxLength * 0.5) {
      cutIndex = maxLength - 1;
    }

    parts.push(remaining.slice(0, cutIndex).trimEnd());
    remaining = remaining.slice(cutIndex).trimStart();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

async function sendPart(context, text, keyboard) {
  if (!keyboard) {
    return context.send(text);
  }

  try {
    return await context.send(text, { keyboard });
  } catch (error) {
    if (error.code !== 912) {
      throw error;
    }

    logger.warn('VK не разрешил отправить клавиатуру (код 912). Сообщение отправлено без кнопок.');
    return context.send(text);
  }
}

async function sendWithOptionalKeyboard(context, text, keyboard) {
  const parts = splitMessage(text);

  for (let index = 0; index < parts.length; index += 1) {
    const isLastPart = index === parts.length - 1;
    // Клавиатуру прикрепляем к последней части.
    await sendPart(context, parts[index], isLastPart ? keyboard : undefined);
  }
}

// Возвращает список URL фото от большего размера к меньшему.
// Разные размеры лежат на разных серверах CDN — это позволяет
// переключиться на другой хост при 429/ошибках одного из них.
function getPhotoUrls(context) {
  const photo = context.attachments.find((attachment) => attachment.type === 'photo');

  if (!photo) return [];

  const sizes = photo.sizes || photo.payload?.sizes || [];
  const urls = sizes
    .filter((size) => size.url)
    .sort((first, second) => (second.width * second.height) - (first.width * first.height))
    .map((size) => size.url);

  for (const fallback of [photo.largeSizeUrl, photo.mediumSizeUrl, photo.smallSizeUrl]) {
    if (fallback && !urls.includes(fallback)) {
      urls.push(fallback);
    }
  }

  return urls;
}

async function withTyping(vk, context, task) {
  const sendTyping = async () => {
    try {
      await vk.api.messages.setActivity({
        type: 'typing',
        peer_id: context.peerId
      });
    } catch (error) {
      logger.warn('Не удалось отправить статус typing:', error.message || error);
    }
  };

  await sendTyping();
  const intervalId = setInterval(sendTyping, 4000);

  try {
    return await task();
  } finally {
    clearInterval(intervalId);
  }
}

module.exports = {
  splitMessage,
  sendWithOptionalKeyboard,
  getPhotoUrls,
  withTyping
};
