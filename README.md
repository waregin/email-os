# Email OS

A personal Gmail triage system. It continuously scans your inbox, classifies every thread, and presents the results in a structured digest. Threads that match a rule you've taught are classified instantly; anything left over is classified by an AI fallback, and the few threads the AI can't place land in an "Unclassified" panel where you can teach a rule in one step.

## How it works

A background scheduler runs every 3 minutes per signed-in user. Each pass fetches unread inbox threads from Gmail and processes them in two stages:

1. **Rule matching** — each thread is matched against your active triage rules. A match produces a decision with a priority tier.
2. **AI classification** — threads that match no rule are sent to an AI classifier (in batches) that proposes a tier and a reusable rule. Accepted guesses become `ai_guess` rules so similar threads match instantly next time. Threads the AI declines to classify become **T5 Unclassified**.

A separate **rule health check** runs daily: rules with a high user-rejection rate get an AI-proposed refinement. For `ai_guess` rules the refinement is applied automatically; for rules you taught, it surfaces as a suggestion you can accept or dismiss in the Rule Health panel.

**Priority tiers:**

| Tier | Label | Meaning |
|------|-------|---------|
| T1 | Immediate Attention | Requires action today |
| T2 | Action Required | Requires action, not urgent |
| T3 | Summarized | Read-only; gets an AI-generated digest summary |
| T4 | Browse | Low-signal; grouped by category |
| T5 | Unclassified | AI couldn't classify; teach a rule (panel hidden when empty) |

**Rule sources:** `manual` (written directly) · `taught` (confirmed via the teaching chat) · `ai_guess` (created by the AI classifier, not yet user-validated). When two rules match the same thread, the lower tier number wins, then `manual` over `taught` over `ai_guess`, then oldest first. Rules are versioned: editing a rule deactivates the old row and creates a new one linked by `parentId`, so historical decisions keep pointing at the version that made them.

**Rule triggers:**
- `sender_domain` — matches the sender's domain, with optional subject/snippet constraints
- `sender` — matches an exact sender address
- `sender_name_contains` — matches a substring of the sender's display name
- `self_sent` — matches email sent to yourself
- `subject_or_snippet_contains_any` — matches any of a list of keywords in subject or snippet
- `subject_or_snippet_contains_all` — matches all of a list of keywords
- `address` — matches a recipient address (useful for mailing lists)
- `list_id` — matches a mailing list's `List-ID` header (stable newsletter identity)

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js v22, Express 5, TypeScript |
| Frontend | React 19, Vite, Tailwind CSS 4 |
| Database | PostgreSQL via Prisma (pg adapter) |
| Gmail | Google APIs (OAuth2) |
| AI — teaching chat | Anthropic API (Claude Sonnet) |
| AI — digest summaries / classification | Anthropic API (Claude Haiku) |
| Testing | Vitest |

## Setup

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

Installing the server runs `prisma generate` automatically (a `postinstall` hook), so the Prisma client is always present.

### 2. Start Postgres

The repo ships a `docker-compose.yml` that runs Postgres 16 and creates two databases — `emailos_dev` (the app) and `emailos_test` (the test suite):

```bash
docker compose up -d
```

This is the only external service you need. To point at a managed Postgres instead, just set `DATABASE_URL` accordingly.

### 3. Configure environment

Create `server/.env`:

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/emailos_dev

# Google OAuth — create credentials at console.cloud.google.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback

# Anthropic
ANTHROPIC_API_KEY=...

# Session
SESSION_SECRET=any-random-string

# Optional — defaults shown
PORT=3001
CLIENT_URL=http://localhost:5173
```

### 4. Run migrations and seed

```bash
cd server
npm run migrate:deploy   # apply schema migrations
npm run seed             # seed user, profile, and rules
```

### 5. Start the app

In two terminals:

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and sign in with Google.

### Migrating from an old SQLite dev.db

Earlier versions used SQLite. To move existing data (rules, decisions, cache) from a local `dev.db` into Postgres, run the schema migration first, then the one-time copy script:

```bash
cd server
npm run migrate:deploy
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/emailos_dev \
  npx ts-node --project tsconfig.seed.json prisma/migrate-from-sqlite.ts ./dev.db
```

The script preserves primary keys and is safe to re-run.

## Usage

### Digest

Every classified thread appears in its tier panel. For each thread you can:
- **Confirm** — acknowledge it (marks an `ai_guess` decision as correct)
- **Done** — mark it handled and archive it from the digest
- **Followup** — escalate a T3/T4 thread to T2, optionally with a note that becomes its summary
- **Wrong** — open an inline tier picker; choosing the correct tier opens the teaching chat pre-seeded with that tier so the agent leads with a rule proposal

T3/T4 items also offer inline **Fix summary** and **Fix category** corrections.

### Unclassified (T5)

When the AI can't classify a thread it appears in the Unclassified panel (shown only when non-empty) with a single **Teach** button. T5 threads are re-evaluated on every pass until a rule classifies them.

### Teaching new rules

The teaching panel is a chat interface powered by Claude. Describe what kind of email this is and how you want it handled; Claude proposes a rule (preferring to refine an existing rule over creating a duplicate). Once confirmed, the rule is saved and immediately applied to matching threads already in your inbox.

### Rule Health

When the daily health check flags a taught rule with a high rejection rate, a Rule Health panel surfaces the suggested refinement with **Accept** (apply as a new version) and **Dismiss** (keep the current rule).

## Development

```bash
# Server
cd server
npm run dev            # development server with hot reload (nodemon)
npm test               # run tests (needs the emailos_test database; docker compose up)
npm run test:watch     # watch mode
npm run build          # compile TypeScript

# Client
cd client
npm run dev            # Vite dev server
npm run lint           # ESLint
npm test               # run tests
npm run build          # production build
```

Tests run against the real `emailos_test` Postgres database. The test harness drops and recreates the schema before each run, so make sure `docker compose up -d` is running first. CI (`.github/workflows/ci.yml`) does the same against a Postgres service container.

## Project structure

```
email-os/
├── docker-compose.yml      # local Postgres (dev + test databases)
├── server/
│   ├── src/
│   │   ├── index.ts        # entry point; resumes schedulers for all users
│   │   ├── app.ts          # Express app setup
│   │   ├── engine.ts       # triage pass: rule match → AI fallback → decisions
│   │   ├── matcher.ts      # rule matching engine
│   │   ├── classifier.ts   # batched AI classification of unmatched threads
│   │   ├── scheduler.ts    # 3-minute triage loop + daily health check
│   │   ├── health-check.ts # rule rejection analysis + AI refinement
│   │   ├── agent.ts        # teaching chat API routes
│   │   ├── gmail.ts        # Gmail API routes + thread cache
│   │   ├── summarizer.ts   # AI digest summary generation
│   │   ├── auth.ts         # Google OAuth routes
│   │   ├── db.ts           # Prisma client (pg adapter)
│   │   ├── middleware.ts   # session auth + token refresh
│   │   └── utils/          # auth, gmail, thread-cache helpers
│   └── prisma/
│       ├── schema.prisma
│       ├── migrations/             # schema history (PostgreSQL)
│       ├── seed.ts                 # seeds user, profile, and rules
│       ├── seed-rules.json         # canonical rule definitions
│       └── migrate-from-sqlite.ts  # one-time SQLite → Postgres data copy
└── client/
    └── src/
        ├── App.tsx          # main UI: tier panels + teach panel
        └── components/
            ├── DigestPanel.tsx     # tier panel with per-item actions
            ├── ThreadDetail.tsx    # expanded thread view
            └── RuleHealthPanel.tsx # accept/dismiss rule suggestions
```
