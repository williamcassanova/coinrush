const RAW_API_BASE = String(window.CQ_API_BASE || '').trim().replace(/\/+$/, '');
const API_BASE = RAW_API_BASE.startsWith('__') ? '' : RAW_API_BASE;
const API = `${API_BASE}/api`;
const NATIVE = Boolean(window.Capacitor?.isNativePlatform?.());
const RETURN_SCHEME = 'com.coingame.coinrush';
const REWARDED_AD_ID = (() => {
  const v = String(window.CQ_REWARDED_AD_ID || '');
  return !v || v.startsWith('__') ? 'ca-app-pub-3940256099942544/5224354917' : v;
})();
const AD_TEST = window.CQ_AD_TEST !== false;
const LS_TOKEN = 'cq_token';
const LS_USER = 'cq_user';
const LS_REF = 'cq_ref';

const store = {
  token: localStorage.getItem(LS_TOKEN) || '',
  user: null,
  config: null,
  state: null,
  referral: null,
  wheel: null,
  withdraw: null,
  heartbeatTimer: null,
};

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('id-ID');

let deferredInstallPrompt = null;
let installedThisSession = false;

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    installedThisSession ||
    NATIVE
  );
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toast(text, kind = '') {
  const node = document.createElement('div');
  node.textContent = text;
  node.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:110px', 'transform:translateX(-50%)',
    'background:#121a2c', 'color:#eef3ff', 'padding:12px 18px', 'border-radius:14px',
    'border:1px solid rgba(120,140,190,.25)', 'font-size:13px', 'z-index:120',
    'max-width:90vw', 'box-shadow:0 14px 40px rgba(0,0,0,.5)', 'transition:opacity .3s',
  ].join(';');
  if (kind === 'error') node.style.borderColor = 'rgba(255,107,138,.6)';
  if (kind === 'ok') node.style.borderColor = 'rgba(55,224,160,.6)';
  document.body.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 300);
  }, 2300);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers['content-type']) headers['content-type'] = 'application/json';
  if (store.token) headers.authorization = `Bearer ${store.token}`;

  const res = await fetch(API + path, { ...opts, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.status === 401 && path !== '/auth/google') {
    logout();
    throw new Error('Sesi berakhir, silakan login lagi');
  }
  if (!res.ok) throw new Error(data?.error || `Terjadi kesalahan (${res.status})`);
  return data;
}

function saveUser() {
  if (store.user) localStorage.setItem(LS_USER, JSON.stringify(store.user));
}

function showLogin() {
  $('login').classList.remove('hidden');
  $('app').classList.add('hidden');
}

function showApp() {
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
}

/* ---------------- rendering ---------------- */

function renderUser() {
  const u = store.user;
  if (!u) return;
  $('name').textContent = u.name || u.email || 'Pemain';
  $('avatar').src = u.avatar || '/icon.svg';
  setBalance(u.coinBalance);
}

function setBalance(coins) {
  const c = Number(coins || 0);
  if (store.user) store.user.coinBalance = c;
  $('balance').textContent = fmt(c);
  $('walletCoin').textContent = fmt(c);
  const kurs = store.config?.coinPerRupiah || 100;
  const idr = `Rp${fmt(Math.floor(c / kurs))}`;
  $('balanceIdr').textContent = idr;
  $('walletIdr').textContent = idr;
  saveUser();
}

function updateCap(today) {
  if (!today) return;
  const cap = Number(today.dailyCap || 0);
  const earned = Number(today.earnedToday || 0);
  $('earnedToday').textContent = fmt(earned);
  $('dailyCap').textContent = fmt(cap);
  $('capChip').textContent = `${fmt(earned)} / ${fmt(cap)} hari ini`;
  const pct = cap > 0 ? Math.min(100, Math.round((earned / cap) * 100)) : 0;
  $('capBar').style.width = `${pct}%`;
}

function updateRounds(today) {
  if (!today) return;
  const left = Math.max(0, Number(today.roundsPerDay) - Number(today.roundsToday));
  const label = $('roundsLeftLabel');
  if (left <= 0) {
    label.textContent = 'Batas ronde harian tercapai';
    $('playBtn').disabled = true;
  } else {
    label.textContent = `Sisa ronde ${left} / ${today.roundsPerDay}`;
    if (!game.running) $('playBtn').disabled = false;
  }
}

