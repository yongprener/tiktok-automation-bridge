/**
 * Telegram Bridge Client — v0.2.0
 * Pure API client. No polling loop here (MV3 service workers die).
 * Polling is driven by chrome.alarms in background.js.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

const TelegramBridge = {
  botToken: '',
  deviceId: '',
  deviceName: '',
  chatId: '',
  lastUpdateId: 0,

  async init() {
    const stored = await chrome.storage.local.get([
      'botToken', 'deviceId', 'deviceName', 'chatId', 'lastUpdateId'
    ]);

    this.botToken = stored.botToken || '';
    // NOTE: do NOT regenerate deviceId here — only generate if truly absent
    this.deviceId = stored.deviceId || this.generateDeviceId();
    this.deviceName = stored.deviceName || '';
    this.chatId = stored.chatId ? String(stored.chatId) : '';
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
      // identity.email requires the "identity.email" permission; fall back gracefully
      const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
      return { email: info.email || '', id: info.id || '' };
    } catch (e) {
      return { email: '', id: '' };
    }
  },

  async apiCall(method, params = {}) {
    if (!this.botToken) throw new Error('Bot token not configured');
    const url = `${TELEGRAM_API_BASE}${this.botToken}/${method}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    const data = await response.json();
    if (!data.ok) throw new Error(data.description || 'Telegram API error');
    return data.result;
  },

  /**
   * Short-poll getUpdates. timeout=0 => returns immediately, safe for MV3.
   */
  async getUpdates(offset) {
    return this.apiCall('getUpdates', {
      offset: (offset !== undefined) ? offset : (this.lastUpdateId + 1),
      timeout: 0,
      allowed_updates: ['message']
    });
  },

  async sendMessage(text, parseMode) {
    if (!this.chatId) throw new Error('Chat not linked. Send a message to the bot first.');
    return this.apiCall('sendMessage', {
      chat_id: this.chatId,
      text,
      parse_mode: parseMode || 'HTML',
      disable_web_page_preview: true
    });
  },

  /**
   * Link chatId from bot updates (used by options page Test Connection).
   */
  async linkChatFromUpdates() {
    const updates = await this.getUpdates(0);
    if (updates.length > 0) {
      const last = updates[updates.length - 1];
      if (last.message && last.message.chat) {
        this.chatId = String(last.message.chat.id);
        await chrome.storage.local.set({ chatId: this.chatId });
        return this.chatId;
      }
    }
    return null;
  }
};
