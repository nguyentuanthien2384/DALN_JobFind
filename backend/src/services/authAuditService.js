import db from '../models/index';

const EVENTS = new Set(['login_succeeded', 'login_failed', 'sso_rejected', 'identity_linked',
  'identity_unlinked', 'session_revoked', 'sessions_revoked_all', 'refresh_reuse_detected', 'account_security_changed']);

// Store a coarse, untrusted device description, never the raw User-Agent/IP,
// credentials, OAuth codes, tokens, email, or arbitrary error messages.
export const deviceLabel = (req) => {
  const ua = String(req?.get?.('User-Agent') || '').slice(0, 1024);
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows' : /Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Thiết bị khác';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt khác';
  return `${browser} · ${os}`;
};

export const recordSecurityEvent = async ({ event, userId = null, device = null }, transaction) => {
  if (!EVENTS.has(event)) throw new Error('UNKNOWN_AUTH_EVENT');
  const write = async () => {
    try {
      await db.AuthSecurityEvent.create({ event, userId, deviceLabel: device?.slice(0, 120) || null });
    } catch {
      // A logging outage must never undo revocation or expose sensitive data.
      console.error('AUTH_AUDIT_WRITE_FAILED');
    }
  };
  if (transaction?.afterCommit) transaction.afterCommit(write);
  else await write();
};

export const recentSecurityEvents = async (userId, before) => {
  if (before !== undefined && (typeof before !== 'string' || !/^[1-9]\d{0,15}$/.test(before))) throw new Error('INVALID_CURSOR');
  const rows = await db.AuthSecurityEvent.findAll({ raw: true,
    where: { userId, ...(before ? { id: { [db.Sequelize.Op.lt]: before } } : {}) },
    attributes: ['id', 'event', 'deviceLabel', 'createdAt'], order: [['id', 'DESC']], limit: 21,
  });
  return { events: rows.slice(0, 20), nextCursor: rows.length > 20 ? String(rows[19].id) : null };
};
