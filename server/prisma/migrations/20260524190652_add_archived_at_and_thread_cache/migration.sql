-- AlterTable
ALTER TABLE "TriageDecision" ADD COLUMN "archivedAt" DATETIME;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "accessToken" TEXT;
ALTER TABLE "User" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "User" ADD COLUMN "tokenExpiry" DATETIME;

-- CreateTable
CREATE TABLE "ThreadCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "labelIds" TEXT NOT NULL,
    "cachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ThreadCache_userId_idx" ON "ThreadCache"("userId");

-- CreateIndex
CREATE INDEX "TriageDecision_threadId_idx" ON "TriageDecision"("threadId");

-- CreateIndex
CREATE INDEX "TriageDecision_userId_archivedAt_idx" ON "TriageDecision"("userId", "archivedAt");
