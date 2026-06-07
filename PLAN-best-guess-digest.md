# Plan: AI-Powered Triage Pass + Enhanced Wrong Button

## Design Summary

The inbox panel is removed. The digest tiers become the entire interface. Every thread is classified — either by a user-confirmed rule or by the AI as a fallback — and appears in one of the five tier panels. T1–T4 are the existing tiers; T5 "Unclassified" is a new panel that appears only when the AI could not classify a thread, and disappears when empty. The "Wrong" button no longer bounces a thread back to an inbox; it opens the teach dialogue directly, with the target tier pre-selected and the agent leading with a hypothesis rather than a question. T5 items show a "Teach" button and are automatically re-evaluated on every triage pass until taught.

---

## Design Decisions Log

| Decision | Resolution |
|----------|-----------|
| Separate "Best Guess" panel vs. merged digest | Single digest — confirmed and AI-guessed decisions mixed in the same tier panels |
| Source naming | `"manual"` (direct) · `"taught"` (teach-agent confirmed) · `"ai_guess"` (AI auto-created) · promoted ai_guess → `"taught"` |
| ai_guess rules in triage pass | Yes — participate in the pass, always sorted after confirmed rules of the same tier |
| Rule priority ordering | Tier ASC → source rank (manual=1, taught=2, ai_guess=3) → createdAt ASC |
| AI classifier failure fallback | T5 decision, `ruleId = null`, no rule created |
| T5 "Unclassified" panel | New tier panel, hidden when empty; "Teach" button only (no Confirm, Followup, Done) |
| Unclassified decisions — re-checking | Engine skips threads where `archivedAt IS NULL AND ruleId IS NOT NULL`; null-ruleId threads always re-tried |
| "Wrong" button flow | Tier picker → teach dialogue pre-seeded with correct tier → agent leads with hypothesis → rule created on confirm |
| Teach flow — conflict avoidance | System prompt explicitly instructs agent to prefer `existingRuleId` modification over new rule creation when pattern overlaps an existing rule |
| Confirming an AI-guessed decision | Marks `wasCorrect: true` on the decision; rule stays `"ai_guess"` until health check or correction promotes it |
| Health check scope | All rules (manual, taught, ai_guess) — ai_guess rules auto-modified, taught/manual rules get a `pendingSuggestion` surfaced in a Rule Health UI section |
| Health check suggestions storage | `pendingSuggestion String?` field on `TriageRule` |
| Health check batch strategy | Poll interval (simpler, works in any environment, sufficient for a daily job); webhook noted as future option |
| Rule history / audit trail | `isActive Boolean` + `parentId String?` on `TriageRule`; modifications create a new row (new version) and set the old row `isActive = false` |
| Batch AI classification | Classifier accepts a list of threads; triage pass collects all unmatched threads and calls the classifier in chunks of ~10–15 |
| Rules settings panel | Deferred |
| Inbox removal | Teach access via "Wrong" / "Teach" button flows; proactive rule creation deferred to settings panel |

---

## Schema Changes

### TriageRule.source — updated valid values

| Value | Meaning |
|-------|---------|
| `"manual"` | User wrote the rule directly |
| `"taught"` | Confirmed via teach agent (renamed from `"agent"`) |
| `"ai_guess"` | Created automatically by the AI classifier; not yet user-validated |

### TriageRule — new fields

```prisma
isActive          Boolean  @default(true)
parentId          String?
parent            TriageRule?  @relation("RuleHistory", fields: [parentId], references: [id])
children          TriageRule[] @relation("RuleHistory")
pendingSuggestion String?  // JSON: { proposedTrigger, proposedPriority, proposedCategoryLabel?, reason, rejectionRate }
```

**`isActive`** — only active rules participate in the triage pass. Every rule query must filter `WHERE isActive = true`.

**`parentId`** — self-referential. When any rule is modified (by the teach agent, by the health check, or by accepting a Rule Health suggestion), the old row is set `isActive = false` and a new row is created with `parentId` pointing to the deactivated version. `TriageDecision.ruleId` keeps referencing the specific version that made the decision, preserving historical accuracy.

**`pendingSuggestion`** — written by the health check for taught/manual rules only. Cleared on Accept or Dismiss. ai_guess rules are auto-modified (never written here).

