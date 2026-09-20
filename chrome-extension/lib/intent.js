/**
 * Intent Router
 *
 * Turns a natural-language instruction into either a single primitive command
 * or a multi-step skill run.
 *
 * Why this exists: the user shouldn't have to remember "scrape <selector>".
 * They say "ambil data analitik di <url>" and this decides what that means.
 *
 * Design: deterministic, pattern-based, no model calls. The bridge must work
 * with zero latency and zero API cost, and the failure mode of a regex miss
 * ("nggak ngerti, ini daftar perintahnya") is better than a wrong guess.
 * Anything not matched here still falls through to the raw command executor,
 * so nothing that worked before stops working.
 */

const IntentRouter = {
  /**
   * @returns {{kind:'skill', skillId:string, params:object, reply:string}
   *          | {kind:'command', command:string}
   *          | {kind:'unknown', reply:string}}
   */

  parse(text, skills = []) {
    const raw = String(text || '').trim();
    if (!raw) return { kind: 'unknown', reply: 'Perintah kosong.' };

    const url = this.extractUrl(raw);

    // ── 1. Explicit skill invocation always wins ──────────────────
    const explicit = raw.match(/^(?:skill\s+(?:run|jalanin|jalankan)\s+)(\S+)([\s\S]*)$/i);
    if (explicit) {
      return {
        kind: 'skill',
        skillId: explicit[1],
        params: this.parseParams(explicit[2]),
        reply: `Menjalankan skill ${explicit[1]}…`
      };
    }

    // "skill" / "daftar skill" -> list them
    if (/^(skill|skills|daftar\s+skill)(\s+list)?$/i.test(raw)) {
      return { kind: 'command', command: 'skill-list' };
    }

    // ── 2. Analytics / statistics  ────────────────────────────────
    // "check dan ambil data analitik di <url>", "ambil statistik", "cek performa"
    if (this.isAnalytics(raw)) {
      const steps = this.skillSteps(skills, 'scrape-tiktokshop') ? 'scrape-tiktokshop' : null;
      return {
        kind: 'skill',
        skillId: steps || 'page-audit',
        params: { url: url || this.analyticsUrl(raw) },
        reply: 'Oke, gw ambil data analitiknya. Tunggu ya…'
      };
    }

    // ── 3. Audience / demographics ────────────────────────────────
    if (/\b(audiens|audience|demografi|penonton|followers?)\b/i.test(raw) && url) {
      return {
        kind: 'skill',
        skillId: 'scrape-tiktokshop',
        params: { url },
        reply: 'Gw ambil data audiensnya…'
      };
    }

    // ── 4. CAPTCHA check ──────────────────────────────────────────
    if (/\b(captcha|verifikasi|cek.?bot)\b/i.test(raw) && url) {
      return { kind: 'skill', skillId: 'check-captcha', params: { url }, reply: 'Gw cek CAPTCHA…' };
    }

    // ── 5. Scrape / ambil data ────────────────────────────────────
    if (/\b(scrape|scrap|ambil\s+data|kumpulkan|tarik\s+data|export\s+data)\b/i.test(raw)) {
      if (url) {
        const items = this.extractNumber(raw, /(\d+)\s*(?:produk|item|baris|data)/i);
        return {
          kind: 'skill',
          skillId: 'scrape-tiktokshop',
          params: { url, ...(items ? { items } : {}) },
          reply: 'Gw scrape sekarang…'
        };
      }
      // scrape with an explicit selector but no URL
      const sel = raw.match(/(?:selector|selektor)\s+(\S+)/i);
      if (sel) return { kind: 'command', command: `scrape ${sel[1]}` };
      return {
        kind: 'unknown',
        reply: 'Mau scrape halaman apa? Sertakan URL-nya, misal:\n<code>ambil data di https://...</code>'
      };
    }

    // ── 6. Audit / periksa halaman ────────────────────────────────
    if (/\b(audit|inspeksi|periksa\s+halaman|cek\s+halaman|struktur)\b/i.test(raw) && url) {
      return { kind: 'skill', skillId: 'page-audit', params: { url }, reply: 'Gw audit halamannya…' };
    }

    // ── 7. Buka / navigate ────────────────────────────────────────
    // Plain "buka <url>" stays a primitive command — fast, and what the user
    // already knows. "buka <url> lalu <verb>" becomes a skill.
    if (/^(buka|open|navigate|browse)\b/i.test(raw) && url) {
      const tail = raw.slice(raw.toLowerCase().indexOf(url.toLowerCase()) + url.length).trim();
      if (/\b(scroll|baca|lalu|terus|kemudian|ambil|scrape)\b/i.test(tail)) {
        return { kind: 'skill', skillId: 'scroll-and-read', params: { url }, reply: 'Gw buka dan baca halamannya…' };
      }
      return { kind: 'command', command: `navigate ${url}` };
    }

    // ── 8. Read / baca halaman ────────────────────────────────────
    if (/\b(baca|read|teks|text|isi\s+halaman|konten)\b/i.test(raw) && url) {
      return { kind: 'skill', skillId: 'scroll-and-read', params: { url }, reply: 'Gw baca halamannya…' };
    }

    // ── 9. Screenshot ─────────────────────────────────────────────
    if (/\b(screenshot|ss|tangkap\s+layar|screenshoot)\b/i.test(raw)) {
      if (url) return { kind: 'command', command: `navigate ${url}` };
      return { kind: 'command', command: 'screenshot' };
    }

    // ── 10. Wait for element ──────────────────────────────────────
    const waitMatch = raw.match(/(?:tunggu|wait)\s+(\S+)/i);
    if (waitMatch && !url) {
      return { kind: 'command', command: `waitfor ${waitMatch[1]}` };
    }

    // ── 11. Bare URL -> open it ───────────────────────────────────
    if (url && raw === url) {
      return { kind: 'command', command: `navigate ${url}` };
    }

    // ── 12. Fall through: let the primitive executor try ──────────
    return { kind: 'passthrough', command: raw };
  },

  // ─── helpers ─────────────────────────────────────────────────────

  isAnalytics(text) {
    return /\b(analitik|analytics|statistik|statistic|performa|insight|metrik|metric|dashboard|penjualan|penghasilan|omzet|pendapatan|gmv|revenue)\b/i.test(text);
  },

  extractUrl(text) {
    const s = String(text);

    // Full URL first.
    const full = s.match(/https?:\/\/[^\s<>"']+/i);
    if (full) return full[0].replace(/[.,;:)\]}'"]+$/, '');

    // Bare domain: shop.tiktok.com/x, tiktok.com, www.example.co.id/a?b=1
    // Requires a dot plus a plausible TLD so ordinary words never match.
    const bare = s.match(/\b((?:[a-z0-9][a-z0-9-]*\.)+(?:com|net|org|io|co|id|dev|app|shop|store|site|xyz|me|tv|info|biz)(?:\/[^\s<>"']*)?)/i);
    if (bare) {
      const host = bare[1].replace(/[.,;:)\]}'"]+$/, '');
      return 'https://' + host;
    }

    return '';
  },

  /** Map a loose phrase to a known TikTok Studio analytics page. */
  analyticsUrl(text) {
    const base = 'https://www.tiktok.com/tiktokstudio/analytics';
    if (/\b(follower|pengikut)\b/i.test(text)) return base + '?tab=follower';
    if (/\b(video|konten)\b/i.test(text)) return base + '?tab=content';
    return base;
  },

  extractNumber(text, re) {
    const m = String(text).match(re);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  },

  /** "url=... items=20" or key=value tokens in any order. */
  parseParams(text) {
    const params = {};
    const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
    let m;
    while ((m = re.exec(text))) {
      params[m[1]] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
    }
    // a bare URL is treated as the url param
    if (!params.url) {
      const u = this.extractUrl(text);
      if (u) params.url = u;
    }
    return params;
  },

  skillSteps(skills, id) {
    return (skills || []).some(s => s.id === id);
  }
};
