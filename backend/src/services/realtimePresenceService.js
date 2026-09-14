import db from '../models/index';

// Greatest prevents delayed writes from another node moving last-seen backwards.
// This records observed activity, not a claim that the user read any message.
export const touch = async (userId, at = new Date()) => {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0 || !Number.isFinite(new Date(at).getTime())) throw new Error('Invalid presence');
    await db.sequelize.query(`INSERT INTO RealtimePresences (userId, lastSeenAt) VALUES ($userId, $at)
        ON DUPLICATE KEY UPDATE lastSeenAt = GREATEST(lastSeenAt, VALUES(lastSeenAt))`, {
        bind: { userId: Number(userId), at: new Date(at) },
    });
};
export const lastSeen = async (userId) => {
    const row = await db.RealtimePresence.findByPk(Number(userId), { raw: true });
    return row ? new Date(row.lastSeenAt).toISOString() : null;
};