### TriageDecision — note on T5

`TriageDecision.priority` accepts any string. `"T5"` is a new valid value, used only for threads the AI could not classify. No schema migration needed.

### Migrations

1. **SQL** — run once before deploying any code that relies on the new source values:

```sql
UPDATE "TriageRule" SET source = 'taught' WHERE source = 'agent';
```

2. **Prisma migration** — add `isActive`, `parentId`, `pendingSuggestion` to `TriageRule`:

```
npx prisma migrate dev --name add-rule-history
```

All existing rules get `isActive = true` (the default). The `parentId` column is nullable, so existing rows are unaffected.

---

## Phase 1 — Rule Priority Ordering

**Modified: `server/src/engine.ts`**

Change rule-loading to filter active rules only, then sort:
1. `priority ASC` (T1 first)
2. Source rank: `manual=1`, `taught=2`, `ai_guess=3`
3. `createdAt ASC` (tiebreaker)

```typescript
const allRules = await prisma.triageRule.findMany({
  where: { userId, isActive: true },
  orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
});

const SOURCE_RANK: Record<string, number> = { manual: 1, taught: 2, ai_guess: 3 };

allRules.sort((a, b) => {
  if (a.priority !== b.priority) return a.priority.localeCompare(b.priority);
  const sa = SOURCE_RANK[a.source] ?? 99;
  const sb = SOURCE_RANK[b.source] ?? 99;
  if (sa !== sb) return sa - sb;
  return a.createdAt.getTime() - b.createdAt.getTime();
});
```

**Also update all other rule queries** (agent `/teach`, `/rules`, `/rules/:id/apply`) to add `isActive: true` to the Prisma `where` clause.

**Tests — `engine.test.ts`:**
- Inactive rule → not loaded; thread treated as unmatched.
- Confirmed rule and ai_guess rule both match → confirmed rule wins.
- Two confirmed rules of different tiers both match → lower tier number wins.
- Two ai_guess rules of the same tier → older one wins.

---

## Phase 2 — AI Classifier (Batched)

**New file: `server/src/classifier.ts`**

The classifier accepts a list of threads and returns classifications for all of them in a single prompt, reducing API call volume significantly.

```typescript
interface ThreadClassification {
  threadId: string;
  tier: string;               // T1 | T2 | T3 | T4
  categoryLabel?: string;     // required when tier = T4
  digestSummary: string;
  digestSummaryTemplate: string;
  trigger: object;
  existingRuleId?: string;    // set when modifying an existing ai_guess rule
}

classifyThreadsWithAI(
  threads: ThreadData[],
  existingRules: TriageRule[],
  anthropic: Anthropic
): Promise<Array<ThreadClassification | null>>
// Returns one result per input thread; null = AI could not classify
```

**Prompt structure:**
- System block (cacheable): tier definitions, existing ruleset, output format instructions, conflict-avoidance rules.
- User message (variable): JSON array of thread data objects.
- Response: JSON array of classification objects, one per thread, in the same order.

**Classifier prompt requirements:**
- Must not propose a rule that would overlap a confirmed rule.
- Must prefer modifying an existing ai_guess rule (`existingRuleId`) over creating a new one.
- Must include `categoryLabel` when assigning T4.
- May return `null` for a specific thread if classification is uncertain.

**Prompt caching** — the system block (tier definitions + full ruleset) is identical for every batch in a triage pass:

```typescript
const response = await anthropic.messages.create({
  model,
  max_tokens: 2048,
  system: [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    },
  ],
  messages: [{ role: 'user', content: JSON.stringify(threadBatch) }],
});
```

**Chunk size:** 10–15 threads per call. Balances context-sharing benefits (model can spot clusters and propose one rule for similar threads) against quality degradation at large batch sizes.

**Tests — `classifier.test.ts` (new file):**
- Single thread → returns array of length 1 with correct classification.
- Multiple threads, one AI-classifiable and one not → `[classification, null]`.
- Thread overlapping a confirmed rule → `null` for that thread.
- T4 classification → includes `categoryLabel`.
- Similar threads in the same batch → single `existingRuleId` modification proposed, not N new rules.
- Malformed AI response → all results in the chunk return `null`.
- Anthropic throws → all results in the chunk return `null`.

---

