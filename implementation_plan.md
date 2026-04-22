# New Order Global — Architecture & Implementation Plan

> *"Like Star and Stripe's quirk — define a rule, and reality bends to it."*
> Users describe what they want. The AI creates the rule. The extension enforces it.

---

## 🏗️ System Architecture Overview

```mermaid
graph TB
    subgraph "Chrome Extension"
        EXT["New Order Global Extension"]
        YT["YouTube Tool (Built-in Free)"]
        CT["Custom AI-Generated Tools"]
        POPUP["Popup UI + Tool Builder Chat"]
        BG["Background Service Worker"]
    end

    subgraph "Backend API Server"
        API["Node.js / Express API"]
        OR["OpenRouter AI Proxy"]
        AUTH_MID["Auth Middleware (JWT)"]
    end

    subgraph "Auth & Payment Website"
        WEB["Next.js / Static Website"]
        STRIPE["Stripe Payment Integration"]
        LOGIN["Auth (Email + Google OAuth)"]
    end

    subgraph "Database"
        MONGO["MongoDB Atlas"]
        USERS["Users Collection"]
        TOOLS["Tools Collection"]
        SUBS["Subscriptions Collection"]
    end

    EXT --> API
    API --> OR
    API --> MONGO
    API --> AUTH_MID
    WEB --> API
    WEB --> STRIPE
    POPUP --> BG
    BG --> API
    CT --> BG
    YT --> BG
```

---

## 📦 Component Breakdown

### 1. Chrome Extension (Restructured)

The existing YouTube extension becomes **one built-in tool** inside the larger "New Order Global" platform.

```
new order global/
├── manifest.json              # Updated for global permissions
├── background.js              # Expanded: tool manager + API bridge
├── popup.html / popup.js      # Redesigned: tool launcher + AI chat
├── settings.html / settings.js # Keep YouTube settings as "YouTube Tool" tab
├── styles.css                 # Keep YouTube styles
├── content.js                 # Keep YouTube content script
├── icons/                     # Updated branding
│
├── core/                      # NEW — Core extension framework
│   ├── tool-manager.js        # Manages installed/active tools
│   ├── tool-runtime.js        # Sandboxed runtime for AI-generated code
│   ├── api-client.js          # Communicates with backend API
│   └── auth.js                # Handles user auth tokens
│
├── builder/                   # NEW — AI Tool Builder
│   ├── builder.html           # Full-page tool builder UI
│   ├── builder.js             # Chat interface + tool preview
│   └── builder.css            # Builder styles
│
└── tools/                     # NEW — Generated tools storage
    └── (dynamically loaded)
```

**Key Changes:**
- `manifest.json` gets broader permissions (`<all_urls>`, `activeTab`, `scripting`, `storage`, `identity`)
- YouTube features remain intact as a "YouTube Tool" — free for all users
- New "AI Builder" button in popup opens the tool creation chat
- Background.js becomes the **Tool Manager** — loads/unloads tools per-site

### 2. Backend API Server

A Node.js/Express server that handles:
- **AI requests** → proxied through OpenRouter
- **User authentication** → JWT tokens
- **Tool CRUD** → save/load/delete tools in MongoDB
- **Usage tracking** → count AI requests per user for billing

```
new-order-api/
├── server.js                 # Express entry point
├── routes/
│   ├── auth.js               # Login, register, token refresh
│   ├── ai.js                 # OpenRouter proxy endpoint
│   ├── tools.js              # CRUD for user tools
│   └── billing.js            # Subscription status check
├── middleware/
│   ├── auth.js               # JWT verification
│   └── rateLimit.js          # Per-user rate limiting
├── models/
│   ├── User.js               # Mongoose user model
│   ├── Tool.js               # Mongoose tool model
│   └── Subscription.js       # Mongoose subscription model
├── services/
│   ├── openrouter.js         # OpenRouter API wrapper
│   └── toolGenerator.js      # AI prompt engineering for tools
├── .env                      # API keys (NEVER committed)
└── package.json
```

### 3. Auth & Payment Website

A simple website where users:
- Sign up / Log in
- View their subscription status
- Manage billing (Stripe)
- View their tool library

### 4. MongoDB Database

```mermaid
erDiagram
    USERS {
        ObjectId _id
        string email
        string passwordHash
        string displayName
        string plan "free|pro|unlimited"
        int aiRequestsUsed
        int aiRequestsLimit
        date createdAt
        date lastLogin
    }
    
    TOOLS {
        ObjectId _id
        ObjectId userId
        string name
        string description
        string targetSite "e.g. twitter.com, *.com"
        string status "draft|active|archived"
        object generatedCode "{ contentScript, styles, config }"
        object metadata "{ version, createdAt, updatedAt }"
        array permissions "required permissions"
    }
    
    SUBSCRIPTIONS {
        ObjectId _id
        ObjectId userId
        string stripeCustomerId
        string stripeSubscriptionId
        string plan
        string status "active|cancelled|past_due"
        date currentPeriodEnd
    }
    
    USERS ||--o{ TOOLS : "creates"
    USERS ||--o| SUBSCRIPTIONS : "has"
```

---

## 🔄 Data Flow: "Create a Twitter Email Collector"

