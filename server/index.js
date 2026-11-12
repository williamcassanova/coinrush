import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { config } from './config.js';
import { query, countOnline, pool } from './db.js';
import { startOnlineReporter } from './telegram.js';
import authRouter from './routes/auth.js';
import gameRouter from './routes/game.js';
import heartbeatRouter from './routes/heartbeat.js';
import withdrawRouter from './routes/withdraw.js';
import wheelRouter from './routes/wheel.js';
import referralRouter from './routes/referral.js';
import adminRouter from './routes/admin.js';

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://accounts.google.com', 'https://www.gstatic.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com'],
        connectSrc: ["'self'", 'https://accounts.google.com'],
        frameSrc: ['https://accounts.google.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'data:'],
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  }),
);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '100kb' }));

app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    max: 400,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, online: await countOnline() });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/game', gameRouter);
app.use('/api/heartbeat', heartbeatRouter);
app.use('/api/withdraw', withdrawRouter);
app.use('/api/wheel', wheelRouter);
app.use('/api/referral', referralRouter);
app.use('/api/admin', adminRouter);

app.use(express.static(path.join(config.root, 'public'), { extensions: ['html'] }));

app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(config.root, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

async function start() {
  try {
    await query('SELECT 1');
    console.log('[db] terhubung ke', config.db.database);
  } catch (err) {
    console.error('[db] gagal terhubung:', err.message);
    console.error('Pastikan MariaDB jalan dan sudah `npm run db:init`.');
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`[server] jalan di http://localhost:${config.port}`);
    if (!config.googleClientId) {
      console.warn('[auth] GOOGLE_CLIENT_ID kosong — login Google belum bisa dipakai');
    }
  });

  startOnlineReporter(async () => {
    const [totals, pending, online] = await Promise.all([
      query('SELECT COUNT(*) AS total_users FROM users'),
      query("SELECT COUNT(*) AS pending FROM withdrawals WHERE status = 'pending'"),
      countOnline(),
    ]);
    return {
      online,
      totalUsers: Number(totals[0].total_users),
      pendingWithdrawals: Number(pending[0].pending),
    };
  });

  const shutdown = async () => {
    console.log('\n[server] mematikan...');
    server.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