## Phase 3 — Triage Pass: AI Fallback + Dynamic Rule Creation

**Modified: `server/src/engine.ts` — `runTriagePass()`**

**Guard change:** skip threads where `archivedAt IS NULL AND ruleId IS NOT NULL`. Null-ruleId (T5/unclassified) decisions never block re-evaluation.

**Pass logic:**

```
Load active rules (isActive: true), sort per Phase 1.

Pass 1 — rule matching:
  For each inbox thread:
    Skip if active non-null-ruleId decision exists.
    Try matchThread(thread, rules).
    If matched: create TriageDecision, mark thread as resolved.

Collect remaining unmatched threads.

Pass 2 — AI classification (chunked):
  Split unmatched threads into chunks of ~10–15.
  For each chunk:
    Call classifyThreadsWithAI(chunk, rules, anthropic)
    For each result:
      If classification returned:
        If existingRuleId: deactivate old rule, create new version (parentId = old id).
        Else: create new TriageRule { source: 'ai_guess', isActive: true }.
        Append new/updated rule to in-memory rules (available for next chunk's overlap check).
        Archive any existing null-ruleId decision for this thread.
        Create TriageDecision linked to the rule.
      If null:
        Archive any existing null-ruleId decision for this thread.
        Create TriageDecision { priority: 'T5', ruleId: null }.
```

> **Inter-chunk rule awareness:** the in-memory `rules` array grows as ai_guess rules are created. Each subsequent chunk sees the new rules in the overlap-check context, preventing redundant rule creation across chunks in the same pass.

**Tests — `engine.test.ts`:**
- Unmatched thread → ai_guess rule created; decision linked to it.
- Two similar threads in same pass → second matches the newly created rule, no second AI call.
- AI classifier returns null → T5 decision created; no rule created.
- Confirmed rule and ai_guess rule both eligible → confirmed rule wins.
- Thread with existing T5 (null-ruleId) decision → old decision archived before new one created.
- Thread with existing non-null-ruleId active decision → skipped.
- Inactive rule → ignored during matching.

---

## Phase 4 — Teach Agent: Prompt Caching + Conflict Avoidance + Audit Trail

**Modified: `server/src/agent.ts`**

**Prompt caching** — system prompt uses `cache_control`:

```typescript
const completion = await anthropic.messages.create({
  model,
  max_tokens: 1024,
  system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
  messages: apiMessages,
});
```

**Conflict avoidance** — add to `SYSTEM_PROMPT_BASE`:

> Before proposing a new rule, review the existing rules listed above. If an existing rule could be modified to handle this case, include its id as `existingRuleId` and update it rather than creating a duplicate. Never propose a rule whose trigger would match a strict subset of threads already caught by a confirmed rule at the same or higher priority.

**Audit trail** — update the `/rules` save endpoint: when `existingRuleId` is provided, don't `update` the existing row — deactivate it and create a new version:

```typescript
if (rule.existingRuleId) {
  const existing = await prisma.triageRule.findUnique({ where: { id: rule.existingRuleId } });
  if (!existing || existing.userId !== userId) { res.status(404)...; return; }

  await prisma.triageRule.update({
    where: { id: rule.existingRuleId },
    data: { isActive: false },
  });
  savedRule = await prisma.triageRule.create({
    data: { userId, source: 'taught', parentId: rule.existingRuleId, isActive: true, ...ruleData },
  });
} else {
  savedRule = await prisma.triageRule.create({
    data: { userId, source: 'taught', isActive: true, ...ruleData },
  });
}
```

Also update **rule injection** in `/teach` to filter `isActive: true`.

**Tests — `agent.test.ts`:**
- Save new rule → `isActive: true`, `parentId: null`.
- Save with `existingRuleId` → old rule `isActive: false`; new rule `isActive: true`, `parentId = old id`.
- New rule version appears in subsequent rule injections; old version does not.
- Prompt caching: system prompt `cache_control` block present in Anthropic call args.

---

## Phase 5 — "Wrong" Button + "Teach" Button: Teach Dialogue Flow

Both buttons open the same teach dialogue. Differences are the label and tier-picker presentation.

**Flow:**

