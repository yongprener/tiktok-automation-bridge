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

Send these to your bridge bot. Prefix with `@<device-name>` if you run more
than one device.

| Command | What it does |
| --- | --- |
| `navigate <url>` / `buka <url>` | Open a URL in a new tab |
| `screenshot` / `ss` | Screenshot the active tab, sent back to Telegram |
| `scrape <css-selector>` | Extract text/href/src from matching elements |
| `text` / `teks` | Dump the active tab's visible text |
| `click <css-selector>` | Click an element |
| `fill <selector>=<value>` | Type into an input (React-safe) |
| `tabs` | List open tabs |
| `status` | Device info and version |
| `help` | Command list |

Example: `@laptop-lenovo scrape h1`

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

- `tests/smoke.js` — background service worker: message routing, polling,
  command execution, update detection (51 assertions)
- `tests/popup.test.js` — popup rendering across 10 scenarios (28 assertions)
- `tests/options.test.js` — settings save/link behaviour (19 assertions)
- `tests/update-check.live.js` — manual, hits the real GitHub API (needs network)

`run.sh` also checks syntax, manifest sanity, that no file hardcodes a version,
and warns when `chrome-extension/` differs from the tagged release.

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

See the `chrome-bridge-extension` skill for the full pitfall list.

## License

MIT — see [LICENSE](LICENSE).
