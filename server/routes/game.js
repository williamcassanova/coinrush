import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { query, withTransaction, countOnline } from '../db.js';
import { creditEarning, changeCoins } from '../lib/coins.js';

const router = Router();

async function loadMissions(userId) {
  const missions = await query(
    `SELECT m.code, m.title, m.description, m.type, m.target, m.reward_coin, m.daily_limit,
            (SELECT COUNT(*) FROM mission_claims c
              WHERE c.user_id = ? AND c.mission_code = m.code AND c.claim_day = CURDATE()) AS claimed_today
       FROM missions m
      WHERE m.active = 1
      ORDER BY m.id`,
    [userId],
  );

  const stats = await query(
    'SELECT rounds FROM game_stats WHERE user_id = ? AND stat_day = CURDATE() LIMIT 1',
    [userId],
  );
  const rounds = Number(stats[0]?.rounds || 0);

  return missions.map((m) => {
    const progress = m.type === 'rounds' ? Math.min(rounds, Number(m.target)) : Number(m.claimed_today) > 0 ? 1 : 0;
    return {
      code: m.code,
      title: m.title,
      description: m.description,
      type: m.type,
      target: Number(m.target),
      rewardCoin: Number(m.reward_coin),
      claimedToday: Number(m.claimed_today) > 0,
      progress,
      claimable:
        Number(m.claimed_today) === 0 &&
        (m.type === 'daily_login' || (m.type === 'rounds' && rounds >= Number(m.target))),
    };
  });
}

async function dailySummary(userId) {
  const stats = await query(
    'SELECT rounds, earned_coins FROM game_stats WHERE user_id = ? AND stat_day = CURDATE() LIMIT 1',
    [userId],
  );
  const roundsToday = await query(
    'SELECT COUNT(*) AS c FROM game_rounds WHERE user_id = ? AND DATE(started_at) = CURDATE()',
    [userId],
  );
  const earned = Number(stats[0]?.earned_coins || 0);
  return {
    roundsFinished: Number(stats[0]?.rounds || 0),
    roundsToday: Number(roundsToday[0]?.c || 0),
    roundsPerDay: config.game.roundsPerDay,
    earnedToday: earned,
    dailyCap: config.dailyCoinCap,
    remaining: Math.max(0, config.dailyCoinCap - earned),
  };
}