```
User clicks "Wrong" (classified item) or "Teach" (T5 unclassified item)
  → Inline tier picker (T1 / T2 / T3 / T4 / ✕ cancel)
    - "Wrong": current tier visually marked as incorrect.
    - "Teach": no pre-marked tier.

User clicks a tier
  → Teach dialogue opens (existing TeachPanel)
  → Thread context pre-filled
  → userContext injected: "The user has indicated this thread belongs in [correctTier].
     Skip clarifying questions and immediately propose a rule with a brief explanation."
  → Agent leads with hypothesis + RULE_PROPOSAL block

User confirms or refines (multi-turn)
  → On rule save (source: 'taught'):
       - Archive old decision.
       - New decision created via rules/apply endpoint.
```

**Frontend changes — `DigestPanel.tsx` / `DigestItemRow`:**
- "Wrong" → show tier picker; current tier visually marked.
- "Teach" (T5 items only) → show tier picker; no pre-marked tier.
- Tier selection → `onOpenTeach(thread, { correctTier })`.
- Item stays in snapshot until teach panel saves; then `onMisclassified` archives it.
- Cancel → restore original button; no API calls.
- T5 items: "Teach" button only — no Confirm, Followup, Done, or Wrong.

**Frontend changes — `App.tsx`:**
- `handleOpenTeach(thread, opts)` passes `correctTier` into teach panel via `userContext`.
- `handleMisclassified` called post-rule-save, not directly from button click.

**Tests — `DigestPanel.test.tsx`:**
- "Wrong" renders tier picker; current tier visually marked.
- "Teach" on T5 item renders tier picker; no pre-marked tier.
- ✕ cancels; no callbacks fired.
- Tier selection calls `onOpenTeach` with correct thread and `correctTier`.
- Item remains in snapshot during tier-picker state.
- Item removed after `onMisclassified` called post-rule-save.
- T5 items: only "Teach" button rendered.

**Tests — `App.decisions.test.tsx`:**
- `handleOpenTeach` with `correctTier` injects correct `userContext`.
- After rule save, `misclassifiedDecision` called for the original decision.

---

## Phase 6 — Frontend: T5 Panel + Remove Inbox

**Modified: `client/src/App.tsx`**

- Add `t5Decisions` state (array of T5 items, fetched alongside T1–T4 decisions).
- Render a `T5Panel` component after T4, conditionally: only when `t5Decisions.length > 0`.
- Remove `inboxThreads` derived state and its `<section>`.
- Remove `ThreadRow` usage (delete if unused).
- Keep threads fetch (still needed for thread detail views).

**New component: `T5Panel`** (or `DigestPanel` with `tier="T5"` and `hideWhenEmpty`)

UI spec:
- Label: "Unclassified"
- Accent: muted gray or warning amber (distinct from T4 Browse)
- Each item: sender, date, snippet
- Per-item buttons: "Teach" only
- No "Confirm all" footer
- Panel not rendered when empty (not collapsed — fully absent)

**Tests — `App.test.tsx`:**
- T5 panel not rendered when `t5Decisions` is empty.
- T5 panel rendered when `t5Decisions` has items.
- No inbox section rendered.
- Teach panel opens from "Teach" on a T5 item.

---

## Phase 7 — Rule Health Check

**New: scheduled job (`server/src/health-check.ts`)**

Runs daily. Uses Anthropic **Message Batches API** with poll-interval completion check.

```
For each active rule:
  rejection_ratio = wasCorrect:false / total decisions (last 30 days)
  if rejection_ratio > 0.3 AND total_decisions >= 5:
    Add to batch: rule + sample rejected threads + modification instruction

Submit batch. Poll GET /v1/message_batches/{id} until status = 'ended'.

For each result:
  if rule.source == 'ai_guess':
    Deactivate old rule; create new version (parentId = old id). isActive: true.
  if rule.source == 'taught' or 'manual':
    Write to rule.pendingSuggestion (no rule change yet).
```

**Batch note:** webhook support deferred; polling is sufficient for a daily job.

**Rule Health UI** (renders only when ≥1 rule has non-null `pendingSuggestion`):

```
⚠ Rule Health
┌──────────────────────────────────────────────────────────┐
│ From @github.com → T3    40% rejection rate              │
│ Suggested: narrow to subject contains "notification" → T4│
│ [Accept]  [Dismiss]                                      │
└──────────────────────────────────────────────────────────┘
```

