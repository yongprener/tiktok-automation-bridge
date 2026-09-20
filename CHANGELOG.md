# Changelog

Semua perubahan penting project ini.
Format: [Keep a Changelog](https://keepachangelog.com/) · Versioning: [SemVer](https://semver.org/)

## [0.4.0] - 2026-09-20

Extension sekarang mengerti **bahasa biasa** dan bisa menjalankan **skill**
(rangkaian langkah tersimpan) dalam satu perintah.

Sebelumnya perintah harus kaku: `scrape <selector>`. Mengirim "check dan ambil
data analitik di <url>" dijawab `❌ Perintah nggak dikenal: check`.

### Added

- **Intent router** — mengenali perintah bahasa Indonesia/Inggris sehari-hari
  dan memetakannya ke skill atau perintah primitif. Deterministik, tanpa panggilan
  model, jadi tidak ada biaya dan tidak ada latensi tambahan. Yang tidak dikenali
  tetap diteruskan ke eksekutor lama, jadi tidak ada yang rusak.
- **Skill system** — skill = file JSON berisi rangkaian langkah. 5 skill bawaan:
  `scrape-tiktokshop`, `check-captcha`, `page-audit`, `scroll-and-read`,
  `watch-element`.
- Aksi langkah: `navigate`, `wait`, `waitFor`, `click`, `fill`, `scroll`,
  `collect`, `assert`, `screenshot`, `report`. Nilai dari langkah sebelumnya
  dipakai lewat `{{variabel}}`.
- Perintah `skill` (daftar) dan `skill run <id> key=value`.
- `waitfor <selector>` sebagai perintah primitif; `click` sekarang bisa pakai
  `text=` selain `selector=`; `assert` bisa mendeteksi CAPTCHA.
- Skill custom bisa disimpan runtime (`skill-save`) tanpa rilis baru.
- Progres dikirim ke Telegram tiap beberapa langkah, jadi proses panjang tidak
  terlihat seperti hang.

### Fixed

- **Skill yang terputus sekarang dilanjutkan, bukan hilang.** Chrome mematikan
  service worker setelah ~30 detik idle, dan scraping multi-langkah melewati itu.
  Runner menyimpan `{skillId, index, vars}` setelah **setiap** langkah dan
  melanjutkan dari langkah terakhir yang selesai — lewat alarm, dan juga saat
  service worker bangun karena alasan apa pun. Run yang ditinggalkan >5 menit
  dibuang, tidak dihidupkan lagi.
- `click` menangani elemen yang `disabled`/tertutup overlay, dan fallback ke
  synthetic pointer event kalau `click()` biasa gagal.
- Domain tanpa `http://` (mis. `shop.tiktok.com/produk`) sekarang dikenali.
- Output langkah `report` masuk ke log sehingga ringkasannya sampai ke chat.

### Changed

- `skills/bundled.json` adalah sumber; `lib/skills-bundled.js` digenerate oleh
  `scripts/sync-skills.py` (service worker tidak bisa `fetch()` file sendiri).
  `tests/run.sh` gagal kalau keduanya tidak sinkron.

### Tests

98 → 181 assertion (background 56, popup 28, options 19, skill 78). Suite skill
memverifikasi setiap skill bawaan benar-benar berjalan, plus resume setelah
service worker mati — dan sudah dibuktikan GAGAL saat routing-nya dikembalikan
ke perilaku lama.

## [0.3.0] - 2026-09-20

Repo dijadikan **public**, sehingga deteksi update otomatis akhirnya bisa
berfungsi. Sebelumnya tombol update adalah kode mati: GitHub menutup Releases
API untuk repo private (HTTP 404), jadi extension tidak akan pernah tahu ada
versi baru.

### Added

- **Deteksi update otomatis via GitHub Releases API.** Extension mengecek tiap
  30 menit lewat `chrome.alarms`, dan menampilkan notifikasi desktop kalau ada
  versi lebih baru.
- Fallback ke feed publik (`UPDATE_FEED_URL`, mis. `version.json`) untuk berjaga
  kalau repo suatu saat di-private lagi.
- `tests/update-check.live.js` — cek langsung ke GitHub API yang asli
  (dijalankan manual, butuh jaringan).
- `LICENSE` — file MIT yang selama ini sudah diklaim di README tapi belum ada.
- `scripts/release.sh` sekarang **mempublikasikan GitHub Release**, bukan cuma
  push tag. Tanpa Release, extension tidak melihat versi baru.

### Fixed

- `update.sh` dan `update.bat` kini menjelaskan penyebab gagal (git belum
  terinstall, folder bukan hasil clone, ada perubahan lokal yang bentrok) dan
  menampilkan versi hasil update.
- `update.bat` menampilkan versi dengan aman walau `python` tidak terpasang.

### Security

- Fixture tes dibersihkan: ID Telegram, device ID, nama device, dan username
  bot yang asli diganti placeholder netral — supaya tidak ikut terpublikasi.
  Seluruh history git sudah discan: tidak ada token, PAT, atau private key
  yang pernah ter-commit, jadi tidak perlu rewrite history.
- `.gitignore` mencakup `*.env`, `*.log`, `*.pem`, `*.zip`, `*.crx`.

### Changed

- `checkForUpdate()` dipecah: `fetchLatestVersion()` mencoba Releases API dulu,
  lalu feed publik. Kalau dua-duanya tidak tersedia, channel dilaporkan
  `manual` supaya popup menampilkan "jalankan update.bat" alih-alih tombol yang
  tidak pernah aktif.
- Suite tes naik dari 83 ke 98 assertion (update-detection kini teruji:
  versi lebih baru, sama, lebih lama, 404, network error, payload kosong).

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
