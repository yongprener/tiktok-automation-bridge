# TikTok Automation Bridge

Chrome extension + desktop app for automated TikTok affiliate content pipeline.

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
- Generate video via Google Veo/Imagen
- Upload + schedule TikTok (review before post)
- Scrape data from web pages
- Update notifier

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

## Tests

No browser needed — `chrome.*` and `fetch` are stubbed in Node.

```bash
./tests/run.sh
```

- `tests/smoke.js` — background service worker logic (30 assertions)
- `tests/popup.test.js` — popup render scenarios (22 assertions)
- `tests/options.test.js` — settings save/link behaviour (19 assertions)

`run.sh` also checks syntax, manifest sanity, and that the version string
agrees across `manifest.json`, `background.js`, and `popup.js`.

## Updating

```bash
./update.sh      # macOS / Linux
update.bat       # Windows (double-click)
```

Then hit the reload (⟳) button on the extension card in `chrome://extensions`.
The popup warns you when the running service worker is older than the on-disk
code, which is exactly this situation.

## Design notes

See the `chrome-bridge-extension` skill for the full list of MV3 pitfalls —
notably: never run a long polling loop in a service worker, always call
`sendResponse`, and read config from `chrome.storage` directly in UI pages.

## License

MIT
