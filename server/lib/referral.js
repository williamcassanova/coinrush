import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeReferralCode(length = 8) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return out;
}

export async function generateUniqueReferralCode(conn) {
  for (let i = 0; i < 8; i += 1) {
    const code = makeReferralCode();
    const [rows] = await conn.query('SELECT id FROM users WHERE referral_code = ? LIMIT 1', [code]);
    if (!rows.length) return code;
  }
  throw new Error('Gagal membuat kode referral unik');
}
