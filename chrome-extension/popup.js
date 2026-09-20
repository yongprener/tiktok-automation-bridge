/**
 * Popup Logic — v0.2.0
 * Reads config straight from storage; gets polling state from background.
 */

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btnToggle').addEventListener('click', togglePolling);
  document.getElementById('btnSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('btnUpdate').addEventListener('click', doUpdate);
  document.getElementById('btnLogs').addEventListener('click', toggleLogs);
  document.getElementById('version').addEventListener('click', () => refresh(true));

  await refresh();
  // live-ish updates while popup is open
  setInterval(refresh, 2000);
});

let currentState = null;
let logsOpen = false;
let busy = false;

async function refresh(checkUpdate = false) {
  if (busy) return;

  let state;
  try {
    state = await send({ type: 'status-check' });
  } catch (e) {
    state = null;
  }

  if (!state) {
    setStatus('red', 'Service worker nggak merespons');
    return;
  }
  currentState = state;

  document.getElementById('version').textContent = 'v' + state.version;
  document.getElementById('device').textContent = state.deviceName || '—';
  document.getElementById('deviceId').textContent = state.deviceId || '';

  // profile / chat link
  const profileEl = document.getElementById('profile');
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    if (info.email) {
      profileEl.textContent = info.email;
    } else {
      profileEl.textContent = state.chatId ? 'Chat linked' : 'Not linked';
    }
  } catch (e) {
    profileEl.textContent = state.chatId ? 'Chat linked' : 'Not linked';
  }

  document.getElementById('polling').textContent = state.polling ? 'Active' : 'Idle';

  const btn = document.getElementById('btnToggle');
  if (!state.configured) {
    setStatus('red', 'Not configured');
    btn.textContent = '⚙️ Open Settings';
    btn.dataset.mode = 'settings';
  } else if (!state.chatId) {
    setStatus('yellow', 'Chat belum ke-link');
    btn.textContent = 'Start';
    btn.dataset.mode = 'start';
  } else if (state.polling) {
    const ago = state.lastPollOk ? Math.round((Date.now() - state.lastPollOk) / 1000) : null;
    if (state.lastPollError) {
      setStatus('yellow', 'Polling error — retrying');
    } else {
      setStatus('green', ago === null || ago < 90 ? 'Connected' : `Connected (${ago}s lalu)`);
    }
    btn.textContent = 'Stop';
    btn.dataset.mode = 'stop';
  } else {
    setStatus('yellow', 'Ready — click Start');
    btn.textContent = 'Start';
    btn.dataset.mode = 'start';
  }

  // error detail
  const errEl = document.getElementById('errBox');
  if (state.lastPollError) {
    errEl.classList.remove('hidden');
    errEl.textContent = '⚠ ' + state.lastPollError;
  } else {
    errEl.classList.add('hidden');
  }

  // update button
  const upBtn = document.getElementById('btnUpdate');
  if (state.updateAvailable && state.updateVersion) {
    upBtn.classList.remove('hidden');
    upBtn.textContent = `⬆ Update v${state.updateVersion} tersedia`;
  } else {
    upBtn.classList.add('hidden');
  }

  if (logsOpen) await renderLogs();

  if (checkUpdate) {
    const verEl = document.getElementById('version');
    const prev = verEl.textContent;
    verEl.textContent = 'cek…';
    try {
      await send({ type: 'check-update' });
    } catch (e) { /* ignore */ }
    verEl.textContent = prev;
  }
}

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

async function togglePolling() {
  const btn = document.getElementById('btnToggle');
  const mode = btn.dataset.mode;

  if (mode === 'settings') {
    chrome.runtime.openOptionsPage();
    return;
  }

  busy = true;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = mode === 'start' ? 'Starting…' : 'Stopping…';

  try {
    const res = mode === 'start'
      ? await send({ type: 'start-polling' })
      : await send({ type: 'stop-polling' });

    if (res && res.success === false) {
      setStatus('red', res.error || 'Gagal');
      showError(res.error || 'Gagal memulai polling');
    }
  } catch (e) {
    // service worker went away — restart it and retry once
    try {
      const res2 = mode === 'start'
        ? await send({ type: 'start-polling' })
        : await send({ type: 'stop-polling' });
      if (res2 && res2.success === false) showError(res2.error);
    } catch (e2) {
      showError('Chrome memutus koneksi ke service worker: ' + e2.message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
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
  btn.textContent = '⬆ Jalankan update.bat, lalu reload extension';
  setTimeout(refresh, 2500);
}

// ─── Helpers ──────────────────────────────────────────────────────

function setStatus(color, text) {
  document.getElementById('status').innerHTML =
    `<span class="dot ${color}"></span>${text}`;
}
