# Email OS — Fix Plan

Bugs first, then complexity/structural cleanup. Within each group, ordered by user-visible impact.

---

## Bugs

### B1 — `describeTrigger` handles obsolete trigger types
**File:** `client/src/utils/rules.ts:43–75`  
**Impact:** Any rule with a `subject_or_snippet_contains_any`, `subject_or_snippet_contains_all`, or a trigger with `subjectOrSnippetContainsAny`/`subjectOrSnippetContainsAll` secondary filters shows raw JSON in the TeachPanel instead of a readable description.  
**Fix:** Replace the stale `subject_contains` / `subject_or_body_contains` cases with the current trigger types. Add display logic for the secondary filter fields.  
**Status:** [x] Done

---

### B2 — Stale closure in `TeachPanel` auto-close effect
**File:** `client/src/App.tsx:391–394`  
**Impact:** After a rule is applied, the 2-second auto-close timer may call the stale `onDecisionsRefresh` or `onClose` callbacks captured at effect-registration time, potentially skipping the decisions refresh.  
**Fix:** Wrap `onDecisionsRefresh` and `onClose` in `useCallback` in `MainApp`, then remove the `eslint-disable-line` suppression and add them to the dependency array.  
**Status:** [x] Done

---

### B3 — `updateFavicon` never resets to plain icon at zero unread
**File:** `client/src/App.tsx:19–26`  
**Impact:** When all emails are read, the tab favicon keeps the last badge number rather than reverting to the plain envelope icon.  
**Fix:** Remove the dead-code guard entirely. Clamp `count` to zero via `Math.max(0, count)` to handle negatives; `0` displays as a badge. Fix `==` to `===` while here.  
**Status:** [x] Done

---

### B4 — `upsertCachedMessages` delete-then-create is non-atomic
**File:** `server/src/engine.ts:28–54`  
**Impact:** A crash or process kill between `deleteMany` and `createMany` permanently deletes cached messages for that thread. Low probability given SQLite is local, but silent data loss when it happens.  
**Fix:** Wrap both operations in a `prisma.$transaction`.  
**Status:** [ ] Open

---

## Structural Cleanup

### S1 — `describeTrigger` secondary-filter fields not described (related to B1 but separate)
**File:** `client/src/utils/rules.ts`  
**Impact:** Rules with `subjectOrSnippetContainsAny` / `subjectOrSnippetContainsAll` secondary filters on `sender_domain` / `sender` / `self_sent` triggers show no indication of the filter in the TeachPanel. Addressed as part of B1.  
**Status:** [ ] Open (tracked under B1)

---

### S2 — Duplicated Gmail client setup in `engine.ts` and `agent.ts`
**Files:** `server/src/engine.ts:94–107`, `server/src/agent.ts:139–157`  
**Impact:** Two identical blocks that create an OAuth client, apply credentials, and register a token-refresh listener. A change to token persistence logic must be made in both places.  
**Fix:** Extract a `buildGmailClient(user)` utility to `server/src/utils/auth.ts`. Both callers use it.  
**Status:** [ ] Open

---

### S3 — Duplicated cache resolution logic in `engine.ts` and `agent.ts`
**Files:** `server/src/engine.ts:155–214`, `server/src/agent.ts:285–311`  
**Impact:** The stale-check → conditional Gmail fetch → populate local vars pattern is written twice. `agent.ts` has a `fetchAndCacheThread` helper for the fetch half, but `engine.ts` doesn't use it.  
**Fix:** Extracted `resolveThreadMetadata` into `engine.ts` (handles both stale and fresh paths). `agent.ts` now imports and uses it; local `fetchAndCacheThread` removed.  
**Status:** [ ] Open

---

### S4 — Extra Gmail API call per decided thread on every triage pass
**File:** `server/src/engine.ts:139–147`  
**Impact:** For each thread that already has a decision, the engine calls `threads.get` (format: minimal) to check for a new last message. 50 decided threads = 50 extra API calls per 3-minute pass before any triage work starts.  
**Fix:** Cache the last-fetched Gmail `historyId` per user and use the Gmail History API (`users.history.list`) to get only changed threads since the last pass. If that's too large a refactor, at minimum batch the decided-thread list and filter using already-cached `CachedMessage` data before hitting the API.  
**Status:** [ ] Open

---

### S5 — `upsertCachedMessages` and `threadCache.upsert` duplicated between `engine.ts` and `agent.ts`
**Files:** `server/src/engine.ts:194–199`, `server/src/agent.ts:180–184`  
**Impact:** The `threadCache.upsert` call shape is copy-pasted. Addressed in part by S3; noting separately because the cache write itself (not just the fetch) is also duplicated inside `fetchAndCacheThread` vs. the inline block in `engine.ts`.  
**Fix:** Covered by S3.  
**Status:** [ ] Open (tracked under S3)

---

### S6 — 100ms sleep per matched thread has no explanation
**File:** `server/src/engine.ts:271`  
**Impact:** Adds up to 10 seconds of artificial delay for a 100-thread inbox. No comment explains it.  
**Fix:** Add a comment explaining it's a Gmail API rate-limit back-off. Consider moving it to after the `buildDigestSummary` (Anthropic) call instead, since that's the actual API call that follows. Or remove it if the rate limit has not been hit in practice.  
**Status:** [ ] Open

---

### S7 — Single-user scheduler with a global `started` flag blocks multi-user use
**File:** `server/src/scheduler.ts:5–6`, `server/src/index.ts:13–16`  
**Impact:** Only one user can ever have the scheduler running per server process. A second login does not start a scheduler for the second user.  
**Fix:** Replace the boolean `started` flag with a `Map<string, ReturnType<typeof setInterval>>` keyed by `userId`. `startScheduler` becomes idempotent per user.  
**Status:** [ ] Open

---

### S8 — Duplicate update logic in unmatched branch of `runTriagePass`
**File:** `server/src/engine.ts`  
**Impact:** Two separate conditions in the `else` (unmatched) branch both execute `prisma.triageDecision.update({ data: { lastMessageId } })` — one for legacy decisions with no `lastMessageId`, one for threads where a new message arrived but no rule matched. The logic is identical; maintaining them separately is unnecessary.  
**Fix:** Merge into `if (existing && (!existing.lastMessageId || newMessageArrived))`.  
**Status:** [ ] Open

---

## Progress Summary

| ID | Description | Status |
|----|-------------|--------|
| B1 | `describeTrigger` stale trigger types | Done |
| B2 | Stale closure in TeachPanel auto-close | Done |
| B3 | Favicon doesn't reset at zero unread | Done |
| B4 | Non-atomic `upsertCachedMessages` | Open |
| S2 | Duplicated Gmail client setup | Open |
| S3 | Duplicated cache resolution logic | Open |
| S4 | Extra API call per decided thread | Open |
| S6 | Unexplained 100ms sleep | Open |
| S7 | Single-user scheduler flag | Open |
| S8 | Duplicate update logic in unmatched branch | Open |
