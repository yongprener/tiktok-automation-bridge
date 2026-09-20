# TikTok Automation Bridge

Chrome extension + desktop app for automated TikTok affiliate content pipeline.

Control a real Chrome browser from Telegram: navigate, scrape, click, fill, and
screenshot — using your actual browser profile, cookies and fingerprint, so
target sites see a normal human session rather than a bot.

Current version: **v0.3.0** · [Releases](https://github.com/yongprener/tiktok-automation-bridge/releases) · [Changelog](CHANGELOG.md)

## Architecture

```
Telegram (chat with Salsa)
    ↕  user gives commands
Hermes Agent (Docker)
    ↕  sends commands to Telegram Bot API
Telegram Bot API (api.telegram.org)
    ↕  extension polls for messages (chrome.alarms, MV3-safe)
Chrome Extension (background.js)
    ↕  chrome.tabs + chrome.scripting
Web pages (real Chrome, real cookies, real fingerprint)
```

## Phase 1: Chrome Extension (MVP)

- Telegram bridge (alarm-driven short-poll of the Bot API)
- Single profile support
- Scrape data from web pages
- Generate video via Google Veo/Imagen
- Upload + schedule TikTok (review before post)
- Update detection via GitHub Releases

## Phase 2: Desktop App (Scaling)

- Multi-profile management
- Queue & scheduling
- Parallel execution
- Dashboard analytics (cross-account)
- Auto-update app + extension

## Setup

1. Create a Telegram bot at @BotFather (`/newbot`).
   **Use a separate bot from the Hermes gateway bot** — both would otherwise
   poll `getUpdates` on the same token and steal each other's messages.
2. Open `chrome://extensions` → enable Developer mode → **Load unpacked** →
   select the `chrome-extension/` folder.
3. Open the extension's Settings page: paste the bot token, give this device a
   name (e.g. `laptop-lenovo`), click **Save**.
4. Send any message to your bot in Telegram, then click **Test Connection**.
   The Chat ID should appear.
5. Open the popup → **Start**. You should get an "online" message from the bot.

## Commands

You can talk normally — no need to memorise syntax. Prefix with
`@<device-name>` if you run more than one device.

**Plain language**

```
buka tiktok.com
check dan ambil data analitik di https://www.tiktok.com/tiktokstudio/analytics
ambil data di shop.tiktok.com/produk
baca halaman https://example.com
audit https://example.com
cek captcha di https://example.com
screenshot
```

**Technical commands** — still work exactly as before

| Command | What it does |
| --- | --- |
| `navigate <url>` / `buka <url>` | Open a URL in a new tab |
| `screenshot` / `ss` | Screenshot the active tab, sent back to Telegram |
| `scrape <css-selector>` | Extract text/href/src from matching elements |
| `text` / `teks` | Dump the active tab's visible text |
| `click <css-selector>` | Click an element |
| `fill <selector>=<value>` | Type into an input (React-safe) |
| `waitfor <css-selector>` | Wait for an element to appear (20s) |
| `tabs` | List open tabs |
| `status` | Device info and version |
| `help` | Command list |

## Skills

A skill is a JSON recipe: a sequence of browser steps with variables. One
message runs the whole thing.

```
skill                          # list available skills
skill run scrape-tiktokshop url=https://shop.tiktok.com/x items=40
```

Bundled skills:

| id | What it does |
| --- | --- |
| `scrape-tiktokshop` | Open a TikTok Shop page, check for CAPTCHA, scroll to load, collect products |
| `check-captcha` | Open a URL and report whether a CAPTCHA is present |
| `page-audit` | Title, link count, image count, screenshot — use before writing selectors |
| `scroll-and-read` | Scroll to the bottom (lazy-load) then dump the page text |
| `watch-element` | Wait for a selector to appear, then screenshot |

### Step actions

`navigate`, `wait`, `waitFor`, `click`, `fill`, `scroll`, `collect`, `assert`,
`screenshot`, `report`.

`collect` fields support `@self` (own text), `:text`, `@attr:<name>` and plain
CSS sub-selectors; `{{var}}` in any step is substituted from earlier results.

### Writing your own

Edit `chrome-extension/skills/bundled.json`, or save a skill at runtime via the
`skill-save` message. Then regenerate the inlined copy — a service worker cannot
`fetch()` its own packaged files:

```bash
python3 scripts/sync-skills.py            # regenerate
python3 scripts/sync-skills.py --check    # verify (run.sh does this)
```

### Surviving MV3 suspension

Chrome kills the service worker after ~30s idle, and a multi-step scrape easily
exceeds that. The runner persists `{skillId, index, vars}` after **every** step
and resumes from the last completed step — so a suspended worker costs you a
30-second delay, not a lost run. A run abandoned for over 5 minutes is dropped
rather than resurrected.

## Updating

```bash
git pull          # or double-click update.bat on Windows / run update.sh
```

Then hit the reload (⟳) button on the extension card in `chrome://extensions`.
Reloading is required — Chrome keeps the old service worker running otherwise.

The popup warns you when the running service worker is older than the code on
disk, which is exactly this situation.

Once a newer [Release](https://github.com/yongprener/tiktok-automation-bridge/releases)
exists, the extension notices within 30 minutes and shows a desktop
notification. Extensions loaded unpacked cannot replace their own files, so the
notification points at `update.bat` / `update.sh` rather than self-updating.

## Versioning

`manifest.json` is the **single source of truth**. `background.js` and
`popup.js` read the version at runtime via `chrome.runtime.getManifest().version`
— they never hardcode it. `tests/run.sh` fails if a version literal reappears.

To cut a release:

```bash
./scripts/release.sh patch   # 0.3.0 -> 0.3.1
./scripts/release.sh minor   # 0.3.0 -> 0.4.0
./scripts/release.sh major   # 0.3.0 -> 1.0.0
```

It bumps the manifest, adds a CHANGELOG section, runs the full test suite,
commits, tags, pushes, and **publishes the GitHub Release**. That last step
matters: the extension detects updates through the Releases API, so a bare git
tag is invisible to it.

## Tests

No browser required — `chrome.*` and `fetch` are stubbed in Node, so the suites
run offline and deterministically.

```bash
./tests/run.sh
```

- `tests/smoke.js` — background worker: routing, polling, commands, update
  detection, and plain-language instructions (56 assertions)
- `tests/popup.test.js` — popup rendering across 10 scenarios (28 assertions)
- `tests/options.test.js` — settings save/link behaviour (19 assertions)
- `tests/skill.test.js` — skill engine, resume, and intent routing (78 assertions)
- `tests/update-check.live.js` — manual, hits the real GitHub API (needs network)

`run.sh` also checks syntax, manifest sanity, that no file hardcodes a version,
that `skills-bundled.js` matches `skills/bundled.json`, and warns when
`chrome-extension/` differs from the tagged release.

## Design notes

Built to avoid the MV3 traps that make these extensions silently fail:

- **No long polling loop in a service worker.** Chrome kills the worker after
  ~30s idle, so a `while(true)` loop dies without a trace and callers hang
  forever. Polling is driven by `chrome.alarms` — one short poll per tick.
- **UI reads `chrome.storage` directly**, never through the service worker, so
  a stale worker cannot make the popup show outdated state.
- **Every message handler calls `sendResponse`**, enforced by a test with a
  timeout guard.
- **All DOM work goes through `chrome.scripting`** from the background worker;
  there is no content script layer to go wrong.
- **The skill engine never touches `chrome.*` directly** — it goes through an
  injected adapter, which is why 78 assertions can run it without a browser.
- **Multi-step runs are resumable**, because a 30s suspension mid-scrape would
  otherwise look like a hang.

See the `chrome-bridge-extension` skill for the full pitfall list.

## License

MIT — see [LICENSE](LICENSE).
