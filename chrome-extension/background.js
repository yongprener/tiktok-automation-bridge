/**
 * Background Service Worker
 *
 * MV3-safe design: NO long-running loops (service worker is killed after ~30s idle).
 * Polling is driven by chrome.alarms firing every 30s, each tick doing ONE short poll.
 *
 * Versi dibaca dari chrome.runtime.getManifest().version — SATU sumber
 * kebenaran (manifest.json). Jangan hardcode versi di file ini.
 */

self.importScripts('lib/telegram-bridge.js');

const CURRENT_VERSION = chrome.runtime.getManifest().version;
const POLL_ALARM = 'bridge-poll';
const UPDATE_ALARM = 'bridge-update-check';

let activeTabId = null;

// ─── Lightweight log ring buffer (shown in popup) ─────────────────

async function logEvent(msg) {
  try {
    const { logs } = await chrome.storage.local.get(['logs']);
    const arr = Array.isArray(logs) ? logs : [];
    arr.push(new Date().toLocaleTimeString('id-ID') + ' ' + msg);
    while (arr.length > 60) arr.shift();
    await chrome.storage.local.set({ logs: arr });
  } catch (e) { /* ignore */ }
}

// ─── Init (runs every time the service worker wakes) ──────────────

(async () => {
  try {
    await TelegramBridge.init();
    console.log('[BG] Init OK. configured=%s polling=%s device=%s',
      TelegramBridge.isConfigured(), await isPollingEnabled(), TelegramBridge.deviceName);
  } catch (e) {
    console.error('[BG] Init error:', e);
  }
})();

async function isPollingEnabled() {
  const { pollingEnabled } = await chrome.storage.local.get(['pollingEnabled']);
  return !!pollingEnabled;
}

async function setPollingEnabled(v) {
  await chrome.storage.local.set({ pollingEnabled: !!v });
}

// ─── Lifecycle ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[BG] onInstalled:', details.reason);
  await TelegramBridge.init();
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 30 });
  await setPollingEnabled(false);
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[BG] onStartup');
  await TelegramBridge.init();
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 30 });
});

// ─── Alarm-driven polling ─────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) {
    await pollTick();
  } else if (alarm.name === UPDATE_ALARM) {
    await checkForUpdate();
  }
});

async function pollTick() {
  await TelegramBridge.init();
  if (!TelegramBridge.isConfigured()) return;
  if (!(await isPollingEnabled())) return;

  try {
    const updates = await TelegramBridge.getUpdates();
    if (updates.length) {
      await logEvent(`poll: ${updates.length} update`);
    }
    for (const update of updates) {
      TelegramBridge.lastUpdateId = update.update_id;
      await chrome.storage.local.set({ lastUpdateId: update.update_id });

      if (update.message && update.message.text) {
        await handleCommandMessage(update.message);
      }
    }
    await chrome.storage.local.set({ lastPollOk: Date.now(), lastPollError: '' });
  } catch (e) {
    console.error('[BG] Poll error:', e.message);
    await chrome.storage.local.set({ lastPollError: e.message });
    await logEvent('poll error: ' + e.message);
  }
}

// ─── Command handling ─────────────────────────────────────────────