router.get('/state', requireAuth, async (req, res, next) => {
  try {
    const [summary, missions, online, installClaimed] = await Promise.all([
      dailySummary(req.user.id),
      loadMissions(req.user.id),
      countOnline(),
      query("SELECT id FROM user_bonuses WHERE user_id = ? AND code = 'install_app' LIMIT 1", [req.user.id]),
    ]);

    res.json({
      user: {
        id: req.user.id,
        name: req.user.name,
        avatar: req.user.avatar,
        coinBalance: Number(req.user.coin_balance),
        role: req.user.role,
      },
      today: summary,
      game: config.game,
      missions,
      online,
      bonuses: {
        install: { coin: config.installBonusCoin, claimed: installClaimed.length > 0 },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/round/start', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const today = await query(
      'SELECT COUNT(*) AS c FROM game_rounds WHERE user_id = ? AND DATE(started_at) = CURDATE()',
      [userId],
    );
    const played = Number(today[0]?.c || 0);
    if (played >= config.game.roundsPerDay) {
      return res.status(429).json({ error: 'Batas ronde harian tercapai' });
    }

    const seed = crypto.randomInt(1, 2 ** 31 - 1);
    const result = await query(
      'INSERT INTO game_rounds (user_id, seed, duration_ms, max_catch) VALUES (?, ?, ?, ?)',
      [userId, seed, config.game.roundDurationMs, config.game.roundMaxCatch],
    );

    res.json({
      roundId: result.insertId,
      seed,
      durationMs: config.game.roundDurationMs,
      maxCatch: config.game.roundMaxCatch,
      coinPerCatch: config.game.coinPerCatch,
      roundsLeft: config.game.roundsPerDay - played - 1,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/round/finish', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const roundId = Number(req.body?.roundId);
    const caughtRaw = Number(req.body?.caught);
    if (!Number.isInteger(roundId) || roundId <= 0) {
      return res.status(400).json({ error: 'Round tidak valid' });
    }

    const result = await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        'SELECT * FROM game_rounds WHERE id = ? AND user_id = ? FOR UPDATE',
        [roundId, userId],
      );
      if (!rows.length) {
        const e = new Error('Round tidak ditemukan');
        e.code = 'NOT_FOUND';
        throw e;
      }
      const round = rows[0];
      if (round.finished_at) {
        const e = new Error('Round sudah selesai');
        e.code = 'FINISHED';
        throw e;
      }

      const [elapsedRows] = await conn.query(
        'SELECT TIMESTAMPDIFF(MICROSECOND, started_at, NOW()) AS us FROM game_rounds WHERE id = ?',
        [roundId],
      );
      const elapsed = Number(elapsedRows[0]?.us || 0) / 1000;
      if (elapsed < Math.floor(Number(round.duration_ms) * 0.6)) {
        const e = new Error('Ronde belum selesai');
        e.code = 'TOO_FAST';
        throw e;
      }

      let caught = Number.isFinite(caughtRaw) ? Math.floor(caughtRaw) : 0;
      caught = Math.max(0, Math.min(caught, Number(round.max_catch)));

      const candidate = caught * config.game.coinPerCatch;
      const credit = await creditEarning(
        conn,
        userId,
        candidate,
        'gameplay',
        `round:${roundId}`,
        `Coin Rush (${caught} tangkap)`,
        config.dailyCoinCap,
      );

      await conn.query(
        'UPDATE game_rounds SET caught = ?, reward_coin = ?, finished_at = NOW() WHERE id = ?',
        [caught, credit.granted, roundId],
      );
      await conn.query('INSERT IGNORE INTO game_stats (user_id, stat_day) VALUES (?, CURDATE())', [userId]);
      await conn.query(
        'UPDATE game_stats SET rounds = rounds + 1 WHERE user_id = ? AND stat_day = CURDATE()',
        [userId],
      );

      return { caught, coinPerCatch: config.game.coinPerCatch, candidate, ...credit };
    });

    const summary = await dailySummary(userId);
    res.json({ ...result, today: summary });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'FINISHED') return res.status(409).json({ error: err.message });
    if (err.code === 'TOO_FAST') return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.get('/missions', requireAuth, async (req, res, next) => {
  try {
    res.json({ missions: await loadMissions(req.user.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/missions/:code/claim', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const code = req.params.code;

    const missions = await query('SELECT * FROM missions WHERE code = ? AND active = 1 LIMIT 1', [code]);
    if (!missions.length) return res.status(404).json({ error: 'Misi tidak ditemukan' });
    const mission = missions[0];

    if (mission.type === 'rounds') {
      const stats = await query(
        'SELECT rounds FROM game_stats WHERE user_id = ? AND stat_day = CURDATE() LIMIT 1',
        [userId],
      );
      if (Number(stats[0]?.rounds || 0) < Number(mission.target)) {
        return res.status(400).json({ error: 'Misi belum selesai' });
      }
    }

    const result = await withTransaction(async (conn) => {
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

      await conn.query(
        'INSERT INTO mission_claims (user_id, mission_code, claim_day, reward_coin) VALUES (?, ?, CURDATE(), ?)',
        [userId, code, mission.reward_coin],
      );

      return creditEarning(
        conn,
        userId,
        Number(mission.reward_coin),
        'mission',
        code,
        mission.title,
        config.dailyCoinCap,
      );
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Misi sudah diklaim hari ini' });
    if (err.code === 'DAILY_CAP') return res.status(409).json({ error: err.message });
    next(err);
  }
});

router.post('/bonus/install', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await withTransaction(async (conn) => {
      const [existing] = await conn.query(
        "SELECT id FROM user_bonuses WHERE user_id = ? AND code = 'install_app' LIMIT 1 FOR UPDATE",
        [userId],
      );
      if (existing.length) {
        const e = new Error('Bonus install sudah diklaim');
        e.code = 'CLAIMED';
        throw e;
      }

      await conn.query(
        "INSERT INTO user_bonuses (user_id, code, reward_coin) VALUES (?, 'install_app', ?)",
        [userId, config.installBonusCoin],
      );
      const balance = await changeCoins(
        conn,
        userId,
        config.installBonusCoin,
        'mission',
        'install_app',
        'Bonus install aplikasi',
      );
      return { balance };
    });

    return res.json({ ok: true, granted: config.installBonusCoin, balance: result.balance });
  } catch (err) {
    if (err.code === 'CLAIMED') return res.status(409).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Bonus install sudah diklaim' });
    next(err);
  }
});

export default router;
