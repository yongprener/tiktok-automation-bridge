/**
 * Popup Logic
 *
 * Versi dibaca dari chrome.runtime.getManifest().version — SATU sumber
 * kebenaran. Jangan hardcode versi di file ini; kalau di-hardcode, versi di
 * popup bisa beda dengan manifest dan muncul banner "service worker basi"
 * palsu.
 *
 * PENTING: config (device, chat, polling) dibaca LANGSUNG dari chrome.storage.local.
 * Popup TIDAK boleh bergantung pada service worker untuk kebenaran data — kalau
 * extension belum di-reload, service worker versi lama masih hidup dan melaporkan
 * status basi ("Not configured" padahal storage sudah terisi).
 */

const EXPECTED_VERSION = chrome.runtime.getManifest().version;

let currentState = null;
let logsOpen = false;
let busy = false;

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btnToggle').addEventListener('click', togglePolling);
  document.getElementById('btnSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('btnUpdate').addEventListener('click', doUpdate);
  document.getElementById('btnLogs').addEventListener('click', toggleLogs);
  document.getElementById('version').addEventListener('click', () => refresh(true));

  await refresh();
  setInterval(() => { refresh().catch(() => {}); }, 2000);
});

async function refresh(checkUpdate = false) {
  if (busy) return;

  // ── 1. SUMBER KEBENARAN: baca storage langsung ──────────────────
  let s = {};
  try {
    s = await chrome.storage.local.get([
      'botToken', 'deviceName', 'deviceId', 'chatId',
      'pollingEnabled', 'lastPollOk', 'lastPollError',
      'updateAvailable', 'updateVersion', 'updateChannel'
    ]);
  } catch (e) {
    setStatus('red', 'Gagal baca storage');
    return;
  }

  const configured = !!(s.botToken && s.deviceName);
  const chatId = s.chatId ? String(s.chatId) : '';
  const polling = !!s.pollingEnabled;
  const deviceName = s.deviceName || '';
  const deviceId = s.deviceId || '';

  // ── 2. Service worker: opsional — cuma buat cek versi ──────────
  let bg = null;
  try {
    bg = await chrome.runtime.sendMessage({ type: 'status-check' });
  } catch (e) {
    bg = null; // normal: SW tidur, Chrome bangunin otomatis
  }

  const swVersion = (bg && bg.version) ? String(bg.version) : '';
  const staleSW = !!(swVersion && swVersion !== EXPECTED_VERSION);
  const swAlive = !!bg;

  currentState = { configured, chatId, polling, deviceName, deviceId, swVersion, staleSW };

  // ── 3. Render ───────────────────────────────────────────────────
  document.getElementById('version').textContent = 'v' + EXPECTED_VERSION;
  document.getElementById('device').textContent = deviceName || '—';
  document.getElementById('deviceId').textContent = deviceId || '';
  document.getElementById('polling').textContent = polling ? 'Active' : 'Idle';

  // Profile / chat link
  const profileEl = document.getElementById('profile');
  let email = '';
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    email = (info && info.email) ? info.email : '';
  } catch (e) { /* ignore */ }
  profileEl.textContent = email || (chatId ? 'Chat linked (' + chatId + ')' : 'Not linked');

  // Warning banner
  const warn = document.getElementById('warnBox');
  if (staleSW) {
    warn.classList.remove('hidden');
    warn.textContent = '⚠ Service worker masih v' + swVersion + '. Reload extension di chrome://extensions (tombol ⟳) biar sinkron.';
  } else if (!swAlive) {
    warn.classList.remove('hidden');
    warn.textContent = 'ℹ Service worker tidur (normal). Data dibaca langsung dari storage.';
  } else {
    warn.classList.add('hidden');
    warn.textContent = '';
  }

  const btn = document.getElementById('btnToggle');
  btn.disabled = false;

  if (!configured) {
    setStatus('red', 'Not configured');
    btn.textContent = '⚙️ Open Settings';
    btn.dataset.mode = 'settings';
  } else if (!chatId) {
    setStatus('yellow', 'Chat belum ke-link');
    btn.textContent = 'Start';
    btn.dataset.mode = 'start';
  } else if (polling) {
    if (s.lastPollError) {
      setStatus('yellow', 'Polling error — retrying');
    } else {
      const ago = s.lastPollOk ? Math.round((Date.now() - s.lastPollOk) / 1000) : null;
      setStatus('green', (ago === null || ago < 90) ? 'Connected' : 'Connected (' + ago + 's lalu)');
    }
    btn.textContent = 'Stop';
    btn.dataset.mode = 'stop';
  } else {
    setStatus('yellow', 'Ready — click Start');
    btn.textContent = 'Start';
    btn.dataset.mode = 'start';
  }

  // Error detail
  const errEl = document.getElementById('errBox');
  if (s.lastPollError) {
    errEl.classList.remove('hidden');
    errEl.textContent = '⚠ ' + s.lastPollError;
  } else {
    errEl.classList.add('hidden');
    errEl.textContent = '';
  }

  // Update button. The repo is private and there is no public release feed, so
  // the extension genuinely cannot self-discover new versions — be honest and
  // point at the updater script instead of showing a button that never fires.
  const upBtn = document.getElementById('btnUpdate');
  const channel = s.updateChannel || '';
  if (s.updateAvailable && s.updateVersion) {
    upBtn.classList.remove('hidden');
    upBtn.textContent = '⬆ Update v' + s.updateVersion + ' tersedia';
    upBtn.dataset.mode = 'available';
  } else if (channel === 'manual') {
    upBtn.classList.remove('hidden');
    upBtn.textContent = 'Update: jalankan update.bat';
    upBtn.dataset.mode = 'manual';
  } else {
    upBtn.classList.add('hidden');
    upBtn.dataset.mode = '';
  }

  if (logsOpen) await renderLogs();

  if (checkUpdate) {
    const verEl = document.getElementById('version');
    verEl.textContent = 'cek…';
    try { await chrome.runtime.sendMessage({ type: 'check-update' }); } catch (e) { /* ignore */ }
    setTimeout(() => { verEl.textContent = 'v' + EXPECTED_VERSION; }, 800);
  }
}

