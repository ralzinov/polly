import _ from 'lodash';
import lowdb from 'lowdb';
import {Telegraf} from 'telegraf';
import FileAsync from 'lowdb/adapters/FileAsync.js';
import workers from './workers/index.mjs';

const DB_TEMPLATE = {
    data: {},
    users: {},
    state: {}
};

const initDb = async (dbPath) => {
    const adapter = new FileAsync(`${dbPath && !dbPath.endsWith('/') ? '/' : ''}db.json`);
    const db = await lowdb(adapter);
    await db.defaults(DB_TEMPLATE).write();
    return db;
}

const onMessageSent = (sent) => {
    if (sent) {
        console.log('Messages was sent');
    } else {
        console.log('Nothing to send');
    }
};

const handleStartMessage = (bot, db) => async (ctx) => {
    const userId = ctx.update.message.from.id;
    const users = await db.get('users').value();
    if (!users[userId]) {
        console.log(`Adding new user with id: "${userId}"`);
        try {
            await db.set(`users.${userId}`, {userId}).write();
            const data = await db.get('data').value();
            Object.entries(workers).forEach(([name, {notifier}], index) => {
                setTimeout(() => {
                    notifier(bot, {[userId]: {}})({}, data[name]).then(onMessageSent);
                }, 1000 * index + 1);
            });
            return ctx.reply('Welcome');
        } catch (e) {
            console.error('Failed to add new user to db', e);
        }
    }
    return ctx.reply('I know you (≖_≖) ');
}

const startPolling = async (bot, db, config) => {
    const loopIntervalSec = 10;
    const pollEvery = async (timeSec) => {
        if (bot.botInfo) {
            const users = await db.get('users').value();
            const persistentData = _.cloneDeep((await db.get('data').value()));
            const state = await db.get('state').value();
            await Promise.all(Object.entries(workers).map(([name, {worker, notifier}]) => {
                const timestamp = state?.[name]?.timestamp || 0;
                const pollingIntervalMs = 1000 * 60 * config.pollingIntervalMin;
                const isTimedOut = timestamp + pollingIntervalMs < Date.now();
                const notifyUsers = notifier(bot, users);
                const dataPath = ['data', name];
                if (isTimedOut) {
                    console.log(`Fetching data for "${name}"`);
                    return db
                        .set(['state', name, 'timestamp'], Date.now())
                        .write()
                        .then(worker)
                        .then((data) => db.set(dataPath, data).write().then(() => data))
                        .then((data) => notifyUsers(persistentData[name], data))
                        .then(onMessageSent);
                }
            }));
        }
        setTimeout(() => pollEvery(loopIntervalSec), 1000 * timeSec);
    };
    return pollEvery(loopIntervalSec);
}

export default async (token, dbPath) => {
    const bot = new Telegraf(token);
    const db = await initDb(dbPath?.trim());

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

    bot.start(handleStartMessage(bot, db));
    startPolling(bot, db, {
        pollingIntervalMin: 5
    });

    try {
        console.log('Start');
        await bot.launch();
    } catch (e) {
        throw new Error(`Failed to launch bot: ${e}`);
    }
}
