import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { query } from '../db.js';

const router = Router();

function baseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = req.get('host');
  return `${proto}://${host}`;
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rows = await query('SELECT referral_code FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    const code = rows[0]?.referral_code;
    if (!code) return res.status(500).json({ error: 'Kode referral belum tersedia' });

    const [stats, invitees] = await Promise.all([
      query(
        `SELECT COUNT(*) AS invited, COALESCE(SUM(reward_referrer),0) AS earned
           FROM referrals WHERE referrer_id = ?`,
        [req.user.id],
      ),
      query(
        `SELECT u.name, u.email, r.created_at
           FROM referrals r JOIN users u ON u.id = r.invitee_id
          WHERE r.referrer_id = ?
          ORDER BY r.id DESC
          LIMIT 50`,
        [req.user.id],
      ),
    ]);

    res.json({
      code,
      link: `${baseUrl(req)}/?ref=${encodeURIComponent(code)}`,
      invited: Number(stats[0].invited),
      earned: Number(stats[0].earned),
      rewardReferrer: config.referral.rewardReferrer,
      rewardInvitee: config.referral.rewardInvitee,
      invitees,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