- **Accept** → deactivate old rule; create new version with `parentId`; clear `pendingSuggestion`.
- **Dismiss** → clear `pendingSuggestion` only.
- Endpoints: `POST /api/agent/rules/:ruleId/suggestion/accept` and `/dismiss`.

**Tests — `health-check.test.ts`:**
- Rule above threshold with sufficient samples → in batch.
- ai_guess rule → old version deactivated, new version created with parentId; `pendingSuggestion` null.
- taught rule → `pendingSuggestion` written; rule trigger unchanged.
- Insufficient sample size → skipped.
- Batch returns no change needed → rule unchanged.

**Tests — `agent.test.ts`:**
- Accept → deactivates old rule, creates new version with parentId, clears `pendingSuggestion`.
- Dismiss → clears `pendingSuggestion` only; rule not versioned.

---

## Additional V2 Items

These are independent of the main phases and can be implemented in any order alongside them.

### Fix: Thread Sorting (issues #2, #13)

**Scope:** T1, T2, T3, and T5 should all display threads oldest-first (most overdue at the top). T4 Browse is grouping-based so ordering there is by group, then oldest-first within a group.

**Where to fix:** the `GET /api/gmail/decisions` endpoint currently returns decisions in `decidedAt` order. Sort should instead be by the thread's received date (`thread.date`), ascending. Fix in the endpoint query / post-processing, and apply the same sort to T5 decisions.

**Tests:** `gmail-decisions.test.ts` — decisions returned in thread-date ascending order for T1–T3; same for T5 endpoint.

---

### Fix: Links Don't Work In-Page (issue #1)

Clicking a link inside a thread detail opens the URL in the same tab, navigating away from the app. Fix: ensure all links rendered inside `ThreadDetail` / the HTML email body open in a new tab (`target="_blank"` + `rel="noopener noreferrer"`). The current `prepareHtml` utility in `client/src/utils/html.ts` is the right place to inject this.

**Tests:** `html.test.ts` — `prepareHtml` adds `target="_blank"` and `rel="noopener noreferrer"` to all `<a>` tags.

---

### Fix: Favicon (issue #4)

Replace the current SVG-with-dynamic-background-logic favicon with a static image. Research note from the issue: weigh pros/cons before doing this. The main trade-off is that a static image is simpler and more reliable across browsers, but loses any dynamic state indicator. For v2 this is cosmetic — use a static image.

**No tests needed.**

---

### Feature: Match on Sender Display Name (issue #10)

Add a new trigger type so rules can match on the display name portion of a sender address (e.g. `"John Smith"` from `"John Smith <john@example.com>"`).

**New trigger format:**
```json
{ "type": "sender_display_name_contains", "pattern": "string" }
```
Case-insensitive substring match on the display name. Falls back to the full sender string if no display name is present.

**Changes:**
- `server/src/matcher.ts` — add `sender_display_name_contains` to `TRIGGER_TYPES` and match logic; add `senderDisplayName` field to `ThreadData`.
- `server/src/utils/thread-cache.ts` — add `extractDisplayName(sender: string)` utility.
- `server/src/engine.ts` — populate `senderDisplayName` in `threadData` objects.
- `server/src/agent.ts` — add trigger format to `SYSTEM_PROMPT_BASE`.
- `client/src/utils/rules.ts` — add `describeTrigger` case for the new type.

**Tests:**
- `matcher.test.ts` — `sender_display_name_contains` matches display name; case-insensitive; no match on email address alone; falls back correctly when no display name.
- `rules.test.ts` — `describeTrigger` formats the new trigger type correctly.
- `agent.test.ts` — system prompt includes the new trigger format.

---

### Feature: Mailing List Header Matching (issue #6)

Expose `List-ID` (and optionally `List-Unsubscribe`) from Gmail message headers so rules can target mailing lists reliably — more stable than sender domain or subject patterns.

**New trigger format:**
```json
{ "type": "list_id", "listId": "string" }
```
Exact match on the `List-ID` header value (normalized: strip `<>` wrapping if present).

