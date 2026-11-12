import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // .env belum ada, pakai default
}

const dbName = process.env.DB_NAME || 'coin_game';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number.parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  socketPath: process.env.DB_SOCKET || undefined,
});

async function columnExists(table, column) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column],
  );
  return Number(rows[0].c) > 0;
}

async function indexExists(table, index) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
    [table, index],
  );
  return Number(rows[0].c) > 0;
}

try {
  await conn.query(`USE \`${dbName}\``);

  await conn.query('ALTER TABLE users MODIFY google_sub VARCHAR(64) NULL');
  console.log('[migrate] google_sub nullable');

  if (!(await columnExists('users', 'password_hash'))) {
    await conn.query('ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER google_sub');
    console.log('[migrate] kolom password_hash ditambahkan');
  } else {
    console.log('[migrate] kolom password_hash sudah ada');
  }

  const [dups] = await conn.query(
    'SELECT email, COUNT(*) AS c FROM users GROUP BY email HAVING c > 1',
  );
  if (dups.length) {
    console.warn('[migrate] ada email duplikat, unique index dilewati:', dups.map((d) => d.email).join(', '));
  } else if (!(await indexExists('users', 'uq_users_email'))) {
    await conn.query('ALTER TABLE users ADD UNIQUE KEY uq_users_email (email)');
    console.log('[migrate] unique index uq_users_email ditambahkan');
  } else {
    console.log('[migrate] unique index uq_users_email sudah ada');
  }

  console.log('[migrate] selesai');
} finally {
  await conn.end();
}