import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // .env belum ada, pakai default
}

function toInt(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function toList(value, fallback) {
  if (!value) return fallback;
  return value
    .split(',')
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export const config = {
  root,
  port: toInt(process.env.PORT, 3000),
  env: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: toInt(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'coin_game',
    socketPath: process.env.DB_SOCKET || undefined,
  },
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpires: process.env.JWT_EXPIRES || '7d',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  coinPerRupiah: toInt(process.env.COIN_PER_RUPIAH, 100),
  minWithdrawIdr: toInt(process.env.MIN_WITHDRAW_IDR, 1000),
  maxWithdrawPerDay: toInt(process.env.MAX_WITHDRAW_PER_DAY, 1),
  withdrawPresets: toList(process.env.WITHDRAW_PRESETS, [1000, 20000, 50000, 100000, 200000]),
  dailyCoinCap: toInt(process.env.DAILY_COIN_CAP, 50000),
  onlineWindowSeconds: toInt(process.env.ONLINE_WINDOW_SECONDS, 60),
  heartbeatSeconds: toInt(process.env.HEARTBEAT_SECONDS, 25),
  game: {
    roundDurationMs: toInt(process.env.ROUND_DURATION_MS, 20000),
    roundMaxCatch: toInt(process.env.ROUND_MAX_CATCH, 60),
    coinPerCatch: toInt(process.env.COIN_PER_CATCH, 10),
    roundsPerDay: toInt(process.env.ROUNDS_PER_DAY, 20),
  },
  wheel: {
    spinsPerDay: toInt(process.env.WHEEL_SPINS_PER_DAY, 3),
    adSeconds: toInt(process.env.WHEEL_AD_SECONDS, 5),
  },
  referral: {
    rewardReferrer: toInt(process.env.REFERRAL_REWARD_REFERRER, 1000),
    rewardInvitee: toInt(process.env.REFERRAL_REWARD_INVITEE, 500),
  },
  installBonusCoin: toInt(process.env.INSTALL_BONUS_COIN, 11500),
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    summaryMinutes: toInt(process.env.TELEGRAM_SUMMARY_MINUTES, 10),
  },
};
