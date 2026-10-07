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

function getPhotoUrl(context) {
  const photo = context.attachments.find((attachment) => attachment.type === 'photo' || attachment.largeSizeUrl || attachment.payload?.sizes);

  if (!photo) return null;

  const sizes = photo.sizes || photo.payload?.sizes || [];
  const biggestSize = sizes
    .filter((size) => size.url)
    .sort((first, second) => (second.width * second.height) - (first.width * first.height))[0];

  return biggestSize?.url || photo.largeSizeUrl || photo.mediumSizeUrl || photo.smallSizeUrl || null;
}

async function withTyping(vk, context, task) {
  const sendTyping = async () => {
    try {
      await vk.api.messages.setActivity({
        type: 'typing',
        peer_id: context.peerId
      });
    } catch (error) {
      console.warn('Не удалось отправить статус typing:', error.message || error);
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
  sendWithOptionalKeyboard,
  getPhotoUrl,
  withTyping
};
