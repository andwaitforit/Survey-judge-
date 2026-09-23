-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyConfigVersion" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "decisionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "checks" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "action" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "clarified" BOOLEAN NOT NULL,
    "providerError" TEXT,
    "missingChecks" TEXT[],
    "finalOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("decisionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "StudyConfigVersion_customerId_studyId_version_key" ON "StudyConfigVersion"("customerId", "studyId", "version");

-- CreateIndex
CREATE INDEX "Decision_customerId_studyId_createdAt_idx" ON "Decision"("customerId", "studyId", "createdAt");

-- CreateIndex
CREATE INDEX "Decision_studyId_sessionId_idx" ON "Decision"("studyId", "sessionId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyConfigVersion" ADD CONSTRAINT "StudyConfigVersion_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only decision log (CLAUDE.md rule 3). The one permitted UPDATE sets finalOutcome from
-- NULL to a value. Everything else is rejected. DELETE stays allowed for retention purges.
CREATE OR REPLACE FUNCTION decision_append_only() RETURNS trigger AS $$
BEGIN
  IF OLD."finalOutcome" IS NOT NULL THEN
    RAISE EXCEPTION 'Decision % is append-only: finalOutcome already set', OLD."decisionId";
  END IF;
  IF (to_jsonb(NEW) - 'finalOutcome') IS DISTINCT FROM (to_jsonb(OLD) - 'finalOutcome') THEN
    RAISE EXCEPTION 'Decision % is append-only: only finalOutcome may be set', OLD."decisionId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER decision_append_only
  BEFORE UPDATE ON "Decision"
  FOR EACH ROW EXECUTE FUNCTION decision_append_only();
