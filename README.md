# New Order Global — Chrome Extension

> **AI-Powered Chrome Extension Builder.** Describe what you want in plain English — AI builds custom tools for any website. Includes a built-in YouTube layout customization tool (free).

---

## Architecture

```
new order global/
├── manifest.json           # Manifest V3 — permissions, content scripts, side panel
├── background.js           # Service worker — tab monitoring, tool injection orchestration
│
├── popup.html / popup.js    # Side panel UI — auth, tool list, AI builder entry point
│
├── core/                   # New Order Global framework
│   ├── api-client.js       # HTTP client — auth, AI, tools, billing, conversations
│   ├── tool-manager.js     # Install, activate, inject, sync AI-generated tools
│   ├── tool-runtime.js     # Content script — storage bridge (ISOLATED ↔ MAIN world)
│   └── auth.js             # Auth state management — login, register, session tracking
│
├── builder/                # AI Tool Builder (full-page chat interface)
│   ├── builder.html        # Chat UI layout
│   ├── builder.js          # Conversation flow, code preview, tool acceptance
│   └── builder.css         # Builder styling
│
├── dashboard/              # Extension dashboard pages
│   ├── billing.html/js     # Credit balance, purchase packages
│   ├── settings.html/js    # User settings
│   ├── tools.html/js       # Tool management list
│   ├── tool-detail.html/js # Tool detail view with dashboard iframe
│   └── dashboard.css       # Shared dashboard styles
│
├── youtube.html / youtube.js / youtube.css   # YouTube New Order (built-in free tool)
├── content.js              # YouTube content script (layout engine)
├── styles.css              # YouTube tool styles
│
└── icons/                  # Extension icons (blue/white variants, 16/48/128px)
```

---

## Features

### Free — Built-in YouTube Tool
- 8+ layout modes (swapped, triple, theater, focus, etc.)
- Resizable columns, collapsible sections
- PiP comments, grid view for related videos
- Volume boost (up to 400%)
- Video notes, timestamp bookmarks
- Comment search & filtering
- Channel blocking, keyword filters
- Playlist manager, watch later
- Custom fonts, compact mode
- Screenshot, skip ads, hide shorts

### Credit-Based — AI Tool Builder
- Describe any tool in plain English
- AI generates JS + CSS + configuration + dashboard HTML
- Preview, test, iterate with feedback, then accept
- Tools auto-inject on matching websites via content scripts
- Data collection with export/download (CSV, JSON)
- Isolated storage per tool via `ToolStorage` bridge
- Cloud sync across devices
- Multiple AI model selection (Gemini, Claude, GPT-4o, etc.)
- Conversation history for iterative refinement

---

## How AI Tools Work

1. **User describes a tool** in the Builder chat UI
2. **Server calls OpenRouter** with a detailed system prompt that instructs the AI to generate a Chrome extension content script
3. **AI returns JSON** containing: `name`, `contentScript`, `styles`, `targetSites`, `config`, `storageSchema`, `dashboardHTML`
4. **Tool is saved as draft** in MongoDB, credits are deducted atomically
5. **User accepts the tool** → it's installed locally and activated
6. **Background service worker** injects the tool's code into matching tabs
7. **Tool code runs in MAIN world** via `chrome.scripting.executeScript`, with a storage bridge back to the ISOLATED world for `chrome.storage` access

### Runtime Architecture

```
┌──────────────────────────────────────────────────┐
│  Web Page (MAIN world)                           │
│  ┌────────────────────────────────────────────┐  │
│  │  Tool IIFE wrapper                         │  │
│  │  ├── ToolStorage (postMessage bridge)      │  │
│  │  ├── downloadData() helper                 │  │
│  │  ├── showToolToast() helper                │  │
│  │  └── User's contentScript code             │  │
│  └────────────────────────────────────────────┘  │
│         ↕ window.postMessage                      │
│  ┌────────────────────────────────────────────┐  │
│  │  tool-runtime.js (ISOLATED world)          │  │
│  │  └── Bridges postMessage ↔ chrome.storage  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

---

## Setup

### 1. Load the Extension
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. Pin the extension icon to your toolbar

### 2. Start the Backend Server
See the [server README](../global%20order%20server/README.md) for full setup instructions.

```bash
cd "../global order server"
cp .env.example .env   # Fill in your keys
npm install
npm run dev
```

### 3. Point Extension to Your Server
Edit `core/api-client.js` line 6:
```js
const BASE_URL = 'http://localhost:3001'; // local dev
// const BASE_URL = 'https://api.global-order.32d.one'; // production
```

---

## Security Model

| What | Where | Who sees it |
|------|-------|-------------|
| OpenRouter API key | Server `.env` | Only server |
| MongoDB URI | Server `.env` | Only server |
| Lemon Squeezy keys | Server `.env` | Only server |
| JWT secret | Server `.env` | Only server |
| User auth tokens | `chrome.storage.local` | Only that user |
| Generated tool code | MongoDB + local cache | The creator |
| User passwords | MongoDB (bcrypt, `select: false`) | Nobody |
| OpenRouter model IDs | Server DB only | Never sent to client |

**All AI calls go through the server.** The extension never touches OpenRouter directly. Even if someone decompiles the extension, they can't access AI without valid credentials and credits.

---

## Credit System

The extension uses a **credit-based** system for AI tool generation:

- **New users** get 10 free credits on signup
- **Credit cost** is calculated per request based on token usage and model pricing
- **Credit packages** can be purchased via Lemon Squeezy:

| Package | Credits | Price |
|---------|---------|-------|
| Starter | 40 | $4.00 |
| Popular | 100 | $8.00 |
| Pro | 200 | $15.00 |

- **Tool limits**: Free=3, Pro=10, Unlimited=999 saved tools
- **Daily AI limit**: 50 requests per user per day

---

## Tech Stack

- **Extension:** Chrome Manifest V3, vanilla JS, no build step
- **Backend:** Node.js, Express, MongoDB, JWT (see [server README](../global%20order%20server/README.md))
- **AI:** OpenRouter (Gemini 2.5 Flash, Claude, GPT-4o, etc.)
- **Payments:** Lemon Squeezy
- **Website:** Next.js, Tailwind CSS (deployed at global-order.32d.one)

---

## License

MIT — See [LICENSE](LICENSE)