const API = '/api';
const token = localStorage.getItem('cq_token') || '';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('id-ID');

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('id-ID');
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers['content-type']) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(API + path, { ...opts, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401) {
    localStorage.removeItem('cq_token');
    location.href = '/';
    throw new Error('Sesi berakhir');
  }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.style.color = isError ? '#ff6b6b' : '#8b96b0';
}

async function loadStats() {
  const s = await api('/admin/stats');
  $('sOnline').textContent = fmt(s.online);
  $('sUsers').textContent = fmt(s.totalUsers);
  $('sPending').textContent = fmt(s.pendingWithdrawals);
  $('sCoins').textContent = fmt(s.totalCoins);
  $('sTodayUsers').textContent = fmt(s.todayUsers);
  $('sTodayRounds').textContent = fmt(s.todayRounds);
  $('sTodayWheel').textContent = fmt(s.todayWheelSpins);
  $('sTodayEarned').textContent = fmt(s.todayEarned);
}

async function loadOnline() {
  const data = await api('/admin/online');
  const body = $('onlineBody');
  if (!data.players.length) {
    body.innerHTML = '<tr><td colspan="3" class="muted small">Tidak ada yang online</td></tr>';
    return;
  }
  body.innerHTML = data.players
    .map(
      (p) => `<tr><td>${escapeHtml(p.name || '-')}</td><td class="muted">${escapeHtml(p.email)}</td><td class="muted">${formatDate(p.last_seen)}</td></tr>`,
    )
    .join('');
}

async function loadWithdrawals() {
  const status = $('wdFilter').value;
  const data = await api(`/admin/withdrawals${status ? `?status=${status}` : ''}`);
  const body = $('wdBody');
  if (!data.withdrawals.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted small">Belum ada data</td></tr>';
    return;
  }
  body.innerHTML = data.withdrawals
    .map((w) => {
      const final = w.status === 'paid' || w.status === 'rejected';
      const actions = final
        ? '<span class="muted small">final</span>'
        : `<button class="b-processing" data-id="${w.id}" data-status="processing">Proses</button>
           <button class="b-paid" data-id="${w.id}" data-status="paid">Lunas</button>
           <button class="b-rejected" data-id="${w.id}" data-status="rejected">Tolak</button>`;
      return `<tr>
        <td>#${w.id}</td>
        <td>${escapeHtml(w.user_name || w.user_email)}</td>
        <td>Rp${fmt(w.amount_idr)}</td>
        <td>${escapeHtml(w.method)} · ${escapeHtml(w.provider)}</td>
        <td>${escapeHtml(w.account_name)} / ${escapeHtml(w.account_number)}</td>
        <td><span class="badge badge-${w.status}">${w.status}</span></td>
        <td><div class="actions">${actions}</div></td>
      </tr>`;
    })
    .join('');
}

async function updateWithdrawal(id, status) {
  if (status === 'rejected' && !confirm('Tolak pencairan ini? Coin akan dikembalikan ke pemain.')) return;
  if (status === 'paid' && !confirm('Tandai sudah dibayar? Pastikan uang sudah ditransfer.')) return;
  try {
    await api(`/admin/withdrawals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
}

async function refreshAll() {
  if (!token) {
    $('status').textContent = 'Belum login. Silakan login di halaman utama.';
    return;
  }
  try {
    await Promise.all([loadStats(), loadOnline(), loadWithdrawals()]);
    setStatus(`Diperbarui ${new Date().toLocaleTimeString('id-ID')}`);
  } catch (err) {
    setStatus(err.message, true);
  }
}

function bind() {
  $('wdFilter').addEventListener('change', () => {
    loadWithdrawals().catch((e) => setStatus(e.message, true));
  });
  $('wdBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (btn) updateWithdrawal(btn.dataset.id, btn.dataset.status);
  });
  $('logout').addEventListener('click', () => {
    localStorage.removeItem('cq_token');
    localStorage.removeItem('cq_user');
    location.href = '/';
  });
  $('openGame').addEventListener('click', () => {
    location.href = '/';
  });
}

bind();
refreshAll();
setInterval(refreshAll, 5000);
