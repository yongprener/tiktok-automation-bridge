/**
 * Popup Logic — v0.1.1
 * Reads config directly from chrome.storage.local (not relying on background init).
 */

const CURRENT_VERSION = '0.1.0';

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('version').textContent = `v${CURRENT_VERSION}`;

  await updateStatus();

  document.getElementById('btnToggle').addEventListener('click', togglePolling);
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnUpdate').addEventListener('click', doUpdate);
  document.getElementById('version').addEventListener('click', checkForUpdate);
});

async function updateStatus() {
  try {
    // Read directly from storage — don't depend on background being initialized
    const stored = await chrome.storage.local.get([
      'botToken', 'deviceId', 'deviceName', 'chatId', 'updateAvailable', 'updateVersion'
    ]);

    const configured = !!(stored.botToken && stored.deviceName);
    const deviceName = stored.deviceName || '';
    const deviceId = stored.deviceId || '';
    const chatId = stored.chatId || '';

    // Update UI
    document.getElementById('device').textContent = deviceName || '—';
    document.getElementById('deviceId').textContent = deviceId || '';
    document.getElementById('profile').textContent = chatId ? 'Linked' : 'Not linked';

    // Check polling status from background
    let polling = false;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'status-check' });
      if (response && response.polling !== undefined) {
        polling = response.polling;
      }
    } catch (e) {
      // Background might not be ready — that's ok
    }

    document.getElementById('polling').textContent = polling ? 'Active' : 'Idle';

    // Set status display
    if (!configured) {
      setStatus('red', 'Not configured');
      const btn = document.getElementById('btnToggle');
      btn.textContent = 'Open Settings';
    } else if (polling) {
      setStatus('green', 'Connected');
      document.getElementById('btnToggle').textContent = 'Stop';
    } else {
      setStatus('yellow', 'Ready — click Start');
      document.getElementById('btnToggle').textContent = 'Start';
    }

    // Show update button if available
    if (stored.updateAvailable && stored.updateVersion) {
      const updateBtn = document.getElementById('btnUpdate');
      updateBtn.classList.remove('hidden');
      updateBtn.textContent = ` Update Available — v${stored.updateVersion}`;
    }

    // Get profile email
    try {
      const info = await chrome.identity.getProfileUserInfo();
      if (info.email) {
        document.getElementById('profile').textContent = info.email;
      }
    } catch (e) {
      // identity might not be available
    }

  } catch (error) {
    setStatus('red', 'Error: ' + error.message);
  }
}

async function togglePolling() {
  const btn = document.getElementById('btnToggle');
  const currentText = btn.textContent;

  if (currentText === 'Open Settings') {
    openSettings();
    return;
  }

  if (currentText === 'Start') {
    btn.textContent = 'Starting...';
    btn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: 'start-polling' });
    } catch (e) {
      // Background might need re-init
      console.log('[Popup] Start failed, trying re-init');
    }
    btn.disabled = false;
  } else if (currentText === 'Stop') {
    btn.textContent = 'Stopping...';
    btn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: 'stop-polling' });
    } catch (e) {
      // ignore
    }
    btn.disabled = false;
  }

  setTimeout(updateStatus, 1000);
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

// ─── Update Check ─────────────────────────────────────────────────

async function checkForUpdate() {
  const REPO_API = 'https://api.github.com/repos/yongprener/tiktok-automation-bridge/releases/latest';
  try {
    const response = await fetch(REPO_API);
    if (!response.ok) return;

    const data = await response.json();
    const latestVersion = (data.tag_name || '').replace(/^v/, '');

    if (latestVersion && isNewerVersion(latestVersion, CURRENT_VERSION)) {
      const updateBtn = document.getElementById('btnUpdate');
      updateBtn.classList.remove('hidden');
      updateBtn.textContent = ` Update Available — v${latestVersion}`;

      await chrome.storage.local.set({
        updateAvailable: true,
        updateVersion: latestVersion
      });
    } else {
      const versionEl = document.getElementById('version');
      versionEl.textContent = `v${CURRENT_VERSION} ✓`;
    }
  } catch (e) {
    console.log('[Popup] Update check failed:', e.message);
  }
}

function isNewerVersion(latest, current) {
  if (!latest) return false;
  const l = latest.split('.').map(Number);
  const c = current.split('.').map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

async function doUpdate() {
  const btn = document.getElementById('btnUpdate');
  btn.textContent = ' Run update.sh or update.bat to update';

  // Notify user
  chrome.notifications?.create('update-instructions', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'How to Update',
    message: 'Run update.sh (Mac/Linux) or update.bat (Windows) in the project folder, then reload the extension.',
    priority: 2
  }).catch(() => {});
}

// ─── Helpers ──────────────────────────────────────────────────────

function setStatus(color, text) {
  document.getElementById('status').innerHTML =
    `<span class="dot ${color}"></span>${text}`;
}
