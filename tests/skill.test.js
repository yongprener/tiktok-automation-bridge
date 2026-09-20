#!/usr/bin/env node
/**
 * Skill system + intent router tests.
 *
 * Loads the real lib files into a shared vm context and drives them with a
 * fake adapter, so the whole skill engine is exercised without a browser.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', 'chrome-extension');
const LIB = path.join(EXT, 'lib');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  XX  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// ── Sandbox with a shared storage both adapter and tests can poke ──
const storage = {};
let imagesTaken = 0;
let navigations = [];
let scrolls = 0;

const sandbox = {
  console, Date, Math, JSON, Object, Array, String, Number, Boolean, Error,
  setTimeout: (fn) => { fn(); return 0; },
  clearTimeout: () => {},
};
sandbox.globalThis = sandbox;
sandbox.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of arr) if (k in storage) out[k] = storage[k];
        return out;
      },
      set: async (o) => { Object.assign(storage, o); },
      remove: async (keys) => {
        for (const k of (Array.isArray(keys) ? keys : [keys])) delete storage[k];
      }
    }
  }
};
const ctx = vm.createContext(sandbox);

for (const f of ['skill-runner.js', 'skills-bundled.js', 'intent.js']) {
  vm.runInContext(fs.readFileSync(path.join(LIB, f), 'utf8'), ctx, { filename: f });
}
// Top-level `const` in a vm script lives in the context's lexical scope, not on
// the sandbox object, so pull the exports out explicitly.
vm.runInContext(
  'globalThis.__x = { SkillRunner, IntentRouter, BUNDLED_SKILLS };',
  ctx
);
const { SkillRunner, IntentRouter, BUNDLED_SKILLS } = sandbox.__x;

// ── Fake adapter: records everything, no browser ──
function makeAdapter(opts = {}) {
  return {
    async navigate(url) { navigations.push(url); return { id: 1, url }; },
    async sleep() {},
    async waitFor(sel) { return opts.waitForFails ? false : true; },
    async click(step) { return opts.clickFails ? { ok: false, error: 'tidak ketemu' } : { ok: true, log: 'diklik' }; },
    async fill() { return { ok: true }; },
    async scroll() { scrolls++; return { ok: true, log: 'di-scroll' }; },
    async collect(step) {
      if (opts.collectFails) return { ok: false, error: 'selector tidak cocok' };
      const n = opts.collectCount === undefined ? 3 : opts.collectCount;
      return { ok: true, data: Array.from({ length: n }, (_, i) => ({ nama: 'Produk ' + (i + 1), harga: 'Rp' + (10000 * (i + 1)) })), count: n };
    },
    async assert(step) {
      if (opts.assertFails) return { ok: false, error: 'assert sengaja gagal' };
      return { ok: true, log: 'ok' };
    },
    async screenshot() { imagesTaken++; return 'data:image/png;base64,AAA'; },
    async saveState(s) { storage.skillRun = s; },
    async loadState() { return storage.skillRun || null; },
    async clearState() { delete storage.skillRun; }
  };
}

const SKILLS = [
  {
    id: 'demo', name: 'Demo', params: [{ name: 'url', required: true }],
    steps: [
      { action: 'navigate', url: '{{url}}' },
      { action: 'wait', ms: 10 },
      { action: 'collect', selector: '.card', as: 'items', limit: 5 },
      { action: 'report', template: 'Ambil {{items}} item dari {{url}}' }
    ]
  },
  {
    id: 'fails', name: 'Fails', params: [],
    steps: [
      { action: 'navigate', url: 'https://example.com' },
      { action: 'click', selector: '.nope' }
    ]
  },
  { id: 'needsParam', name: 'Needs', params: [{ name: 'url', required: true }], steps: [{ action: 'navigate', url: '{{url}}' }] },
  { id: 'defaulted', name: 'Def', params: [{ name: 'n', required: false, default: 7 }], steps: [{ action: 'report', template: 'n={{n}}' }] }
];

(async () => {
  console.log('\n=== A. Intent router: the message that failed for the user ===');
  const skillsMeta = SKILLS.concat(BUNDLED_SKILLS).map(s => ({ id: s.id }));

  let r = IntentRouter.parse('check dan ambil data analitik di https://www.tiktok.com/tiktokstudio/analytics', skillsMeta);
  t('routed as a skill', r.kind === 'skill', JSON.stringify(r));
  t('picked scrape-tiktokshop', r.skillId === 'scrape-tiktokshop', r.skillId);
  t('url extracted exactly', r.params.url === 'https://www.tiktok.com/tiktokstudio/analytics', r.params.url);
  t('mentions analytics in reply', /analitik/i.test(r.reply), r.reply);

  console.log('\n=== B. Intent router: other phrasings ===');
  const cases = [
    ['buka https://example.com', 'command', 'navigate https://example.com'],
    ['ambil data di https://shop.tiktok.com/x', 'skill', 'scrape-tiktokshop'],
    ['scrape produk di https://shop.tiktok.com/y', 'skill', 'scrape-tiktokshop'],
    ['baca halaman https://example.com', 'skill', 'scroll-and-read'],
    ['audit https://example.com', 'skill', 'page-audit'],
    ['cek captcha di https://example.com', 'skill', 'check-captcha'],
    ['screenshot', 'command', 'screenshot'],
    ['ss', 'command', 'screenshot'],
    ['skill', 'command', 'skill-list'],
    ['skill run demo url=https://a.com', 'skill', 'demo'],
    ['tunggu .tombol', 'command', 'waitfor .tombol'],
    ['https://example.com', 'command', 'navigate https://example.com'],
    ['cek audiens di https://tiktok.com/studio', 'skill', 'scrape-tiktokshop'],
    ['buka tiktok.com', 'command', 'navigate https://tiktok.com'],
    ['ambil data di shop.tiktok.com/produk', 'skill', 'scrape-tiktokshop'],
    ['audit contoh.com', 'skill', 'page-audit']
  ];
  for (const [input, kind, expect] of cases) {
    const out = IntentRouter.parse(input, skillsMeta);
    const got = out.kind === 'skill' ? out.skillId : out.command;
    t(`"${input}" -> ${kind} ${expect}`, out.kind === kind && got === expect, `${out.kind}/${got}`);
  }

  console.log('\n=== C. Intent router: unknown stays helpful, never silent ===');
  r = IntentRouter.parse('apa kabar bot', skillsMeta);
  t('falls through (not a crash)', !!r.kind, r.kind);
  r = IntentRouter.parse('ambil data', skillsMeta);
  t('asks for a URL', r.kind === 'unknown' && /url/i.test(r.reply), JSON.stringify(r));
  r = IntentRouter.parse('', skillsMeta);
  t('empty input handled', r.kind === 'unknown');

  console.log('\n=== D. Intent: url parsing edge cases ===');
  r = IntentRouter.parse('ambil data di https://shop.tiktok.com/x.', skillsMeta);
  t('trailing period stripped', r.params.url === 'https://shop.tiktok.com/x', r.params.url);
  r = IntentRouter.parse('ambil data di https://shop.tiktok.com/x?q=1&b=2', skillsMeta);
  t('query string preserved', r.params.url === 'https://shop.tiktok.com/x?q=1&b=2', r.params.url);

  console.log('\n=== E. SkillRunner: happy path + templating ===');
  navigations = []; scrolls = 0;
  SkillRunner.init(makeAdapter({}), SKILLS);
  let out = await SkillRunner.run('demo', { url: 'https://shop.test/a' });
  t('run ok', out.ok === true, out.error);
  t('navigated to the param URL', navigations[0] === 'https://shop.test/a', String(navigations[0]));
  t('collected into a var', Array.isArray(out.vars.items) && out.vars.items.length === 3, JSON.stringify(out.vars.items && out.vars.items.length));
  t('log has one line per step', out.log.length === 4, JSON.stringify(out.log));
  t('report step text lands in the log', out.log.some(l => l.includes('Ambil ') && l.includes('item dari https://shop.test/a')), JSON.stringify(out.log));
  t('state cleared after success', storage.skillRun === undefined, JSON.stringify(storage.skillRun));

  console.log('\n=== F. SkillRunner: missing required param is a clear error ===');
  out = await SkillRunner.run('needsParam', {});
  t('not ok', out.ok === false);
  t('names the missing param', /url/.test(out.error), out.error);
  t('shows usage', /skill run needsParam/.test(out.error), out.error);

  console.log('\n=== G. SkillRunner: default param applied ===');
  out = await SkillRunner.run('defaulted', {});
  t('used the default', out.log.some(l => /n=7/.test(l)), JSON.stringify(out.log));

  console.log('\n=== H. SkillRunner: step failure stops cleanly and reports the step ===');
  SkillRunner.init(makeAdapter({ clickFails: true }), SKILLS);
  out = await SkillRunner.run('fails', {});
  t('not ok', out.ok === false);
  t('identifies the failing step', /Step 2 \(click\)/.test(out.error), out.error);
  t('kept the log up to failure', out.log.length === 2, JSON.stringify(out.log));

  console.log('\n=== I. SkillRunner: unknown skill id ===');
  out = await SkillRunner.run('does-not-exist', {});
  t('not ok', out.ok === false);
  t('points at the list command', /skill/i.test(out.error), out.error);

  console.log('\n=== J. SkillRunner: validation ===');
  t('rejects empty skill', SkillRunner.validate({}).length > 0);
  t('rejects unknown action', SkillRunner.validate({ id: 'x', steps: [{ action: 'fly' }] }).some(e => /tidak dikenal/.test(e)));
  t('rejects collect without "as"', SkillRunner.validate({ id: 'x', steps: [{ action: 'collect', selector: '.a' }] }).some(e => /"as"/.test(e)));
  t('accepts a good skill', SkillRunner.validate({ id: 'x', steps: [{ action: 'screenshot' }] }).length === 0);

  console.log('\n=== K. Resume after the service worker dies mid-run ===');
  SkillRunner.init(makeAdapter({}), SKILLS);
  // simulate a run that got killed after completing step 2 of 4
  storage.skillRun = {
    skillId: 'demo', index: 3,   // steps 1-3 done; only the report is left
    vars: { url: 'https://shop.test/resume', items: [{ nama: 'sudah ada' }] },
    startedAt: Date.now(), log: ['[1/4] navigate → url', '[2/4] wait 10ms', '[3/4] collect items: 1 item']
  };
  navigations = [];
  out = await SkillRunner.resumeIfPending();
  t('resumed instead of restarting', out !== null, String(out));
  t('did NOT redo the navigate step', !navigations.includes('https://shop.test/resume'), JSON.stringify(navigations));
  t('kept previously collected vars', out.vars.items[0].nama === 'sudah ada', JSON.stringify(out.vars.items));
  t('completed the remaining step', out.ok === true, out.error);
  t('prior log preserved', out.log.length === 4, JSON.stringify(out.log));
  t('state cleared after resume', storage.skillRun === undefined);

  console.log('\n=== K2. Resume mid-run re-runs only the unfinished steps ===');
  storage.skillRun = {
    skillId: 'demo', index: 2,
    vars: { url: 'https://shop.test/mid' },
    startedAt: Date.now(), log: ['[1/4] navigate', '[2/4] wait']
  };
  out = await SkillRunner.resumeIfPending();
  t('completed remaining steps', out.ok === true, out.error);
  t('collected fresh data (collect had not run)', Array.isArray(out.vars.items), JSON.stringify(out.vars.items));

  console.log('\n=== L. Resume ignores a stale run ===');
  storage.skillRun = { skillId: 'demo', index: 0, vars: {}, startedAt: Date.now() - (6 * 60 * 1000), log: [] };
  out = await SkillRunner.resumeIfPending();
  t('stale run discarded', out === null, JSON.stringify(out));
  t('stale state cleared', storage.skillRun === undefined);

  console.log('\n=== M. Resume is a no-op when nothing is pending ===');
  out = await SkillRunner.resumeIfPending();
  t('returns null', out === null, JSON.stringify(out));

  console.log('\n=== N. Templating helpers ===');
  t('nested path', SkillRunner.resolvePath({ a: { b: [{ c: 'x' }] } }, 'a.b.0.c') === 'x');
  t('missing path -> undefined', SkillRunner.resolvePath({}, 'nope.deep') === undefined);
  t('render replaces tokens', SkillRunner.render('hi {{nama}}', { nama: 'Salsa' }) === 'hi Salsa');
  t('unknown token -> empty', SkillRunner.render('[{{nope}}]', {}) === '[]');
  t('object token (no stringify blowup)', SkillRunner.render('{{o}}', { o: { k: 1 } }).includes('k'));
  t('array preview joins lines', SkillRunner.preview([{ a: 1 }, { a: 2 }]).split('\n').length === 2);
  t('preview truncates long input', SkillRunner.preview('x'.repeat(5000), 100).includes('karakter lagi'));
  t('renderDeep walks nested objects', SkillRunner.renderDeep({ s: '{{v}}', l: ['{{v}}'] }, { v: 'Z' }).l[0] === 'Z');

  console.log('\n=== O. Bundled skills are well-formed ===');
  t('bundled file loaded', Array.isArray(BUNDLED_SKILLS) && BUNDLED_SKILLS.length >= 4, String(BUNDLED_SKILLS.length));
  for (const s of BUNDLED_SKILLS) {
    const errs = SkillRunner.validate(s);
    t(`bundled "${s.id}" validates`, errs.length === 0, errs.join('; '));
  }

  console.log('\n=== P. Every bundled skill actually runs end-to-end ===');
  for (const s of BUNDLED_SKILLS) {
    SkillRunner.init(makeAdapter({}), BUNDLED_SKILLS);
    const params = {};
    for (const p of (s.params || [])) {
      const n = typeof p === 'string' ? p : p.name;
      if (typeof p === 'object' && p.default !== undefined) continue;
      params[n] = n === 'url' ? 'https://example.com' : '1';
    }
    const res = await SkillRunner.run(s.id, params);
    t(`"${s.id}" runs ok`, res.ok === true, res.error);
  }

  console.log('\n=== Q. list() shape for the chat menu ===');
  SkillRunner.init(makeAdapter({}), BUNDLED_SKILLS, [{ id: 'custom-one', name: 'Custom', steps: [{ action: 'screenshot' }] }]);
  const list = SkillRunner.list();
  t('includes custom skills', list.some(s => s.id === 'custom-one'));
  t('marks the source', list.find(s => s.id === 'custom-one').source === 'custom');
  t('bundled marked bundled', list.find(s => s.id === 'scrape-tiktokshop').source === 'bundled');
  t('custom overrides bundled on id clash', (() => {
    SkillRunner.init(makeAdapter({}), [{ id: 'dup', name: 'bundled', steps: [{ action: 'screenshot' }] }],
                                     [{ id: 'dup', name: 'custom', steps: [{ action: 'screenshot' }] }]);
    return SkillRunner.list().filter(s => s.id === 'dup').length === 1 && SkillRunner.get('dup').name === 'custom';
  })());

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\nFATAL:', e && e.stack || e);
  process.exit(1);
});
