import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token tidak ada' });

    const payload = jwt.verify(token, config.jwtSecret);
    const rows = await query(
      'SELECT id, email, name, avatar, coin_balance, role FROM users WHERE id = ? LIMIT 1',
      [payload.sub],
    );
    if (!rows.length) return res.status(401).json({ error: 'User tidak ditemukan' });

    if (payload.jti) {
      await query('UPDATE sessions SET last_seen = NOW() WHERE jti = ?', [payload.jti]).catch(() => {});
    }

    req.user = { ...rows[0], jti: payload.jti };
    return next();
  } catch {
    return res.status(401).json({ error: 'Token tidak valid' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Akses admin diperlukan' });
  }
  return next();
}
