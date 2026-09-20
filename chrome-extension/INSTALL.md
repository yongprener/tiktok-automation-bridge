# Chrome Extension — TikTok Automation Bridge

Version 0.2.1

## Installation (Developer Mode)

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder
5. Extension should appear in the list

## Setup

1. Bikin bot Telegram BARU di @BotFather (`/newbot`) — jangan pakai bot yang
   sama dengan bot Hermes, nanti keduanya rebutan pesan.
2. Click the extension icon → **Settings**
3. Enter:
   - **Device Name**: e.g. `laptop-lenovo`
   - **Bot Token**: dari @BotFather
4. Click **Save**
5. Send a message to your bot in Telegram, then click **Test Connection** —
   the Chat ID should appear
6. Click the extension icon → **Start**
7. You should see "Connected" in the popup and an "online" message in Telegram

## Troubleshooting

**Popup says "Not configured" but Settings says "Configured"**
The running service worker is older than the code on disk. Open
`chrome://extensions` and click the reload (⟳) button on the extension card.
The popup shows a warning banner when it detects this mismatch.

**Start does nothing / reverts to "Start"**
Click **📋 Log** in the popup and read the last lines. Common causes:
- Chat not linked → send a message to the bot, then press Start again
- Wrong token → re-run **Test Connection** in Settings
- Bot has an active webhook → `Test Connection` calls `deleteWebhook` for you

**Popup says "Chat belum ke-link"**
Send any message to the bridge bot in Telegram, then press Start. The extension
learns the Chat ID from the first incoming message.

## Usage

Commands are sent from Hermes Agent (Salsa) via Telegram Bot API.

### Supported Commands

| Command | Description |
|---------|-------------|
| `buka <url>` / `navigate <url>` | Buka URL di tab baru |
| `screenshot` / `ss` | Screenshot tab aktif, dikirim ke Telegram |
| `scrape <selector>` | Extract elements by CSS selector |
| `text` / `teks` | Dump teks halaman |
| `click <selector>` | Click an element |
| `fill <selector>=<value>` | Fill input field (React-safe) |
| `tabs` | List tab yang terbuka |
| `status` | Show device status |
| `help` | Daftar perintah |

### Multi-Device Targeting

Commands can be targeted at specific devices:
```
@laptop-lenovo buka tiktok.com/upload
@laptop-lenovo screenshot
```

Without `@device_name`, each device that receives the message will act on it.
