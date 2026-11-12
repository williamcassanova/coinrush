const msg = document.getElementById('msg');
const openApp = document.getElementById('openApp');
const params = new URLSearchParams(location.search);
const ref = (params.get('ref') || '').toUpperCase();

function waitForGoogle(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Google Sign-In gagal dimuat'));
      }
    }, 120);
  });
}

async function onCredential(response) {
  msg.className = 'msg center';
  msg.textContent = 'Memverifikasi...';
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: response.credential, referralCode: ref || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
    if (!data.token) throw new Error('Token tidak diterima dari server');

    const url = `com.coingame.coinrush://auth?token=${encodeURIComponent(data.token)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
    openApp.href = url;
    openApp.classList.remove('hidden');
    msg.className = 'msg ok center';
    msg.textContent = 'Login berhasil. Kembali ke aplikasi.';
    try {
      location.href = url;
    } catch {}
  } catch (err) {
    msg.className = 'msg error center';
    msg.textContent = err.message;
    openApp.classList.add('hidden');
  }
}

async function boot() {
  try {
    const cfg = await fetch('/api/auth/config').then((r) => r.json());
    if (!cfg.googleClientId) throw new Error('GOOGLE_CLIENT_ID belum diatur di server.');
    await waitForGoogle();
    window.google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: onCredential,
    });
    window.google.accounts.id.renderButton(document.getElementById('gsiButton'), {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
    });
  } catch (err) {
    msg.className = 'msg error center';
    msg.textContent = err.message;
  }
}

boot();