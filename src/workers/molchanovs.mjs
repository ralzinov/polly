import _ from 'lodash';
import fetch from 'node-fetch';
import html from 'node-html-parser';

const POOLS = {
    CHAIKA: {
        label: 'Чайка',
        id: '65b64540-c816-11ea-bbd3-0050568342b3',
        trainings: ['ad66550f-cb3f-11ea-bbd3-0050568342b3']
    },
    MCHS: {
        label: 'МЧС',
        id: 'da11d109-cb37-11ea-bbd3-0050568342b3',
        trainings: ['632f7da9-23f8-11eb-bbe5-0050568342b3']
    },
    ZIL: {
        label: 'ЗИЛ',
        id: 'da11d108-cb37-11ea-bbd3-0050568342b3',
        trainings: ['ad505156-f343-11ea-bbe4-0050568342b3']
    }
};

const getTrainers = (htmlData) => {
    const trainers = htmlData.querySelectorAll('[data-employee]');
    const trainersMap = {};
    trainers.forEach((record) => {
        try {
            const {id} = JSON.parse(record.attributes['data-filter-option']);
            trainersMap[id] = record.innerText.trim();
        } catch (e) {
            console.error('Failed to parse trainer record');
        }
    });
    return trainersMap;
}

const mapData = (htmlData, trainers) => {
    const records = htmlData.querySelectorAll('[data-option-filter]');
    const data = [];
    records.forEach((record, index) => {
        let count = {};
        record.querySelectorAll('.place-table_res').forEach((item) => {
            const text = item.innerText.trim().replace(/\s/gm, '').toLowerCase();
            if (text.includes('free')) {
                const [free, total] = text.split(':')[1]?.split('from');
                count = {
                    free: parseInt(free, 10),
                    total: parseInt(total, 10)
                };
            }
        });

        if (isNaN(count.free) || isNaN(count.total)) {
            return;
        }

        let options = {};
        try {
            options = {
                ...JSON.parse(record.attributes['data-option-filter']),
                ...JSON.parse(record.querySelector('[data-timetable-item]').attributes['data-options']),
            };
        } catch (e) {
            console.error(`Failed to parse data of item #${index}. Skipping`);
        }
        data.push({
            trainingType: options.service,
            startDate: options.start_date,
            trainer: trainers[options.employee],
            ...count
        });
    });
    return data.sort((a, b) => {
        const dateA = new Date(a.startDate);
        const dateB = new Date(b.startDate);
        return dateA - dateB;
    });
}

const fetchData = async (id) => {
    const response = await fetch('https://reservi.ru/api-fit1c/json/v2/', {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded'
        },
        body: [
            'method=getFitCalendar',
            'api_key=9dd877e0-8eaf-41dc-97b0-a9a0ef8e5400', // seems to be persistent
            'params[salonId]=' + id,
            'params[getAll]=Y',
            'lang=en'
        ].join('&')
    }).then((r) => r.json());

    const trainers = getTrainers(html.parse(response.SLIDER.ALL_BLOCK));
    return mapData(html.parse(response.SLIDER.BODY), trainers);
};

const formatDate = (date) => (new Date(date)).toLocaleDateString('en', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

const formatMessage = (id, entries) => {
    const poolConfig = _.find(POOLS, {id});
    if (!poolConfig) {
        console.error(`Cannot find config for pool with id "${id}"`);
        return '';
    }
    const messageBody = entries.map((entry) => {
        return `_${formatDate(entry.startDate)}_\n` +
            `${entry.trainer}\n` +
            `Free *${entry.free} of ${entry.total}*\n`
    });
    return `*${poolConfig.label}*\n${messageBody.join('\n')}`
};

const worker = async () => {
    const pools = Object.values(POOLS);
    const data = await Promise.all(pools.map(({id, label}) => {
        return fetchData(id).catch((e) => console.error(`Failed to fetch data for "${label}"`, e));
    }));
    return pools.reduce((acc, {id, trainings}, index) => ({
        ...acc,
        [id]: data[index].filter(({trainingType}) => trainings.includes(trainingType))
    }), {});
};

const getDiff = (prevData, data) => {
    const getMapPath = (record) => [
        record.trainingType,
        record.startDate,
        record.trainer,
        `t${record.total}`,
        `f${record.free}`
    ];
    const prevDataMap = prevData?.reduce((acc, record) => _.set(acc, getMapPath(record), true), {});
    return data.filter((record) => !_.get(prevDataMap, getMapPath(record)));
}

const notifier = (bot, users = {}) => async (prevData, data) => {
    let result = false;
    Object.entries(data).forEach(([id, message], messageIndex) => {
        if (!_.isEqual(message, prevData?.[id])) {
            const diff = getDiff(prevData?.[id], message);
            const messageText = formatMessage(id, diff);
            Object.keys(users).forEach((id, index) => {
                setTimeout(() => {
                    bot.telegram.sendMessage(id, messageText, {
                        parse_mode: 'Markdown'
                    }).catch((e) => {
                        console.error(`Failed to send message to used with ${id}`, e);
                    });
                }, 1000 * index + messageIndex);
            });
            result = Object.keys(users).length > 0;
        }
    });
    return result;
}

export default {
    worker,
    notifier
};
