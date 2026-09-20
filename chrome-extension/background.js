/**
 * Background Service Worker
 * 
 * Main orchestrator for the extension.
 * - Initializes Telegram bridge
 * - Polls for commands
 * - Dispatches commands to content scripts
 * - Manages tab lifecycle
 * - Handles alarms for polling schedule
 */

import { TelegramBridge } from './lib/telegram-bridge.js';

const bridge = new TelegramBridge();
let activeTabId = null;

// ─── Lifecycle ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[BG] Extension installed/updated:', details.reason);
  
  await bridge.init();
  
  if (details.reason === 'install') {
    // First install — open options page
    chrome.runtime.openOptionsPage();
  }
  
  // Set up polling alarm (every 1 second check)
  chrome.alarms.create('poll', { periodInMinutes: 0.5 });
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[BG] Browser started');
  await bridge.init();
  chrome.alarms.create('poll', { periodInMinutes: 0.5 });
});

// ─── Alarm Handler ────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'poll') {
    if (bridge.isConfigured() && !bridge.polling) {
      await bridge.startPolling();
    }
  } else if (alarm.name === 'heartbeat') {
    // Send heartbeat every 5 minutes
    if (bridge.isConfigured()) {
      await bridge.sendMessage(`💓 Heartbeat: ${bridge.deviceName} alive`);
    }
  }
});

// ─── Message Router ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'bridge-command') {
    handleCommand(message.command, sender, sendResponse);
    return true; // async response
  }
  
  if (message.type === 'status-check') {
    sendResponse({
      configured: bridge.isConfigured(),
      deviceName: bridge.deviceName,
      deviceId: bridge.deviceId,
      polling: bridge.polling
    });
    return false;
  }
  
  if (message.type === 'config-update') {
    bridge.saveConfig(message.config).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (message.type === 'start-polling') {
    bridge.startPolling().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (message.type === 'stop-polling') {
    bridge.stopPolling();
    sendResponse({ success: true });
    return false;
  }
});

// ─── Command Handler ──────────────────────────────────────────────

async function handleCommand(command, sender, sendResponse) {
  console.log('[BG] Command received:', command);
  
  const parts = command.toLowerCase().split(/\s+/);
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
        // fill selector=value
        const match = command.match(/fill\s+(\S+)\s*=\s*(.+)/i);
        if (match) {
          await fillInput(match[1], match[2]);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Usage: fill selector=value' });
        }
        break;
      }
      
      case 'inject': {
        // Execute custom JS in page
        const code = command.replace(/^\S+\s+/, '');
        const result = await injectScript(code);
        sendResponse({ success: true, result });
        break;
      }
      
      case 'status': {
        sendResponse({
          success: true,
          status: {
            deviceName: bridge.deviceName,
            deviceId: bridge.deviceId,
            polling: bridge.polling,
            activeTab: activeTabId
          }
        });
        break;
      }
      
      default: {
        // Forward to content script for page-specific actions
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
          activeTabId = tabs[0].id;
          const response = await chrome.tabs.sendMessage(activeTabId, {
            type: 'execute',
            command
          });
          sendResponse(response || { success: false, error: 'No response from content script' });
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
  // Normalize URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  const tab = await chrome.tabs.create({ url, active: true });
  activeTabId = tab.id;
  
  // Wait for page load
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
    func: (sel) => {
      const el = document.querySelector(sel);
      if (el) el.click();
      return !!el;
    },
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

async function injectScript(code) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) throw new Error('No active tab');
  
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: new Function(code)
  });
  
  return results[0]?.result;
}
