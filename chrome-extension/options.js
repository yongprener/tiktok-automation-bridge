/**
 * Options Page Logic
 * Setup device name, bot token, test connection.
 */

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  
  document.getElementById('btnSave').addEventListener('click', saveConfig);
  document.getElementById('btnTest').addEventListener('click', testConnection);
});

async function loadConfig() {
  try {
    const stored = await chrome.storage.local.get([
      'botToken', 'deviceId', 'deviceName', 'chatId'
    ]);
    
    document.getElementById('deviceName').value = stored.deviceName || '';
    document.getElementById('botToken').value = stored.botToken || '';
    document.getElementById('deviceId').textContent = stored.deviceId || '—';
    
    // Get profile email
    try {
      const info = await chrome.identity.getProfileUserInfo();
      document.getElementById('profile').textContent = info.email || 'Not logged in';
    } catch {
      document.getElementById('profile').textContent = 'N/A';
    }
    
    if (stored.botToken && stored.deviceName) {
      document.getElementById('status').textContent = 'Configured';
    } else {
      document.getElementById('status').textContent = 'Not configured';
    }
  } catch (error) {
    showResult('Error loading config: ' + error.message, true);
  }
}

async function saveConfig() {
  const deviceName = document.getElementById('deviceName').value.trim();
  const botToken = document.getElementById('botToken').value.trim();
  
  if (!deviceName || !botToken) {
    showResult('Device name and bot token are required', true);
    return;
  }
  
  // Generate device ID if not exists
  const stored = await chrome.storage.local.get(['deviceId']);
  const deviceId = stored.deviceId || 'dev_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  
  await chrome.storage.local.set({
    deviceName,
    botToken,
    deviceId,
    lastUpdateId: 0,
    chatId: ''
  });
  
  showResult('✅ Configuration saved! Click "Test Connection" to verify.', false);
  document.getElementById('deviceId').textContent = deviceId;
  document.getElementById('status').textContent = 'Configured';
}

async function testConnection() {
  const botToken = document.getElementById('botToken').value.trim();
  const deviceName = document.getElementById('deviceName').value.trim();
  
  if (!botToken) {
    showResult('Bot token required', true);
    return;
  }
  
  showResult('Testing connection...', false);
  
  try {
    // Test: call getMe to verify token
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = await response.json();
    
    if (data.ok) {
      const botName = data.result.username;
      showResult(`✅ Connected to @${botName}. Bot is active.`, false);
      
      // Try to get latest chat ID
      const updatesResp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=1&offset=-1`);
      const updatesData = await updatesResp.json();
      
      if (updatesData.ok && updatesData.result.length > 0) {
        const chatId = String(updatesData.result[0].message.chat.id);
        await chrome.storage.local.set({ chatId });
        showResult(`✅ Connected to @${botName}. Chat ID: ${chatId}`, false);
      } else {
        showResult(`✅ Connected to @${botName}. Send a message to the bot first to link chat.`, false);
      }
    } else {
      showResult('❌ Invalid bot token: ' + data.description, true);
    }
  } catch (error) {
    showResult('❌ Connection failed: ' + error.message, true);
  }
}

function showResult(message, isError) {
  const el = document.getElementById('result');
  el.innerHTML = `<p class="${isError ? 'error' : 'success'}">${message}</p>`;
}
