import amqplib from 'amqplib';
import { EXCHANGE } from './events.js';
import { requireEnvironment } from './securityConfig.js';
import { DEAD_LETTER_EXCHANGE, closeTransferPublisher } from './messageTransfer.js';
import { createDeliveryHandler, validateRetryPolicy } from './consumeDelivery.js';

// Lop bao quanh amqplib de moi service khong phai lap lai phan ket noi, khai bao
// exchange va logic ket noi lai. Dung topic exchange: ben gui chi quan tam
// routing key, ben nhan tu chon pattern minh muon nghe.

let connection = null;
let channel = null;
let connecting = null;
let stopping = false;
let draining = false;
const inFlight = new Set();
let reconnectTimer = null;
const closedChannels = new WeakSet();

// Danh sach cac dang ky lang nghe dang hoat dong.
//
// Phai nho lai vi mot ly do song con: khi mat ket noi, ben GUI tu hoi phuc duoc
// (moi lan publish deu goi getChannel), nhung ben NHAN thi khong - no dang ky
// mot lan luc khoi dong roi thoi. RabbitMQ khoi dong lai mot cai la moi consumer
// chet lang: khong loi, khong log, chi la khong nhan duoc gi nua. Da xay ra that:
// nhat ky hoat dong ngung ghi dung luc RabbitMQ tat, va khong bao gio ghi lai.
const subscriptions = [];
let resubscribing = false;

const log = (msg, extra = '') => console.log(`[rabbitmq] ${msg}`, extra);

// Dang ky lai tat ca cac hang doi sau khi ket noi lai duoc.
const resubscribeAll = async () => {
    if (draining || stopping || resubscribing || subscriptions.length === 0) return;
    resubscribing = true;
    try {
        for (const sub of subscriptions) {
            await attachConsumer(sub);
        }
        log(`da dang ky lai ${subscriptions.length} hang doi sau khi ket noi lai`);
    } catch (error) {
        log('dang ky lai that bai, se thu o lan ket noi sau', error.message);
        scheduleReconnect();
    } finally {
        resubscribing = false;
    }
};

const scheduleReconnect = () => {
    if (stopping || draining || reconnectTimer || subscriptions.length === 0) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        getChannel().then(() => resubscribeAll()).catch((error) => {
            log('ket noi lai that bai', error.message);
            scheduleReconnect();
        });
    }, 3000);
};