async function handleCommandMessage(message) {
  const text = (message.text || '').trim();
  const chatId = String(message.chat.id);

  if (!TelegramBridge.chatId) {
    TelegramBridge.chatId = chatId;
    await chrome.storage.local.set({ chatId });
  }

  // Optional "@deviceName command" targeting
  let command = text;
  const targetMatch = text.match(/^@(\S+)\s+(.*)$/);
  if (targetMatch) {
    const targetDevice = targetMatch[1].toLowerCase();
    const myName = (TelegramBridge.deviceName || '').toLowerCase();
    if (targetDevice !== myName) return; // not for this device
    command = targetMatch[2];
  }

  // Ack
  try {
    await TelegramBridge.sendMessage(`✅ <b>${escapeHtml(command)}</b>\n_diterima, diproses..._`);
  } catch (e) {
    console.warn('[BG] Ack failed:', e.message);
  }

  const result = await executeCommand(command);

  try {
    if (result.success) {
      if (result.screenshot) {
        await sendPhoto(result.screenshot, result.message || '📸 Screenshot');
      } else {
        const body = result.data
          ? '\n<pre>' + escapeHtml(JSON.stringify(result.data, null, 2).slice(0, 3000)) + '</pre>'
          : '';
        await TelegramBridge.sendMessage(`✅ ${escapeHtml(result.message || 'Done')}${body}`);
      }
    } else {
      await TelegramBridge.sendMessage(`❌ ${escapeHtml(result.error || 'Command failed')}`);
    }
  } catch (e) {
    console.warn('[BG] Result send failed:', e.message);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendPhoto(dataUrl, caption) {
  const blob = await (await fetch(dataUrl)).blob();
  const form = new FormData();
  form.append('chat_id', TelegramBridge.chatId);
  form.append('caption', caption);
  form.append('photo', blob, 'screenshot.png');
  const res = await fetch(`https://api.telegram.org/bot${TelegramBridge.botToken}/sendPhoto`, {
    method: 'POST',
    body: form
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description);
  return data.result;
}

// ─── Command executor ─────────────────────────────────────────────

async function executeCommand(command) {
  const parts = (command || '').trim().split(/\s+/);
  const action = (parts[0] || '').toLowerCase();
  const rest = parts.slice(1).join(' ');

  try {
    switch (action) {
      case 'navigate':
      case 'buka':
      case 'open': {
        if (!rest) return { success: false, error: 'Usage: navigate <url>' };
        const tab = await navigateToUrl(rest);
        return { success: true, message: `Buka ${tab.url || rest}` };
      }
      case 'screenshot':
      case 'ss': {
        const dataUrl = await captureScreenshot();
        return { success: true, screenshot: dataUrl, message: '📸 Screenshot' };
      }
      case 'scrape':
      case 'ambil': {
        if (!rest) return { success: false, error: 'Usage: scrape <css-selector>' };
        const data = await scrapeContent(rest);
        return { success: true, message: `Ketemu ${data.length} elemen`, data };
      }
      case 'text':
      case 'teks': {
        const data = await pageText();
        return { success: true, message: 'Teks halaman', data };
      }
      case 'click':
      case 'klik': {
        if (!rest) return { success: false, error: 'Usage: click <css-selector>' };
        const ok = await clickElement(rest);
        return ok
          ? { success: true, message: `Klik ${rest}` }
          : { success: false, error: `Elemen tidak ketemu: ${rest}` };
      }
      case 'fill': {
        const m = command.match(/^fill\s+(\S+)\s*=\s*([\s\S]+)$/i);
        if (!m) return { success: false, error: 'Usage: fill <selector>=<value>' };
        const ok = await fillInput(m[1], m[2]);
        return ok
          ? { success: true, message: `Isi ${m[1]}` }
          : { success: false, error: `Elemen tidak ketemu: ${m[1]}` };
      }
      case 'tabs':
      case 'list': {
        const tabs = await chrome.tabs.query({});
        return {
          success: true,
          message: `${tabs.length} tab terbuka`,
          data: tabs.map(t => ({ id: t.id, title: t.title, url: t.url }))
        };
      }
      case 'status': {
        return {
          success: true,
          message: 'Status device',
          data: {
            deviceName: TelegramBridge.deviceName,
            deviceId: TelegramBridge.deviceId,
            version: CURRENT_VERSION,
            chatId: TelegramBridge.chatId,
            lastUpdateId: TelegramBridge.lastUpdateId
          }
        };
      }
      case 'help':
      case 'bantuan': {
        return {
          success: true,
          message: 'Perintah',
          data: [
            'navigate <url>', 'screenshot', 'scrape <selector>',
            'text', 'click <selector>', 'fill <selector>=<value>',
            'tabs', 'status', 'help'
          ]
        };
      }
      default:
        return { success: false, error: `Perintah nggak dikenal: ${action}. Kirim "help" buat list.` };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Tab helpers ──────────────────────────────────────────────────

async function getActiveTab() {
  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs[0]) tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) throw new Error('Nggak ada tab aktif. Buka dulu tab-nya.');
  return tabs[0];
}

async function navigateToUrl(url) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const tab = await chrome.tabs.create({ url, active: true });
  activeTabId = tab.id;
  return tab;
}

async function captureScreenshot() {
  const tab = await getActiveTab();
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
}

async function scrapeContent(selector) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel) => {
      const els = document.querySelectorAll(sel);
      return Array.from(els).slice(0, 200).map(el => ({
        tag: el.tagName,
        text: (el.textContent || '').trim().slice(0, 300),
        href: el.href || '',
        src: el.src || ''
      }));
    },
    args: [selector]
  });
  return results[0]?.result || [];
}

async function pageText() {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => (document.body ? document.body.innerText.slice(0, 5000) : '')
  });
  return results[0]?.result || '';
}

async function clickElement(selector) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel) => { const el = document.querySelector(sel); if (el) { el.click(); return true; } return false; },
    args: [selector]
  });
  return !!results[0]?.result;
}

async function fillInput(selector, value) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    args: [selector, value]
  });
  return !!results[0]?.result;
}

// ─── Auto-update check ────────────────────────────────────────────
//
// The repo is PUBLIC, so the unauthenticated GitHub Releases API works.
// Two sources, tried in order:
//   1. GitHub Releases API  (works now that the repo is public)
//   2. UPDATE_FEED_URL      (optional public version.json — survives even if
//                            the repo ever goes private again)
// If both are unavailable we report channel='manual' so the popup can point
// the user at update.bat instead of showing a button that never fires.

const REPO_API = 'https://api.github.com/repos/yongprener/tiktok-automation-bridge/releases/latest';
const UPDATE_FEED_URL = ''; // optional: raw version.json URL

