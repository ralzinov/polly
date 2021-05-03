import initBot from './src/bot.mjs';

(async () => {
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const storagePath = process.env.DATA_STORAGE_PATH;

    initBot(telegramToken, storagePath).catch((e) => {
        console.error(`Bot failed with error: ${e}`);
        process.exit(1);
    });
})();
