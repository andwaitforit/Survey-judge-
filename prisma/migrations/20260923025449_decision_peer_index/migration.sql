-- DropIndex
DROP INDEX "Decision_studyId_sessionId_idx";

-- CreateIndex
CREATE INDEX "Decision_customerId_studyId_sessionId_idx" ON "Decision"("customerId", "studyId", "sessionId");

-- CreateIndex
CREATE INDEX "Decision_customerId_studyId_questionId_createdAt_idx" ON "Decision"("customerId", "studyId", "questionId", "createdAt");
