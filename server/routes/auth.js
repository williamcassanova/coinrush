import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { changeCoins } from '../lib/coins.js';
import { generateUniqueReferralCode } from '../lib/referral.js';

const router = Router();
const googleClient = new OAuth2Client(config.googleClientId);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan. Coba lagi nanti.' },
});

function publicConfig() {
  return {
    googleClientId: config.googleClientId,
    coinPerRupiah: config.coinPerRupiah,
    minWithdrawIdr: config.minWithdrawIdr,
    maxWithdrawPerDay: config.maxWithdrawPerDay,
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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  try {
    const expected = Buffer.from(hash, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

async function applyReferral(conn, referrerId, inviteeId) {
  await conn.query(
    'INSERT INTO referrals (referrer_id, invitee_id, reward_referrer, reward_invitee) VALUES (?, ?, ?, ?)',
    [referrerId, inviteeId, config.referral.rewardReferrer, config.referral.rewardInvitee],
  );
  await changeCoins(conn, referrerId, config.referral.rewardReferrer, 'referral', `ref:${inviteeId}:referrer`, 'Bonus ajak teman');
  await changeCoins(conn, inviteeId, config.referral.rewardInvitee, 'referral', `ref:${inviteeId}:invitee`, 'Bonus referral');
}

async function createUserWithReferral({
  googleSub = null,
  passwordHash = null,
  email,
  name = null,
  avatar = null,
  referralCode = null,
}) {
  const normalizedEmail = normalizeEmail(email);
  const isAdminEmail = config.adminEmails.includes(normalizedEmail);

  return withTransaction(async (conn) => {
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
      `INSERT INTO users (google_sub, password_hash, email, name, avatar, role, referral_code, referred_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [googleSub, passwordHash, normalizedEmail, name, avatar, role, code, referrerId],
    );
    const newUserId = ins.insertId;

    if (referrerId) await applyReferral(conn, referrerId, newUserId);

    const [rows] = await conn.query('SELECT * FROM users WHERE id = ? LIMIT 1', [newUserId]);
    return rows[0];
  });
}

async function issueSession(req, user) {
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
  return token;
}

router.get('/config', (_req, res) => {
  res.json(publicConfig());
});

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Email tidak valid' });
    }

    const plain = String(password || '');
    if (plain.length < 8) return res.status(400).json({ error: 'Password minimal 8 karakter' });
    if (plain.length > 128) return res.status(400).json({ error: 'Password terlalu panjang' });

    const existing = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
    if (existing.length) return res.status(409).json({ error: 'Email sudah terdaftar' });

    const user = await createUserWithReferral({
      googleSub: null,
      passwordHash: hashPassword(plain),
      email: normalizedEmail,
      name: String(name || '').trim().slice(0, 150) || normalizedEmail.split('@')[0],
      avatar: null,
      referralCode,
    });

    const token = await issueSession(req, user);
    return res.json({ token, user: publicUser(user), config: publicConfig() });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email sudah terdaftar' });
    console.warn('[auth] register gagal:', err.message);
    return res.status(500).json({ error: 'Gagal membuat akun' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    const rows = await query('SELECT * FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
    const user = rows[0];

    if (!user || !user.password_hash || !verifyPassword(String(password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }

    const token = await issueSession(req, user);
    return res.json({ token, user: publicUser(user), config: publicConfig() });
  } catch (err) {
    console.warn('[auth] login gagal:', err.message);
    return res.status(500).json({ error: 'Gagal masuk' });
  }
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
      const byEmail = (await query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]))[0];

      if (byEmail) {
        if (byEmail.google_sub && byEmail.google_sub !== p.sub) {
          return res.status(409).json({ error: 'Email sudah dipakai akun Google lain' });
        }

        const role = isAdminEmail && byEmail.role !== 'admin' ? 'admin' : byEmail.role;
        const code =
          byEmail.referral_code ||
          (await withTransaction((conn) => generateUniqueReferralCode(conn)));

        await query(
          `UPDATE users SET google_sub = ?, email = ?, name = COALESCE(?, name),
                  avatar = COALESCE(?, avatar), role = ?, referral_code = ?
           WHERE id = ?`,
          [p.sub, email, p.name || null, p.picture || null, role, code, byEmail.id],
        );

        user = {
          ...byEmail,
          google_sub: p.sub,
          name: p.name || byEmail.name,
          avatar: p.picture || byEmail.avatar,
          role,
          referral_code: code,
        };
      } else {
        user = await createUserWithReferral({
          googleSub: p.sub,
          email,
          name: p.name || null,
          avatar: p.picture || null,
          referralCode,
        });
      }
    } else {
      const role = isAdminEmail && user.role !== 'admin' ? 'admin' : user.role;
      const code = user.referral_code || (await withTransaction((conn) => generateUniqueReferralCode(conn)));
      await query(
        'UPDATE users SET email = ?, name = ?, avatar = ?, role = ?, referral_code = ? WHERE id = ?',
        [email, p.name || null, p.picture || null, role, code, user.id],
      );
      user = {
        ...user,
        email,
        name: p.name || user.name,
        avatar: p.picture || user.avatar,
        role,
        referral_code: code,
      };
    }

    const token = await issueSession(req, user);
    return res.json({ token, user: publicUser(user), config: publicConfig() });
  } catch (err) {
    console.warn('[auth] google gagal:', err.message);
    return res.status(401).json({ error: 'Login Google gagal' });
  }
});

export default router;