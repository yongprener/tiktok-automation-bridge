#!/usr/bin/env node
/**
 * Popup smoke test.
 *
 * Reproduces the EXACT reported bug:
 *   options.html says "Configured / Chat ID: 7750244035"
 *   popup says "Not configured / Not linked"
 * because the old service worker answers status-check with stale values.
 *
 * The fix under test: popup must trust chrome.storage.local, not the SW.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', 'chrome-extension');
const popupSrc = fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};

// ── Minimal DOM ───────────────────────────────────────────────────
function makeEl(id) {
  return {
    id, textContent: '', innerHTML: '', dataset: {}, disabled: false,
    _classes: new Set(),
    classList: {
      add: (c) => {}, remove: (c) => {}, toggle: () => {}, contains: () => false
    },
    addEventListener: (ev, fn) => { makeEl.handlers[id] = makeEl.handlers[id] || {}; makeEl.handlers[id][ev] = fn; }
  };
}
makeEl.handlers = {};

const els = {};
const IDS = ['version', 'status', 'device', 'profile', 'polling', 'deviceId',
             'errBox', 'warnBox', 'btnToggle', 'btnSettings', 'btnUpdate',
             'btnLogs', 'logs'];

function resetDom() {
  for (const id of IDS) els[id] = makeEl(id);
  makeEl.handlers = {};
}
resetDom();

const domReadyHandlers = [];

const sandbox = {
  console,
  Date,
  Math,
  JSON,
  setTimeout: (fn) => { /* don't fire intervals */ return 0; },
  clearTimeout: () => {},
  setInterval: () => 0,
  document: {
    getElementById: (id) => els[id] || makeEl(id),
    addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') domReadyHandlers.push(fn); }
  }
};

// ── Chrome stubs (mutable per scenario) ──────────────────────────
let storageData = {};
let swResponse = null;      // what the service worker replies
let swThrows = false;
let identityEmail = '';

sandbox.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of arr) if (k in storageData) out[k] = storageData[k];
        return out;
      },
      set: async (o) => { Object.assign(storageData, o); }
    }
  },
  runtime: {
    sendMessage: async (msg) => {
      if (swThrows) throw new Error('Receiving end does not exist');
      if (msg.type === 'status-check') return swResponse;
      return {};
    },
    openOptionsPage: () => {}
  },
  identity: {
    getProfileUserInfo: async () => ({ email: identityEmail, id: '1' })
  }
};

const ctx = vm.createContext(sandbox);
vm.runInContext(popupSrc, ctx, { filename: 'popup.js' });

// Trigger DOMContentLoaded and wait for refresh() to settle
async function boot() {
  resetDom();
  for (const fn of domReadyHandlers) await fn();
  await new Promise(r => setTimeout(r, 60));
}

(async () => {
  console.log('\nA) THE REPORTED BUG: storage is configured, SW is stale (v0.1.0, configured:false)');
  storageData = {
    botToken: '123:FAKE', deviceName: 'len-yongprener21',
    deviceId: 'dev_mu9ex4mh56fbuk', chatId: '7750244035',
    pollingEnabled: false
  };
  swResponse = { version: '0.1.0', configured: false, deviceName: '', chatId: '', polling: false };
  identityEmail = '';
  await boot();

  t('device shown from storage', els.device.textContent === 'len-yongprener21', els.device.textContent);
  t('NOT "Not configured"', els.status.innerHTML.indexOf('Not configured') === -1, els.status.innerHTML);
  t('button says Start', els.btnToggle.textContent === 'Start', els.btnToggle.textContent);
  t('button mode=start', els.btnToggle.dataset.mode === 'start', els.btnToggle.dataset.mode);
  t('polling Idle', els.polling.textContent === 'Idle', els.polling.textContent);
  t('profile shows Chat linked (not "Not linked")',
    els.profile.textContent.indexOf('Chat linked') === 0, els.profile.textContent);
  t('STALE SW banner shown', els.warnBox.textContent.indexOf('0.1.0') !== -1, els.warnBox.textContent);

  console.log('\nB) Not configured for real -> Open Settings');
  storageData = { deviceId: 'dev_x' };
  swResponse = { version: '0.2.1', configured: false };
  await boot();
  t('status Not configured', els.status.innerHTML.indexOf('Not configured') !== -1, els.status.innerHTML);
  t('button Open Settings', els.btnToggle.textContent.indexOf('Open Settings') !== -1, els.btnToggle.textContent);
  t('mode=settings', els.btnToggle.dataset.mode === 'settings');

  console.log('\nC) Configured + chat linked + polling ON -> Connected / Stop');
  storageData = {
    botToken: '123:FAKE', deviceName: 'laptop', chatId: '99',
    pollingEnabled: true, lastPollOk: Date.now()
  };
  swResponse = { version: '0.2.1', configured: true, chatId: '99', polling: true };
  await boot();
  t('status Connected', els.status.innerHTML.indexOf('Connected') !== -1, els.status.innerHTML);
  t('button Stop', els.btnToggle.textContent === 'Stop', els.btnToggle.textContent);
  t('polling Active', els.polling.textContent === 'Active');
  t('no stale banner', els.warnBox.textContent === '', els.warnBox.textContent);

  console.log('\nD) Configured but chat missing -> "Chat belum ke-link"');
  storageData = { botToken: '123:FAKE', deviceName: 'laptop', pollingEnabled: false };
  await boot();
  t('status chat belum ke-link', els.status.innerHTML.indexOf('Chat belum ke-link') !== -1, els.status.innerHTML);
  t('profile Not linked', els.profile.textContent === 'Not linked', els.profile.textContent);

  console.log('\nE) Service worker asleep (sendMessage throws) — still renders from storage');
  storageData = { botToken: '123:FAKE', deviceName: 'laptop', chatId: '99', pollingEnabled: false };
  swThrows = true;
  await boot();
  swThrows = false;
  t('device still shown', els.device.textContent === 'laptop', els.device.textContent);
  t('status Ready', els.status.innerHTML.indexOf('Ready') !== -1, els.status.innerHTML);
  t('sleep banner shown', els.warnBox.textContent.indexOf('tidur') !== -1, els.warnBox.textContent);

  console.log('\nF) Google email present -> shown instead of chat-linked');
  storageData = { botToken: '1:a', deviceName: 'd', chatId: '5', pollingEnabled: false };
  identityEmail = 'user@gmail.com';
  await boot();
  t('email shown', els.profile.textContent === 'user@gmail.com', els.profile.textContent);

  console.log('\nG) Poll error surfaces in errBox');
  storageData = {
    botToken: '1:a', deviceName: 'd', chatId: '5',
    pollingEnabled: true, lastPollOk: Date.now(), lastPollError: 'Telegram API error: 401'
  };
  await boot();
  t('error banner visible', els.errBox.textContent.indexOf('401') !== -1, els.errBox.textContent);
  t('status warns polling error', els.status.innerHTML.indexOf('error') !== -1, els.status.innerHTML);

  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\nFATAL:', e && e.stack || e);
  process.exit(1);
});
