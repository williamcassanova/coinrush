import fs from 'node:fs/promises';
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
  multipleStatements: true,
});

try {
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${dbName}\``);

  const schema = await fs.readFile(path.join(root, 'schema.sql'), 'utf8');
  await conn.query(schema);

  const [tables] = await conn.query('SHOW TABLES');
  console.log(`[db] database "${dbName}" siap. Tabel:`);
  for (const row of tables) console.log('  -', Object.values(row)[0]);
} finally {
  await conn.end();
}