async function togglePolling() {
  const btn = document.getElementById('btnToggle');
  const mode = btn.dataset.mode;

  if (mode === 'settings') {
    chrome.runtime.openOptionsPage();
    return;
  }

  busy = true;
  btn.disabled = true;
  btn.textContent = mode === 'start' ? 'Starting…' : 'Stopping…';

  try {
    const res = await chrome.runtime.sendMessage(
      mode === 'start' ? { type: 'start-polling' } : { type: 'stop-polling' }
    );
    if (res && res.success === false) {
      setStatus('red', res.error || 'Gagal');
      showError(res.error || 'Gagal memulai polling');
    }
  } catch (e) {
    // SW mungkin baru dibangunkan — coba sekali lagi
    try {
      const res2 = await chrome.runtime.sendMessage(
        mode === 'start' ? { type: 'start-polling' } : { type: 'stop-polling' }
      );
      if (res2 && res2.success === false) showError(res2.error);
    } catch (e2) {
      showError('Service worker nggak merespons. Reload extension di chrome://extensions.');
    }
  } finally {
    busy = false;
    await refresh();
  }
}

function showError(msg) {
  const errEl = document.getElementById('errBox');
  errEl.classList.remove('hidden');
  errEl.textContent = '⚠ ' + msg;
}

async function toggleLogs() {
  logsOpen = !logsOpen;
  document.getElementById('logs').classList.toggle('hidden', !logsOpen);
  if (logsOpen) await renderLogs();
}

async function renderLogs() {
  const el = document.getElementById('logs');
  const { logs } = await chrome.storage.local.get(['logs']);
  el.textContent = (logs || []).slice(-30).join('\n') || '(kosong)';
}

async function doUpdate() {
  const btn = document.getElementById('btnUpdate');
  // Extension unpacked tidak bisa menimpa file-nya sendiri sambil jalan.
  // Arahkan user ke skrip updater, lalu jelaskan langkah reload-nya.
  btn.textContent = 'Jalankan update.bat / update.sh, lalu klik ⟳ di chrome://extensions';
  try {
    chrome.notifications?.create('update-howto', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Cara update',
      message: 'Jalankan update.bat (Windows) atau update.sh (Mac/Linux) di folder project, lalu klik tombol reload di chrome://extensions.',
      priority: 2
    });
  } catch (e) { /* notifications opsional */ }
  setTimeout(refresh, 3000);
}

function setStatus(color, text) {
  document.getElementById('status').innerHTML =
    '<span class="dot ' + color + '"></span>' + text;
}
