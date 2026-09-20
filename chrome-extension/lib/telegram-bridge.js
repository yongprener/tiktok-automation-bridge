/**
 * Telegram Bridge Client
 * 
 * Handles communication with Telegram Bot API.
 * Long-polls for incoming commands from Hermes Agent.
 * Sends results back via Telegram messages.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

class TelegramBridge {
  constructor() {
    this.botToken = '';
    this.deviceId = '';
    this.deviceName = '';
    this.chatId = '';
    this.lastUpdateId = 0;
    this.polling = false;
    this.pollTimeout = 30; // long polling seconds
  }

  async init() {
    const stored = await chrome.storage.local.get([
      'botToken', 'deviceId', 'deviceName', 'chatId', 'lastUpdateId'
    ]);
    
    this.botToken = stored.botToken || '';
    this.deviceId = stored.deviceId || this.generateDeviceId();
    this.deviceName = stored.deviceName || '';
    this.chatId = stored.chatId || '';
    this.lastUpdateId = stored.lastUpdateId || 0;

    if (!stored.deviceId) {
      await chrome.storage.local.set({ deviceId: this.deviceId });
    }

    return this.isConfigured();
  }

  isConfigured() {
    return !!(this.botToken && this.deviceName);
  }

  generateDeviceId() {
    return 'dev_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }

  async saveConfig(config) {
    const updates = {};
    if (config.botToken !== undefined) this.botToken = updates.botToken = config.botToken;
    if (config.deviceName !== undefined) this.deviceName = updates.deviceName = config.deviceName;
    if (config.chatId !== undefined) this.chatId = updates.chatId = config.chatId;
    await chrome.storage.local.set(updates);
  }

  async getProfileInfo() {
    try {
      const info = await chrome.identity.getProfileUserInfo();
      return info;
    } catch (e) {
      return { email: '', id: '' };
    }
  }

  // ─── Telegram Bot API ──────────────────────────────────────────

  async apiCall(method, params = {}) {
    if (!this.botToken) throw new Error('Bot token not configured');
    
    const url = `${TELEGRAM_API_BASE}${this.botToken}/${method}`;
    const body = JSON.stringify(params);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    
    const data = await response.json();
    if (!data.ok) throw new Error(data.description || 'Telegram API error');
    return data.result;
  }

  async getUpdates(offset = this.lastUpdateId + 1) {
    return this.apiCall('getUpdates', {
      offset,
      timeout: this.pollTimeout,
      allowed_updates: ['message']
    });
  }

  async sendMessage(text, parseMode = 'HTML') {
    if (!this.chatId) {
      // Try to find chat ID from latest messages
      const updates = await this.getUpdates(0);
      if (updates.length > 0) {
        this.chatId = String(updates[updates.length - 1].message.chat.id);
        await chrome.storage.local.set({ chatId: this.chatId });
      }
    }
    
    return this.apiCall('sendMessage', {
      chat_id: this.chatId,
      text,
      parse_mode: parseMode
    });
  }

  async sendPhoto(photo, caption = '') {
    return this.apiCall('sendPhoto', {
      chat_id: this.chatId,
      photo,
      caption
    });
  }

  async sendDocument(file) {
    return this.apiCall('sendDocument', {
      chat_id: this.chatId,
      document: file
    });
  }

  // ─── Polling Loop ──────────────────────────────────────────────

  async startPolling() {
    if (this.polling) return;
    if (!this.isConfigured()) return;
    
    this.polling = true;
    console.log(`[Bridge] Polling started for device: ${this.deviceName} (${this.deviceId})`);
    
    // Announce online status
    const profile = await this.getProfileInfo();
    await this.sendMessage(
      `🟢 <b>${this.deviceName}</b> is online\n` +
      `Device ID: <code>${this.deviceId}</code>\n` +
      `Profile: ${profile.email || 'not logged in'}`
    );

    while (this.polling) {
      try {
        const updates = await this.getUpdates();
        
        for (const update of updates) {
          this.lastUpdateId = update.update_id;
          await chrome.storage.local.set({ lastUpdateId: this.lastUpdateId });
          
          if (update.message && update.message.text) {
            await this.handleMessage(update.message);
          }
        }
      } catch (error) {
        console.error('[Bridge] Polling error:', error);
        // Backoff on error
        await this.sleep(5000);
      }
    }
  }

  stopPolling() {
    this.polling = false;
    console.log('[Bridge] Polling stopped');
  }

  // ─── Message Handler ────────────────────────────────────────────

  async handleMessage(message) {
    const text = message.text || '';
    const chatId = String(message.chat.id);
    
    // Update chatId if not set
    if (!this.chatId) {
      this.chatId = chatId;
      await chrome.storage.local.set({ chatId: this.chatId });
    }

    // Parse command: [device_name] command args
    // If device_name matches ours, execute
    const lines = text.split('\n');
    const firstLine = lines[0].trim();
    
    // Check if message is targeted at this device
    // Format: "@device_name command" or just "command" (broadcast)
    const targetMatch = firstLine.match(/^@(\S+)\s+(.*)/);
    let command, isTargeted = false;
    
    if (targetMatch) {
      const targetDevice = targetMatch[1];
      command = targetMatch[2];
      if (targetDevice.toLowerCase() === this.deviceName.toLowerCase()) {
        isTargeted = true;
      } else {
        return; // Not for us
      }
    } else {
      command = text.trim();
      isTargeted = true; // Broadcast — accept
    }

    // Send to content script for execution
    const event = new CustomEvent('bridge-command', {
      detail: { command, isTargeted, chatId }
    });
    window.dispatchEvent(event);

    // Also notify background script
    chrome.runtime.sendMessage({
      type: 'bridge-command',
      command,
      isTargeted,
      chatId
    }).catch(() => {}); // content script might not exist

    // Acknowledge receipt
    await this.sendMessage(`✅ Received: ${command}`);
  }

  // ─── Helpers ────────────────────────────────────────────────────

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for use in background.js
self.TelegramBridge = TelegramBridge;
