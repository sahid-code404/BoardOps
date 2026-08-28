-- LedgerEntry.entityId is polymorphic by design (Payment, Bill, Refund, Adjustment, ...).
-- The bootstrap schema incorrectly constrained it to Payment(id), which prevents valid
-- Bill and Refund ledger entries when D1 foreign-key enforcement is enabled.
-- Rebuild the table without that invalid entityId foreign key while preserving the
-- real User ownership foreign key and all existing data/indexes.

PRAGMA defer_foreign_keys = on;

CREATE TABLE "new_LedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "runningBalance" REAL NOT NULL DEFAULT 0,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "description" TEXT NOT NULL,
    "billingMonth" INTEGER,
    "billingYear" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_LedgerEntry" (
    "id", "userId", "type", "amount", "runningBalance", "entityType", "entityId",
    "description", "billingMonth", "billingYear", "createdAt"
)
SELECT
    "id", "userId", "type", "amount", "runningBalance", "entityType", "entityId",
    "description", "billingMonth", "billingYear", "createdAt"
FROM "LedgerEntry";

DROP TABLE "LedgerEntry";
ALTER TABLE "new_LedgerEntry" RENAME TO "LedgerEntry";

CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");
CREATE INDEX "LedgerEntry_entityType_entityId_idx" ON "LedgerEntry"("entityType", "entityId");
CREATE INDEX "LedgerEntry_billingMonth_billingYear_idx" ON "LedgerEntry"("billingMonth", "billingYear");
