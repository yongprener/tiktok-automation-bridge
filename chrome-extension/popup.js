/**
 * Popup Logic
 * Shows connection status, version, update check, start/stop polling.
 */

const CURRENT_VERSION = '0.1.0';
const REPO_API = 'https://api.github.com/repos/yongprener/tiktok-automation-bridge/releases/latest';

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('version').textContent = `v${CURRENT_VERSION}`;
  
  await updateStatus();
  await checkForUpdate();

  document.getElementById('btnToggle').addEventListener('click', togglePolling);
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnUpdate').addEventListener('click', doUpdate);
  document.getElementById('version').addEventListener('click', checkForUpdate);
});

async function updateStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'status-check' });
    
    if (!response) {
      setStatus('error', 'No response');
      return;
    }
    
    const { configured, deviceName, deviceId, polling } = response;
    
    if (!configured) {
      setStatus('red', 'Not configured');
      const btn = document.getElementById('btnToggle');
      btn.textContent = 'Open Settings';
      btn.disabled = false;
      btn.onclick = openSettings;
    } else if (polling) {
      setStatus('green', 'Connected');
      document.getElementById('btnToggle').textContent = 'Stop';
    } else {
      setStatus('yellow', 'Ready');
      document.getElementById('btnToggle').textContent = 'Start';
    }
    
    document.getElementById('device').textContent = deviceName || '—';
    document.getElementById('polling').textContent = polling ? 'Active' : 'Idle';
    document.getElementById('deviceId').textContent = deviceId || '';
    
    // Get profile email
    try {
      const info = await chrome.identity.getProfileUserInfo();
      document.getElementById('profile').textContent = info.email || 'Not logged in';
    } catch {
      document.getElementById('profile').textContent = 'N/A';
    }
  } catch (error) {
    setStatus('red', 'Error: ' + error.message);
  }
}

async function togglePolling() {
  const btn = document.getElementById('btnToggle');
  const currentText = btn.textContent;
  
  if (currentText === 'Start') {
    await chrome.runtime.sendMessage({ type: 'start-polling' });
    btn.textContent = 'Starting...';
  } else if (currentText === 'Stop') {
    await chrome.runtime.sendMessage({ type: 'stop-polling' });
    btn.textContent = 'Stopping...';
  }
  
  setTimeout(updateStatus, 1000);
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

// ─── Update Check ─────────────────────────────────────────────────

async function checkForUpdate() {
  try {
    const response = await fetch(REPO_API);
    if (!response.ok) return;
    
    const data = await response.json();
    const latestVersion = data.tag_name.replace(/^v/, '');
    
    if (isNewerVersion(latestVersion, CURRENT_VERSION)) {
      const updateBtn = document.getElementById('btnUpdate');
      updateBtn.classList.remove('hidden');
      updateBtn.textContent = ` Update Available — v${latestVersion}`;
      
      // Store download URL
      if (data.zipball_url) {
        chrome.storage.local.set({ updateUrl: data.zipball_url, updateVersion: latestVersion });
      }
    }
  } catch (e) {
    // Silently fail — update check is non-critical
    console.log('[Popup] Update check failed:', e.message);
  }
}

function isNewerVersion(latest, current) {
  const latestParts = latest.split('.').map(Number);
  const currentParts = current.split('.').map(Number);
  
  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

async function doUpdate() {
  const btn = document.getElementById('btnUpdate');
  btn.textContent = ' Downloading...';
  
  try {
    const { updateUrl } = await chrome.storage.local.get(['updateUrl']);
    if (!updateUrl) throw new Error('No update URL');
    
    // Download the zipball
    const response = await fetch(updateUrl);
    const blob = await response.blob();
    
    // Save to downloads
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tiktok-automation-bridge-update.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    btn.textContent = ' Downloaded! Extract and replace extension folder.';
    
    // Notify background
    await chrome.runtime.sendMessage({ 
      type: 'bridge-command', 
      command: 'status' 
    });
  } catch (error) {
    btn.textContent = ` Update failed: ${error.message}`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function setStatus(color, text) {
  document.getElementById('status').innerHTML = 
    `<span class="dot ${color}"></span>${text}`;
}
