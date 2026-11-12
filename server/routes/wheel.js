import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { creditEarning } from '../lib/coins.js';
import { WHEEL_PRIZES, pickPrizeIndex, publicPrizes } from '../lib/wheel.js';

const router = Router();

async function spinsToday(userId, conn = null) {
  const sql =
    'SELECT COUNT(*) AS c FROM wheel_spins WHERE user_id = ? AND spin_day = CURDATE()';
  if (conn) {
    const [rows] = await conn.query(sql, [userId]);
    return Number(rows[0]?.c || 0);
  }
  const rows = await query(sql, [userId]);
  return Number(rows[0]?.c || 0);
}

async function earnedToday(userId) {
  const rows = await query(
    'SELECT earned_coins FROM game_stats WHERE user_id = ? AND stat_day = CURDATE() LIMIT 1',
    [userId],
  );
  return Number(rows[0]?.earned_coins || 0);
}

router.get('/state', requireAuth, async (req, res, next) => {
  try {
    const used = await spinsToday(req.user.id);
    const earned = await earnedToday(req.user.id);
    res.json({
      prizes: publicPrizes(),
      spinsPerDay: config.wheel.spinsPerDay,
      spinsLeft: Math.max(0, config.wheel.spinsPerDay - used),
      adSeconds: config.wheel.adSeconds,
      dailyCap: config.dailyCoinCap,
      earnedToday: earned,
      remaining: Math.max(0, config.dailyCoinCap - earned),
    });
  } catch (err) {
    next(err);
  }
});

// Placeholder gerbang iklan: token dianggap sah bila waktu tonton terpenuhi.
// Saat integrasi jaringan iklan asli, terbitkan token lewat callback SSV mereka.
router.post('/ad', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const used = await spinsToday(userId);
    if (used >= config.wheel.spinsPerDay) {
      return res.status(409).json({ error: 'Jatah putaran hari ini habis' });
    }
    const earned = await earnedToday(userId);
    if (earned >= config.dailyCoinCap) {
      return res.status(409).json({ error: 'Batas coin harian sudah tercapai' });
    }

    const token = crypto.randomUUID();
    await query(
      'INSERT INTO ad_tokens (user_id, token, purpose, watch_seconds) VALUES (?, ?, ?, ?)',
      [userId, token, 'wheel', config.wheel.adSeconds],
    );

    res.json({ adToken: token, watchSeconds: config.wheel.adSeconds });
  } catch (err) {
    next(err);
  }
});

router.post('/spin', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const adToken = String(req.body?.adToken || '').trim();
    if (!adToken) return res.status(400).json({ error: 'Token iklan tidak ada' });

    const result = await withTransaction(async (conn) => {
      const [tokens] = await conn.query(
        'SELECT * FROM ad_tokens WHERE token = ? AND user_id = ? AND purpose = ? FOR UPDATE',
        [adToken, userId, 'wheel'],
      );
      if (!tokens.length) {
        const e = new Error('Token iklan tidak valid');
        e.code = 'BAD_TOKEN';
        throw e;
      }
      const token = tokens[0];
      if (token.used_at) {
        const e = new Error('Iklan sudah dipakai');
        e.code = 'USED';
        throw e;
      }

      const [elapsedRows] = await conn.query(
        'SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS s FROM ad_tokens WHERE id = ?',
        [token.id],
      );
      if (Number(elapsedRows[0]?.s || 0) < Number(token.watch_seconds)) {
        const e = new Error('Iklan belum selesai ditonton');
        e.code = 'NOT_DONE';
        throw e;
      }

      const used = await spinsToday(userId, conn);
      if (used >= config.wheel.spinsPerDay) {
        const e = new Error('Jatah putaran hari ini habis');
        e.code = 'NO_SPINS';
        throw e;
      }

      await conn.query('INSERT IGNORE INTO game_stats (user_id, stat_day) VALUES (?, CURDATE())', [userId]);
      const [st] = await conn.query(
        'SELECT earned_coins FROM game_stats WHERE user_id = ? AND stat_day = CURDATE() FOR UPDATE',
        [userId],
      );
      if (Number(st[0]?.earned_coins || 0) >= config.dailyCoinCap) {
        const e = new Error('Batas coin harian sudah tercapai');
        e.code = 'DAILY_CAP';
        throw e;
      }

      const prizeIndex = pickPrizeIndex();
      const prize = WHEEL_PRIZES[prizeIndex];
      const credit = await creditEarning(
        conn,
        userId,
        prize.coin,
        'wheel',
        `wheel:${token.id}`,
        `Roda: ${prize.label} coin`,
        config.dailyCoinCap,
      );

      await conn.query('UPDATE ad_tokens SET used_at = NOW() WHERE id = ?', [token.id]);
      await conn.query(
        'INSERT INTO wheel_spins (user_id, spin_day, prize_index, reward_coin) VALUES (?, CURDATE(), ?, ?)',
        [userId, prizeIndex, credit.granted],
      );

      return { prizeIndex, prizeCoin: prize.coin, ...credit, spinsLeft: Math.max(0, config.wheel.spinsPerDay - used - 1) };
    });

    const earned = await earnedToday(userId);
    res.json({ ...result, earnedToday: earned, remaining: Math.max(0, config.dailyCoinCap - earned) });
  } catch (err) {
    if (['BAD_TOKEN', 'USED', 'NOT_DONE', 'NO_SPINS', 'DAILY_CAP'].includes(err.code)) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