// Container thuong khoi dong nhanh hon RabbitMQ, nen phai thu lai thay vi chet ngay.
const connectWithRetry = async (url, attempt = 1) => {
    if (stopping) throw new Error('RabbitMQ consumer is stopping');
    try {
        const conn = await amqplib.connect(url);
        log('da ket noi');
        return conn;
    } catch (error) {
        const delay = Math.min(attempt * 2000, 15000);
        log(`ket noi that bai (${error.message}), thu lai sau ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return connectWithRetry(url, attempt + 1);
    }
};

export const getChannel = async () => {
    if (stopping) throw new Error('RabbitMQ consumer is stopping');
    if (channel) return channel;
    // Nhieu lenh goi song song luc khoi dong deu se cho chung mot lan ket noi.
    if (connecting) return connecting;

    const opening = (async () => {
        const url = requireEnvironment('RABBITMQ_URL');
        const conn = await connectWithRetry(url);
        if (stopping) {
            await conn.close();
            throw new Error('RabbitMQ consumer is stopping');
        }
        connection = conn;
        let ch;
        const invalidate = () => {
            if (ch) closedChannels.add(ch);
            if (connection !== conn) return;
            connection = null;
            channel = null;
            Promise.resolve().then(() => conn.close()).catch(() => {});
            scheduleReconnect();
        };
        conn.on('error', (err) => log('loi ket noi', err.message));
        conn.on('close', invalidate);
        try {
            ch = await conn.createChannel();
            ch.on('error', (err) => { log('loi consumer channel', err.message); invalidate(); });
            ch.on('close', invalidate);
            await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
            await ch.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
            if (stopping || connection !== conn || closedChannels.has(ch)) throw new Error('RabbitMQ consumer channel closed');
            channel = ch;
            return ch;
        } catch (error) {
            invalidate();
            throw error;
        }
    })().finally(() => {
        if (connecting === opening) connecting = null;
    });
    connecting = opening;

    return connecting;
};

// Legacy direct publish: persistent, but not confirmed. Outbox and error transfers
// use separate confirmed publishers; migrating remaining direct publishers is separate work.
export const publish = async (routingKey, payload) => {
    const ch = await getChannel();
    const body = Buffer.from(JSON.stringify(payload));
    ch.publish(EXCHANGE, routingKey, body, {
        persistent: true,
        contentType: 'application/json',
        timestamp: Date.now()
    });
    log(`gui su kien ${routingKey}`);
};

// Dang ky mot hang doi len ket noi hien tai. Tach rieng de goi lai duoc sau khi
// ket noi lai, khong phai khoi dong lai ca service.
const attachConsumer = async (sub) => {
    if (draining || stopping) throw new Error('RabbitMQ consumer is draining');
    const { queueName, patterns, handler, prefetch, retry } = sub;
    const ch = await getChannel();
    if (sub.channel === ch) return;
    if (sub.attaching?.channel === ch) return sub.attaching.promise;
    const attaching = (async () => {
        const deadLetterQueue = `${queueName}.dead-letter`;
        // Preserve existing queue arguments: no in-place TTL/DLX conversion.
        await ch.assertQueue(deadLetterQueue, { durable: true });
        await ch.bindQueue(deadLetterQueue, DEAD_LETTER_EXCHANGE, queueName);
        await ch.assertQueue(queueName, { durable: true });
        await ch.prefetch(prefetch);

        for (const pattern of patterns) {
            await ch.bindQueue(queueName, EXCHANGE, pattern);
        }

        log(`hang doi ${queueName} dang nghe: ${patterns.join(', ')}`);

        const callback = createDeliveryHandler({
            channel: ch, queueName, handler, retry,
            isActive: () => !stopping && !closedChannels.has(ch)
        });
        if (draining || stopping) throw new Error('RabbitMQ consumer is draining');
        const consumer = await ch.consume(queueName, async (msg) => {
            if (!msg) {
                // Broker cancelled this consumer (for example its queue was deleted).
                try { await ch.close(); } catch { /* Connection recovery owns the next attempt. */ }
                return;
            }
            const work = callback(msg);
            inFlight.add(work);
            try { await work; } finally { inFlight.delete(work); }
        });
        sub.consumerTag = consumer?.consumerTag;
        if (closedChannels.has(ch) || stopping) throw new Error('RabbitMQ consumer channel closed');
        sub.channel = ch;
    })();
    sub.attaching = { channel: ch, promise: attaching };
    try { await attaching; } finally {
        if (sub.attaching?.promise === attaching) sub.attaching = null;
    }
};

// Dang ky lang nghe. patterns la mang routing key (ho tro ky tu dai dien cua topic).
// prefetch gioi han so tin xu ly cung luc - quan trong voi AI worker vi moi tin
// ton mot lan goi model, khong the om ca hang doi mot luc.
export const consume = async (queueName, patterns, handler, { prefetch = 5, retry } = {}) => {
    const sub = { queueName, patterns, handler, prefetch, retry: validateRetryPolicy(retry) };
    // Nho lai de tu dang ky lai khi ket noi lai duoc.
    subscriptions.push(sub);
    await attachConsumer(sub);
};

export const closeConnection = async () => {
    stopping = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    closeTransferPublisher();
    const ch = channel;
    const conn = connection;
    if (ch) closedChannels.add(ch);
    channel = null;
    connection = null;
    try { if (ch) await ch.close(); } catch { /* Already closed. */ }
    try { if (conn) await conn.close(); } catch { /* Already closed. */ }
};

export const isConsumerReady = () => !stopping && !draining && Boolean(channel)
    && subscriptions.length > 0 && subscriptions.every((sub) => sub.channel === channel && !closedChannels.has(channel));

// Cancel delivery first; in-flight handlers must still ACK on the open channel.
// The service runtime owns the timeout. Timed-out/unacked work is redelivered.
export const drainConsumers = async () => {
    draining = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    await Promise.all(subscriptions.map(async (sub) => {
        if (sub.attaching) await sub.attaching.promise.catch(() => {});
        if (sub.consumerTag && sub.channel && !closedChannels.has(sub.channel)) {
            await sub.channel.cancel(sub.consumerTag);
        }
    }));
    await Promise.allSettled([...inFlight]);
};
