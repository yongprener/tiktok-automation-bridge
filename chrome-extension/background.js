/**
 * Background Service Worker
 * Main orchestrator: init bridge, poll commands, auto-update check, dispatch.
 */

self.importScripts('lib/telegram-bridge.js');

const CURRENT_VERSION = '0.1.0';
const REPO_API = 'https://api.github.com/repos/yongprener/tiktok-automation-bridge/releases/latest';

let activeTabId = null;

// ─── Initialize on load (service worker start) ────────────────────

// Run immediately — service worker wakes up on messages, not just onInstalled
initBackground();

async function initBackground() {
  try {
    await TelegramBridge.init();
    console.log('[BG] Bridge initialized. Configured:', TelegramBridge.isConfigured());
    
    // Set up alarms
    chrome.alarms.create('poll', { periodInMinutes: 0.5 });
    chrome.alarms.create('update-check', { periodInMinutes: 30 });
  } catch (e) {
    console.error('[BG] Init error:', e);
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[BG] Installed/updated:', details.reason);
  await TelegramBridge.init();
  
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[BG] Browser started');
  await TelegramBridge.init();
});

// ─── Alarm Handler ────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'poll') {
    if (TelegramBridge.isConfigured() && !TelegramBridge.polling) {
      console.log('[BG] Auto-starting polling from alarm...');
      await TelegramBridge.startPolling();
    }
  } else if (alarm.name === 'update-check') {
    await checkForUpdate();
  }
});

// ─── Auto-Update ──────────────────────────────────────────────────

async function checkForUpdate() {
  try {
    const response = await fetch(REPO_API);
    if (!response.ok) return;
    const data = await response.json();
    const latestVersion = (data.tag_name || '').replace(/^v/, '');

    if (latestVersion && isNewerVersion(latestVersion, CURRENT_VERSION)) {
      chrome.notifications.create('update-available', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Update Available',
        message: `v${latestVersion} is ready. Run update.bat to update.`,
        priority: 2
      });
      await chrome.storage.local.set({ updateAvailable: true, updateVersion: latestVersion });
    }
  } catch (e) {
    console.log('[BG] Update check failed:', e.message);
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

// ─── Message Router ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'status-check') {
    sendResponse({
      configured: TelegramBridge.isConfigured(),
      deviceName: TelegramBridge.deviceName,
      deviceId: TelegramBridge.deviceId,
      polling: TelegramBridge.polling,
      version: CURRENT_VERSION
    });
    return false;
  }

  if (message.type === 'config-update') {
    TelegramBridge.saveConfig(message.config).then(async () => {
      await TelegramBridge.init();
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'start-polling') {
    // Re-init in case config changed
    TelegramBridge.init().then(() => {
      return TelegramBridge.startPolling();
    }).then(() => {
      sendResponse({ success: true });
    }).catch((e) => {
      sendResponse({ success: false, error: e.message });
    });
    return true;
  }

  if (message.type === 'stop-polling') {
    TelegramBridge.stopPolling();
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'check-update') {
    checkForUpdate().then(() => {
      chrome.storage.local.get(['updateAvailable', 'updateVersion']).then((res) => {
        sendResponse(res);
      });
    });
    return true;
  }

  if (message.type === 'bridge-command') {
    handleCommand(message.command, sender, sendResponse);
    return true;
  }

  return false;
});

// ─── Command Handler ──────────────────────────────────────────────

async function handleCommand(command, sender, sendResponse) {
  console.log('[BG] Command:', command);
  const parts = (command || '').toLowerCase().split(/\s+/);
  const action = parts[0];

  try {
    switch (action) {
      case 'navigate':
      case 'buka': {
        const url = parts.slice(1).join(' ');
        await navigateToUrl(url);
        sendResponse({ success: true, message: `Navigated to ${url}` });
        break;
      }
      case 'screenshot': {
        const dataUrl = await captureScreenshot();
        sendResponse({ success: true, screenshot: dataUrl });
        break;
      }
      case 'scrape': {
        const selector = parts.slice(1).join(' ');
        const result = await scrapeContent(selector);
        sendResponse({ success: true, data: result });
        break;
      }
      case 'click': {
        const selector = parts.slice(1).join(' ');
        await clickElement(selector);
        sendResponse({ success: true });
        break;
      }
      case 'fill': {
        const match = command.match(/fill\s+(\S+)\s*=\s*(.+)/i);
        if (match) {
          await fillInput(match[1], match[2]);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Usage: fill selector=value' });
        }
        break;
      }
      case 'status': {
        sendResponse({
          success: true,
          status: {
            deviceName: TelegramBridge.deviceName,
            deviceId: TelegramBridge.deviceId,
            polling: TelegramBridge.polling,
            version: CURRENT_VERSION,
            activeTab: activeTabId
          }
        });
        break;
      }
      default: {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
          activeTabId = tabs[0].id;
          try {
            const response = await chrome.tabs.sendMessage(activeTabId, {
              type: 'execute',
              command
            });
            sendResponse(response || { success: false, error: 'No response from content script' });
          } catch (e) {
            sendResponse({ success: false, error: 'Cannot reach content script: ' + e.message });
          }
        } else {
          sendResponse({ success: false, error: 'No active tab' });
        }
      }
    }
  } catch (error) {
    console.error('[BG] Command error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ─── Tab Actions ──────────────────────────────────────────────────

async function navigateToUrl(url) {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  const tab = await chrome.tabs.create({ url, active: true });
  activeTabId = tab.id;
  return new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    });
  });
}

async function captureScreenshot() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) throw new Error('No active tab');
  return chrome.tabs.captureVisibleTab(tabs[0].windowId, { format: 'png' });
}

async function scrapeContent(selector) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) throw new Error('No active tab');
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: (sel) => {
      const elements = document.querySelectorAll(sel);
      return Array.from(elements).map(el => ({
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 500),
        href: el.href || '',
        src: el.src || '',
        html: el.outerHTML.substring(0, 1000)
      }));
    },
    args: [selector]
  });
  return results[0]?.result || [];
}

async function clickElement(selector) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) throw new Error('No active tab');
  await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: (sel) => { const el = document.querySelector(sel); if (el) el.click(); return !!el; },
    args: [selector]
  });
}

async function fillInput(selector, value) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) throw new Error('No active tab');
  await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    args: [selector, value]
  });
}
