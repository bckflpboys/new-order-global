# New Order Global — Chrome Extension

> **AI-Powered Chrome Extension Builder.** Describe what you want in plain English — AI builds custom tools for any website.

Built-in: YouTube New Order (free layout customization tool).

---

## 🏗️ Architecture

```
Chrome Extension
├── manifest.json          # V3 manifest — permissions, resources
├── popup.html/js          # Extension popup — quick controls + AI Builder CTA
├── background.js          # Service worker — YouTube injection + AI tool injection
├── content.js             # YouTube content script (built-in free tool)
├── styles.css             # YouTube tool styles
├── settings.html/js/css   # YouTube settings page
│
├── core/                  # New Order Global framework
│   ├── api-client.js      # Communicates with backend server
│   ├── tool-manager.js    # Installs, activates, injects AI tools
│   ├── tool-runtime.js    # Sandboxed runtime for generated code
│   └── auth.js            # User session management
│
├── builder/               # AI Tool Builder (full-page chat UI)
│   ├── builder.html
│   ├── builder.js
│   └── builder.css
│
└── server/                # Backend API (deployed separately)
    ├── server.js           # Express entry point
    ├── models/             # MongoDB schemas (User, Tool)
    ├── routes/             # API routes (auth, ai, tools, billing)
    ├── middleware/          # JWT auth, rate limiting
    └── services/           # OpenRouter AI integration
```

---

## ⚡ Features

### Free (Built-in YouTube Tool)
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

### Paid (AI Tool Builder)
- Describe any tool in plain English
- AI generates JS + CSS + configuration
- Preview, test, iterate, then accept
- Tools auto-inject on matching websites
- Data collection with export/download
- Isolated storage per tool
- Cloud sync across devices

---

## 🚀 Setup

### 1. Load the Extension
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. Click the extension icon to verify

### 2. Start the Backend Server
```bash
cd server
cp .env.example .env
# Fill in your keys (see below)
npm install
npm run dev
```

### 3. Configure Environment
Edit `server/.env`:
```env
MONGODB_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_random_secret
OPENROUTER_API_KEY=sk-or-v1-your_key
OPENROUTER_MODEL=anthropic/claude-sonnet-4-20250514
LEMONSQUEEZY_API_KEY=your_key
LEMONSQUEEZY_STORE_ID=your_store_id
LEMONSQUEEZY_PRO_VARIANT_ID=your_variant_id
LEMONSQUEEZY_UNLIMITED_VARIANT_ID=your_variant_id
```

### 4. Point Extension to Your Server
Edit `core/api-client.js` line 6:
```js
const BASE_URL = 'http://localhost:3001'; // local dev
// const BASE_URL = 'https://api.neworderglobal.com'; // production
```

---

## 🔒 Security Model

| What | Where | Who sees it |
|------|-------|-------------|
| OpenRouter API key | Server `.env` | Only you |
| MongoDB URI | Server `.env` | Only you |
| Lemon Squeezy keys | Server `.env` | Only you |
| JWT secret | Server `.env` | Only you |
| User auth tokens | `chrome.storage.local` | Only that user |
| Generated tool code | MongoDB + local cache | The creator |
| User passwords | MongoDB (bcrypt) | Nobody |

**All AI calls go through YOUR server.** The extension never touches OpenRouter directly. Even if someone decompiles the extension, they can't access AI without a valid account and paid plan.

---

## 📡 API Endpoints

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | — | Create account |
| POST | `/api/auth/login` | — | Sign in |
| GET | `/api/auth/profile` | JWT | Get user profile |
| PUT | `/api/auth/profile` | JWT | Update display name |
| POST | `/api/auth/change-password` | JWT | Change password |

### AI
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/ai/generate` | JWT | Generate a new tool |
| POST | `/api/ai/iterate` | JWT | Modify existing tool |

### Tools
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/tools` | JWT | List user's tools |
| GET | `/api/tools/:id` | JWT | Get specific tool |
| POST | `/api/tools` | JWT | Save/accept a tool |
| PUT | `/api/tools/:id` | JWT | Update a tool |
| DELETE | `/api/tools/:id` | JWT | Delete a tool |

### Billing
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/billing/subscription` | JWT | Current plan info |
| GET | `/api/billing/usage` | JWT | AI usage stats |
| POST | `/api/billing/checkout` | JWT | Create Lemon Squeezy checkout |
| POST | `/api/billing/webhook` | Signature | Lemon Squeezy events |

---

## 💰 Plans

| Feature | Free | Pro ($9.99/mo) | Unlimited ($24.99/mo) |
|---------|------|----------------|----------------------|
| YouTube Tool | ✅ | ✅ | ✅ |
| AI Generations | 0 | 50/month | Unlimited |
| Saved Tools | 0 | 10 | Unlimited |
| Cloud Sync | — | ✅ | ✅ |
| Priority AI | — | — | ✅ |

---

## 🛠️ Tech Stack

- **Extension:** Chrome Manifest V3, vanilla JS
- **Backend:** Node.js, Express, MongoDB, JWT
- **AI:** OpenRouter (Claude, GPT-4o, Gemini)
- **Payments:** Lemon Squeezy
- **Website:** Next.js 16, Tailwind CSS

---

© New Order Global. All rights reserved.