import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { config } from '../config.js';
import { query, withTransaction, countOnline } from '../db.js';
import { changeCoins } from '../lib/coins.js';
import { sendTelegram, telegramEnabled } from '../telegram.js';

const router = Router();

router.use(requireAuth, requireAdmin);

const WD_STATUSES = new Set(['pending', 'processing', 'paid', 'rejected']);

router.get('/stats', async (_req, res, next) => {
  try {
    const [totals, pending, todayUsers, todayStats, todayWheel, online] = await Promise.all([
      query('SELECT COUNT(*) AS total_users, COALESCE(SUM(coin_balance),0) AS total_coins FROM users'),
      query("SELECT COUNT(*) AS pending FROM withdrawals WHERE status = 'pending'"),
      query('SELECT COUNT(*) AS today_users FROM users WHERE DATE(created_at) = CURDATE()'),
      query('SELECT COALESCE(SUM(rounds),0) AS today_rounds, COALESCE(SUM(earned_coins),0) AS today_earned FROM game_stats WHERE stat_day = CURDATE()'),
      query('SELECT COUNT(*) AS today_wheel FROM wheel_spins WHERE spin_day = CURDATE()'),
      countOnline(),
    ]);

    res.json({
      online,
      totalUsers: Number(totals[0].total_users),
      totalCoins: Number(totals[0].total_coins),
      pendingWithdrawals: Number(pending[0].pending),
      todayUsers: Number(todayUsers[0].today_users),
      todayRounds: Number(todayStats[0].today_rounds),
      todayWheelSpins: Number(todayWheel[0].today_wheel),
      todayEarned: Number(todayStats[0].today_earned),
      coinPerRupiah: config.coinPerRupiah,
      minWithdrawIdr: config.minWithdrawIdr,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/online', async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT u.id, u.name, u.email, MAX(s.last_seen) AS last_seen
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.last_seen > (NOW() - INTERVAL ? SECOND)
        GROUP BY u.id, u.name, u.email
        ORDER BY last_seen DESC
        LIMIT 200`,
      [config.onlineWindowSeconds],
    );
    res.json({ online: rows.length, players: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/withdrawals', async (req, res, next) => {
  try {
    const status = req.query.status;
    const params = [];
    let where = '';
    if (status && WD_STATUSES.has(String(status))) {
      where = 'WHERE w.status = ?';
      params.push(String(status));
    }
    const rows = await query(
      `SELECT w.*, u.name AS user_name, u.email AS user_email
         FROM withdrawals w
         JOIN users u ON u.id = w.user_id
         ${where}
        ORDER BY w.id DESC
        LIMIT 200`,
      params,
    );
    res.json({ withdrawals: rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/withdrawals/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status, note } = req.body || {};
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID tidak valid' });
    if (!['processing', 'paid', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid' });
    }

    const result = await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT * FROM withdrawals WHERE id = ? FOR UPDATE', [id]);
      if (!rows.length) {
        const e = new Error('Withdraw tidak ditemukan');
        e.code = 'NOT_FOUND';
        throw e;
      }
      const wd = rows[0];
      if (wd.status === 'paid' || wd.status === 'rejected') {
        const e = new Error('Withdraw sudah final, tidak bisa diubah');
        e.code = 'FINAL';
        throw e;
      }

      let balance = null;
      if (status === 'rejected') {
        balance = await changeCoins(conn, wd.user_id, Number(wd.coin_amount), 'adjust', `wd:${id}:refund`, note || 'Withdraw ditolak');
      }

      await conn.query('UPDATE withdrawals SET status = ?, note = ? WHERE id = ?', [
        status,
        note || wd.note,
        id,
      ]);

      return { userId: wd.user_id, amountIdr: Number(wd.amount_idr), balance };
    });

    if (telegramEnabled()) {
      sendTelegram(
        [
          '<b>🔄 Status withdraw diperbarui</b>',
          `ID: #${id}`,
          `Status: ${status}`,
          `Jumlah: Rp${result.amountIdr.toLocaleString('id-ID')}`,
          note ? `Catatan: ${note}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    res.json({ ok: true, status, refundedBalance: result.balance });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'FINAL') return res.status(409).json({ error: err.message });
    next(err);
  }
});

router.get('/users', async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, name, email, role, coin_balance, created_at
         FROM users
        ORDER BY id DESC
        LIMIT 100`,
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