function renderMissions(missions) {
  const box = $('missions');
  box.innerHTML = '';
  if (!missions?.length) {
    box.innerHTML = '<p class="muted small">Belum ada misi.</p>';
    return;
  }
  for (const m of missions) {
    const item = document.createElement('div');
    item.className = 'mission';
    const pct = m.target > 0 ? Math.min(100, Math.round((m.progress / m.target) * 100)) : 0;
    item.innerHTML = `
      <div class="mission-info">
        <div class="mission-title">${escapeHtml(m.title)}</div>
        <div class="mission-desc">${escapeHtml(m.description || '')} · +${fmt(m.rewardCoin)} coin</div>
        <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
      </div>
      <button class="claim-btn" data-code="${escapeHtml(m.code)}" ${m.claimable ? '' : 'disabled'}>
        ${m.claimedToday ? 'Selesai' : m.claimable ? 'Klaim' : `${m.progress}/${m.target}`}
      </button>`;
    box.appendChild(item);
  }
}

async function loadState() {
  const s = await api('/game/state');
  store.state = s;
  store.user = s.user;
  renderUser();
  $('online').textContent = s.online;
  updateCap(s.today);
  updateRounds(s.today);
  renderMissions(s.missions);
  renderInstallBonus();
}

function renderInstallBonus() {
  const b = store.state?.bonuses?.install;
  const btn = $('claimInstallBtn');
  const desc = $('installBonusDesc');
  const card = $('installBonus');
  if (!b || !btn) return;

  if (b.claimed) {
    card.classList.add('claimed');
    btn.textContent = 'Sudah diklaim';
    btn.disabled = true;
    desc.textContent = 'Bonus install sudah kamu terima.';
    return;
  }

  card.classList.remove('claimed');
  btn.disabled = false;
  btn.textContent = `Klaim ${fmt(b.coin)} coin`;
  desc.textContent = isStandalone()
    ? 'Aplikasi sudah terpasang. Klaim bonusmu sekarang.'
    : `Install Coin Rush, dapat ${fmt(b.coin)} coin gratis (sekali).`;
}

async function claimInstall() {
  const b = store.state?.bonuses?.install;
  if (!b || b.claimed) return;
  const btn = $('claimInstallBtn');

  if (!isStandalone()) {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      if (choice?.outcome !== 'accepted') {
        toast('Install dibatalkan', 'error');
        return;
      }
      installedThisSession = true;
    } else {
      toast('Install dulu lewat menu browser → Install app / Add to Home Screen', 'error');
      return;
    }
  }

  btn.disabled = true;
  try {
    const r = await api('/game/bonus/install', { method: 'POST' });
    setBalance(r.balance);
    if (store.state?.bonuses?.install) store.state.bonuses.install.claimed = true;
    renderInstallBonus();
    toast(`+${fmt(r.granted)} coin`, 'ok');
  } catch (err) {
    btn.disabled = false;
    toast(err.message, 'error');
  }
}

async function refreshMissions() {
  try {
    const s = await api('/game/missions');
    if (store.state) store.state.missions = s.missions;
    renderMissions(s.missions);
  } catch {
    // diamkan
  }
}

/* ---------------- tabs ---------------- */

function switchTab(name) {
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.page').forEach((p) => {
    p.classList.toggle('hidden', p.dataset.page !== name);
  });
  if (name === 'wheel') {
    ensureWheel();
    drawWheel(wheel.rotation);
  }
  if (name === 'missions') renderInstallBonus();
  if (name === 'referral') loadReferral().catch(() => {});
  if (name === 'wallet') loadWithdrawals().catch(() => {});
}

/* ---------------- Coin Rush ---------------- */

