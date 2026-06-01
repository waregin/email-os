-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ThreadCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "labelIds" TEXT NOT NULL,
    "toAddresses" TEXT NOT NULL DEFAULT '',
    "htmlBody" TEXT,
    "plaintextBody" TEXT,
    "cachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ThreadCache" ("cachedAt", "date", "htmlBody", "id", "labelIds", "plaintextBody", "sender", "snippet", "subject", "updatedAt", "userId") SELECT "cachedAt", "date", "htmlBody", "id", "labelIds", "plaintextBody", "sender", "snippet", "subject", "updatedAt", "userId" FROM "ThreadCache";
DROP TABLE "ThreadCache";
ALTER TABLE "new_ThreadCache" RENAME TO "ThreadCache";
CREATE INDEX "ThreadCache_userId_idx" ON "ThreadCache"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
