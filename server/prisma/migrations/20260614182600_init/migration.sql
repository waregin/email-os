-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageRule" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriageRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageDecision" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleId" TEXT,
    "priority" TEXT NOT NULL,
    "digestSummary" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedByUser" BOOLEAN NOT NULL DEFAULT false,
    "wasCorrect" BOOLEAN,
    "archivedAt" TIMESTAMP(3),
    "userFlagged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TriageDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "labelIds" TEXT NOT NULL,
    "toAddresses" TEXT NOT NULL DEFAULT '',
    "listId" TEXT,
    "htmlBody" TEXT,
    "plaintextBody" TEXT,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreadCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CachedMessage" (
    "id" TEXT NOT NULL,
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
    "listId" TEXT,
    "position" INTEGER NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CachedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "TriageRule_userId_isActive_idx" ON "TriageRule"("userId", "isActive");

-- CreateIndex
CREATE INDEX "TriageDecision_threadId_idx" ON "TriageDecision"("threadId");

-- CreateIndex
CREATE INDEX "TriageDecision_userId_archivedAt_idx" ON "TriageDecision"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "ThreadCache_userId_idx" ON "ThreadCache"("userId");

-- CreateIndex
CREATE INDEX "CachedMessage_threadId_idx" ON "CachedMessage"("threadId");

-- CreateIndex
CREATE INDEX "CachedMessage_userId_idx" ON "CachedMessage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key_key" ON "UserProfile"("userId", "key");

-- AddForeignKey
ALTER TABLE "TriageRule" ADD CONSTRAINT "TriageRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageRule" ADD CONSTRAINT "TriageRule_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TriageRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageDecision" ADD CONSTRAINT "TriageDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageDecision" ADD CONSTRAINT "TriageDecision_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TriageRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CachedMessage" ADD CONSTRAINT "CachedMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ThreadCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
