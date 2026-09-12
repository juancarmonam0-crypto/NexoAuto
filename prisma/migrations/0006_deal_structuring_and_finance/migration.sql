-- Phase 9B — deal structuring, payment modes and the finance engine.
--
-- SCOPE: this migration ONLY adds what the canonical engine needs to persist a
-- structured deal. No existing table, column, index or constraint is dropped,
-- renamed or rewritten. Every new money column is NULLable, so existing rows
-- keep their meaning and no backfill is required.
--
-- RATE POLICY NOTE: `ratePolicyId`, `ratePolicyCeilingBasisPoints` and
-- `ratePolicyEvaluatedAt` record WHICH configured policy was checked and WHEN.
-- They are an audit trail, not a legal certification, and the software must
-- never present them as one.

-- ---------------------------------------------------------------------------
-- 1. Lease-to-own is a distinct product, not a lease.
-- ---------------------------------------------------------------------------
-- PostgreSQL 12+ allows ADD VALUE inside a transaction, which is how Prisma
-- Migrate runs a migration file. The new value is not USED in this transaction,
-- which PostgreSQL requires, so this is safe on the versions we target.
ALTER TYPE "FinanceType" ADD VALUE IF NOT EXISTS 'LEASE_TO_OWN';

-- ---------------------------------------------------------------------------
-- 2. Payment frequency.
-- ---------------------------------------------------------------------------
CREATE TYPE "PaymentFrequency" AS ENUM ('MONTHLY', 'SEMIMONTHLY', 'BIWEEKLY', 'WEEKLY');

-- ---------------------------------------------------------------------------
-- 3. Structured terms on the deal.
-- ---------------------------------------------------------------------------
ALTER TABLE "deals"
  ADD COLUMN "paymentFrequency" "PaymentFrequency" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "paymentAmountCents" INTEGER,
  ADD COLUMN "finalPaymentCents" INTEGER,
  ADD COLUMN "numberOfPayments" INTEGER,
  ADD COLUMN "firstPaymentDate" TIMESTAMP(3),
  ADD COLUMN "salesTaxCents" INTEGER,
  ADD COLUMN "financeChargeCents" INTEGER,
  ADD COLUMN "totalOfPaymentsCents" INTEGER,
  ADD COLUMN "remainingBalanceCents" INTEGER,
  ADD COLUMN "tradeInPayoffCents" INTEGER,
  ADD COLUMN "capitalizedCostCents" INTEGER,
  ADD COLUMN "capCostReductionCents" INTEGER,
  ADD COLUMN "residualValueCents" INTEGER,
  ADD COLUMN "moneyFactorAprBasisPoints" INTEGER,
  ADD COLUMN "purchaseOptionCents" INTEGER,
  ADD COLUMN "ratePolicyId" TEXT,
  ADD COLUMN "ratePolicyCeilingBasisPoints" INTEGER,
  ADD COLUMN "ratePolicyEvaluatedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 4. Integrity constraints.
--
-- These are the invariants the engine guarantees, enforced by the database so a
-- future writer cannot quietly break them.
-- ---------------------------------------------------------------------------
ALTER TABLE "deals"
  -- No structured money field may be negative.
  ADD CONSTRAINT "deals_structured_money_non_negative" CHECK (
    ("paymentAmountCents" IS NULL OR "paymentAmountCents" >= 0)
    AND ("finalPaymentCents" IS NULL OR "finalPaymentCents" >= 0)
    AND ("numberOfPayments" IS NULL OR "numberOfPayments" >= 0)
    AND ("salesTaxCents" IS NULL OR "salesTaxCents" >= 0)
    AND ("financeChargeCents" IS NULL OR "financeChargeCents" >= 0)
    AND ("totalOfPaymentsCents" IS NULL OR "totalOfPaymentsCents" >= 0)
    AND ("remainingBalanceCents" IS NULL OR "remainingBalanceCents" >= 0)
    AND ("tradeInPayoffCents" IS NULL OR "tradeInPayoffCents" >= 0)
    AND ("capitalizedCostCents" IS NULL OR "capitalizedCostCents" >= 0)
    AND ("capCostReductionCents" IS NULL OR "capCostReductionCents" >= 0)
    AND ("residualValueCents" IS NULL OR "residualValueCents" >= 0)
    AND ("purchaseOptionCents" IS NULL OR "purchaseOptionCents" >= 0)
    AND ("amountFinancedCents" IS NULL OR "amountFinancedCents" >= 0)
  ),
  -- A payment schedule is a positive number of payments, within the engine's
  -- sanity bound (10 years of weekly payments).
  ADD CONSTRAINT "deals_payment_schedule_sane" CHECK (
    "numberOfPayments" IS NULL OR ("numberOfPayments" >= 1 AND "numberOfPayments" <= 520)
  ),
  -- The engine's arithmetic invariant: the total of payments IS the amount
  -- financed plus the finance charge. Verified cent-exactly when all three are
  -- recorded, so a hand-edited row cannot disagree with the contract.
  ADD CONSTRAINT "deals_payments_arithmetic" CHECK (
    "amountFinancedCents" IS NULL
    OR "financeChargeCents" IS NULL
    OR "totalOfPaymentsCents" IS NULL
    OR "totalOfPaymentsCents" = "amountFinancedCents" + "financeChargeCents"
  ),
  -- A financed amount cannot exceed the sum of every payment by more than the
  -- finance charge allows; i.e. a recorded schedule may not under-collect.
  ADD CONSTRAINT "deals_total_of_payments_covers_principal" CHECK (
    "amountFinancedCents" IS NULL
    OR "totalOfPaymentsCents" IS NULL
    OR "totalOfPaymentsCents" >= "amountFinancedCents"
  ),
  -- Lease / lease-to-own structure sanity.
  ADD CONSTRAINT "deals_lease_structure_sane" CHECK (
    ("moneyFactorAprBasisPoints" IS NULL OR ("moneyFactorAprBasisPoints" >= 0 AND "moneyFactorAprBasisPoints" <= 6000))
    AND ("residualValueCents" IS NULL OR "capitalizedCostCents" IS NULL OR "residualValueCents" <= "capitalizedCostCents")
    AND ("capCostReductionCents" IS NULL OR "capitalizedCostCents" IS NULL OR "capCostReductionCents" <= "capitalizedCostCents")
  ),
  -- The rate-policy audit trail is recorded as a pair or not at all: a policy id
  -- without the ceiling it imposed cannot be audited.
  ADD CONSTRAINT "deals_rate_policy_snapshot_paired" CHECK (
    ("ratePolicyId" IS NULL AND "ratePolicyCeilingBasisPoints" IS NULL)
    OR ("ratePolicyId" IS NOT NULL AND "ratePolicyCeilingBasisPoints" IS NOT NULL)
  ),
  -- A structured instalment deal that records payments must record how many.
  ADD CONSTRAINT "deals_payment_amount_requires_schedule" CHECK (
    "paymentAmountCents" IS NULL
    OR "paymentAmountCents" = 0
    OR "numberOfPayments" IS NOT NULL
  );
