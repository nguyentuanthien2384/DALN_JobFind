import { createLogger } from '../../../shared/logger.js';
import { sendEmail, pushRealtime, EMAIL_SKIP_REASONS } from './channels.js';
import { claimDelivery, finishDelivery } from './deliveryStore.js';

const logger = createLogger('notification-delivery');
const MAX_ATTEMPTS = 10;

export const deliveryOutcome = (channel, result = {}) => {
    if (result.sent) return { status: 'sent' };
    if (result.skipped) {
        const missingConfig = channel === 'realtime' || [
            EMAIL_SKIP_REASONS.NOT_CONFIGURED, EMAIL_SKIP_REASONS.NO_SAFE_DEMO_RECIPIENT
        ].includes(result.reason);
        return { status: missingConfig ? 'pending' : 'skipped', error: result.reason || 'not_configured' };
    }
    const error = result.error || 'delivery_result_missing';
    if (channel === 'realtime') return { status: 'pending', error };
    // Explicit SMTP rejection means the message was NOT accepted, so a 4xx is safe to retry.
    const explicitRejection = ['EENVELOPE', 'EMESSAGE', 'EAUTH', 'EPROTOCOL'].includes(result.code);
    if (explicitRejection && result.responseCode >= 400 && result.responseCode < 500) return { status: 'pending', error };
    if (explicitRejection && result.responseCode >= 500 && result.responseCode < 600) return { status: 'failed', error };
    // Only errors known to precede message transmission can be retried automatically.
    // Nodemailer labels socket loss/timeouts as CONN even AFTER DATA. CONN is not proof of safety.
    if (['EDNS', 'EAUTH'].includes(result.code)) {
        return { status: 'pending', error };
    }
    return { status: 'unknown', error };
};

const attemptDelivery = async (channel, payload) => {
    // Deadline does not cancel SMTP. The result is unknown and must never be auto-retried.
    let timer;
    try {
        return await Promise.race([
            channel === 'email' ? sendEmail(payload) : pushRealtime(payload),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve({ error: 'delivery_deadline_exceeded' }), 60000);
                timer.unref();
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
};

export const runDeliveryOnce = async ({ stats } = {}) => {
    const row = await claimDelivery();
    if (!row) return false;
    let outcome;
    let result;
    let payload;
    try {
        payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        if (!payload || !['email', 'realtime'].includes(row.channel)) throw new Error('Invalid delivery payload/channel');
    } catch (error) {
        outcome = { status: 'failed', error: error.message };
    }
    if (!outcome) {
        try {
            result = await attemptDelivery(row.channel, payload);
            outcome = deliveryOutcome(row.channel, result);
        } catch (error) {
            outcome = deliveryOutcome(row.channel, { error: error.message });
        }
        // Configuration can be supplied later; keep those intents pending without exhausting retries.
        if (result?.skipped) outcome.attempted = false;
        if (outcome.status === 'pending' && !result?.skipped && row.attempts >= MAX_ATTEMPTS) {
            outcome.status = 'failed';
        }
    }
    // If this write fails, leave processing intact. Recovery quarantines email as unknown.
    const updated = await finishDelivery(row, outcome);
    if (updated && stats) {
        if (outcome.status === 'sent') stats[row.channel === 'email' ? 'emailed' : 'pushed'] += 1;
        if (['failed', 'unknown'].includes(outcome.status)) stats.failed += 1;
    }
    if (updated && ['failed', 'unknown'].includes(outcome.status)) {
        logger.warn('can kiem tra lan gui thong bao', {
            id: row.id, eventId: row.eventId, channel: row.channel, status: outcome.status
        });
    }
    return true;
};

export const startDeliveryWorker = ({ stats, intervalMs = 1000 } = {}) => {
    let stopped = false;
    let timer;
    const tick = async () => {
        try {
            // One sender per process; additional replicas coordinate through database row locks.
            for (let i = 0; i < 20 && !stopped; i += 1) {
                if (!await runDeliveryOnce({ stats })) break;
            }
        } catch (error) {
            logger.error('xu ly hang doi thong bao that bai', { error: error.message });
        } finally {
            if (!stopped) {
                timer = setTimeout(tick, intervalMs);
                timer.unref();
            }
        }
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
};