function mulberry32(a) {
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const game = {
  ctx: null,
  w: 0,
  h: 0,
  running: false,
  raf: 0,
  items: [],
  score: 0,
  basket: 0.5,
  basketW: 0.26,
  endAt: 0,
  last: 0,
  spawnAcc: 0,
  prng: Math.random,
  round: null,
  flash: 0,
  floats: [],
};

function fitGameCanvas() {
  const canvas = $('gameCanvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 320;
  const h = canvas.clientHeight || 300;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  game.ctx = canvas.getContext('2d');
  game.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.w = w;
  game.h = h;
}

function spawnItem() {
  const isBomb = game.prng() < 0.22;
  game.items.push({
    x: 0.08 + game.prng() * 0.84,
    y: -0.1,
    vy: 0.34 + game.prng() * 0.24,
    type: isBomb ? 'bomb' : 'coin',
    r: isBomb ? 14 : 12,
    done: false,
  });
}

function drawGame() {
  const { ctx, w, h } = game;
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = '#4a5b8a';
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, (h / 6) * i);
    ctx.lineTo(w, (h / 6) * i);
    ctx.stroke();
  }
  ctx.restore();

  for (const it of game.items) {
    if (it.done) continue;
    const x = it.x * w;
    const y = it.y * h;
    ctx.save();
    ctx.translate(x, y);
    if (it.type === 'coin') {
      ctx.shadowColor = 'rgba(255, 199, 70, 0.7)';
      ctx.shadowBlur = 16;
      const g = ctx.createRadialGradient(-4, -5, 2, 0, 0, it.r);
      g.addColorStop(0, '#fff2b0');
      g.addColorStop(1, '#f5a623');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, it.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#8a5a08';
      ctx.font = '700 12px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('₵', 0, 1);
    } else {
      ctx.shadowColor = 'rgba(255, 90, 120, 0.7)';
      ctx.shadowBlur = 14;
      const g = ctx.createRadialGradient(-3, -4, 2, 0, 0, it.r);
      g.addColorStop(0, '#ff8fa8');
      g.addColorStop(1, '#b01d44');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, it.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffd0da';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, -it.r - 1);
      ctx.quadraticCurveTo(2, -it.r - 8, 7, -it.r - 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  const bw = game.basketW * w;
  const bx = game.basket * w - bw / 2;
  const by = h - 34;
  ctx.save();
  ctx.shadowColor = 'rgba(63, 214, 255, 0.55)';
  ctx.shadowBlur = 18;
  const bg = ctx.createLinearGradient(bx, by, bx + bw, by + 26);
  bg.addColorStop(0, '#3fd6ff');
  bg.addColorStop(1, '#8b5cff');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, 20, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.roundRect(bx + 6, by + 3, bw - 12, 4, 3);
  ctx.fill();
  ctx.restore();

  for (const f of game.floats) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, f.life);
    ctx.fillStyle = f.color;
    ctx.font = '800 15px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x * w, f.y * h);
    ctx.restore();
  }

  if (game.flash > 0) {
    ctx.fillStyle = `rgba(255, 70, 100, ${game.flash * 0.28})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function gameLoop(ts) {
  if (!game.running) return;
  const dt = Math.min(0.05, (ts - game.last) / 1000);
  game.last = ts;

  const remain = Math.max(0, (game.endAt - ts) / 1000);
  $('hudTime').textContent = Math.ceil(remain);

  game.spawnAcc += dt;
  const interval = 0.34;
  while (game.spawnAcc >= interval) {
    game.spawnAcc -= interval;
    spawnItem();
  }

  const basketY = game.h - 28;
  const halfW = (game.basketW * game.w) / 2;
  const basketX = game.basket * game.w;

  for (const it of game.items) {
    if (it.done) continue;
    it.y += it.vy * dt;
    const px = it.x * game.w;
    const py = it.y * game.h;

    if (py >= basketY - 10 && py <= basketY + 26) {
      if (Math.abs(px - basketX) <= halfW + it.r * 0.6) {
        it.done = true;
        if (it.type === 'coin') {
          game.score += 1;
          game.floats.push({ x: it.x, y: it.y, text: '+1', color: '#ffd75e', life: 1 });
        } else {
          game.score = Math.max(0, game.score - 1);
          game.flash = 1;
          game.floats.push({ x: it.x, y: it.y, text: '-1', color: '#ff6b8a', life: 1 });
        }
      }
    } else if (py > game.h + 40) {
      it.done = true;
    }
  }

  for (const f of game.floats) {
    f.y -= dt * 0.25;
    f.life -= dt * 1.6;
  }
  game.floats = game.floats.filter((f) => f.life > 0);
  game.items = game.items.filter((it) => !it.done);
  game.flash = Math.max(0, game.flash - dt * 2);

  $('hudScore').textContent = game.score;
  drawGame();

  if (remain <= 0) {
    finishRound();
    return;
  }
  game.raf = requestAnimationFrame(gameLoop);
}

async function startRound() {
  if (game.running) return;
  const btn = $('playBtn');
  btn.disabled = true;
  $('gameMsg').className = 'msg';
  $('gameMsg').textContent = '';
  try {
    const round = await api('/game/round/start', { method: 'POST' });
    game.round = round;
    game.prng = mulberry32(round.seed);
    game.items = [];
    game.floats = [];
    game.score = 0;
    game.spawnAcc = 0;
    game.flash = 0;
    game.basket = 0.5;
    game.running = true;
    fitGameCanvas();
    $('hudScore').textContent = '0';
    $('hudTime').textContent = Math.ceil(round.durationMs / 1000);
    $('gameOverlay').classList.add('gone');
    game.last = performance.now();
    game.endAt = game.last + round.durationMs;
    game.raf = requestAnimationFrame(gameLoop);
  } catch (err) {
    btn.disabled = false;
    $('gameMsg').className = 'msg error';
    $('gameMsg').textContent = err.message;
  }
}

async function finishRound() {
  game.running = false;
  cancelAnimationFrame(game.raf);
  const caught = game.score;
  $('gameOverlay').classList.remove('gone');
  $('playBtn').textContent = 'Main lagi';
  $('playBtn').disabled = true;

  try {
    const r = await api('/game/round/finish', {
      method: 'POST',
      body: JSON.stringify({ roundId: game.round.roundId, caught }),
    });
    setBalance(r.balance);
    if (r.today) {
      store.state.today = r.today;
      updateCap(r.today);
      updateRounds(r.today);
    }
    $('gameMsg').className = 'msg ok';
    $('gameMsg').textContent = r.capped
      ? `+${fmt(r.granted)} coin (sebagian tertahan batas harian)`
      : `+${fmt(r.granted)} coin dari ${caught} tangkapan`;
    await refreshMissions();
  } catch (err) {
    $('playBtn').disabled = false;
    $('gameMsg').className = 'msg error';
    $('gameMsg').textContent = err.message;
  }
}

function bindGameControls() {
  const canvas = $('gameCanvas');
  const move = (clientX) => {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    game.basket = Math.max(0.04, Math.min(0.96, x));
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    move(e.clientX);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (game.running) move(e.clientX);
  });
  window.addEventListener('keydown', (e) => {
    if (!game.running) return;
    if (e.key === 'ArrowLeft') game.basket = Math.max(0.04, game.basket - 0.07);
    if (e.key === 'ArrowRight') game.basket = Math.min(0.96, game.basket + 0.07);
  });
  window.addEventListener('resize', () => {
    if (game.w) fitGameCanvas();
  });
}

/* ---------------- Wheel ---------------- */

const wheel = {
  ctx: null,
  size: 0,
  rotation: 0,
  spinning: false,
};

function fitWheelCanvas() {
  const canvas = $('wheelCanvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = canvas.clientWidth || 260;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  wheel.ctx = canvas.getContext('2d');
  wheel.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  wheel.size = size;
}

function drawWheel(rotation) {
  if (!wheel.ctx) fitWheelCanvas();
  const ctx = wheel.ctx;
  const size = wheel.size;
  if (!ctx || !size) return;
  const prizes = store.wheel?.prizes || [];
  const n = prizes.length || 7;
  const seg = (Math.PI * 2) / n;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 6;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(cx, cy);

  const halo = ctx.createRadialGradient(0, 0, radius * 0.4, 0, 0, radius + 8);
  halo.addColorStop(0, 'rgba(255,207,92,0)');
  halo.addColorStop(1, 'rgba(255,207,92,0.16)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(rotation);
  for (let i = 0; i < n; i += 1) {
    const start = i * seg;
    const end = start + seg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = prizes[i]?.color || (i % 2 ? '#2b3550' : '#38456b');
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.rotate(start + seg / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 13px system-ui';
    ctx.fillText(prizes[i]?.label || '?', radius - 16, 0);
    ctx.fillStyle = 'rgba(255,207,92,0.85)';
    ctx.font = '700 9px system-ui';
    ctx.fillText('coin', radius - 16, 13);
    ctx.restore();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(-9, -radius + 2);
  ctx.lineTo(9, -radius + 2);
  ctx.lineTo(0, -radius + 18);
  ctx.closePath();
  ctx.fillStyle = '#ffcf5c';
  ctx.shadowColor = 'rgba(255,207,92,0.7)';
  ctx.shadowBlur = 14;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  const hub = ctx.createRadialGradient(-4, -5, 2, 0, 0, 24);
  hub.addColorStop(0, '#2a3552');
  hub.addColorStop(1, '#0e1424');
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,207,92,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ffcf5c';
  ctx.font = '800 16px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('₵', 0, 1);
  ctx.restore();
}

function ensureWheel() {
  if (!wheel.ctx) fitWheelCanvas();
  if (!store.wheel) {
    loadWheel().catch(() => {});
  } else {
    renderWheelPrizes(store.wheel);
  }
}

async function loadWheel() {
  const data = await api('/wheel/state');
  store.wheel = data;
  renderWheelPrizes(data);
  drawWheel(wheel.rotation);
}

function renderWheelPrizes(data) {
  $('spinsLeft').textContent = fmt(data.spinsLeft);
  const grid = $('prizeGrid');
  grid.innerHTML = (data.prizes || [])
    .map((p) => `<div class="prize"><b>${fmt(p.coin)}</b>coin</div>`)
    .join('');
  const sisa = Number(data.spinsLeft);
  const rem = Number(data.remaining);
  $('spinBtn').disabled = wheel.spinning || sisa <= 0 || rem <= 0;
  if (rem <= 0 && sisa > 0) {
    $('spinBtn').textContent = 'Batas coin harian tercapai';
  } else if (sisa <= 0) {
    $('spinBtn').textContent = 'Jatah putaran habis';
  } else {
    $('spinBtn').textContent = 'Tonton iklan & putar';
  }
}

function spinTo(index) {
  return new Promise((resolve) => {
    const prizes = store.wheel?.prizes || [];
    const n = prizes.length || 7;
    const seg = (Math.PI * 2) / n;
    const segCenter = index * seg + seg / 2;
    const base = -Math.PI / 2 - segCenter;
    const current = wheel.rotation % (Math.PI * 2);
    let target = base;
    while (target < current + Math.PI * 2 * 5) target += Math.PI * 2;

    const start = wheel.rotation;
    const delta = target - start;
    const startTs = performance.now();
    const duration = 3600;

    const step = (ts) => {
      const t = Math.min(1, (ts - startTs) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      wheel.rotation = start + delta * eased;
      drawWheel(wheel.rotation);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        wheel.rotation = target % (Math.PI * 2);
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

function showAd(seconds) {
  return new Promise((resolve) => {
    const overlay = $('adOverlay');
    overlay.classList.remove('hidden');
    const total = Math.max(1, Number(seconds) || 5);
    const startTs = performance.now();
    $('adCount').textContent = String(total);
    $('adProgress').style.width = '0%';

    const tick = (ts) => {
      const elapsed = (ts - startTs) / 1000;
      const left = Math.max(0, total - elapsed);
      $('adCount').textContent = String(Math.ceil(left));
      $('adProgress').style.width = `${Math.min(100, (elapsed / total) * 100)}%`;
      if (elapsed < total) {
        requestAnimationFrame(tick);
      } else {
        setTimeout(() => {
          overlay.classList.add('hidden');
          resolve();
        }, 350);
      }
    };
    requestAnimationFrame(tick);
  });
}

async function showNativeRewarded() {
  const AdMob = window.Capacitor?.Plugins?.AdMob;
  if (!AdMob) {
    await showAd(5);
    return;
  }
  let rewarded = false;
  let listener = null;
  try {
    await AdMob.initialize({});
    listener = await AdMob.addListener('onRewardedVideoAdReward', () => {
      rewarded = true;
    });
    await AdMob.prepareRewardVideoAd({ adId: REWARDED_AD_ID, isTesting: AD_TEST });
    await AdMob.showRewardVideoAd();
  } finally {
    try {
      await listener?.remove();
    } catch {}
  }
  if (!rewarded) throw new Error('Iklan belum selesai. Coba lagi.');
}

async function spinWheel() {
  if (wheel.spinning) return;
  const btn = $('spinBtn');
  $('wheelMsg').className = 'msg center';
  $('wheelMsg').textContent = '';
  wheel.spinning = true;
  btn.disabled = true;

  try {
    const ad = await api('/wheel/ad', { method: 'POST' });
    if (NATIVE) await showNativeRewarded();
    else await showAd(ad.watchSeconds);
    const result = await api('/wheel/spin', {
      method: 'POST',
      body: JSON.stringify({ adToken: ad.adToken }),
    });

    await spinTo(result.prizeIndex);
    setBalance(result.balance);
    if (store.wheel) {
      store.wheel.spinsLeft = result.spinsLeft;
      store.wheel.remaining = result.remaining;
      store.wheel.earnedToday = result.earnedToday;
    }
    if (store.state?.today) {
      store.state.today.earnedToday = result.earnedToday;
      store.state.today.remaining = result.remaining;
      updateCap(store.state.today);
    }
    $('wheelMsg').className = 'msg ok center';
    $('wheelMsg').textContent = `+${fmt(result.granted)} coin!`;
    await loadWheel();
  } catch (err) {
    $('wheelMsg').className = 'msg error center';
    $('wheelMsg').textContent = err.message;
    $('adOverlay').classList.add('hidden');
  } finally {
    wheel.spinning = false;
    btn.disabled = false;
    if (store.wheel) renderWheelPrizes(store.wheel);
  }
}

/* ---------------- Referral ---------------- */

async function loadReferral() {
  const data = await api('/referral');
  store.referral = data;
  $('refCode').textContent = data.code;
  $('refInvited').textContent = fmt(data.invited);
  $('refEarned').textContent = fmt(data.earned);

  $('rewardList').innerHTML = [
    `<li><span>Kamu dapat per teman</span><b>+${fmt(data.rewardReferrer)} coin</b></li>`,
    `<li><span>Teman baru dapat</span><b>+${fmt(data.rewardInvitee)} coin</b></li>`,
    `<li><span>Bonus masuk otomatis saat teman login</span><b>instan</b></li>`,
  ].join('');

  const box = $('refInvitees');
  if (!data.invitees?.length) {
    box.innerHTML = '<p class="muted small">Belum ada teman yang bergabung.</p>';
  } else {
    box.innerHTML = data.invitees
      .map(
        (u) => `<div class="invitee"><span>${escapeHtml(u.name || u.email)}</span><span class="muted tiny">${new Date(String(u.created_at).replace(' ', 'T')).toLocaleDateString('id-ID')}</span></div>`,
      )
      .join('');
  }
}

async function shareReferral() {
  const data = store.referral;
  if (!data) return;
  const text = `Gabung Coin Rush pakai kode ${data.code}, kita berdua dapat coin!`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Coin Rush', text, url: data.link });
    } else {
      await navigator.clipboard.writeText(data.link);
      $('refMsg').className = 'msg ok center';
      $('refMsg').textContent = 'Link disalin!';
    }
  } catch {
    // dibatalkan user
  }
}

async function copyReferral() {
  const data = store.referral;
  if (!data) return;
  try {
    await navigator.clipboard.writeText(data.code);
    $('refMsg').className = 'msg ok center';
    $('refMsg').textContent = 'Kode disalin!';
  } catch {
    $('refMsg').className = 'msg error center';
    $('refMsg').textContent = 'Gagal menyalin, salin manual ya.';
  }
}

/* ---------------- Wallet ---------------- */

async function loadWithdrawals() {
  const data = await api('/withdraw/mine');
  store.withdraw = data;
  if (data.coinBalance != null) setBalance(data.coinBalance);
  renderPresets(data);
  renderWdHistory(data.withdrawals);
}

function renderPresets(data) {
  const row = $('presets');
  const first = Number(data.firstWithdrawIdr || 200);
  const eligible = Boolean(data.firstWithdrawEligible);
  const options = [];
  if (eligible) options.push(first);
  for (const p of data.presets || []) {
    if (eligible && Number(p) === first) continue;
    options.push(Number(p));
  }
  row.innerHTML = options
    .map(
      (v) =>
        `<button type="button" class="preset" data-amount="${v}">Rp${fmt(v)}${v === first && eligible ? ' <span class="muted tiny">pertama</span>' : ''}</button>`,
    )
    .join('');

  $('wdHint').textContent = eligible
    ? `Pencairan pertama bisa Rp${fmt(first)} khusus ${data.firstWithdrawProvider} (e-wallet). Setelah itu minimal Rp${fmt(data.minWithdrawIdr)}.`
    : `Minimal pencairan Rp${fmt(data.minWithdrawIdr)}.`;

  if (!eligible && Number($('wdAmount').value) === first) $('wdAmount').value = '';
}

function renderWdHistory(items) {
  const box = $('wdHistory');
  if (!items?.length) {
    box.innerHTML = '<p class="muted small">Belum ada riwayat pencairan.</p>';
    return;
  }
  box.innerHTML = items
    .map(
      (w) => `
      <div class="wd-item">
        <div>
          <div>Rp${fmt(w.amount_idr)} · <span class="muted">${escapeHtml(w.provider)}</span></div>
          <div class="muted tiny">#${w.id} · ${new Date(String(w.created_at).replace(' ', 'T')).toLocaleString('id-ID')}</div>
        </div>
        <span class="badge badge-${w.status}">${w.status}</span>
      </div>`,
    )
    .join('');
}

async function submitWithdraw(event) {
  event.preventDefault();
  const msg = $('wdMsg');
  msg.className = 'msg';
  msg.textContent = '';

  const amountIdr = Number($('wdAmount').value);
  const kurs = store.config?.coinPerRupiah || 100;
  if (!Number.isInteger(amountIdr) || amountIdr <= 0) {
    msg.className = 'msg error';
    msg.textContent = 'Jumlah tidak valid';
    return;
  }
  if (amountIdr * kurs > Number(store.user?.coinBalance || 0)) {
    msg.className = 'msg error';
    msg.textContent = 'Saldo coin tidak cukup';
    return;
  }

  try {
    const r = await api('/withdraw', {
      method: 'POST',
      body: JSON.stringify({
        amountIdr,
        method: $('wdMethod').value,
        provider: $('wdProvider').value.trim(),
        accountName: $('wdName').value.trim(),
        accountNumber: $('wdNumber').value.trim(),
      }),
    });
    setBalance(r.balance);
    msg.className = 'msg ok';
    msg.textContent = `Permintaan #${r.withdrawalId} dikirim, menunggu diproses.`;
    $('wdAmount').value = '';
    await loadWithdrawals();
  } catch (err) {
    msg.className = 'msg error';
    msg.textContent = err.message;
  }
}

/* ---------------- auth + heartbeat ---------------- */

function captureReferral() {
  const params = new URLSearchParams(location.search);
  const ref = params.get('ref');
  if (ref) {
    localStorage.setItem(LS_REF, ref.trim().toUpperCase());
    params.delete('ref');
    const q = params.toString();
    history.replaceState({}, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  }
}

function startHeartbeat() {
  stopHeartbeat();
  const seconds = store.config?.heartbeatSeconds || 25;
  const ping = async () => {
    try {
      const r = await api('/heartbeat', { method: 'POST' });
      $('online').textContent = r.online;
    } catch {
      // retry berikutnya
    }
  };
  ping();
  store.heartbeatTimer = setInterval(ping, seconds * 1000);
}

function stopHeartbeat() {
  if (store.heartbeatTimer) clearInterval(store.heartbeatTimer);
  store.heartbeatTimer = null;
}

function logout() {
  stopHeartbeat();
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_USER);
  store.token = '';
  store.user = null;
  location.reload();
}

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

async function handleCredential(response) {
  const msg = $('loginMsg');
  msg.className = 'msg';
  msg.textContent = 'Memverifikasi...';
  try {
    const referralCode = localStorage.getItem(LS_REF) || undefined;
    const data = await api('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential: response.credential, referralCode }),
    });
    store.token = data.token;
    store.user = data.user;
    store.config = data.config;
    localStorage.setItem(LS_TOKEN, data.token);
    localStorage.removeItem(LS_REF);
    saveUser();

    showApp();
    await loadState();
    msg.textContent = '';
    startHeartbeat();
  } catch (err) {
    msg.className = 'msg error';
    msg.textContent = err.message;
  }
}

