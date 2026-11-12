import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { changeCoins } from '../lib/coins.js';
import { sendTelegram, telegramEnabled } from '../telegram.js';

const router = Router();

const METHODS = new Set(['ewallet', 'bank']);
const PROVIDER_MAX = 50;
const NAME_MAX = 120;
const ACCOUNT_MAX = 50;

async function firstWithdrawEligible(userId) {
  const rows = await query(
    "SELECT COUNT(*) AS c FROM withdrawals WHERE user_id = ? AND status <> 'rejected'",
    [userId],
  );
  return Number(rows[0]?.c || 0) === 0;
}

router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const [rows, eligible] = await Promise.all([
      query(
        `SELECT id, amount_idr, coin_amount, method, provider, account_name, account_number,
                status, note, created_at
           FROM withdrawals
          WHERE user_id = ?
          ORDER BY id DESC
          LIMIT 50`,
        [req.user.id],
      ),
      firstWithdrawEligible(req.user.id),
    ]);
    res.json({
      withdrawals: rows,
      firstWithdrawEligible: eligible,
      presets: config.withdrawPresets,
      firstWithdrawIdr: config.firstWithdrawIdr,
      firstWithdrawProvider: config.firstWithdrawProvider,
      minWithdrawIdr: config.minWithdrawIdr,
      coinPerRupiah: config.coinPerRupiah,
      coinBalance: Number(req.user.coin_balance),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { amountIdr, method, provider, accountName, accountNumber } = req.body || {};

    const idr = Number(amountIdr);
    if (!Number.isInteger(idr) || idr <= 0) {
      return res.status(400).json({ error: 'Jumlah withdraw tidak valid' });
    }
    if (!METHODS.has(method)) return res.status(400).json({ error: 'Metode tidak valid' });

    const prov = String(provider || '').trim();
    const name = String(accountName || '').trim();
    const number = String(accountNumber || '').trim();
    if (!prov || prov.length > PROVIDER_MAX) return res.status(400).json({ error: 'Provider tidak valid' });
    if (!name || name.length > NAME_MAX) return res.status(400).json({ error: 'Nama pemilik rekening tidak valid' });
    if (!number || number.length > ACCOUNT_MAX) return res.status(400).json({ error: 'Nomor rekening/e-wallet tidak valid' });

    const eligible = await firstWithdrawEligible(req.user.id);
    const isFirstSpecial = idr === config.firstWithdrawIdr;

    if (isFirstSpecial) {
      if (!eligible) {
        return res.status(400).json({ error: `Penarikan Rp${config.firstWithdrawIdr} hanya untuk pencairan pertama` });
      }
      if (method !== 'ewallet' || prov.toUpperCase() !== config.firstWithdrawProvider) {
        return res.status(400).json({ error: `Penarikan pertama Rp${config.firstWithdrawIdr} hanya via e-wallet ${config.firstWithdrawProvider}` });
      }
    } else if (idr < config.minWithdrawIdr) {
      return res.status(400).json({
        error: `Minimal withdraw Rp${config.minWithdrawIdr.toLocaleString('id-ID')} (atau Rp${config.firstWithdrawIdr} khusus pertama via ${config.firstWithdrawProvider})`,
      });
    }

    const coinCost = idr * config.coinPerRupiah;

    const result = await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT coin_balance FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
      if (!rows.length) throw new Error('User tidak ditemukan');
      if (Number(rows[0].coin_balance) < coinCost) {
        const e = new Error('Saldo coin tidak cukup');
        e.code = 'INSUFFICIENT_BALANCE';
        throw e;
      }

      const [ins] = await conn.query(
        `INSERT INTO withdrawals (user_id, amount_idr, coin_amount, method, provider, account_name, account_number)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, idr, coinCost, method, prov, name, number],
      );

      const balance = await changeCoins(conn, req.user.id, -coinCost, 'withdraw', `wd:${ins.insertId}`, 'Permintaan withdraw');
      return { id: ins.insertId, balance, coinCost };
    });

    if (telegramEnabled()) {
      sendTelegram(
        [
          '<b>💸 Withdraw baru (pending)</b>',
          `User: ${req.user.name || req.user.email}`,
          `Jumlah: Rp${idr.toLocaleString('id-ID')}`,
          `Metode: ${method} - ${prov}`,
          `Rekening: ${name} / ${number}`,
          `ID: #${result.id}`,
        ].join('\n'),
      );
    }

    return res.json({ ok: true, withdrawalId: result.id, coinCost: result.coinCost, balance: result.balance });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') return res.status(400).json({ error: err.message });
    next(err);
  }
});

export default router;
