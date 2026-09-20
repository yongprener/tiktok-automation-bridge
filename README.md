# TikTok Automation Bridge

Chrome extension + desktop app for automated TikTok affiliate content pipeline.

## Architecture

```
Telegram (chat with Salsa)
    ↕  user gives commands
Hermes Agent (Docker)
    ↕  sends commands to Telegram Bot API
Telegram Bot API (api.telegram.org)
    ↕  extension polls for messages
Chrome Extension (background.js + content.js)
    ↕  chrome.tabs API + content scripts
Web pages (real Chrome, real cookies, real fingerprint)
```

## Phase 1: Chrome Extension (MVP)

- Telegram bridge (poll Bot API)
- Single profile support
- Generate video via Google Veo/Imagen
- Upload + schedule TikTok (review before post)
- Scrape data from web pages
- Self-update from GitHub releases

## Phase 2: Desktop App (Scaling)

- Multi-profile management
- Queue & scheduling
- Parallel execution
- Dashboard analytics (cross-account)
- Auto-update app + extension

## Setup

1. Load unpacked extension in Chrome
2. Enter bot token in options page
3. Name your device
4. Start giving commands via Telegram

## License

MIT