async function initGoogle() {
  if (!store.config?.googleClientId) {
    $('loginMsg').className = 'msg error';
    $('loginMsg').textContent = 'GOOGLE_CLIENT_ID belum diatur di server.';
    return;
  }
  try {
    await waitForGoogle();
    window.google.accounts.id.initialize({
      client_id: store.config.googleClientId,
      callback: handleCredential,
    });
    window.google.accounts.id.renderButton($('gsiButton'), {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
    });
  } catch (err) {
    $('loginMsg').className = 'msg error';
    $('loginMsg').textContent = err.message;
  }
}

function renderNativeLogin() {
  const box = $('gsiButton');
  box.innerHTML = '<button id="nativeLoginBtn" class="native-login-btn" type="button">Login dengan Google</button>';
  $('nativeLoginBtn').addEventListener('click', nativeLogin);
}

async function nativeLogin() {
  const Browser = window.Capacitor?.Plugins?.Browser;
  const msg = $('loginMsg');
  if (!API_BASE) {
    msg.className = 'msg error';
    msg.textContent = 'API server belum dikonfigurasi pada build ini.';
    return;
  }
  if (!Browser) {
    msg.className = 'msg error';
    msg.textContent = 'Browser native tidak tersedia.';
    return;
  }
  const ref = localStorage.getItem(LS_REF) || '';
  const url = `${API_BASE}/native-login.html${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  msg.className = 'msg';
  msg.textContent = 'Membuka Google...';
  try {
    await Browser.open({ url });
  } catch (err) {
    msg.className = 'msg error';
    msg.textContent = err.message;
  }
}

async function completeNativeLogin(url) {
  const parsed = new URL(url);
  const token = parsed.searchParams.get('token');
  const ref = parsed.searchParams.get('ref');
  if (ref) localStorage.setItem(LS_REF, String(ref).toUpperCase());
  if (!token) throw new Error('Token tidak ditemukan');
  store.token = token;
  localStorage.setItem(LS_TOKEN, token);
  localStorage.removeItem(LS_REF);
  try {
    await window.Capacitor?.Plugins?.Browser?.close();
  } catch {}
  showApp();
  await loadState();
  $('loginMsg').textContent = '';
  startHeartbeat();
  switchTab('home');
}

async function initNativeLinks() {
  const App = window.Capacitor?.Plugins?.App;
  if (!App) return;
  await App.addListener('appUrlOpen', async ({ url }) => {
    if (!url || !url.startsWith(`${RETURN_SCHEME}://`)) return;
    try {
      await completeNativeLogin(url);
    } catch (err) {
      $('loginMsg').className = 'msg error';
      $('loginMsg').textContent = `Login gagal: ${err.message}`;
      toast(`Login gagal: ${err.message}`, 'error');
    }
  });
}

