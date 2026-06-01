# Email OS

A personal Gmail triage system. It continuously scans your inbox, classifies threads by a rule set you define, and presents them in a structured digest view. When a thread doesn't match any rule, a built-in AI chat panel lets you teach the system a new one.

## How it works

A background scheduler runs every 3 minutes, fetching unread inbox threads from Gmail and matching each one against your triage rules. Matched threads are assigned a priority tier and stored as decisions. The UI presents decisions in a digest and unmatched threads in a raw inbox view.

**Priority tiers:**

| Tier | Label | Meaning |
|------|-------|---------|
| T1 | Immediate Attention | Requires action today |
| T2 | Action Required | Requires action, not urgent |
| T3 | Summarized | Read-only; gets an AI-generated digest summary |
| T4 | Browse | Low-signal; grouped by category |

**Rule triggers:**
- `sender_domain` — matches the sender's domain, with optional subject/snippet constraints
- `sender` — matches an exact sender address
- `self_sent` — matches email sent to yourself
- `subject_or_snippet_contains_any` — matches any of a list of keywords in subject or snippet
- `subject_or_snippet_contains_all` — matches all of a list of keywords
- `address` — matches a recipient address (useful for mailing lists)

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js v22, Express 5, TypeScript |
| Frontend | React 19, Vite, Tailwind CSS 4 |
| Database | SQLite via Prisma (better-sqlite3 adapter) |
| Gmail | Google APIs (OAuth2) |
| AI — teaching chat | Anthropic API (Claude Sonnet) |
| AI — digest summaries | Anthropic API (Claude Haiku) |
| Testing | Vitest |

## Setup

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

Create `server/.env`:

```env
# Google OAuth — create credentials at console.cloud.google.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback

# Anthropic
ANTHROPIC_API_KEY=...

# Session
SESSION_SECRET=any-random-string

# Optional — defaults shown
DATABASE_URL=file:./dev.db
PORT=3001
CLIENT_URL=http://localhost:5173
```

### 3. Run migrations and seed

```bash
cd server
npx prisma migrate deploy        # apply schema migrations
npx ts-node prisma/seed.ts       # seed user and rules
```

### 4. Start the app

In two terminals:

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and sign in with Google.

## Usage

### Digest

Decided threads appear in the four tier panels. For each thread you can:
- **Confirm** — acknowledge it
- **Done** — mark it handled and archive from the digest
- **Follow-up** — escalate a T3/T4 thread to T2
- **Misclassified** — mark it wrong and return it to the inbox for re-teaching

### Inbox

Threads that haven't matched any rule appear below the digest. Click a thread to expand it. Click **Teach** to open the teaching panel.

### Teaching new rules

The Teach panel is a chat interface powered by Claude. Describe what kind of email this is and how you want it handled. Claude will propose a rule; you can accept, revise, or ask for changes. Once confirmed, the rule is saved and immediately applied to matching threads already in your inbox.

## Development

```bash
# Server
cd server
npm run dev          # development server with hot reload (nodemon)
npm test             # run tests
npm run test:watch   # watch mode
npm run build        # compile TypeScript

# Client
cd client
npm run dev          # Vite dev server
npm test             # run tests
npm run build        # production build
```

## Project structure

```
email-os/
├── server/
│   ├── src/
│   │   ├── index.ts        # entry point, starts scheduler
│   │   ├── app.ts          # Express app setup
│   │   ├── engine.ts       # triage pass logic, thread cache
│   │   ├── matcher.ts      # rule matching engine
│   │   ├── scheduler.ts    # 3-minute polling loop
│   │   ├── agent.ts        # teaching chat API routes
│   │   ├── gmail.ts        # Gmail API routes + thread cache
│   │   ├── summarizer.ts   # AI digest summary generation
│   │   ├── auth.ts         # Google OAuth routes
│   │   └── middleware.ts   # session auth + token refresh
│   └── prisma/
│       ├── schema.prisma
│       ├── migrations/     # schema history
│       ├── seed.ts         # seeds user, profile, and rules
│       └── seed-rules.json # canonical rule definitions (83 rules)
└── client/
    └── src/
        ├── App.tsx          # main UI: digest + inbox + teach panel
        └── components/
            ├── DigestPanel.tsx   # tier panel with actions
            └── ThreadDetail.tsx  # expanded thread view
```
