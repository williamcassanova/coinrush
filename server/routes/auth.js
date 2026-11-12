import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { changeCoins } from '../lib/coins.js';
import { generateUniqueReferralCode } from '../lib/referral.js';

const router = Router();
const googleClient = new OAuth2Client(config.googleClientId);

function publicConfig() {
  return {
    googleClientId: config.googleClientId,
    coinPerRupiah: config.coinPerRupiah,
    minWithdrawIdr: config.minWithdrawIdr,
    firstWithdrawIdr: config.firstWithdrawIdr,
    firstWithdrawProvider: config.firstWithdrawProvider,
    withdrawPresets: config.withdrawPresets,
    dailyCoinCap: config.dailyCoinCap,
    heartbeatSeconds: config.heartbeatSeconds,
    onlineWindowSeconds: config.onlineWindowSeconds,
    game: config.game,
    wheel: { spinsPerDay: config.wheel.spinsPerDay, adSeconds: config.wheel.adSeconds },
    referral: config.referral,
    installBonusCoin: config.installBonusCoin,
  };
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    role: user.role,
    coinBalance: Number(user.coin_balance ?? 0),
    referralCode: user.referral_code || null,
  };
}

router.get('/config', (_req, res) => {
  res.json(publicConfig());
});

router.post('/google', async (req, res) => {
  try {
    const { credential, referralCode } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Credential Google wajib dikirim' });
    if (!config.googleClientId) {
      return res.status(500).json({ error: 'GOOGLE_CLIENT_ID belum diatur di .env' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: config.googleClientId,
    });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) return res.status(401).json({ error: 'Token Google tidak valid' });

    const email = p.email.toLowerCase();
    const isAdminEmail = config.adminEmails.includes(email);

    let user = (await query('SELECT * FROM users WHERE google_sub = ? LIMIT 1', [p.sub]))[0];

    if (!user) {
      user = await withTransaction(async (conn) => {
        const code = await generateUniqueReferralCode(conn);
        const role = isAdminEmail ? 'admin' : 'player';

        let referrerId = null;
        const refInput = String(referralCode || '').trim().toUpperCase();
        if (refInput) {
          const [refRows] = await conn.query(
            'SELECT id FROM users WHERE referral_code = ? LIMIT 1',
            [refInput],
          );
          if (refRows.length) referrerId = refRows[0].id;
        }

        const [ins] = await conn.query(
          `INSERT INTO users (google_sub, email, name, avatar, role, referral_code, referred_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [p.sub, email, p.name || null, p.picture || null, role, code, referrerId],
        );
        const newUserId = ins.insertId;

        if (referrerId) {
          await conn.query(
            'INSERT INTO referrals (referrer_id, invitee_id, reward_referrer, reward_invitee) VALUES (?, ?, ?, ?)',
            [referrerId, newUserId, config.referral.rewardReferrer, config.referral.rewardInvitee],
          );
          await changeCoins(conn, referrerId, config.referral.rewardReferrer, 'referral', `ref:${newUserId}:referrer`, 'Bonus ajak teman');
          await changeCoins(conn, newUserId, config.referral.rewardInvitee, 'referral', `ref:${newUserId}:invitee`, 'Bonus referral');
        }

        const [rows] = await conn.query('SELECT * FROM users WHERE id = ? LIMIT 1', [newUserId]);
        return rows[0];
      });
    } else {
      const role = isAdminEmail && user.role !== 'admin' ? 'admin' : user.role;
      const code = user.referral_code || (await withTransaction((conn) => generateUniqueReferralCode(conn)));
      await query(
        'UPDATE users SET email = ?, name = ?, avatar = ?, role = ?, referral_code = ? WHERE id = ?',
        [email, p.name || null, p.picture || null, role, code, user.id],
      );
      user = { ...user, email, name: p.name || user.name, avatar: p.picture || user.avatar, role, referral_code: code };
    }

    const jti = crypto.randomUUID();
    const token = jwt.sign({ sub: user.id, role: user.role, jti }, config.jwtSecret, {
      expiresIn: config.jwtExpires,
    });

    await query('INSERT INTO sessions (user_id, jti, ip, user_agent) VALUES (?, ?, ?, ?)', [
      user.id,
      jti,
      req.ip || null,
      String(req.headers['user-agent'] || '').slice(0, 255),
    ]);

    return res.json({ token, user: publicUser(user), config: publicConfig() });
  } catch (err) {
    console.warn('[auth] google gagal:', err.message);
    return res.status(401).json({ error: 'Login Google gagal' });
  }
});

export default router;
