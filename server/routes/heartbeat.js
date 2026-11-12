import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query, countOnline } from '../db.js';

const router = Router();

router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user.jti) {
      await query('UPDATE sessions SET last_seen = NOW() WHERE jti = ?', [req.user.jti]);
    }
    res.json({ ok: true, online: await countOnline() });
  } catch (err) {
    next(err);
  }
});

export default router;
