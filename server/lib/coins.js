// Menambah/mengurangi coin secara atomik + mencatat ke ledger.
// `amount` boleh negatif. Harus dipanggil di dalam transaksi (conn).
export async function changeCoins(conn, userId, amount, type, ref = null, note = null) {
  const [rows] = await conn.query(
    'SELECT coin_balance FROM users WHERE id = ? FOR UPDATE',
    [userId],
  );
  if (!rows.length) throw new Error('User tidak ditemukan');

  const balanceAfter = Number(rows[0].coin_balance) + Number(amount);
  if (balanceAfter < 0) {
    const err = new Error('Saldo coin tidak cukup');
    err.code = 'INSUFFICIENT_BALANCE';
    throw err;
  }

  await conn.query('UPDATE users SET coin_balance = ? WHERE id = ?', [balanceAfter, userId]);
  await conn.query(
    `INSERT INTO coin_ledger (user_id, amount, balance_after, type, ref, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, amount, balanceAfter, type, ref, note],
  );

  return balanceAfter;
}

// Credit coin yang tunduk pada batas harian (gameplay, misi, roda).
// Mengembalikan jumlah yang benar-benar diberikan setelah dipotong batas.
export async function creditEarning(conn, userId, amount, type, ref, note, dailyCap) {
  if (amount <= 0) {
    const [rows] = await conn.query('SELECT coin_balance FROM users WHERE id = ?', [userId]);
    return { granted: 0, capped: false, balance: Number(rows[0]?.coin_balance || 0), remaining: 0 };
  }

  await conn.query('INSERT IGNORE INTO game_stats (user_id, stat_day) VALUES (?, CURDATE())', [userId]);
  const [stats] = await conn.query(
    'SELECT earned_coins FROM game_stats WHERE user_id = ? AND stat_day = CURDATE() FOR UPDATE',
    [userId],
  );
  const earned = Number(stats[0]?.earned_coins || 0);
  const remaining = Math.max(0, dailyCap - earned);
  const granted = Math.min(amount, remaining);

  if (granted <= 0) {
    const [rows] = await conn.query('SELECT coin_balance FROM users WHERE id = ?', [userId]);
    return { granted: 0, capped: true, balance: Number(rows[0]?.coin_balance || 0), remaining: 0 };
  }

  const balance = await changeCoins(conn, userId, granted, type, ref, note);
  await conn.query(
    'UPDATE game_stats SET earned_coins = earned_coins + ? WHERE user_id = ? AND stat_day = CURDATE()',
    [granted, userId],
  );

  return { granted, capped: granted < amount, balance, remaining: remaining - granted };
}
