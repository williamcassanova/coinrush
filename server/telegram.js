import { config } from './config.js';

export function telegramEnabled() {
  return Boolean(config.telegram.token && config.telegram.chatId);
}

export async function sendTelegram(text) {
  if (!telegramEnabled()) return;
  try {
    const url = `https://api.telegram.org/bot${config.telegram.token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegram.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[telegram] gagal kirim:', res.status, body.slice(0, 200));
    }
  } catch (err) {
    console.warn('[telegram] error:', err.message);
  }
}

export function startOnlineReporter(getStats) {
  if (!telegramEnabled()) {
    console.log('[telegram] nonaktif (token/chat_id belum diisi)');
    return null;
  }
  const everyMs = Math.max(1, config.telegram.summaryMinutes) * 60_000;
  let last = -1;

  const tick = async () => {
    try {
      const stats = await getStats();
      if (stats.online === last && stats.online === 0) return;
      last = stats.online;
      await sendTelegram(
        [
          '<b>📊 Ringkasan Coin Game</b>',
          `Online: <b>${stats.online}</b>`,
          `Total pemain: ${stats.totalUsers}`,
          `Withdraw pending: ${stats.pendingWithdrawals}`,
        ].join('\n'),
      );
    } catch (err) {
      console.warn('[telegram] reporter error:', err.message);
    }
  };

  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  return timer;
}
