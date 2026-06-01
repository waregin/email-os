-- CreateTable
CREATE TABLE "CachedMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "toRecipients" TEXT NOT NULL DEFAULT '[]',
    "date" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "htmlBody" TEXT,
    "plaintextBody" TEXT,
    "isUnread" BOOLEAN NOT NULL,
    "labelIds" TEXT NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL,
    "cachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CachedMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ThreadCache" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CachedMessage_threadId_idx" ON "CachedMessage"("threadId");

-- CreateIndex
CREATE INDEX "CachedMessage_userId_idx" ON "CachedMessage"("userId");
