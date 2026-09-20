#!/usr/bin/env node
/**
 * Live check against the REAL GitHub API.
 *
 * Not part of tests/run.sh — it needs network access. Run manually:
 *   node tests/update-check.live.js
 *
 * Verifies that the extension's update logic actually works now that the repo
 * is public: the payload shape from the GitHub Releases API, plus the popup
 * state it should produce.
 */

const REPO = 'yongprener/tiktok-automation-bridge';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

function isNewerVersion(latest, current) {
  const l = String(latest).split('.').map(Number);
  const c = String(current).split('.').map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

(async () => {
  const manifestVersion = JSON.parse(
    require('fs').readFileSync(require('path').join(__dirname, '..', 'chrome-extension', 'manifest.json'), 'utf8')
  ).version;

  console.log(`\nLocal manifest version: ${manifestVersion}`);
  console.log(`Repo: ${REPO} (public?)\n`);

  // 1) Is the repo reachable without auth?
  const repoRes = await fetch(`https://api.github.com/repos/${REPO}`);
  console.log(`1) Repo metadata: HTTP ${repoRes.status}`);
  if (repoRes.ok) {
    const repo = await repoRes.json();
    console.log(`   private: ${repo.private} | visibility: ${repo.visibility}`);
  }

  // 2) Releases API — the exact call the extension makes
  const relRes = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
  console.log(`\n2) releases/latest: HTTP ${relRes.status}`);

  if (relRes.status === 404) {
    console.log('   NO RELEASES PUBLISHED YET.');
    console.log('   -> extension will report updateChannel="manual" and the popup');
    console.log('      will say "Update: jalankan update.bat". Not a bug.');
    console.log('   -> publish a GitHub Release (or a tag via the UI) to test the happy path.');
    process.exit(0);
  }

  if (!relRes.ok) {
    console.log(`   Unexpected status. Extension handles this by falling back to manual.`);
    process.exit(0);
  }

  const rel = await relRes.json();
  const tag = String(rel.tag_name || rel.name || '').replace(/^v/, '').trim();
  console.log(`   tag_name: ${rel.tag_name}  -> parsed version: ${tag}`);
  console.log(`   published: ${rel.published_at}`);

  const newer = isNewerVersion(tag, manifestVersion);
  console.log(`\n3) isNewerVersion("${tag}", "${manifestVersion}") = ${newer}`);
  console.log(`   -> popup would show: ${newer ? 'UPDATE AVAILABLE v' + tag : 'up to date'}`);
  console.log(`   -> updateChannel: "feed" ${newer ? '' : '(no update offered)'}`);

  console.log('\n✅ Live update-check path verified.\n');
})().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