**Changes:**
- `server/prisma/schema.prisma` — add `listId String?` to `ThreadCache` and `CachedMessage`. New Prisma migration required.
- `server/src/utils/thread-cache.ts` — extract `List-ID` header when fetching/caching messages; store on `CachedMessage`.
- `server/src/matcher.ts` — add `list_id` trigger type; add `listId` to `ThreadData`.
- `server/src/engine.ts` — populate `listId` in `threadData`.
- `server/src/agent.ts` — add trigger format to `SYSTEM_PROMPT_BASE`.
- `client/src/utils/rules.ts` — add `describeTrigger` case.

**Tests:**
- `matcher.test.ts` — `list_id` trigger matches exact value; no match on different value; no match when header absent.
- `thread-cache.test.ts` — `List-ID` header extracted and stored correctly; normalised (strips `<>`).

---

### Feature: In-Page Refresh (issue #14)

Add a refresh button to the page header that re-fetches decisions and threads without a full page reload. The existing `handleDecisionsRefresh` callback already exists in `App.tsx`; this is purely a UI addition.

**Changes:**
- `client/src/App.tsx` — add a refresh icon button in the header; wire to `handleDecisionsRefresh` (and re-fetch threads).
- Show a brief loading state while fetching.

**Tests:** `App.test.tsx` — clicking refresh button calls the fetch functions; loading indicator shown during fetch.

---

### Feature: Followup Note (issue #15)

When a user clicks Followup on a T3/T4 item, open a small inline text input so they can record _why_ they're following up (e.g. "Reply with pricing by Friday"). That note becomes the `digestSummary` for the resulting T2 decision, replacing the generic T3/T4 summary.

**Changes:**
- `client/src/components/DigestPanel.tsx` — clicking Followup on a T3/T4 item shows a one-line text input inline (pre-populated with subject/snippet for context) with Confirm and Cancel buttons instead of immediately calling `onFollowup`.
- `client/src/api.ts` — extend the `followupDecision` API call to accept an optional `note: string`.
- `server/src/gmail.ts` — `POST /api/gmail/decisions/:id/followup` accepts optional `note` in body; if provided, updates `digestSummary` to the note value when updating the decision.

**Tests:**
- `DigestPanel.test.tsx` — clicking Followup shows inline text input; submitting calls `onFollowup` with the note; cancel restores the item without calling `onFollowup`.
- `gmail-decisions.test.ts` — followup with note updates `digestSummary`; followup without note leaves `digestSummary` unchanged.

---

## Implementation Order

| Step | Scope |
|------|-------|
| ~~1~~ | ~~Migration SQL (`agent` → `taught`)~~ ✓ |
| ~~2~~ | ~~Prisma migration: `isActive`, `parentId`, `pendingSuggestion` on `TriageRule`; `listId` on `ThreadCache` / `CachedMessage`~~ ✓ |
| ~~3~~ | ~~Phase 1: Rule priority ordering; add `isActive: true` filter to all rule queries~~ ✓ |
| ~~4~~ | ~~Fix: thread sorting T1–T4 (T5 inherits same logic when built in step 15)~~ ✓ |
| ~~5~~ | ~~Feature: sender display name trigger~~ ✓ |
| ~~6~~ | ~~Feature: mailing list header trigger~~ ✓ |
| ~~7~~ | ~~Phase 2: `classifier.ts` (batched) + unit tests~~ ✓ |
| ~~8~~ | ~~Phase 3: Triage pass AI fallback + T5 decisions + integration tests~~ ✓ |
| ~~9~~ | ~~Phase 4: Prompt caching + conflict avoidance + audit trail in `/rules` endpoint~~ ✓ |
| 10 | Fix: links open in new tab (`prepareHtml`) |
| 11 | Fix: favicon static image |
| 12 | Feature: in-page refresh button |
| 13 | Feature: followup note |
| 14 | Phase 5: "Wrong" / "Teach" button flows + tests |
| 15 | Phase 6: T5 panel + remove inbox panel + tests |
| 16 | Phase 7: Health check + Rule Health UI + tests |

Backend steps (3–9) are fully implementable and testable before touching the frontend.

---

## Open Questions

- Health check polling interval: daily seems right; could be a `UserProfile` setting later.
- Webhook for batch processing: add if a real-time bulk "classify all" UI feature is built.
- Source value for ai_guess rules that accumulate enough `wasCorrect: true` confirmations without a health-check event — should repeated user confirmations alone eventually promote a rule from `ai_guess` to `taught`? If so, what threshold?
