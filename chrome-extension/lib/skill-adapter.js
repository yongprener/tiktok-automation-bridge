/**
 * Skill Adapter — the real chrome.* implementation of what SkillRunner needs.
 *
 * Kept separate from background.js so the runner stays free of browser APIs and
 * therefore testable. background.js supplies the tab/DOM helpers.
 */

function createSkillAdapter(h) {
  // h = { getActiveTab, execInPage, navigateToUrl, captureScreenshot }
  const RUN_STATE_KEY = 'skillRun';

  /** Run a function in the page and get the first result back. */
  async function inPage(func, args = []) {
    const tab = await h.getActiveTab();
    const results = await h.execInPage(tab.id, func, args);
    return results && results[0] ? results[0].result : undefined;
  }

  return {
    // ── navigation / timing ────────────────────────────────────────
    async navigate(url) {
      return h.navigateToUrl(url);
    },

    async sleep(ms) {
      return new Promise(r => setTimeout(r, ms));
    },

    // ── waiting ───────────────────────────────────────────────────
    /**
     * Poll for a selector instead of using MutationObserver: the observer
     * lives in the page, but the loop lives here, so we can bail out cleanly
     * when the service worker is about to be suspended.
     */
    async waitFor(selector, timeout) {
      const deadline = Date.now() + timeout;
      const step = 400;
      while (Date.now() < deadline) {
        const found = await inPage((sel) => !!document.querySelector(sel), [selector]);
        if (found) return true;
        await new Promise(r => setTimeout(r, step));
      }
      return false;
    },

    // ── interactions ──────────────────────────────────────────────
    async click(step) {
      const selector = step.selector;
      if (!selector && !step.text) {
        return { ok: false, error: 'click butuh "selector" atau "text"' };
      }

      const res = await inPage((sel, txt) => {
        let el = null;

        if (sel) {
          el = document.querySelector(sel);
        } else if (txt) {
          // click the smallest element whose own text matches
          const all = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"]'));
          const matches = all.filter(e => (e.innerText || e.value || '').trim().toLowerCase().includes(txt.toLowerCase()));
          matches.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
          el = matches[0] || null;
        }

        if (!el) return { ok: false, reason: 'not-found' };

        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
          return { ok: false, reason: 'not-clickable' };
        }
        if (el.disabled) return { ok: false, reason: 'disabled' };

        const candidates = [el, el.parentElement, el.closest('button,a,[role="button"]')].filter(Boolean);
        for (const c of candidates) {
          try { c.click(); return { ok: true }; } catch (e) { /* try next */ }
        }

        // last resort: synthetic pointer events
        try {
          const r = el.getBoundingClientRect();
          const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
          return { ok: true, synthetic: true };
        } catch (e) {
          return { ok: false, reason: e.message };
        }
      }, [selector, step.text || '']);

      if (!res || res.ok === false) {
        const reason = res && res.reason;
        const what = selector ? `"${selector}"` : `teks "${step.text}"`;
        const hint = reason === 'not-found' ? 'tidak ketemu'
          : reason === 'disabled' ? 'sedang disabled'
          : reason === 'not-clickable' ? 'tidak bisa diklik (hidden/overlay)'
          : (reason || 'gagal');
        return { ok: false, error: `klik ${what} ${hint}` };
      }
      return { ok: true, log: res.synthetic ? 'diklik (synthetic)' : 'diklik' };
    },

    async fill(selector, value) {
      const ok = await inPage((sel, val) => {
        const el = document.querySelector(sel);
        if (!el) return { ok: false, error: 'not-found' };

        el.focus();

        const isCE = el.getAttribute && el.getAttribute('contenteditable') !== null;
        if (isCE) {
          el.textContent = val;
        } else if (el.tagName === 'SELECT') {
          el.value = val;
        } else {
          // React/controlled inputs ignore a plain .value assignment.
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
          if (setter) setter.call(el, val); else el.value = val;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
        return { ok: true };
      }, [selector, value]);

      if (!ok || ok.ok === false) {
        return { ok: false, error: ok && ok.error === 'not-found' ? `input tidak ketemu: ${selector}` : 'gagal mengisi' };
      }
      return { ok: true };
    },

    async scroll(step) {
      const res = await inPage((to, by) => {
        const before = window.scrollY;
        if (to === 'top') window.scrollTo(0, 0);
        else if (to === 'bottom') window.scrollTo(0, document.body.scrollHeight);
        else if (by) window.scrollBy(0, Number(by));
        else window.scrollBy(0, window.innerHeight * 1.5);
        return { before, after: window.scrollY, height: document.body.scrollHeight };
      }, [step.to || '', step.by || 0]);

      await new Promise(r => setTimeout(r, Number(step.settle) || 800));
      const moved = res ? (res.after !== res.before) : false;
      return {
        ok: true,
        log: moved ? `scroll ${res.before}→${res.after} (total ${res.height})` : 'sudah di ujung'
      };
    },

    // ── data extraction ───────────────────────────────────────────
    async collect(step) {
      const raw = await inPage((sel, fields, attr, limit, dedupe) => {
        const els = Array.from(document.querySelectorAll(sel));
        const out = [];
        const seen = new Set();

        for (const el of els) {
          if (out.length >= limit) break;
          let item;

          if (fields && Object.keys(fields).length) {
            item = {};
            for (const [name, fsel] of Object.entries(fields)) {
              if (fsel === '@self') {
                item[name] = (el.innerText || el.textContent || '').trim();
              } else if (fsel === ':text') {
                item[name] = (el.innerText || el.textContent || '').trim();
              } else if (fsel.startsWith('@attr:')) {
                const a = fsel.slice(6);
                item[name] = el.getAttribute(a) || (el[a] !== undefined ? String(el[a]) : '');
              } else if (fsel.startsWith('@')) {
                const a = fsel.slice(1);
                item[name] = el[a] !== undefined ? String(el[a]) : '';
              } else {
                const sub = el.querySelector(fsel);
                item[name] = sub ? (sub.innerText || sub.textContent || '').trim() : '';
              }
              if (typeof item[name] === 'string') item[name] = item[name].slice(0, 500);
            }
          } else if (attr) {
            if (attr.startsWith('@')) {
              const a = attr.slice(1);
              item = { value: el[a] !== undefined ? String(el[a]) : '' };
            } else {
              item = { value: el.getAttribute(attr) || '' };
            }
          } else {
            item = { text: (el.innerText || el.textContent || '').trim().slice(0, 500) };
          }

          const key = dedupe ? JSON.stringify(item) : null;
          if (dedupe) {
            if (seen.has(key)) continue;
            seen.add(key);
          }
          out.push(item);
        }
        return out;
      }, [
        step.selector,
        step.fields || null,
        step.attr || '',
        Math.min(Number(step.limit) || 100, 500),
        !!step.dedupe
      ]);

      const data = Array.isArray(raw) ? raw : [];
      return { ok: true, data, count: data.length };
    },

    async assert(step) {
      const res = await inPage((mode, sel, txt, attrs) => {
        switch (mode) {
          case 'exists': {
            const n = document.querySelectorAll(sel).length;
            return n > 0 ? { ok: true, n } : { ok: false, error: `elemen "${sel}" tidak ada` };
          }
          case 'notExists': {
            const n = document.querySelectorAll(sel).length;
            return n === 0 ? { ok: true } : { ok: false, error: `elemen "${sel}" masih ada (${n})` };
          }
          case 'countAtLeast': {
            const n = document.querySelectorAll(sel).length;
            return n >= attrs.min ? { ok: true, n } : { ok: false, error: `cuma ${n} elemen "${sel}", minimal ${attrs.min}` };
          }
          case 'textContains': {
            const body = document.body ? document.body.innerText : '';
            return body.includes(txt) ? { ok: true } : { ok: false, error: `halaman tidak memuat teks "${txt}"` };
          }
          case 'urlContains': {
            return location.href.includes(txt) ? { ok: true } : { ok: false, error: `URL "${location.href}" tidak memuat "${txt}"` };
          }
          case 'noCaptcha': {
            const html = document.documentElement ? document.documentElement.innerHTML : '';
            const marker = /captcha|recaptcha|hcaptcha|cf-challenge|verify you are human|are you a robot/i.test(html);
            return marker ? { ok: false, error: 'CAPTCHA terdeteksi — perlu verifikasi manual' } : { ok: true };
          }
          default:
            return { ok: false, error: `assert mode tidak dikenal: ${mode}` };
        }
      }, [
        step.assert || step.mode,
        step.selector || '',
        step.text || '',
        { min: Number(step.min) || 1 }
      ]);

      if (!res || res.ok === false) return { ok: false, error: (res && res.error) || 'assert gagal' };
      return { ok: true, log: res.n !== undefined ? `ok (${res.n})` : 'ok' };
    },

    async screenshot() {
      return h.captureScreenshot();
    },

    // ── persistence ───────────────────────────────────────────────
    async saveState(state) {
      await chrome.storage.local.set({ [RUN_STATE_KEY]: state });
    },
    async loadState() {
      const got = await chrome.storage.local.get([RUN_STATE_KEY]);
      return got[RUN_STATE_KEY] || null;
    },
    async clearState() {
      await chrome.storage.local.remove([RUN_STATE_KEY]);
    }
  };
}

/**
 * Skill storage: bundled skills ship in the repo, custom ones live in
 * chrome.storage.local so the user can tweak selectors without a release.
 */
const SkillStore = {
  KEY: 'customSkills',

  async loadCustom() {
    const got = await chrome.storage.local.get([this.KEY]);
    const arr = got[this.KEY];
    return Array.isArray(arr) ? arr : [];
  },

  async saveCustom(skill) {
    const errs = SkillRunner.validate(skill);
    if (errs.length) return { ok: false, error: errs.join('; ') };

    const arr = await this.loadCustom();
    const i = arr.findIndex(s => s.id === skill.id);
    if (i >= 0) arr[i] = skill; else arr.push(skill);
    await chrome.storage.local.set({ [this.KEY]: arr });
    return { ok: true, count: arr.length };
  },

  async deleteCustom(id) {
    const arr = await this.loadCustom();
    const next = arr.filter(s => s.id !== id);
    if (next.length === arr.length) return { ok: false, error: `skill custom "${id}" tidak ada` };
    await chrome.storage.local.set({ [this.KEY]: next });
    return { ok: true, count: next.length };
  },

  async all(bundled) {
    return SkillRunner.mergeSkills(bundled, await this.loadCustom());
  }
};