async function fetchLatestVersion() {
  // 1) GitHub Releases API
  try {
    const res = await fetch(REPO_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      const v = String(data.tag_name || data.name || '').replace(/^v/, '').trim();
      if (v) return { version: v, source: 'releases' };
    }
  } catch (e) {
    console.log('[BG] Releases API unavailable:', e.message);
  }

  // 2) Optional public feed
  if (UPDATE_FEED_URL) {
    try {
      const res = await fetch(UPDATE_FEED_URL, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const v = String(data.version || data.tag_name || '').replace(/^v/, '').trim();
        if (v) return { version: v, source: 'feed' };
      }
    } catch (e) {
      console.log('[BG] Update feed unavailable:', e.message);
    }
  }

  return null;
}

async function checkForUpdate() {
  const found = await fetchLatestVersion();

  if (!found) {
    // Cannot determine — be honest, point at the updater script.
    await chrome.storage.local.set({
      lastUpdateCheck: Date.now(),
      updateAvailable: false,
      updateVersion: '',
      updateChannel: 'manual'
    });
    return { channel: 'manual' };
  }

  const newer = isNewerVersion(found.version, CURRENT_VERSION);

  await chrome.storage.local.set({
    lastUpdateCheck: Date.now(),
    updateAvailable: newer,
    updateVersion: newer ? found.version : '',
    updateChannel: 'feed'
  });

  if (newer) {
    chrome.notifications.create('update-available', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Update Tersedia',
      message: `v${found.version} siap (kamu di v${CURRENT_VERSION}). Jalankan update.bat / update.sh lalu reload extension.`,
      priority: 2
    });
  }

  return { channel: 'feed', updateAvailable: newer, version: found.version, source: found.source };
}

function isNewerVersion(latest, current) {
  const l = String(latest).split('.').map(Number);
  const c = String(current).split('.').map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

// ─── Message router (SYNC responses only — never await a loop) ────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'status-check': {
      // Must answer synchronously-ish; read storage then respond.
      (async () => {
        const stored = await chrome.storage.local.get([
          'botToken', 'deviceName', 'deviceId', 'chatId',
          'pollingEnabled', 'lastPollOk', 'lastPollError',
          'updateAvailable', 'updateVersion', 'updateChannel'
        ]);
        sendResponse({
          configured: !!(stored.botToken && stored.deviceName),
          deviceName: stored.deviceName || '',
          deviceId: stored.deviceId || '',
          chatId: stored.chatId ? String(stored.chatId) : '',
          polling: !!stored.pollingEnabled,
          lastPollOk: stored.lastPollOk || 0,
          lastPollError: stored.lastPollError || '',
          updateAvailable: !!stored.updateAvailable,
          updateVersion: stored.updateVersion || '',
          updateChannel: stored.updateChannel || '',
          version: CURRENT_VERSION
        });
      })();
      return true; // async response
    }

    case 'start-polling': {
      (async () => {
        try {
          await TelegramBridge.init();
          if (!TelegramBridge.isConfigured()) {
            sendResponse({ success: false, error: 'Belum dikonfigurasi. Isi Settings dulu.' });
            return;
          }
          if (!TelegramBridge.chatId) {
            // try to auto-link from pending updates
            try {
              await TelegramBridge.linkChatFromUpdates();
            } catch (e) { /* ignore */ }
          }
          if (!TelegramBridge.chatId) {
            sendResponse({ success: false, error: 'Chat belum ke-link. Kirim pesan ke bot dulu, lalu klik Start lagi.' });
            return;
          }
          await setPollingEnabled(true);
          chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
          await logEvent('polling enabled');
          // immediately do one tick so the "online" message goes out
          try {
            await TelegramBridge.sendMessage(
              `🟢 <b>${escapeHtml(TelegramBridge.deviceName)}</b> online\n` +
              `Device ID: <code>${escapeHtml(TelegramBridge.deviceId)}</code>\n` +
              `Version: ${CURRENT_VERSION}`
            );
          } catch (e) {
            await logEvent('send online failed: ' + e.message);
            sendResponse({ success: false, error: 'Gagal kirim pesan Telegram: ' + e.message });
            return;
          }
          await pollTick();
          sendResponse({ success: true, message: 'Polling aktif' });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    case 'stop-polling': {
      (async () => {
        await setPollingEnabled(false);
        sendResponse({ success: true });
      })();
      return true;
    }

    case 'config-update': {
      (async () => {
        await TelegramBridge.saveConfig(message.config || {});
        await TelegramBridge.init();
        sendResponse({ success: true });
      })();
      return true;
    }

    case 'check-update': {
      (async () => {
        await checkForUpdate();
        const stored = await chrome.storage.local.get(['updateAvailable', 'updateVersion', 'updateChannel']);
        sendResponse(stored);
      })();
      return true;
    }

    case 'run-command': {
      (async () => {
        const result = await executeCommand(message.command || '');
        sendResponse(result);
      })();
      return true;
    }

    default:
      return false;
  }
});
