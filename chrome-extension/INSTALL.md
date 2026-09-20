# Chrome Extension — TikTok Automation Bridge

## Installation (Developer Mode)

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder
5. Extension should appear in the list

## Setup

1. Click the extension icon → click **Settings**
2. Enter:
   - **Device Name**: e.g. `laptop-rumah`
   - **Bot Token**: from @BotFather
3. Click **Save**
4. Click **Test Connection** — should show ✅ if token is valid
5. Send a message to the bot in Telegram — this links your chat ID
6. Click the extension icon → click **Start**
7. You should see "Connected" in the popup

## Usage

Commands are sent from Hermes Agent (Salsa) via Telegram Bot API.

### Supported Commands

| Command | Description |
|---------|-------------|
| `buka <url>` | Navigate to URL |
| `screenshot` | Capture current page |
| `scrape <selector>` | Extract elements by CSS selector |
| `click <selector>` | Click an element |
| `fill <selector>=<value>` | Fill input field |
| `inject <js>` | Execute JavaScript |
| `status` | Show device status |
| `wait <selector> <timeout>` | Wait for element |
| `scroll <top/bottom>` | Scroll page |
| `get_text <selector>` | Get text content |
| `get_html <selector>` | Get HTML content |

### Multi-Device Targeting

Commands can be targeted at specific devices:
```
@laptop-rumah buka tiktok.com/upload
@pc-kantor screenshot
```

Without `@device_name`, command is broadcast to all connected devices.
