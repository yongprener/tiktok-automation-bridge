# Changelog

Semua perubahan penting project ini.
Format: [Keep a Changelog](https://keepachangelog.com/) · Versioning: [SemVer](https://semver.org/)

## [0.2.1] - 2026-09-20

Perbaikan besar: tombol Start yang diam-diam gagal, dan status popup yang tidak
sinkron dengan halaman Settings.

### Fixed

- **Tombol Start tidak melakukan apa-apa.** `startPolling()` memakai loop
  `while(true)` di service worker. Chrome mematikan service worker setelah
  ~30 detik idle, sehingga `sendResponse` tidak pernah dipanggil dan popup
  kembali ke "Start" tanpa pesan error. Polling sekarang digerakkan
  `chrome.alarms` (satu short-poll per tick).
- **Popup bilang "Not configured" padahal Settings bilang "Configured".**
  Popup mengambil data dari service worker. Kalau extension belum di-reload,
  service worker versi lama masih hidup dan membalas dengan nilai basi. Popup
  sekarang membaca `chrome.storage.local` langsung sebagai sumber kebenaran.
- **Klik Save di Settings menghapus Chat ID.** `saveConfig()` membaca storage
  tanpa menyertakan key `botToken`, jadi `stored.botToken` selalu `undefined`
  dan cabang "token berubah → reset chat" selalu jalan. Setiap klik Save
  memutus link chat tanpa peringatan.
- **`getUpdates` memakai long-poll (`timeout: 30`)** yang menggantung service
  worker. Sekarang `timeout: 0`.
- **`update.sh` gagal di repo private** — masih mengunduh archive zip, yang
  mengembalikan HTTP 404. Sekarang memakai `git pull`.
- **Tombol "Update tersedia" adalah kode mati** — memanggil GitHub Releases API
  yang membalas 404 karena repo private dan belum ada release. Sekarang UI
  jujur menampilkan "jalankan update.bat", dan feed publik (jika ada) dipakai
  otomatis begitu dikonfigurasi.

### Added

- Tombol **📋 Log** di popup — ring buffer 60 baris, supaya kegagalan terlihat
  alih-alih diam.
- Command baru: `text`/`teks`, `tabs`, `help`. Setiap command dari Telegram
  sekarang dibalas "✅ diterima" lalu hasilnya (termasuk screenshot).
- `deleteWebhook` otomatis sebelum `getUpdates` di tombol Test Connection.
- Tombol **Re-link Chat** di Settings.
- Banner di popup yang membandingkan versi service worker dengan versi UI,
  memberitahu user kapan harus klik reload di `chrome://extensions`.
- `tests/` — 83 assertion tanpa butuh browser (stub `chrome.*` di Node):
  `smoke.js` (36), `popup.test.js` (28), `options.test.js` (19).
- `tests/run.sh` — syntax check, manifest sanity, dan tiga suite di atas.
- `scripts/release.sh` — satu perintah untuk naikkan versi, tambah bagian
  CHANGELOG, jalankan tes, lalu commit + tag + push.
- `CHANGELOG.md` (file ini).

### Changed

- Versi kini punya **satu sumber kebenaran**: `manifest.json`. `background.js`
  dan `popup.js` membacanya lewat `chrome.runtime.getManifest().version`, bukan
  lagi menyalin literal yang bisa melenceng.
- `content.js` dihapus. Semua aksi DOM lewat `chrome.scripting.executeScript`
  dari background — satu lapisan lebih sedikit yang bisa gagal.
- Permission ditambah: `identity.email` (agar email profil Chrome terbaca).
- Isi input React-safe: pakai native value setter + dispatch `input`/`change`.

## [0.2.0] - 2026-09-20

### Added

- Arsitektur polling MV3-safe (`chrome.alarms`).
- `pollingEnabled` di storage sehingga status polling bertahan saat service
  worker mati.

## [0.1.0] - 2026-09-20

### Added

- Rilis pertama: extension Manifest V3 dengan bridge Telegram Bot API.
- Popup status, halaman Settings, perintah `navigate`, `screenshot`, `scrape`,
  `click`, `fill`, `status`.
- Dukungan multi-device (target `@nama-device`).
