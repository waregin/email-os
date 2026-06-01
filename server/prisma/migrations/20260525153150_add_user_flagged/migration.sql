-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TriageDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleId" TEXT,
    "priority" TEXT NOT NULL,
    "digestSummary" TEXT NOT NULL,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedByUser" BOOLEAN NOT NULL DEFAULT false,
    "wasCorrect" BOOLEAN,
    "archivedAt" DATETIME,
    "userFlagged" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TriageDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TriageDecision_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TriageRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TriageDecision" ("archivedAt", "confirmedByUser", "decidedAt", "digestSummary", "id", "priority", "ruleId", "threadId", "userId", "wasCorrect") SELECT "archivedAt", "confirmedByUser", "decidedAt", "digestSummary", "id", "priority", "ruleId", "threadId", "userId", "wasCorrect" FROM "TriageDecision";
DROP TABLE "TriageDecision";
ALTER TABLE "new_TriageDecision" RENAME TO "TriageDecision";
CREATE INDEX "TriageDecision_threadId_idx" ON "TriageDecision"("threadId");
CREATE INDEX "TriageDecision_userId_archivedAt_idx" ON "TriageDecision"("userId", "archivedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
