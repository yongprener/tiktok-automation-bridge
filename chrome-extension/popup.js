/**
 * Popup Logic
 * Shows connection status and allows start/stop polling.
 */

document.addEventListener('DOMContentLoaded', async () => {
  await updateStatus();
  
  document.getElementById('btnToggle').addEventListener('click', togglePolling);
  document.getElementById('btnOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
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
      document.getElementById('btnToggle').textContent = 'Setup Required';
      document.getElementById('btnToggle').disabled = true;
    } else if (polling) {
      setStatus('green', 'Connected');
      document.getElementById('btnToggle').textContent = 'Stop';
      document.getElementById('btnToggle').disabled = false;
    } else {
      setStatus('yellow', 'Ready');
      document.getElementById('btnToggle').textContent = 'Start';
      document.getElementById('btnToggle').disabled = false;
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

function setStatus(color, text) {
  document.getElementById('status').innerHTML = 
    `<span class="dot ${color}"></span>${text}`;
}
