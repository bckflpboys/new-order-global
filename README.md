# New Order Global — Chrome Extension

> **AI-Powered Chrome Extension Builder.** Describe what you want in plain English — AI builds custom tools for any website. Includes a built-in YouTube layout customization tool (free).

---

## Architecture

```
new order global/
├── manifest.json           # Manifest V3 — permissions, content scripts, side panel
├── background.js           # Service worker — tab monitoring, tool injection, agent orchestration
│
├── popup.html / popup.js    # Side panel UI — auth, tool list, AI builder entry point
│
├── core/                   # New Order Global framework
│   ├── api-client.js       # HTTP client — auth, AI, tools, billing, agent, conversations, settings
│   ├── tool-manager.js     # Install, activate, inject, sync AI-generated tools (incl. dashboardHTML)
│   ├── tool-runtime.js     # Content script — storage bridge (ISOLATED ↔ MAIN world)
│   ├── agent-runtime.js    # Content script — DOM reader + action executor (40+ actions)
│   ├── bg-agent-loop.js    # Background agent loop — runs tasks from Telegram/WhatsApp without panel open
│   ├── whatsapp-watcher.js # WhatsApp Web watcher — monitors agent group, sends/receives messages
│   └── auth.js             # Auth state management — login, register, session tracking
│
├── builder/                # AI Tool Builder (full-page chat interface)
│   ├── builder.html        # Chat UI layout
│   ├── builder.js          # Conversation flow, code preview, tool acceptance, conversational mode
│   └── builder.css         # Builder styling
│
├── agent/                  # Global Executive — Browser Agent
│   ├── agent.html          # Task UI — input, step log, tab tracker, plan modal, task type badge
│   ├── agent.js            # Agent loop controller — plan → brief → execute → report → next
│   └── agent.css           # Agent styling (Alexandria editorial red theme)
│
├── dashboard/              # Extension dashboard pages
│   ├── setup.html/js       # Integrations + preferences + research depth + agent settings +
│   │                        #   domain rules + memory browser + scheduled tasks
│   ├── billing.html/js     # Credit balance, purchase packages, subscriptions
│   ├── settings.html/js    # User profile settings
│   ├── tools.html/js       # Tool management list
│   ├── tool-detail.html/js # Tool detail with dashboard iframe (srcdoc + __noInitialData injection)
│   ├── replay.html/js      # Action Replay — step-by-step task playback with timeline
│   └── dashboard.css       # Shared dashboard styles (red theme)
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
- Cloud sync across devices (including dashboardHTML)
- Multiple AI model selection (Gemini, Claude, GPT-4o, etc.)
- Conversation history for iterative refinement
- **Conversational mode** — AI can respond with natural text for explanations, not just code JSON
- **Dashboard iframe** — Each tool can include a dashboard HTML page rendered in a sandboxed iframe with bidirectional `postMessage` communication and `__noInitialData` injection for reliable data handoff

### Credit-Based — Global Executive (Browser Agent)
- Describe a multi-step browser task in plain English
- AI autonomously plans and executes actions across tabs
- **40+ supported actions** (see full list below)
- **Task type classification** — research, action, or mixed (auto-detected by planner)
- **Research depth controls** — configurable minimum source domains, SERP pagination, site visit counts, scroll passes, and server-side claim verification
- **Research gate** — prevents premature task completion on research/mixed tasks until enough distinct sources are consulted
- **Web search** — server-side search via Brave/SerpAPI/DuckDuckGo with pagination support
- **Research notes with verification** — agent records structured claims; server fetches source URLs and checks key terms against page text (verified ✓ / partial ⚠ / not found ✗ / fetch failed ⏳)
- **Goal ledger** — milestones survive context truncation; stuck detection warns the agent when looping
- **Long-term memory** — agent remembers facts about you across tasks (auto-extracted or manually added; secrets never stored)
- **Per-domain rules** — hard/soft constraints the agent must follow on specific websites
- **Scheduled tasks** — cron-based recurring task execution (tier-gated)
- **PDF handling** — read metadata, rasterise pages, fill AcroForm fields, add text overlays
- **File capture** — fetch URLs into OBS storage using the user's logged-in session; chain into PDF fill, upload, or notify
- **Screenshot capture** — uploaded to OBS, fed to vision model on next step
- **Email reading** — read Gmail/Outlook/Yahoo/Proton inboxes for OTPs and messages
- **Coord-based actions** — click, type, drag at viewport coordinates for canvas/WebGL/games
- **Human-in-the-loop** — `askUser` and `confirmAction` for co-pilot mode safety
- **Tool integration** — invoke or create user's AI-generated Tools mid-task
- **Sub-agent spawning** (Super Agent) — parallel child tasks
- **Multi-agent council** (Super Agent) — Strategist/Executor/Critic/Optimizer deliberation
- **Background execution** — tasks from Telegram/WhatsApp run without the panel open
- **Action Replay** — step-by-step playback of past tasks with timeline scrubber
- Live step-by-step execution log with tab tracking and verification glyphs
- Task history with stored data review
- Plan modal with risk badges and task type badge (research/action/mixed)

### Messaging Integrations
- **Telegram** — Link a bot via @BotFather; agent sends updates and accepts tasks via DM
- **WhatsApp** — Watch a dedicated "My Agent" group; agent reads incoming messages and types replies
- **Notification preferences** — choose channel (Telegram/WhatsApp/none), toggle per-event (complete, awaiting, failure)
- **Chat nudges** — mid-task messages from Telegram/WhatsApp are injected into the agent's context
- **In-app popups** — Extension surfaces server-sent notifications (tier-targeted) with clear/dismiss actions

### Dashboard Pages
- **Setup** — Telegram/WhatsApp linking, notification prefs, agent behaviour, research depth, agent limits & custom rules, per-domain rules, long-term memory browser, scheduled tasks
- **My Tools** — list, activate/deactivate, delete AI-generated tools
- **Tool Detail** — dashboard iframe with `__noInitialData` injection + `postMessage` bridge for data exchange
- **Action Replay** — browse past tasks, step-by-step playback with speed control
- **Credits & Billing** — balance, one-time packages, subscription management
- **Settings** — profile display name and email
- **Updates & Notices** — shows extension self-update popups (latest release + changelog) and unread in-app notifications

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

1. **User describes a task** in the Agent UI (e.g. "Research the best budget laptops under $800")
2. **Extension sends task** to `POST /api/agent/start` with the active tab's URL and title
3. **Server calls the LLM** (OpenRouter) with a detailed agent system prompt defining 40+ available actions and the user's research depth preferences
4. **LLM classifies the task** as `research`, `action`, or `mixed` and returns a plan with milestones
5. **Extension shows the plan** in a modal with risk badges and a task type badge
6. **LLM returns a structured JSON action** (e.g. `{"action": "webSearch", "params": {"query": "best budget laptops 2025"}}`)
7. **Server-side actions** (`webSearch`, `researchNote`) are executed on the server — the extension receives rewritten results
8. **Client-side actions** are executed by `agent-runtime.js` injected into the target tab — reads DOM state or performs the action
9. **Extension reports the result** back to `POST /api/agent/step` along with page state
10. **Server feeds the result + context** back to the LLM for the next action, including research state (verified notes, domain counts) and goal ledger
11. **Research gate** — if the agent tries to call `done` on a research/mixed task with too few sources, the server demotes it to a `message` and tells the agent to gather more
12. **Loop repeats** until the LLM returns a `done` action or the step limit is reached

### Agent Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Agent UI (agent.html)                                  │
│  ├── Task input + model selector + run mode toggle      │
│  ├── Plan modal (risk badges + task type badge)         │
│  ├── Live step log with action details + verification   │
│  ├── Tab tracker (shows open tabs)                      │
│  └── Task history sidebar                               │
└────────────────┬────────────────────────────────────────┘
                 │ chrome.runtime.sendMessage
┌────────────────▼────────────────────────────────────────┐
│  background.js                                          │
│  ├── ge-execute-in-tab → injects + messages tab         │
│  ├── ge-open-tab / ge-switch-tab / ge-close-tab         │
│  ├── ge-download / ge-download-content                  │
│  ├── ge-screenshot → captures tab, uploads to OBS       │
│  ├── ge-capture-file → fetches URL into OBS storage     │
│  ├── bg-agent-loop.js → background task execution       │
│  ├── whatsapp-watcher.js → WhatsApp group monitor       │
│  └── ensureAgentRuntime() — lazy injection              │
└────────────────┬────────────────────────────────────────┘
                 │ chrome.tabs.sendMessage
┌────────────────▼────────────────────────────────────────┐
│  agent-runtime.js (content script in target tab)        │
│  ├── readPageState() → structured DOM snapshot          │
│  ├── executeClick/Type/Scroll/Select/Extract/...        │
│  ├── Coord-based actions (clickAt, typeText, etc.)      │
│  ├── readEmail / readDownloads / readConsole             │
│  └── Responds via sendResponse                          │
└─────────────────────────────────────────────────────────┘
                 ↕ HTTP (NewOrderAPI)
┌─────────────────────────────────────────────────────────┐
│  Server (/api/agent)                                    │
│  ├── /start  — create task, classify type, get plan     │
│  ├── /step   — report result, get next action           │
│  │   ├── Server-side: webSearch, researchNote, verify   │
│  │   ├── Research gate: reject premature done            │
│  │   └── Page-state diffing / caching                    │
│  ├── /answer — reply to askUser / confirmAction          │
│  ├── /stop   — cancel running task                       │
│  └── /tasks  — list & view past tasks                   │
└─────────────────────────────────────────────────────────┘
```