/* ---------------- bind + init ---------------- */

function bindUi() {
  $('logout').addEventListener('click', logout);
  $('playBtn').addEventListener('click', startRound);
  $('spinBtn').addEventListener('click', spinWheel);
  $('copyRef').addEventListener('click', copyReferral);
  $('shareRef').addEventListener('click', shareReferral);
  $('wdForm').addEventListener('submit', submitWithdraw);
  $('claimInstallBtn').addEventListener('click', claimInstall);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    renderInstallBonus();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installedThisSession = true;
    renderInstallBonus();
    toast('Aplikasi terpasang! Klaim bonusnya.', 'ok');
  });

  $('missions').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-code]');
    if (!btn || btn.disabled) return;
    try {
      const r = await api(`/game/missions/${encodeURIComponent(btn.dataset.code)}/claim`, { method: 'POST' });
      setBalance(r.balance);
      toast(`+${fmt(r.granted)} coin`, 'ok');
      await refreshMissions();
      if (store.state?.today) {
        store.state.today.earnedToday += r.granted;
        store.state.today.remaining = r.remaining;
        updateCap(store.state.today);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('presets').addEventListener('click', (e) => {
    const btn = e.target.closest('.preset');
    if (!btn) return;
    document.querySelectorAll('.preset').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const amount = Number(btn.dataset.amount);
    $('wdAmount').value = String(amount);
    const first = Number(store.withdraw?.firstWithdrawIdr || 200);
    if (amount === first && store.withdraw?.firstWithdrawEligible) {
      $('wdMethod').value = 'ewallet';
      $('wdProvider').value = store.withdraw.firstWithdrawProvider;
    }
  });

  document.querySelectorAll('.nav-item').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  bindGameControls();
  window.addEventListener('resize', () => {
    if (!$('app').classList.contains('hidden') && !document.querySelector('[data-page="wheel"]').classList.contains('hidden')) {
      fitWheelCanvas();
      drawWheel(wheel.rotation);
    }
  });
}

function registerServiceWorker() {
  if (!NATIVE && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

async function init() {
  captureReferral();
  bindUi();
  registerServiceWorker();
  if (NATIVE) await initNativeLinks();
  fitGameCanvas();

  try {
    const res = await fetch(`${API}/auth/config`);
    store.config = await res.json();
  } catch {
    toast('Server tidak bisa dihubungi', 'error');
    showLogin();
    if (NATIVE) {
      const m = $('loginMsg');
      m.className = 'msg error';
      m.textContent = 'API server belum dikonfigurasi pada build ini.';
    }
    return;
  }

  const savedUser = localStorage.getItem(LS_USER);
  if (savedUser) {
    try {
      store.user = JSON.parse(savedUser);
    } catch {
      store.user = null;
    }
  }

  if (store.token) {
    try {
      showApp();
      renderUser();
      await loadState();
      startHeartbeat();
      switchTab('home');
      return;
    } catch {
      localStorage.removeItem(LS_TOKEN);
      store.token = '';
    }
  }

  showLogin();
  if (NATIVE) renderNativeLogin();
  else initGoogle();
}

init();
