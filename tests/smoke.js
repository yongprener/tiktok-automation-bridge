#!/usr/bin/env node
/**
 * Smoke test: load background.js with stubbed chrome APIs.
 * Verifies the message router actually RESPONDS (the bug: it never did).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', 'chrome-extension');

// Version comes from the real manifest — the code under test reads
// chrome.runtime.getManifest().version, so the stub must mirror that.
const MANIFEST_VERSION = JSON.parse(
  fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')
).version;

// ── Fake storage ──────────────────────────────────────────────────
const store = {
  botToken: '123:FAKE',
  deviceName: 'test-device',
  deviceId: 'dev_test1',
  chatId: '123456789',
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
        set: async (obj) => { Object.assign(store, obj); },
        remove: async (keys) => { for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k]; }
      }
    },
    alarms: {
      create: (name, info) => alarmsCreated.push({ name, info }),
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) }
    },
    runtime: {
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      getManifest: () => ({ version: MANIFEST_VERSION })
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

// Controls the mocked GitHub Releases API response. Default: 404, which is what
// a repo with no releases returns.
let releasesPayload = { status: 404, body: {} };

global.fetch = async (url, opts = {}) => {
  fetchCalls.push({ url: String(url), body: opts.body });
  const u = String(url);
  if (u.includes('api.github.com')) {
    if (releasesPayload.throw) throw new Error(releasesPayload.throw);
    return {
      ok: releasesPayload.status >= 200 && releasesPayload.status < 300,
      status: releasesPayload.status,
      json: async () => releasesPayload.body
    };
  }
  if (u.includes('/getUpdates')) {
    return { ok: true, json: async () => getUpdatesPayload };
  }
  if (u.includes('/sendMessage') || u.includes('/sendPhoto')) {
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  }
  if (u.includes('/getMe')) {
    return { ok: true, json: async () => ({ ok: true, result: { username: 'test_bot' } }) };
  }
  return { ok: true, json: async () => ({ ok: true, result: {} }) };
};

// ── Load background.js ────────────────────────────────────────────
const bgSrc = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const libSrc = {};
for (const f of ['telegram-bridge.js', 'skill-runner.js', 'skill-adapter.js', 'skills-bundled.js', 'intent.js']) {
  libSrc[f] = fs.readFileSync(path.join(EXT, 'lib', f), 'utf8');
}

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
    const key = String(f).split('/').pop();   // background.js passes 'lib/x.js'
    const src = libSrc[key];
    if (!src) throw new Error('test harness missing lib file: ' + f);
    vm.runInContext(src, ctx, { filename: f });
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
  t('version matches manifest', r && r.version === MANIFEST_VERSION, r && r.version + ' vs ' + MANIFEST_VERSION);
  t('chatId preserved', r && r.chatId === '123456789', r && r.chatId);

  console.log('\n1b) status-check reads FRESH storage (not stale in-memory values)');
  store.deviceName = 'renamed-device';
  store.chatId = '12345';
  r = await sendMessage({ type: 'status-check' });
  t('reflects new deviceName', r && r.deviceName === 'renamed-device', r && r.deviceName);
  t('reflects new chatId', r && r.chatId === '12345', r && r.chatId);
  store.deviceName = 'test-device';
  store.chatId = '123456789';

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
      message: { message_id: 9, chat: { id: 123456789 }, text: 'status' }
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

  console.log('\n14) update check with no public feed reports channel=manual (not silent)');
  delete store.updateChannel;
  r = await sendMessage({ type: 'check-update' });
  t('responds', !!r);
  t('channel=manual', store.updateChannel === 'manual', String(store.updateChannel));
  t('no phantom update offered', store.updateAvailable === false, String(store.updateAvailable));
  t('timestamp recorded', typeof store.lastUpdateCheck === 'number');

  console.log('\n15) status-check exposes updateChannel to the popup');
  r = await sendMessage({ type: 'status-check' });
  t('updateChannel present', r && r.updateChannel === 'manual', r && String(r.updateChannel));
  t('version is manifest version', r && r.version === MANIFEST_VERSION, r && r.version);

  // ── Update-detection: driven by a mocked GitHub Releases API ──
  // These are the paths that matter now that the repo is public. Network is
  // stubbed so the suite stays deterministic and offline-capable.
  const NOTIFS = [];
  sandbox.chrome.notifications = { create: (id, opts) => NOTIFS.push({ id, opts }) };

  console.log('\n16) releases API newer than us -> update offered + notified');
  NOTIFS.length = 0;
  releasesPayload = { status: 200, body: { tag_name: 'v99.0.0' } };
  r = await sendMessage({ type: 'check-update' });
  t('updateAvailable=true', store.updateAvailable === true, String(store.updateAvailable));
  t('updateVersion=99.0.0', store.updateVersion === '99.0.0', store.updateVersion);
  t('channel=feed', store.updateChannel === 'feed', store.updateChannel);
  t('notification fired', NOTIFS.some(n => n.id === 'update-available'), JSON.stringify(NOTIFS.map(n => n.id)));
  t('response carries the version', r && r.updateVersion === '99.0.0', r && JSON.stringify(r));

  console.log('\n17) releases API same version -> no update, no notification');
  NOTIFS.length = 0;
  releasesPayload = { status: 200, body: { tag_name: 'v' + MANIFEST_VERSION } };
  r = await sendMessage({ type: 'check-update' });
  t('updateAvailable=false', store.updateAvailable === false, String(store.updateAvailable));
  t('updateVersion cleared', store.updateVersion === '', JSON.stringify(store.updateVersion));
  t('still channel=feed (we DID reach the API)', store.updateChannel === 'feed', store.updateChannel);
  t('no notification', NOTIFS.length === 0, JSON.stringify(NOTIFS.map(n => n.id)));

  console.log('\n18) releases API older than us -> no update (no downgrade prompt)');
  releasesPayload = { status: 200, body: { tag_name: 'v0.0.1' } };
  r = await sendMessage({ type: 'check-update' });
  t('updateAvailable=false', store.updateAvailable === false, String(store.updateAvailable));

  console.log('\n19) releases API 404 -> falls back to manual channel');
  releasesPayload = { status: 404, body: {} };
  r = await sendMessage({ type: 'check-update' });
  t('channel=manual', store.updateChannel === 'manual', store.updateChannel);
  t('updateAvailable=false', store.updateAvailable === false);

  console.log('\n20) network throw -> manual channel, no crash');
  releasesPayload = { throw: 'network down' };
  r = await sendMessage({ type: 'check-update' });
  t('channel=manual', store.updateChannel === 'manual', store.updateChannel);
  t('no crash', !!r);

  console.log('\n21) releases payload without a version -> manual channel');
  releasesPayload = { status: 200, body: { name: '' } };
  r = await sendMessage({ type: 'check-update' });
  t('channel=manual', store.updateChannel === 'manual', store.updateChannel);

  // ── The real regression: a plain-language instruction must route to a skill ──
  // This is the exact message that failed with "Perintah nggak dikenal: check".
  console.log('\n22) plain-language instruction routes to a skill end-to-end');
  getUpdatesPayload = {
    ok: true,
    result: [{
      update_id: 900,
      message: {
        message_id: 30,
        chat: { id: 123456789 },
        text: 'check dan ambil data analitik di https://www.tiktok.com/tiktokstudio/analytics'
      }
    }]
  };
  fetchCalls.length = 0;
  await tick({ name: 'bridge-poll' });

  const sent = fetchCalls.filter(c => c.url.includes('/sendMessage')).map(c => String(c.body));
  t('no "nggak dikenal" error', !sent.some(b => /nggak dikenal/i.test(b)), sent.find(b => /nggak dikenal/i.test(b)) || '');
  t('did NOT navigate blindly (it is a skill, not a raw command)', !sent.some(b => /"navigate /.test(b)));
  t('asked to open the analytics URL', sent.some(b => /analitik/i.test(b)), JSON.stringify(sent.slice(0, 2)));

  console.log('\n23) bare-domain instruction also routes (no http:// needed)');
  getUpdatesPayload = {
    ok: true,
    result: [{ update_id: 901, message: { message_id: 31, chat: { id: 1 }, text: 'ambil data di shop.tiktok.com/produk' } }]
  };
  fetchCalls.length = 0;
  await tick({ name: 'bridge-poll' });
  const sent2 = fetchCalls.filter(c => c.url.includes('/sendMessage')).map(c => String(c.body));
  t('no unknown-command error', !sent2.some(b => /nggak dikenal/i.test(b)));

  console.log('\n24) a genuinely unknown instruction gets a helpful reply, not silence');
  getUpdatesPayload = {
    ok: true,
    result: [{ update_id: 902, message: { message_id: 32, chat: { id: 1 }, text: 'apa kabar bot' } }]
  };
  fetchCalls.length = 0;
  await tick({ name: 'bridge-poll' });
  const sent3 = fetchCalls.filter(c => c.url.includes('/sendMessage')).map(c => String(c.body));
  t('still replies', sent3.length >= 1, String(sent3.length));

  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
