const { Keyboard } = require('vk-io');
const { BUTTONS } = require('../config/constants');

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

module.exports = {
  getMainKeyboard,
  getBloggersKeyboard,
  getBusinessKeyboard
};
