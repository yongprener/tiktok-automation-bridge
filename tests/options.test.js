#!/usr/bin/env node
/**
 * Options page test — focused on the chatId-preservation regression.
 *
 * Bug history: saveConfig() read storage WITHOUT the 'botToken' key, so
 * stored.botToken was always undefined, so the "token changed -> reset chat"
 * branch always fired. Every click of Save silently unlinked the chat and the
 * popup fell back to "Not linked".
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', 'chrome-extension');
const src = fs.readFileSync(path.join(EXT, 'options.js'), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};

const IDS = ['deviceName', 'botToken', 'deviceId', 'profile', 'status', 'chatId', 'result',
             'btnSave', 'btnTest', 'btnRelink'];
let els = {};
const handlers = {};

function resetDom() {
  els = {};
  for (const id of IDS) {
    els[id] = {
      id, value: '', textContent: '', innerHTML: '', style: {},
      addEventListener: (ev, fn) => { handlers[id + ':' + ev] = fn; }
    };
  }
  for (const k of Object.keys(handlers)) delete handlers[k];
}

let storageData = {};
let fetchHandler = async () => ({ ok: true, json: async () => ({ ok: true, result: { username: 'x' } }) });

const domReady = [];
const sandbox = {
  console, Date, Math, JSON,
  setTimeout, clearTimeout,
  fetch: (...a) => fetchHandler(...a),
  document: {
    getElementById: (id) => els[id] || { textContent: '', innerHTML: '', style: {}, value: '' },
    addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') domReady.push(fn); }
  },
  chrome: {
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
    identity: { getProfileUserInfo: async () => ({ email: '' }) }
  }
};

vm.runInContext(src, vm.createContext(sandbox), { filename: 'options.js' });

async function boot() {
  resetDom();
  for (const fn of domReady) await fn();
  await new Promise(r => setTimeout(r, 40));
}

(async () => {
  console.log('\nA) Existing install: save with UNCHANGED token must NOT wipe chatId');
  storageData = {
    botToken: '123:FAKE', deviceName: 'laptop-lenovo',
    deviceId: 'dev_test0001', chatId: '123456789', lastUpdateId: 555
  };
  await boot();
  t('form prefilled deviceName', els.deviceName.value === 'laptop-lenovo', els.deviceName.value);
  t('form prefilled botToken', els.botToken.value === '123:FAKE');
  t('chatId displayed', els.chatId.textContent === '123456789', els.chatId.textContent);
  t('status Configured', els.status.textContent === 'Configured', els.status.textContent);

  // simulate the user clicking Save without changing anything
  els.deviceName.value = 'laptop-lenovo';
  els.botToken.value = '123:FAKE';
  await handlers['btnSave:click']();
  await new Promise(r => setTimeout(r, 40));

  t('chatId PRESERVED after save', storageData.chatId === '123456789', String(storageData.chatId));
  t('lastUpdateId PRESERVED', storageData.lastUpdateId === 555, String(storageData.lastUpdateId));
  t('deviceId unchanged', storageData.deviceId === 'dev_test0001', storageData.deviceId);
  t('success message shown', els.result.innerHTML.indexOf('Tersimpan') !== -1, els.result.innerHTML);

  console.log('\nB) Real token change DOES reset chat link');
  els.botToken.value = '999:NEWTOKEN';
  els.deviceName.value = 'laptop-lenovo';
  await handlers['btnSave:click']();
  await new Promise(r => setTimeout(r, 40));
  t('chatId cleared', storageData.chatId === '', JSON.stringify(storageData.chatId));
  t('lastUpdateId reset', storageData.lastUpdateId === 0);
  t('new token stored', storageData.botToken === '999:NEWTOKEN');

  console.log('\nC) Missing fields -> validation error, nothing written');
  storageData = { botToken: 'x:y', deviceName: 'd' };
  await boot();
  els.deviceName.value = '';
  els.botToken.value = '';
  await handlers['btnSave:click']();
  await new Promise(r => setTimeout(r, 40));
  t('error shown', els.result.innerHTML.indexOf('wajib diisi') !== -1, els.result.innerHTML);
  t('deviceName untouched in storage', storageData.deviceName === 'd');

  console.log('\nD) Test Connection links chat from pending update');
  storageData = { botToken: '123:FAKE', deviceName: 'd' };
  await boot();
  els.botToken.value = '123:FAKE';
  fetchHandler = async (url) => {
    if (url.includes('/getMe')) return { ok: true, json: async () => ({ ok: true, result: { username: 'test_bridge_bot' } }) };
    if (url.includes('/deleteWebhook')) return { ok: true, json: async () => ({ ok: true, result: true }) };
    if (url.includes('/getUpdates')) return { ok: true, json: async () => ({ ok: true, result: [{ update_id: 777, message: { chat: { id: 123456789 } } }] }) };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  await handlers['btnTest:click']();
  await new Promise(r => setTimeout(r, 60));
  t('chatId stored', String(storageData.chatId) === '123456789', String(storageData.chatId));
  t('lastUpdateId stored', storageData.lastUpdateId === 777, String(storageData.lastUpdateId));
  t('mentions bot username', els.result.innerHTML.indexOf('test_bridge_bot') !== -1, els.result.innerHTML);

  console.log('\nE) Invalid token surfaces the API error');
  storageData = { botToken: 'bad', deviceName: 'd' };
  await boot();
  els.botToken.value = 'bad';
  fetchHandler = async () => ({ ok: true, json: async () => ({ ok: false, description: 'Unauthorized' }) });
  await handlers['btnTest:click']();
  await new Promise(r => setTimeout(r, 40));
  t('error shown', els.result.innerHTML.indexOf('Unauthorized') !== -1, els.result.innerHTML);
  t('marked as error', els.result.innerHTML.indexOf('error') !== -1, els.result.innerHTML);

  console.log('\nF) No pending update -> helpful hint, no crash');
  storageData = { botToken: '123:FAKE', deviceName: 'd' };
  await boot();
  els.botToken.value = '123:FAKE';
  fetchHandler = async (url) => {
    if (url.includes('/getMe')) return { ok: true, json: async () => ({ ok: true, result: { username: 'b' } }) };
    if (url.includes('/getUpdates')) return { ok: true, json: async () => ({ ok: true, result: [] }) };
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };
  await handlers['btnTest:click']();
  await new Promise(r => setTimeout(r, 60));
  t('hint mentions sending a message', els.result.innerHTML.indexOf('Kirim pesan') !== -1, els.result.innerHTML);

  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\nFATAL:', e && e.stack || e);
  process.exit(1);
});
