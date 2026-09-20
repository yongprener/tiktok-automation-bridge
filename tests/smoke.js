#!/usr/bin/env node
/**
 * Smoke test: load background.js with stubbed chrome APIs.
 * Verifies the message router actually RESPONDS (the bug: it never did).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', 'chrome-extension');

// ── Fake storage ──────────────────────────────────────────────────
const store = {
  botToken: '123:FAKE',
  deviceName: 'test-device',
  deviceId: 'dev_test1',
  chatId: '7750244035',
  lastUpdateId: 0,
  pollingEnabled: false
};

const listeners = { alarm: [], message: [], installed: [], startup: [] };
const alarmsCreated = [];
const fetchCalls = [];

function makeChrome() {
  return {
    storage: {
      local: {
        get: async (keys) => {
          if (keys == null) return { ...store };
          const arr = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of arr) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (obj) => { Object.assign(store, obj); }
      }
    },
    alarms: {
      create: (name, info) => alarmsCreated.push({ name, info }),
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) }
    },
    runtime: {
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) }
    },
    tabs: {
      query: async () => [{ id: 1, windowId: 1, url: 'https://example.com', title: 'Example' }],
      create: async ({ url }) => ({ id: 2, url }),
      captureVisibleTab: async () => 'data:image/png;base64,AAAA',
      sendMessage: async () => ({ ok: true }),
      onUpdated: { addListener: () => {}, removeListener: () => {} }
    },
    scripting: {
      executeScript: async ({ func, args }) => [{ result: func ? func(...(args || [])) : null }]
    },
    identity: {
      getProfileUserInfo: async () => ({ email: 'test@example.com', id: '1' })
    },
    notifications: { create: () => {} }
  };
}

// ── Fake fetch that records Telegram calls ────────────────────────
let getUpdatesPayload = { ok: true, result: [] };
global.fetch = async (url, opts = {}) => {
  fetchCalls.push({ url: String(url), body: opts.body });
  const u = String(url);
  if (u.includes('/getUpdates')) {
    return { ok: true, json: async () => getUpdatesPayload };
  }
  if (u.includes('/sendMessage') || u.includes('/sendPhoto')) {
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  }
  if (u.includes('/getMe')) {
    return { ok: true, json: async () => ({ ok: true, result: { username: 'test_bot' } }) };
  }
  if (u.includes('api.github.com')) {
    return { ok: false, status: 404, json: async () => ({}) };
  }
  return { ok: true, json: async () => ({ ok: true, result: {} }) };
};

// ── Load background.js ────────────────────────────────────────────
const bgSrc = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const bridgeSrc = fs.readFileSync(path.join(EXT, 'lib', 'telegram-bridge.js'), 'utf8');

const sandbox = {
  chrome: makeChrome(),
  console,
  fetch: global.fetch,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  JSON,
  FormData: class { append() {} },
  AbortController,
  Blob: class {},
  URL,
  HTMLTextAreaElement: class {},
  HTMLInputElement: class {},
  // Minimal DOM so injected funcs (scrape/text/click/fill) can run in Node
  document: {
    querySelectorAll: () => [
      { tagName: 'H1', textContent: 'Example Domain', href: '', src: '' }
    ],
    querySelector: () => null,
    body: { innerText: 'Example Domain' }
  }
};
sandbox.self = sandbox;
sandbox.importScripts = (...files) => {
  for (const f of files) {
    vm.runInContext(bridgeSrc, ctx, { filename: f });
  }
};
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};

vm.runInContext(bgSrc, ctx, { filename: 'background.js' });

// Helper: invoke the message listener with a timeout guard
function sendMessage(msg, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const fn = listeners.message[0];
    if (!fn) return reject(new Error('no message listener registered'));
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) reject(new Error('TIMEOUT — listener never called sendResponse (the original bug)'));
    }, timeoutMs);
    const ok = fn(msg, {}, (resp) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(resp);
    });
    if (ok !== true && ok !== false && ok !== undefined) {
      // ignore
    }
  });
}

(async () => {
  await new Promise(r => setTimeout(r, 50)); // let the IIFE init settle

  console.log('\n1) status-check responds');
  let r = await sendMessage({ type: 'status-check' });
  t('returns object', !!r);
  t('configured=true', r && r.configured === true, JSON.stringify(r));
  t('version=0.2.0', r && r.version === '0.2.0', r && r.version);
  t('chatId preserved', r && r.chatId === '7750244035', r && r.chatId);

  console.log('\n2) start-polling responds (was: silent hang)');
  r = await sendMessage({ type: 'start-polling' });
  t('returns object', !!r);
  t('success=true', r && r.success === true, JSON.stringify(r));
  t('pollingEnabled written', store.pollingEnabled === true);
  t('alarm created', alarmsCreated.some(a => a.name === 'bridge-poll'));
  t('online message sent', fetchCalls.some(c => c.url.includes('/sendMessage') && /online/.test(String(c.body))));

  console.log('\n3) status-check now reports polling');
  r = await sendMessage({ type: 'status-check' });
  t('polling=true', r && r.polling === true, JSON.stringify(r));

  console.log('\n4) stop-polling');
  r = await sendMessage({ type: 'stop-polling' });
  t('success=true', r && r.success === true);
  t('pollingEnabled=false', store.pollingEnabled === false);

  console.log('\n5) command routing — "status"');
  store.pollingEnabled = true;
  r = await sendMessage({ type: 'run-command', command: 'status' });
  t('success=true', r && r.success === true, JSON.stringify(r));
  t('has deviceName', r && r.data && r.data.deviceName === 'test-device');

  console.log('\n6) command routing — unknown command returns error (no crash)');
  r = await sendMessage({ type: 'run-command', command: 'fly-to-moon' });
  t('success=false', r && r.success === false);
  t('has error text', r && typeof r.error === 'string' && r.error.length > 0);

  console.log('\n7) command routing — click with no selector');
  r = await sendMessage({ type: 'run-command', command: 'click' });
  t('success=false + usage', r && r.success === false && /Usage/i.test(r.error || ''), JSON.stringify(r));

  console.log('\n8) scrape through chrome.scripting');
  r = await sendMessage({ type: 'run-command', command: 'scrape h1' });
  t('success=true', r && r.success === true, JSON.stringify(r));

  console.log('\n9) poll tick handles a real incoming Telegram message');
  getUpdatesPayload = {
    ok: true,
    result: [{
      update_id: 555,
      message: { message_id: 9, chat: { id: 7750244035 }, text: 'status' }
    }]
  };
  fetchCalls.length = 0;
  const tick = listeners.alarm[0];
  await tick({ name: 'bridge-poll' });
  t('lastUpdateId advanced to 555', store.lastUpdateId === 555, String(store.lastUpdateId));
  t('ack sent to Telegram', fetchCalls.some(c => c.url.includes('/sendMessage')));
  t('no poll error stored', !store.lastPollError, store.lastPollError);

  console.log('\n10) @device targeting is respected');
  getUpdatesPayload = {
    ok: true,
    result: [{ update_id: 556, message: { message_id: 10, chat: { id: 1 }, text: '@other-device status' } }]
  };
  fetchCalls.length = 0;
  await tick({ name: 'bridge-poll' });
  t('ignored (no ack for other device)', !fetchCalls.some(c => c.url.includes('/sendMessage')));

  console.log('\n11) @test-device targeting works');
  getUpdatesPayload = {
    ok: true,
    result: [{ update_id: 557, message: { message_id: 11, chat: { id: 1 }, text: '@test-device status' } }]
  };
  fetchCalls.length = 0;
  await tick({ name: 'bridge-poll' });
  t('ack sent', fetchCalls.some(c => c.url.includes('/sendMessage')));

  console.log('\n12) start-polling refuses when chat NOT linked (clear error, not silence)');
  // No pending updates at all => auto-link cannot succeed => must error out visibly
  getUpdatesPayload = { ok: true, result: [] };
  store.chatId = '';
  store.botToken = '123:FAKE';
  store.deviceName = 'test-device';
  store.pollingEnabled = false;
  r = await sendMessage({ type: 'start-polling' });
  t('success=false', r && r.success === false, JSON.stringify(r));
  t('mentions linking', /link/i.test(r.error || ''), r.error);
  t('polling NOT enabled', store.pollingEnabled === false);

  console.log('\n13) start-polling auto-links when bot has a pending message');
  getUpdatesPayload = {
    ok: true,
    result: [{ update_id: 600, message: { message_id: 20, chat: { id: 999 }, text: 'halo' } }]
  };
  store.chatId = '';
  r = await sendMessage({ type: 'start-polling' });
  t('success=true', r && r.success === true, JSON.stringify(r));
  t('chatId auto-linked to 999', String(store.chatId) === '999', String(store.chatId));

  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
