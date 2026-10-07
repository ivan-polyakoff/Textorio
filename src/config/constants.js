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

module.exports = {
  BUTTONS,
  USER_STATES
};
