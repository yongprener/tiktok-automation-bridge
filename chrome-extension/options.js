/**
 * Options Page Logic — v0.2.0
 * Setup device name, bot token, test connection.
 * IMPORTANT: saving config must NOT wipe chatId / lastUpdateId.
 */

const api = (token, method, params) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: params ? JSON.stringify(params) : undefined
  }).then(r => r.json());

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  document.getElementById('btnSave').addEventListener('click', saveConfig);
  document.getElementById('btnTest').addEventListener('click', testConnection);
  document.getElementById('btnRelink').addEventListener('click', relinkChat);
});

async function loadConfig() {
  const stored = await chrome.storage.local.get([
    'botToken', 'deviceId', 'deviceName', 'chatId'
  ]);

  document.getElementById('deviceName').value = stored.deviceName || '';
  document.getElementById('botToken').value = stored.botToken || '';
  document.getElementById('deviceId').textContent = stored.deviceId || '—';
  document.getElementById('chatId').textContent = stored.chatId ? String(stored.chatId) : '—';

  await refreshProfile();
  updateStatus(stored);
}

async function refreshProfile() {
  const el = document.getElementById('profile');
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    el.textContent = info.email || 'Not logged in';
  } catch (e) {
    el.textContent = 'Not available';
  }
}

function updateStatus(stored) {
  const ok = !!(stored.botToken && stored.deviceName);
  document.getElementById('status').textContent = ok ? 'Configured' : 'Not configured';
  document.getElementById('status').style.color = ok ? '#4caf50' : '#ff9800';
}

async function saveConfig() {
  const deviceName = document.getElementById('deviceName').value.trim();
  const botToken = document.getElementById('botToken').value.trim();

  if (!deviceName || !botToken) {
    showResult('Device name dan bot token wajib diisi', true);
    return;
  }

  const stored = await chrome.storage.local.get([
    'deviceId', 'chatId', 'lastUpdateId'
  ]);

  const updates = { deviceName, botToken };
  // generate deviceId only once
  if (!stored.deviceId) {
    updates.deviceId = 'dev_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }
  // PRESERVE chatId if the token is unchanged — don't force re-link
  if (stored.botToken !== botToken) {
    updates.chatId = '';
    updates.lastUpdateId = 0;
  }

  await chrome.storage.local.set(updates);

  const after = await chrome.storage.local.get(['deviceId', 'chatId']);
  document.getElementById('deviceId').textContent = after.deviceId || '—';
  document.getElementById('chatId').textContent = after.chatId ? String(after.chatId) : '—';
  updateStatus({ botToken, deviceName });
  showResult('✅ Tersimpan. Klik "Test Connection" untuk verifikasi.', false);
}

async function testConnection() {
  const botToken = document.getElementById('botToken').value.trim();
  if (!botToken) { showResult('Bot token wajib diisi', true); return; }

  showResult('Mengetes koneksi…', false);
  try {
    const me = await api(botToken, 'getMe');
    if (!me.ok) { showResult('❌ Token invalid: ' + me.description, true); return; }

    const botName = me.result.username;
    // note: getUpdates uses POST, so no webhook conflict issues from GET
    await api(botToken, 'deleteWebhook', { drop_pending_updates: false });
    const up = await api(botToken, 'getUpdates', { limit: 100, timeout: 0 });

    if (up.ok && up.result.length > 0) {
      const last = up.result[up.result.length - 1];
      const chatId = last.message ? String(last.message.chat.id) : null;
      const lastId = last.update_id;
      if (chatId) {
        await chrome.storage.local.set({ chatId, lastUpdateId: lastId });
        document.getElementById('chatId').textContent = chatId;
        showResult(`✅ Terkoneksi ke @${botName}. Chat ID: ${chatId}`, false);
        return;
      }
    }
    showResult(`✅ Terkoneksi ke @${botName}. Kirim pesan ke bot dulu untuk link chat.`, false);
  } catch (error) {
    showResult('❌ Koneksi gagal: ' + error.message, true);
  }
}

async function relinkChat() {
  const { botToken } = await chrome.storage.local.get(['botToken']);
  if (!botToken) { showResult('Simpan bot token dulu', true); return; }
  showResult('Mencari chat…', false);
  try {
    await api(botToken, 'deleteWebhook', { drop_pending_updates: false });
    const up = await api(botToken, 'getUpdates', { limit: 100, timeout: 0 });
    if (up.ok && up.result.length > 0) {
      const last = up.result[up.result.length - 1];
      if (last.message) {
        const chatId = String(last.message.chat.id);
        await chrome.storage.local.set({ chatId, lastUpdateId: last.update_id });
        document.getElementById('chatId').textContent = chatId;
        showResult('✅ Chat ke-link: ' + chatId, false);
        return;
      }
    }
    showResult('Chat belum ketemu. Kirim pesan ke bot di Telegram, lalu klik lagi.', true);
  } catch (e) {
    showResult('❌ Gagal: ' + e.message, true);
  }
}

function showResult(message, isError) {
  document.getElementById('result').innerHTML =
    `<p class="${isError ? 'error' : 'success'}">${message}</p>`;
}
