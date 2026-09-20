/**
 * Telegram Bridge Client
 * Handles communication with Telegram Bot API.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

const TelegramBridge = {
  botToken: '',
  deviceId: '',
  deviceName: '',
  chatId: '',
  lastUpdateId: 0,
  polling: false,
  pollTimeout: 30,

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
  },

  isConfigured() {
    return !!(this.botToken && this.deviceName);
  },

  generateDeviceId() {
    return 'dev_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  },

  async saveConfig(config) {
    const updates = {};
    if (config.botToken !== undefined) { this.botToken = updates.botToken = config.botToken; }
    if (config.deviceName !== undefined) { this.deviceName = updates.deviceName = config.deviceName; }
    if (config.chatId !== undefined) { this.chatId = updates.chatId = config.chatId; }
    await chrome.storage.local.set(updates);
  },

  async getProfileInfo() {
    try {
      return await chrome.identity.getProfileUserInfo();
    } catch (e) {
      return { email: '', id: '' };
    }
  },

  async apiCall(method, params = {}) {
    if (!this.botToken) throw new Error('Bot token not configured');
    const url = `${TELEGRAM_API_BASE}${this.botToken}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.description || 'Telegram API error');
    return data.result;
  },

  async getUpdates(offset) {
    return this.apiCall('getUpdates', {
      offset: offset || (this.lastUpdateId + 1),
      timeout: this.pollTimeout,
      allowed_updates: ['message']
    });
  },

  async sendMessage(text, parseMode) {
    if (!this.chatId) {
      const updates = await this.getUpdates(0);
      if (updates.length > 0) {
        this.chatId = String(updates[updates.length - 1].message.chat.id);
        await chrome.storage.local.set({ chatId: this.chatId });
      }
    }
    return this.apiCall('sendMessage', {
      chat_id: this.chatId,
      text,
      parse_mode: parseMode || 'HTML'
    });
  },

  async startPolling() {
    if (this.polling) return;
    if (!this.isConfigured()) return;

    this.polling = true;
    console.log(`[Bridge] Polling started: ${this.deviceName} (${this.deviceId})`);

    const profile = await this.getProfileInfo();
    await this.sendMessage(
      `✅ ${this.deviceName} is online\n` +
      `Device ID: ${this.deviceId}\n` +
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
        await this.sleep(5000);
      }
    }
  },

  stopPolling() {
    this.polling = false;
    console.log('[Bridge] Polling stopped');
  },

  async handleMessage(message) {
    const text = (message.text || '').trim();
    const chatId = String(message.chat.id);

    if (!this.chatId) {
      this.chatId = chatId;
      await chrome.storage.local.set({ chatId: this.chatId });
    }

    const targetMatch = text.match(/^@(\S+)\s+(.*)/);
    let command;

    if (targetMatch) {
      const targetDevice = targetMatch[1];
      command = targetMatch[2];
      if (targetDevice.toLowerCase() !== this.deviceName.toLowerCase()) {
        return;
      }
    } else {
      command = text;
    }

    await this.sendMessage(`✅ Received: ${command}`);

    // Forward to content script
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await chrome.tabs.sendMessage(tabs[0].id, { type: 'execute', command });
      }
    } catch (e) {
      console.log('[Bridge] No content script on active tab');
    }
  },

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};