```mermaid
sequenceDiagram
    actor User
    participant Ext as Extension Popup
    participant BG as Background.js
    participant API as Backend API
    participant AI as OpenRouter (AI)
    participant DB as MongoDB

    User->>Ext: "Create a tool that collects emails on Twitter"
    Ext->>BG: sendMessage({ type: 'buildTool', prompt: '...' })
    BG->>API: POST /api/ai/generate { prompt, token }
    API->>API: Verify JWT, check usage quota
    API->>AI: POST openrouter.ai/chat/completions
    Note over AI: AI generates:<br/>1. Content script (DOM scraping)<br/>2. Storage schema (emails[])<br/>3. UI components (panel, download btn)<br/>4. Site matcher (twitter.com/*)
    AI-->>API: Generated tool code + config
    API-->>BG: Tool blueprint
    BG-->>Ext: Display tool preview
    User->>Ext: Reviews & clicks "Accept & Save"
    Ext->>BG: sendMessage({ type: 'saveTool', tool: {...} })
    BG->>API: POST /api/tools { tool, token }
    API->>DB: tools.insertOne(tool)
    DB-->>API: Saved
    API-->>BG: { success: true, toolId }
    BG->>BG: Register tool's content script for twitter.com/*
    Note over BG: Tool is now active!<br/>When user visits Twitter,<br/>the email collector runs
```

---

## 🤖 AI System Prompt (for OpenRouter)

The AI that generates tools needs a very specific system prompt. Here's the design:

```
You are New Order — an AI that creates Chrome extension tools.

When the user describes what they want, you generate:
1. A content script (JavaScript) that runs on the target website
2. CSS styles for any UI you create
3. A configuration object with:
   - name: Tool name
   - targetSites: URL match patterns (e.g. ["*://twitter.com/*"])
   - permissions: Required Chrome permissions
   - storage: What data to store and its schema
   - ui: What UI elements to inject (panels, buttons, overlays)

RULES:
- Generated code must be self-contained
- Use vanilla JS only (no frameworks)
- All UI must be injected into the page DOM
- Data storage uses chrome.storage.local
- Include export/download functionality when collecting data
- Include a cleanup function to remove all injected elements
- Never access external APIs without user consent
- Code must handle errors gracefully
- Include descriptive console.log for debugging

OUTPUT FORMAT:
Return a JSON object:
{
  "name": "Tool Name",
  "description": "What this tool does",
  "targetSites": ["*://example.com/*"],
  "contentScript": "// full JS code here",
  "styles": "/* full CSS here */",
  "config": { ... },
  "storageSchema": { ... }
}
```

---

## 💰 Pricing Structure (Suggested)

| Plan | Price | AI Requests/Month | Tools Saved | Built-in Tools |
|------|-------|--------------------|-------------|----------------|
| Free | $0 | 0 | 0 | YouTube Tool only |
| Pro | $9.99/mo | 50 | 10 | All built-in |
| Unlimited | $24.99/mo | Unlimited | Unlimited | All + Priority AI |

---

## 🔑 What YOU Need to Set Up

Before I can build this, I need you to handle these external services:

### 1. OpenRouter API Key
- Go to [openrouter.ai](https://openrouter.ai)
- Create an account and get an API key
- Choose which models to use (suggested: `anthropic/claude-sonnet` or `openai/gpt-4o`)
- **Give me the API key** (or I'll use a placeholder)

### 2. MongoDB Atlas Database
- Go to [mongodb.com/atlas](https://mongodb.com/atlas)
- Create a free cluster
- Create a database called `neworder`
- Get the connection string: `mongodb+srv://username:password@cluster.xxxxx.mongodb.net/neworder`
- **Give me the connection string**

### 3. Domain / Hosting for API & Website
- Where will the backend API be hosted? Options:
  - **Vercel** (serverless functions — free tier available)
  - **Railway.app** (Node.js server — $5/mo)
  - **Render.com** (Node.js server — free tier)
  - **Your own VPS**
- Where will the auth/payment website be hosted?

### 4. Stripe Account (for payments)
- Go to [stripe.com](https://stripe.com)
- Create an account
- Get API keys (publishable + secret)
- **Give me the keys** (or I'll use test mode keys as placeholders)

### 5. Auth Strategy Decision
- **Option A**: Email/password (I build it, store in MongoDB)
- **Option B**: Google OAuth (need Google Cloud Console project)
- **Option C**: Both
- Which do you prefer?

---

## 📋 Implementation Phases

### Phase 1: Extension Restructure ⚡
- Reorganize extension files into the new structure
- Keep all YouTube functionality intact
- Add core framework (tool-manager, tool-runtime)
- Update manifest.json for broader permissions
- Redesign popup with "AI Builder" entry point

### Phase 2: Backend API Server 🖥️
- Set up Express server with routes
- OpenRouter integration with the tool-generation system prompt
- MongoDB models & CRUD operations
- JWT authentication middleware

### Phase 3: AI Tool Builder UI 🤖
- Build the chat-based tool builder interface
- Tool preview & testing sandbox
- Accept/reject/iterate workflow
- Tool storage & management

### Phase 4: Auth & Payment Website 💳
- User registration & login
- Stripe subscription integration
- Tool library dashboard
- Account management

### Phase 5: Polish & Launch 🚀
- Error handling & edge cases
- Rate limiting & abuse prevention
- Tool marketplace (users can share tools)
- Analytics & monitoring

---

## ⚠️ Important Decisions Needed

1. **Where should I start?** Phase 1 (extension restructure) or Phase 2 (backend first)?
2. **API keys** — Do you have the OpenRouter, MongoDB, and Stripe credentials ready?
3. **Hosting** — Where are we deploying the API and website?
4. **Auth method** — Email/password, Google OAuth, or both?
5. **Model choice** — Which AI model on OpenRouter? (affects cost and quality)

---

> [!IMPORTANT]
> I can start building **Phase 1** (restructuring the extension) right now without any API keys. The YouTube tool will continue to work exactly as before. Once you give me the API credentials, I'll wire up the backend and AI integration.

**Tell me your answers to the questions above, and I'll start building immediately.**
