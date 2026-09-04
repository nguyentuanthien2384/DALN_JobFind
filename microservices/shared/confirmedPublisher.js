import { randomUUID } from 'node:crypto';

// Mot bo listener cho moi channel, ke ca khi nhieu message dang cho confirm.
// ACK cua broker va drain cua bo dem la hai dieu kien khac nhau.
export const createConfirmedPublisher = (channel, { timeoutMs = 10_000 } = {}) => {
    const pending = new Map();
    let closed = false;

    const failAll = (error) => {
        closed = true;
        for (const item of pending.values()) item.finish(error);
    };
    const invalidate = (error) => {
        failAll(error);
        // Dong channel de giai phong callback unconfirmed trong amqplib.
        Promise.resolve().then(() => channel.close()).catch(() => {});
    };

    channel.on('error', invalidate);
    channel.on('close', () => failAll(new Error('RabbitMQ confirm channel closed')));
    channel.on('return', (msg) => {
        const item = pending.get(msg.properties?.headers?.['x-publish-id']);
        item?.finish(new Error(`RabbitMQ unroutable message: ${msg.fields?.replyText || 'NO_ROUTE'}`));
    });
    channel.on('drain', () => {
        for (const item of pending.values()) {
            item.drained = true;
            item.check();
        }
    });

    return (exchange, routingKey, body, options) => new Promise((resolve, reject) => {
        if (closed) return reject(new Error('RabbitMQ confirm channel closed'));
        const publishId = randomUUID();
        let timer;
        const item = {
            written: false,
            drained: false,
            confirmed: false,
            finish(error) {
                if (!pending.delete(publishId)) return;
                clearTimeout(timer);
                if (error) reject(error);
                else resolve();
            },
            check() {
                if (this.written && this.drained && this.confirmed) this.finish();
            }
        };
        pending.set(publishId, item);
        timer = setTimeout(() => invalidate(new Error('RabbitMQ publisher confirm timeout')), timeoutMs);

        try {
            item.drained = channel.publish(exchange, routingKey, body, {
                ...options,
                mandatory: true,
                headers: { ...options?.headers, 'x-publish-id': publishId }
            }, (error) => {
                if (error) item.finish(error);
                else {
                    item.confirmed = true;
                    item.check();
                }
            });
            item.written = true;
            item.check();
        } catch (error) {
            invalidate(error);
        }
    });
};
