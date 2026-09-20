import { activeFamily } from '../services/authSessionService';
// Legacy JWT is an explicit migration compatibility switch, OFF by default in production.
export const validAccessSession = async (claims) => {
  if (claims?.sid) return activeFamily(claims.sid, Number(claims.sub));
  return process.env.AUTH_ALLOW_LEGACY_TOKENS === 'true'
    || (process.env.NODE_ENV !== 'production' && process.env.AUTH_ALLOW_LEGACY_TOKENS !== 'false');
};
