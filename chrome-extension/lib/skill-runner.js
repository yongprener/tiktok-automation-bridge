/**
 * Skill Runner
 *
 * A "skill" is a JSON file describing a sequence of browser steps. Instead of
 * asking the agent to issue twenty separate commands, you run one skill and the
 * extension walks the steps, collecting variables as it goes.
 *
 * MV3 CONSTRAINT (the reason this file has a resume mechanism):
 * the service worker is killed after ~30s idle, and a multi-step scrape easily
 * exceeds that. So after EVERY step we persist {skillId, index, vars} to
 * chrome.storage.local. If the worker dies mid-run, the next alarm tick calls
 * resumeIfPending() and continues from the last completed step.
 *
 * DEPENDENCY INJECTION: the runner never touches chrome.* or the DOM directly.
 * Everything goes through `adapter`, which background.js implements with real
 * APIs and the tests implement with stubs. That is what makes this testable
 * outside a browser.
 */

const SkillRunner = {
  adapter: null,
  skills: [],
  /** @type {null | {skillId:string, index:number, vars:object, startedAt:number, log:string[]}} */
  state: null,
  MAX_STEPS: 60,
  STEP_TIMEOUT_MS: 60000,
  RESUME_AFTER_MS: 5 * 60 * 1000, // don't resurrect ancient runs

  /**
   * @param {object} adapter  { execInPage(tabId, func, args), getActiveTab(),
   *                            navigate(url), screenshot(), saveState(obj),
   *                            loadState(), clearState(), storage }
   * @param {Array} bundled   skills shipped in the repo
   * @param {Array} custom    skills saved by the user in chrome.storage
   */
  init(adapter, bundled = [], custom = []) {
    this.adapter = adapter;
    this.skills = this.mergeSkills(bundled, custom);
    return this.skills;
  },

  /** Custom skills override bundled ones with the same id. */
  mergeSkills(bundled, custom) {
    const map = new Map();
    for (const s of bundled) map.set(s.id, { ...s, source: 'bundled' });
    for (const s of custom) map.set(s.id, { ...s, source: 'custom' });
    return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
  },

  get(id) {
    return this.skills.find(s => s.id === id) || null;
  },

  list() {
    return this.skills.map(s => ({
      id: s.id,
      name: s.name || s.id,
      source: s.source,
      steps: (s.steps || []).length,
      params: (s.params || []).map(p => (typeof p === 'string' ? p : p.name)),
      description: s.description || ''
    }));
  },

  // ─── Validation ──────────────────────────────────────────────────

  validate(skill) {
    const errs = [];
    if (!skill || typeof skill !== 'object') return ['skill bukan object'];
    if (!skill.id) errs.push('id wajib');
    if (!Array.isArray(skill.steps) || skill.steps.length === 0) errs.push('steps wajib dan tidak boleh kosong');
    if (Array.isArray(skill.steps) && skill.steps.length > this.MAX_STEPS) {
      errs.push(`steps maksimal ${this.MAX_STEPS}`);
    }
    const KNOWN = ['navigate', 'waitFor', 'wait', 'click', 'fill', 'scroll',
                   'collect', 'assert', 'screenshot', 'report'];
    for (const [i, step] of (skill.steps || []).entries()) {
      if (!step || typeof step !== 'object') { errs.push(`step ${i}: bukan object`); continue; }
      if (!step.action) errs.push(`step ${i}: action wajib`);
      else if (!KNOWN.includes(step.action)) errs.push(`step ${i}: action tidak dikenal "${step.action}"`);
      if (step.action === 'collect' && !step.as) errs.push(`step ${i}: collect butuh "as"`);
      if (step.action === 'collect' && !step.selector) errs.push(`step ${i}: collect butuh "selector"`);
    }
    return errs;
  },

  // ─── Templating ──────────────────────────────────────────────────

  /** Resolve "{{a.b.0.text}}" against vars. Unknown paths become ''. */
  resolvePath(vars, path) {
    if (path === '.') return vars;
    let cur = vars;
    for (const key of path.split('.')) {
      if (cur === null || cur === undefined) return undefined;
      cur = Array.isArray(cur) && /^\d+$/.test(key) ? cur[Number(key)] : cur[key];
    }
    return cur;
  },

  /** Replace {{path}} tokens. Non-string values are JSON-stringified. */
  render(template, vars) {
    if (typeof template !== 'string') return template;
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path) => {
      const v = this.resolvePath(vars, path);
      if (v === undefined || v === null) return '';
      if (typeof v === 'object') return this.preview(v);
      return String(v);
    });
  },

  /** Compact preview of a value for chat output. */
  preview(value, max = 1200) {
    let s;
    try {
      if (Array.isArray(value)) {
        s = value.map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\n');
      } else if (typeof value === 'object') {
        s = JSON.stringify(value, null, 2);
      } else {
        s = String(value);
      }
    } catch (e) {
      s = '[tidak bisa dirender]';
    }
    return s.length > max ? s.slice(0, max) + `\n… (${s.length - max} karakter lagi)` : s;
  },

  /** Fill {{tokens}} inside every string of a step. */
  renderDeep(value, vars) {
    if (typeof value === 'string') return this.render(value, vars);
    if (Array.isArray(value)) return value.map(v => this.renderDeep(v, vars));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.renderDeep(v, vars);
      return out;
    }
    return value;
  },

  // ─── Execution ───────────────────────────────────────────────────

  /**
   * Run a skill from scratch.
   * @returns {{ok:boolean, vars:object, log:string[], error?:string}}
   */
  async run(skillId, params = {}, onProgress) {
    const skill = this.get(skillId);
    if (!skill) {
      return { ok: false, vars: {}, log: [], error: `Skill "${skillId}" tidak ada. Kirim "skill" untuk daftar.` };
    }

    const errs = this.validate(skill);
    if (errs.length) {
      return { ok: false, vars: {}, log: [], error: 'Skill tidak valid: ' + errs.join('; ') };
    }

    // required params
    const missing = [];
    for (const p of skill.params || []) {
      const name = typeof p === 'string' ? p : p.name;
      const required = typeof p === 'string' ? true : p.required !== false;
      if (required && (params[name] === undefined || params[name] === '')) missing.push(name);
      if (params[name] === undefined && typeof p === 'object' && p.default !== undefined) {
        params[name] = p.default;
      }
    }
    if (missing.length) {
      const usage = (skill.params || []).map(p => {
        const n = typeof p === 'string' ? p : p.name;
        return `${n}=<nilai>`;
      }).join(' ');
      return {
        ok: false, vars: {}, log: [],
        error: `Parameter kurang: ${missing.join(', ')}\nPakai: skill run ${skillId} ${usage}`
      };
    }

    this.state = {
      skillId,
      index: 0,
      vars: { ...params },
      startedAt: Date.now(),
      log: []
    };
    await this.persist();

    return this.continueRun(onProgress);
  },

  /**
   * Continue the current run from this.state.index.
   * Called by run() and by resumeIfPending().
   */
  async continueRun(onProgress) {
    const st = this.state;
    if (!st) return { ok: false, vars: {}, log: [], error: 'Tidak ada skill yang sedang jalan.' };

    const skill = this.get(st.skillId);
    if (!skill) {
      await this.finish();
      return { ok: false, vars: st.vars, log: st.log, error: `Skill "${st.skillId}" hilang.` };
    }
    const steps = skill.steps || [];

    while (st.index < steps.length) {
      const i = st.index;
      const step = this.renderDeep(steps[i], st.vars);
      let result;

      try {
        result = await this.runStep(step, st.vars, skill);
      } catch (e) {
        result = { ok: false, error: e.message || String(e) };
      }

      const label = `[${i + 1}/${steps.length}] ${step.action}`;

      if (!result || result.ok === false) {
        const msg = (result && result.error) || 'gagal tanpa keterangan';
        st.log.push(`${label} ✗ ${msg}`);
        const out = { ok: false, vars: st.vars, log: st.log, error: `Step ${i + 1} (${step.action}) gagal: ${msg}` };
        await this.finish();
        return out;
      }

      // A `report` step carries its output in `message`, not `log` — the chat
      // layer reads the last log line as the summary, so put it there.
      if (result.message) st.log.push(result.message);
      else if (result.log) st.log.push(`${label} ${result.log}`);
      else st.log.push(`${label} ✓`);

      if (result.vars) Object.assign(st.vars, result.vars);

      // A step can signal "stop here, this is the answer"
      if (result.done) {
        st.index = i + 1;
        await this.finish();
        return { ok: true, vars: st.vars, log: st.log, done: true };
      }

      st.index = i + 1;
      await this.persist();

      if (onProgress) {
        try { await onProgress({ index: i + 1, total: steps.length, action: step.action, log: st.log[st.log.length - 1] }); }
        catch (e) { /* progress reporting must never break the run */ }
      }
    }

    const out = { ok: true, vars: st.vars, log: st.log };
    await this.finish();
    return out;
  },

  /** Execute one step. Returns {ok, vars?, log?, done?, screenshot?}. */
  async runStep(step, vars, skill) {
    const a = this.adapter;
    if (!a) throw new Error('adapter belum di-set');

    switch (step.action) {
      case 'navigate': {
        if (!step.url) return { ok: false, error: 'butuh "url"' };
        await a.navigate(step.url);
        return { ok: true, log: `→ ${step.url}` };
      }

      case 'wait': {
        const ms = Number(step.ms) || 1000;
        await a.sleep(Math.min(ms, this.STEP_TIMEOUT_MS));
        return { ok: true, log: `${ms}ms` };
      }

      case 'waitFor': {
        if (!step.selector) return { ok: false, error: 'butuh "selector"' };
        const timeout = Number(step.timeout) || 15000;
        const found = await a.waitFor(step.selector, timeout);
        if (!found) return { ok: false, error: `elemen tidak muncul: ${step.selector}` };
        return { ok: true, log: `siap: ${step.selector}` };
      }

      case 'click': {
        const res = await a.click(step);
        if (!res.ok) return { ok: false, error: res.error };
        return { ok: true, log: res.log || 'diklik' };
      }

      case 'fill': {
        if (!step.selector) return { ok: false, error: 'butuh "selector"' };
        const res = await a.fill(step.selector, step.value ?? '');
        if (!res.ok) return { ok: false, error: res.error };
        return { ok: true, log: 'diisi' };
      }

      case 'scroll': {
        const res = await a.scroll(step);
        if (!res.ok) return { ok: false, error: res.error };
        return { ok: true, log: res.log || 'di-scroll' };
      }

      case 'collect': {
        const res = await a.collect(step);
        if (!res.ok) return { ok: false, error: res.error };
        return {
          ok: true,
          vars: { [step.as]: res.data },
          log: `${step.as}: ${res.count} item`
        };
      }

      case 'assert': {
        const res = await a.assert(step);
        if (!res.ok) return { ok: false, error: res.error };
        return { ok: true, log: res.log || 'ok' };
      }

      case 'screenshot': {
        const shot = await a.screenshot();
        if (step.as) {
          return { ok: true, vars: { [step.as]: shot }, log: 'screenshot diambil' };
        }
        return { ok: true, screenshot: shot, log: 'screenshot diambil' };
      }

      case 'report': {
        const text = step.template ? this.render(step.template, vars) : this.preview(vars);
        // `done` lets a report step be the final action (the default) while
        // still allowing further steps when final:false.
        return { ok: true, message: text, done: step.final !== false };
      }

      default:
        return { ok: false, error: `action tidak dikenal: ${step.action}` };
    }
  },

  // ─── Persistence (survives service worker death) ─────────────────

  async persist() {
    if (!this.adapter) return;
    try { await this.adapter.saveState(this.state); } catch (e) { /* best effort */ }
  },

  async clearState() {
    this.state = null;
    if (!this.adapter) return;
    try { await this.adapter.clearState(); } catch (e) { /* best effort */ }
  },

  async finish() {
    await this.clearState();
  },

  /** Load a persisted run and continue it. No-op if there is nothing to resume. */
  async resumeIfPending(onProgress) {
    if (!this.adapter) return null;
    let saved = null;
    try { saved = await this.adapter.loadState(); } catch (e) { return null; }
    if (!saved || !saved.skillId) return null;

    // Don't resurrect a run that has been sitting for hours.
    if (Date.now() - (saved.startedAt || 0) > this.RESUME_AFTER_MS) {
      await this.clearState();
      return null;
    }

    this.state = saved;
    return this.continueRun(onProgress);
  },

  progressText(state) {
    if (!state) return 'tidak ada skill yang jalan';
    return `${state.skillId} — step ${state.index}`;
  }
};
