const TelegramBot = require('node-telegram-bot-api');

class Telegram {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.PETGANG_TELEGRAM_CHAT_ID;

    if (!this.botToken || !this.chatId) {
      this.isEnabled = false;
      return;
    }

    this.isEnabled = true;
    this.bot = new TelegramBot(this.botToken, { polling: false });
  }
}

module.exports = Telegram;
