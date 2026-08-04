import amqplib from 'amqplib';
import { EXCHANGE } from './events.js';

// Lop bao quanh amqplib de moi service khong phai lap lai phan ket noi, khai bao
// exchange va logic ket noi lai. Dung topic exchange: ben gui chi quan tam
// routing key, ben nhan tu chon pattern minh muon nghe.

let connection = null;
let channel = null;
let connecting = null;

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
    if (resubscribing || subscriptions.length === 0) return;
    resubscribing = true;
    try {
        for (const sub of subscriptions) {
            await attachConsumer(sub);
        }
        log(`da dang ky lai ${subscriptions.length} hang doi sau khi ket noi lai`);
    } catch (error) {
        log('dang ky lai that bai, se thu o lan ket noi sau', error.message);
    } finally {
        resubscribing = false;
    }
};

// Container thuong khoi dong nhanh hon RabbitMQ, nen phai thu lai thay vi chet ngay.
const connectWithRetry = async (url, attempt = 1) => {
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
    if (channel) return channel;
    // Nhieu lenh goi song song luc khoi dong deu se cho chung mot lan ket noi.
    if (connecting) return connecting;

    connecting = (async () => {
        const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
        connection = await connectWithRetry(url);

        connection.on('error', (err) => log('loi ket noi', err.message));
        connection.on('close', () => {
            log('ket noi dong');
            connection = null;
            channel = null;
            connecting = null;

            // Chu dong ket noi lai neu service nay dang lang nghe hang doi nao do.
            // Ben gui co the doi den lan publish ke tiep, nhung ben nhan thi khong
            // co "lan ke tiep" nao ca - phai tu bat lai, neu khong no im lang mai mai.
            if (subscriptions.length > 0) {
                setTimeout(() => {
                    getChannel()
                        .then(() => resubscribeAll())
                        .catch((err) => log('ket noi lai that bai', err.message));
                }, 3000);
            }
        });

        channel = await connection.createChannel();
        await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
        connecting = null;
        return channel;
    })();

    return connecting;
};

// Gui mot su kien. durable + persistent de tin khong mat khi RabbitMQ restart.
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
const attachConsumer = async ({ queueName, patterns, handler, prefetch }) => {
    const ch = await getChannel();
    await ch.assertQueue(queueName, { durable: true });
    await ch.prefetch(prefetch);

    for (const pattern of patterns) {
        await ch.bindQueue(queueName, EXCHANGE, pattern);
    }

    log(`hang doi ${queueName} dang nghe: ${patterns.join(', ')}`);

    await ch.consume(queueName, async (msg) => {
        if (!msg) return;
        let payload;
        try {
            payload = JSON.parse(msg.content.toString());
        } catch (error) {
            // Tin hong thi khong bao gio parse duoc, requeue chi lam no quay vong mai.
            log('tin khong doc duoc, bo qua', error.message);
            ch.nack(msg, false, false);
            return;
        }

        try {
            await handler(payload, msg.fields.routingKey);
            ch.ack(msg);
        } catch (error) {
            log(`xu ly ${msg.fields.routingKey} that bai: ${error.message}`);
            // requeue = false: day sang dead letter thay vi lap vo han. Neu can
            // thu lai thi nen dung hang doi retry co do tre tang dan.
            ch.nack(msg, false, false);
        }
    });
};

// Dang ky lang nghe. patterns la mang routing key (ho tro ky tu dai dien cua topic).
// prefetch gioi han so tin xu ly cung luc - quan trong voi AI worker vi moi tin
// ton mot lan goi model, khong the om ca hang doi mot luc.
export const consume = async (queueName, patterns, handler, { prefetch = 5 } = {}) => {
    const sub = { queueName, patterns, handler, prefetch };
    // Nho lai de tu dang ky lai khi ket noi lai duoc.
    subscriptions.push(sub);
    await attachConsumer(sub);
};

export const closeConnection = async () => {
    try {
        if (channel) await channel.close();
        if (connection) await connection.close();
    } catch {
        // Dang tat may chu, loi luc dong khong con y nghia gi.
    }
};