### Background Agent Loop

When a task originates from Telegram or WhatsApp, the `bg-agent-loop.js` service worker module runs it without the side panel being open:

1. Chrome alarm polls every 30s for inbox messages
2. If a prompt is found, opens a background tab and drives the agent loop
3. Uses a content-script port heartbeat (20s) to keep the MV3 service worker alive
4. Sends `X-Agent-Run-Mode: background` header — server gates to paying subscribers
5. Drains `pending-chat-reply` to resume `awaiting_user` tasks from chat replies

### WhatsApp Web Watcher

The `whatsapp-watcher.js` content script runs on `web.whatsapp.com` and bridges the agent to a dedicated WhatsApp group:

1. **Group discovery** — Finds the user's "My Agent" group in the chat list using multiple selector fallback strategies
2. **Incoming messages** — MutationObserver watches for new incoming messages in the group and forwards them to the background → server `/api/integrations/whatsapp/incoming`
3. **Outbound messages** — Periodically polls the background for queued messages, types them into the chat input, and presses Enter
4. **Resilience** — Reattaches MutationObserver after DOM rebuilds, self-heals if it loses the chat reference, sends heartbeat every 25s to keep the service worker alive

---

## How Tool Dashboards Work

Each AI-generated Tool can include a `dashboardHTML` field — a full HTML page that renders inside an iframe on the Tool Detail page.

