-- AlterTable
ALTER TABLE "CachedMessage" ADD COLUMN "listId" TEXT;

-- AlterTable
ALTER TABLE "ThreadCache" ADD COLUMN "listId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TriageRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "categoryLabel" TEXT,
    "digestSummaryTemplate" TEXT NOT NULL,
    "notes" TEXT,
    "source" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parentId" TEXT,
    "pendingSuggestion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TriageRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TriageRule_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TriageRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TriageRule" ("action", "categoryLabel", "createdAt", "digestSummaryTemplate", "id", "notes", "priority", "source", "trigger", "updatedAt", "userId") SELECT "action", "categoryLabel", "createdAt", "digestSummaryTemplate", "id", "notes", "priority", "source", "trigger", "updatedAt", "userId" FROM "TriageRule";
DROP TABLE "TriageRule";
ALTER TABLE "new_TriageRule" RENAME TO "TriageRule";
CREATE INDEX "TriageRule_userId_isActive_idx" ON "TriageRule"("userId", "isActive");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
