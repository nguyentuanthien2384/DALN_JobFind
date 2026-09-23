import db from '../models/index';

const presenceUserId = value => {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^[1-9][0-9]*$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

// Greatest prevents delayed writes from another node moving last-seen backwards.
// This records observed activity, not a claim that the user read any message.
export const touch = async (userId, at = new Date()) => {
    const id = presenceUserId(userId);
    if (!id || at == null || !Number.isFinite(new Date(at).getTime())) throw new Error('Invalid presence');
    await db.sequelize.query(`INSERT INTO RealtimePresences (userId, lastSeenAt) VALUES ($userId, $at)
        ON DUPLICATE KEY UPDATE lastSeenAt = GREATEST(lastSeenAt, VALUES(lastSeenAt))`, {
        bind: { userId: id, at: new Date(at) },
    });
};
export const lastSeen = async (userId) => {
    const id = presenceUserId(userId);
    if (!id) throw new Error('Invalid presence');
    const row = await db.RealtimePresence.findByPk(id, { raw: true });
    return row ? new Date(row.lastSeenAt).toISOString() : null;
};