### Data Communication

The iframe uses a **dual-channel** approach for reliable data handoff:

1. **`__noInitialData` injection** — Before the iframe's `</head>`, the extension injects a `<script>` block setting `window.__noInitialData = {...}` with the tool's stored data. This ensures data is available even before the iframe's JS listener is ready.
2. **`postMessage` bridge** — The parent page also sends the data via `window.postMessage` at multiple retry points (DOMContentLoaded, load event, and timed delays of 0/200/600ms) to handle race conditions.

### Message Protocol

The iframe communicates with the parent using these message types:

| Type | Direction | Description |
|------|-----------|-------------|
| `requestData` | iframe → parent | Ask for stored data |
| `exportData` | iframe → parent | Export data (triggers download) |
| `clearData` | iframe → parent | Clear all stored data |
| `updateData` | iframe → parent | Save/update data entries |
| `deleteData` | iframe → parent | Delete specific data entries |

The parent page's event listener accepts null/empty origins (required for `srcdoc` iframes) and only processes known message types for security.

---

## Updates & In-App Notifications

- **Self-update polling:** The extension calls `/api/extension/latest-release` with its current version. When `hasUpdate` is true, a popup displays the changelog plus "Open release" / "Download ZIP" links. History comes from `/api/extension/releases`.
- **Notification popups:** Periodically hits `/api/notifications/unread` and renders tier-targeted messages; supports dismiss-one (`POST /api/notifications/:id/read`) and clear-all.
- **Safety:** Popups run in the dashboard context; unread state is tracked server-side so messages do not repeat across devices.

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
| Integration encryption key | Server `.env` | Only server |
| Brave/SerpAPI keys | Server `.env` | Only server |
| OBS credentials | Server `.env` | Only server |
| User auth tokens | `chrome.storage.local` | Only that user |
| Generated tool code | MongoDB + local cache | The creator |
| User passwords | MongoDB (bcrypt, `select: false`) | Nobody |
| OpenRouter model IDs | Server DB only | Never sent to client |
| Telegram bot tokens | MongoDB (AES-256-GCM encrypted) | Only server |
| Long-term memories | MongoDB | Only that user (filtered for secrets) |

**All AI calls go through the server.** The extension never touches OpenRouter directly. Even if someone decompiles the extension, they can't access AI without valid credentials and credits.

---

## Credits & Subscriptions

The extension uses both **one-time credit packages** and **recurring subscriptions**.

### One-Time Credit Packages

| Package | Credits | Price |
|---------|---------|-------|
| Starter | 40 | $4.00 |
| Popular | 100 | $8.00 |
| Pro | 250 | $15.00 |
| Bulk | 600 | $30.00 |

### Subscription Plans

| Plan | Credits | Price | Agent Tier | Tools |
|------|---------|-------|------------|-------|
| Starter | 150/mo | $6.99/mo | Monthly | 15 |
| Yearly Archive | 900/yr | $59.99/yr | Yearly | 25 |
| Super Agent | 600/mo | $24.00/mo | Super | 999 |

### Agent Tier Comparison

| Feature | Free | Starter | Yearly | Super Agent |
|---------|------|---------|--------|-------------|
| Max steps per task | 15 | 40 | 60 | 150 |
| Simultaneous tabs | 1 | 3 | 5 | 10 |
| Concurrent tasks | 1 | 2 | 3 | 5 |
| Daily tasks | 10 | 30 | 50 | 200 |
| Screenshots | ✗ | 3/task | 4/task | 8/task |
| Long-term memory | ✗ | ✗ | ✓ | ✓ |
| Scheduled tasks | ✗ | 2 | 10 | 999 |
| PDF fill | ✗ | ✓ | ✓ | ✓ |
| File capture | 3/task | 10/task | 20/task | 50/task |
| Multi-agent council | ✗ | ✗ | ✗ | ✓ |
| Sub-agents | ✗ | ✗ | ✗ | ✓ |
| Session persistence | ✗ | ✗ | ✗ | ✓ |
| Background execution | ✗ | ✓ | ✓ | ✓ |
| Temperature | 0.30 | 0.25 | 0.25 | 0.20 |

- **New users** get 10 free credits on signup
- **Credit cost** is calculated per request based on token usage and model pricing
- Subscribers get their plan credits on each billing cycle
- Yearly Archive saves ~33% vs monthly

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