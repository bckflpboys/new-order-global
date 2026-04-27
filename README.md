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
│   ├── api-client.js       # HTTP client — auth, AI, tools, billing, agent, conversations
│   ├── tool-manager.js     # Install, activate, inject, sync AI-generated tools
│   ├── tool-runtime.js     # Content script — storage bridge (ISOLATED ↔ MAIN world)
│   ├── agent-runtime.js    # Content script — DOM reader + action executor for agent
│   └── auth.js             # Auth state management — login, register, session tracking
│
├── builder/                # AI Tool Builder (full-page chat interface)
│   ├── builder.html        # Chat UI layout
│   ├── builder.js          # Conversation flow, code preview, tool acceptance
│   └── builder.css         # Builder styling
│
├── agent/                  # Global Executive — Browser Agent
│   ├── agent.html          # Task UI — input, step log, tab tracker, auth
│   ├── agent.js            # Agent loop controller — start → execute → report → next
│   └── agent.css           # Agent styling (Alexandria editorial theme)
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

### Credit-Based — Global Executive (Browser Agent)
- Describe a multi-step browser task in plain English
- AI autonomously plans and executes actions across tabs
- **17 supported actions:** `readPage`, `extract`, `click`, `type`, `scroll`, `select`, `pressKey`, `clear`, `openTab`, `switchTab`, `closeTab`, `storeData`, `download`, `wait`, `waitForElement`, `think`, `message`, `done`
- Scrape data from websites (Facebook Marketplace, Google results, etc.)
- Create documents in Google Sheets/Docs
- Send messages via WhatsApp Web or other platforms
- Download extracted data as files
- Live step-by-step execution log with tab tracking
- Task history with stored data review
- Safety limit of 50 steps per task

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

## How the Global Executive Works

1. **User describes a task** in the Agent UI (e.g. "Scrape Facebook Marketplace listings under $200")
2. **Extension sends task** to `POST /api/agent/start` with the active tab's URL and title
3. **Server calls the LLM** (OpenRouter) with a detailed agent system prompt defining 17 available actions
4. **LLM returns a structured JSON action** (e.g. `{"action": "readPage", "params": {}}`)
5. **Extension executes the action** — `background.js` injects `agent-runtime.js` into the target tab, which reads DOM state or performs the action
6. **Extension reports the result** back to `POST /api/agent/step` along with page state
7. **Server feeds the result + context** back to the LLM for the next action
8. **Loop repeats** until the LLM returns a `done` action or the 50-step limit is reached

### Agent Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Agent UI (agent.html)                                  │
│  ├── Task input + model selector                        │
│  ├── Live step log with action details                  │
│  ├── Tab tracker (shows open tabs)                      │
│  └── Task history sidebar                               │
└────────────────┬────────────────────────────────────────┘
                 │ chrome.runtime.sendMessage
┌────────────────▼────────────────────────────────────────┐
│  background.js                                          │
│  ├── ge-execute-in-tab → injects + messages tab         │
│  ├── ge-open-tab / ge-switch-tab / ge-close-tab         │
│  ├── ge-download / ge-download-content                  │
│  └── ensureAgentRuntime() — lazy injection               │
└────────────────┬────────────────────────────────────────┘
                 │ chrome.tabs.sendMessage
┌────────────────▼────────────────────────────────────────┐
│  agent-runtime.js (content script in target tab)        │
│  ├── readPageState() → structured DOM snapshot          │
│  ├── executeClick/Type/Scroll/Select/Extract/...        │
│  └── Responds via sendResponse                          │
└─────────────────────────────────────────────────────────┘
                 ↕ HTTP (NewOrderAPI)
┌─────────────────────────────────────────────────────────┐
│  Server (/api/agent)                                    │
│  ├── /start  — create task, get first action from LLM   │
│  ├── /step   — report result, get next action           │
│  ├── /stop   — cancel running task                      │
│  └── /tasks  — list & view past tasks                   │
└─────────────────────────────────────────────────────────┘
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

## Credits & Subscriptions

The extension uses both **one-time credit packages** and **recurring subscriptions**.

### One-Time Credit Packages

| Package | Credits | Price |
|---------|---------|-------|
| Starter | 40 | $4.00 |
| Popular | 100 | $8.00 |
| Pro | 200 | $15.00 |

### Subscription Plans

| Plan | Credits | Price | Agent Tier | Tools |
|------|---------|-------|------------|-------|
| Monthly Recurring | 100/mo | $6.99/mo | Monthly | 10 |
| Yearly Archive | 480/yr | $49.99/yr | Yearly | 10 |
| Super Agent | 300/mo | $20.00/mo | Super | 999 |

### Agent Tier Comparison

| Feature | Free | Monthly | Yearly | Super Agent |
|---------|------|---------|--------|-------------|
| Max steps per task | 10 | 20 | 30 | 50 |
| Simultaneous tabs | 1 | 3 | 5 | 10 |
| Concurrent tasks | 1 | 2 | 2 | 3 |
| Daily tasks | 5 | 15 | 25 | 50 |
| Daily AI requests | 50 | 100 | 100 | 200 |
| Multi-agent council | — | — | — | ✓ |
| Temperature | 0.30 | 0.25 | 0.25 | 0.20 |

- **New users** get 10 free credits on signup
- **Credit cost** is calculated per request based on token usage and model pricing
- Subscribers get their plan credits on each billing cycle
- Yearly Archive saves ~40% vs monthly

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