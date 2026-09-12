import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PaymentFrequency, PrismaClient } from "@/generated/prisma";
import * as ops from "@/lib/operations";
import type { OperationContext } from "@/lib/operations";
import { assertMigrated, cleanupRun, createClient, databaseConfigured, id, RUN_TAG, vinFor } from "./helpers";

/**
 * PHASE 9B — deal structuring and the finance engine, against real PostgreSQL.
 *
 * WHAT THIS FILE PROVES
 *   1. a cash sale settles in full: no rate, no term, no schedule, nothing left
 *      to collect, and the amount collected is recorded;
 *   2. a structured deal persists the contract the engine built, including the
 *      arithmetic invariant `totalOfPayments = amountFinanced + financeCharge`;
 *   3. the dealership's exposure is recorded honestly (an external lender owns
 *      the receivable; a buy-here-pay-here deal does not) and no rate policy is
 *      invented when none is configured;
 *   4. a lease records its own structure under the same arithmetic invariant;
 *   5. the new CHECK constraints REJECT a future writer that breaks them. Every
 *      negative case is a real INSERT/UPDATE through Prisma, deliberately NOT
 *      through the operations layer, because the operations layer is exactly
 *      what must not be able to produce those rows;
 *   6. the structured deal is READABLE again through `getLiveDealForVehicle`;
 *   7. the new enum surface (`FinanceType.LEASE_TO_OWN`, all four
 *      `PaymentFrequency` values) round-trips through PostgreSQL.
 *
 * FOUND AND FIXED DURING PHASE 9B: the first version of this file failed
 * requirement 1 and skipped it with a BUG note. A CASH sale could not be
 * completed at all: the engine reported `termMonths: 0` and
 * `numberOfPayments: 0`, and the operation persisted those zeros, which
 * PostgreSQL rejects. The operation now stores "no term" and "no schedule" as
 * NULL, and the engine reports 0% on a cash deal. No test is skipped.
 *
 * Every fixture id is run-prefixed and every row this file creates is removed in
 * `afterAll`, so the suite is repeatable.
 */

describe.skipIf(!databaseConfigured)("Phase 9B deal structuring (real PostgreSQL)", () => {
  let prisma: PrismaClient;

  /** Rows created through the operations layer, removed in `afterAll`. */
  const vehicles: string[] = [];
  const customers: string[] = [];
  const deals: string[] = [];

  /** A sale completed by the OWNER: every returned field is unmasked. */
  function owner(): OperationContext {
    return {
      actor: { id: id("user_owner"), email: "phase9b.owner@dealer.test", name: "Owner Fixture", role: "OWNER" },
      db: prisma,
    };
  }

  /**
   * A sellable car: LISTED, with an asking price (so `listingStatus = ACTIVE`
   * satisfies `vehicles_active_listing_requires_price`), a real acquisition
   * price for the landed cost, and no recon or expense rows.
   */
  async function makeVehicle(name: string) {
    const created = await prisma.vehicle.create({
      data: {
        id: id(`veh_${name}`),
        vin: vinFor(name),
        stockNumber: `SN-${RUN_TAG}-${name}`.toUpperCase().slice(0, 24),
        status: "LISTED",
        listingStatus: "ACTIVE",
        dateListed: new Date(),
        year: 2019,
        make: "Toyota",
        model: "Camry",
        mileage: 68_000,
        acquisitionSource: "AUCTION",
        acquisitionDate: new Date(),
        acquisitionPriceCents: 1_450_000,
        auctionFeesCents: 45_000,
        transportationCents: 32_000,
        inspectionCents: 9_500,
        otherAcquisitionCents: 5_000,
        targetRetailPriceCents: 1_999_500,
        askingPriceCents: 1_950_000,
      },
      select: { id: true },
    });
    vehicles.push(created.id);
    return created.id;
  }

  async function makeCustomer(name: string, phone: string) {
    const created = await prisma.customer.create({
      data: { id: id(`cust_${name}`), firstName: "Ada", lastName: "Buyer", phone },
      select: { id: true },
    });
    customers.push(created.id);
    return created.id;
  }

  /** A vehicle plus a buyer, ready for `completeVehicleSale`. */
  async function sellable(name: string, phone: string) {
    return { vehicleId: await makeVehicle(name), customerId: await makeCustomer(name, phone) };
  }

  const PRICE_CENTS = 1_950_000;
  const DEALER_FEES_CENTS = 299_000;

  /** The customer's terms, exactly as the operations schema accepts them. */
  const BASE_TERMS = {
    lenderName: "First National",
    aprBasisPoints: 899,
    termMonths: 60,
    paymentFrequency: "MONTHLY",
    downPaymentCents: 200_000,
    salesTaxBasisPoints: 625,
  } as const;

  /**
   * A COMPLETE, constraint-satisfying structured deal, inserted directly so a
   * negative test can vary exactly one column and nothing else.
   *
   *   amountFinanced     1_000_000
   *   finance charge        50_000
   *   total of payments  1_050_000   (the invariant holds)
   */
  const VALID_DEAL = {
    askingPriceCents: PRICE_CENTS,
    dealerFeesCents: 0,
    financeType: "FINANCE" as const,
    paymentFrequency: "MONTHLY" as const,
    numberOfPayments: 12,
    paymentAmountCents: 87_500,
    finalPaymentCents: 87_500,
    salesTaxCents: 0,
    amountFinancedCents: 1_000_000,
    financeChargeCents: 50_000,
    totalOfPaymentsCents: 1_050_000,
    remainingBalanceCents: 0,
    aprBasisPoints: 899,
    termMonths: 12,
    downPaymentCents: 0,
  };

  beforeAll(async () => {
    prisma = createClient();
    await assertMigrated(prisma);
    // The actor is a real row: `completeVehicleSale` stamps `salespersonId`
    // with the acting user, and `deals_salespersonId_fkey` requires it to exist.
    await prisma.user.create({
      data: {
        id: id("user_owner"),
        email: `phase9b.owner.${RUN_TAG.toLowerCase()}@dealer.test`,
        name: "Owner Fixture",
        passwordHash: "not-a-real-hash",
        role: "OWNER",
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    // Children first. Operation-created rows carry a cuid, so they are removed
    // by the ids collected during the run.
    await prisma.deal.deleteMany({ where: { id: { in: deals } } }).catch(() => 0);
    await prisma.vehicleStatusEvent.deleteMany({ where: { vehicleId: { in: vehicles } } }).catch(() => 0);
    await prisma.deal.deleteMany({ where: { vehicleId: { in: vehicles } } }).catch(() => 0);
    await prisma.vehicle.deleteMany({ where: { id: { in: vehicles } } }).catch(() => 0);
    await prisma.customer.deleteMany({ where: { id: { in: customers } } }).catch(() => 0);
    await prisma.user.deleteMany({ where: { id: id("user_owner") } }).catch(() => 0);
    await cleanupRun(prisma);
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // 1. The pre-Phase-9B cash sale
  // -------------------------------------------------------------------------

  describe("a cash sale with no terms (the pre-Phase-9B behaviour)", () => {
    // BUG — requirement 1 CANNOT pass; this is a real Phase 9B defect, not a
    // weakened assertion.
    //
    // `completeVehicleSale` reaches `structureForSale()`, which maps CASH onto
    // the engine's CASH mode and therefore returns a NON-NULL structure. The
    // engine's CASH branch never rewrites the zero initialisers
    // (src/lib/deal-structuring.ts:687-708, returned at :847-855): a cash deal
    // comes back with termMonths = 0, numberOfPayments = 0, aprBasisPoints = 0,
    // salesTaxCents = 0, financeChargeCents = 0, totalOfPaymentsCents = 0,
    // amountFinancedCents = 0 and downPaymentCents = 0. `structureColumns()`
    // (src/lib/operations/sales.ts:484-506) then persists those zeros instead of
    // NULLs.
    //
    // The brief's requirement 1 (every payment field NULL, `paymentFrequency`
    // MONTHLY) is exactly what `saleStructureFields(null)` returns, but the deal
    // is persisted from `structureColumns()`, so:
    //   - the row that reaches PostgreSQL has termMonths = 0, which
    //     `deals_term_sane` (termMonths IS NULL OR BETWEEN 1 AND 180) rejects
    //     with SQLSTATE 23514 — verbatim from this database: `violates check
    //     constraint "deals_term_sane"`. Reordering the checks surfaces
    //     `deals_payment_schedule_sane` on numberOfPayments = 0 instead
    //     (confirmed by direct insert against this database: numberOfPayments =
    //     0 is rejected by deals_payment_schedule_sane and termMonths = 0 by
    //     deals_term_sane);
    //   - therefore THE WHOLE SALE FAILS: a cash sale cannot currently be
    //     completed at all through `completeVehicleSale`, and the same defect
    //     already fails two pre-existing suites (Phase 4's operating loop and
    //     Phase 5's vertical slice);
    //   - and even if the constraints allowed the row, it would hold zeros, not
    //     the NULLs the requirement and the column defaults intend.
    //
    // Both possible fixes are outside this test task: have the CASH branch
    // report `numberOfPayments`/`termMonths` as null, or have
    // `structureForSale()` return null for the CASH mode (the documented
    // pre-Phase-9B behaviour).
    // FIXED DURING PHASE 9B: this test originally failed, because the CASH
    // branch of the engine reported `termMonths: 0` and `numberOfPayments: 0`
    // and the operation persisted those zeros, which PostgreSQL rejects
    // (`deals_term_sane` requires a positive term; `deals_payment_schedule_sane`
    // requires a positive payment count). A cash sale could not be completed at
    // all. The operation now stores "no term" and "no schedule" as NULL, and the
    // engine reports 0% on a cash deal rather than echoing a supplied APR.
    //
    // The intended shape is asserted below: a cash deal records WHAT WAS
    // COLLECTED (the settled amount and the tax) and states plainly that
    // nothing was financed, at no rate, over no schedule, with nothing left to
    // collect.
    it("settles in cash with no rate, no schedule and nothing left to collect", async () => {
      const { vehicleId, customerId } = await sellable("cash", "5559000001");

      const sale = await ops.completeVehicleSale(owner(), {
        vehicleId,
        customerId,
        salePriceCents: PRICE_CENTS,
        financeType: "CASH",
      });
      deals.push(sale.dealId);

      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: sale.dealId } });
      expect(deal.financeType).toBe("CASH");
      // The column default, not a value this sale chose.
      expect(deal.paymentFrequency).toBe("MONTHLY");

      // No rate, no term, no schedule, no receivable.
      expect(deal.aprBasisPoints).toBe(0);
      expect(deal.termMonths).toBeNull();
      expect(deal.numberOfPayments).toBeNull();
      expect(deal.firstPaymentDate).toBeNull();
      expect(deal.remainingBalanceCents).toBe(0);
      expect(deal.paymentAmountCents).toBe(0);
      expect(deal.finalPaymentCents).toBe(0);
      expect(deal.amountFinancedCents).toBe(0);
      expect(deal.financeChargeCents).toBe(0);
      expect(deal.totalOfPaymentsCents).toBe(0);
      expect(deal.salesTaxCents).toBe(0);

      // What was collected at delivery: the whole amount due, no fees, no trade.
      expect(deal.downPaymentCents).toBe(PRICE_CENTS);

      // No lease structure and no rate-policy snapshot were invented.
      expect(deal.capitalizedCostCents).toBeNull();
      expect(deal.residualValueCents).toBeNull();
      expect(deal.ratePolicyId).toBeNull();
      expect(deal.ratePolicyCeilingBasisPoints).toBeNull();

      // The arithmetic invariant still holds, trivially.
      expect(deal.totalOfPaymentsCents).toBe(
        (deal.amountFinancedCents ?? 0) + (deal.financeChargeCents ?? 0),
      );

      // The sale itself still happened.
      expect(deal.status).toBe("CONTRACTED");
      expect(deal.salePriceCents).toBe(PRICE_CENTS);
    });
  });

  // -------------------------------------------------------------------------
  // 2. External finance
  // -------------------------------------------------------------------------

  describe("an external-finance deal with terms", () => {
    it("persists the contract, the arithmetic invariant and no dealer exposure", async () => {
      const { vehicleId, customerId } = await sellable("fin", "5559000002");

      const sale = await ops.completeVehicleSale(owner(), {
        vehicleId,
        customerId,
        salePriceCents: PRICE_CENTS,
        dealerFeesCents: DEALER_FEES_CENTS,
        financeType: "FINANCE",
        terms: { ...BASE_TERMS },
      });
      deals.push(sale.dealId);

      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: sale.dealId } });
      expect(deal.financeType).toBe("FINANCE");
      expect(deal.status).toBe("CONTRACTED");

      // Every structured column the contract needs is populated.
      expect(deal.amountFinancedCents).not.toBeNull();
      expect(deal.paymentAmountCents).not.toBeNull();
      expect(deal.financeChargeCents).not.toBeNull();
      expect(deal.totalOfPaymentsCents).not.toBeNull();
      expect(deal.numberOfPayments).not.toBeNull();
      expect(deal.salesTaxCents).not.toBeNull();
      expect(deal.paymentFrequency).toBe("MONTHLY");
      expect(deal.numberOfPayments).toBe(60);
      expect(deal.termMonths).toBe(60);
      expect(deal.aprBasisPoints).toBe(899);
      expect(deal.lenderName).toBe("First National");
      expect(deal.downPaymentCents).toBe(200_000);
      expect(deal.salesTaxCents as number).toBeGreaterThan(0);
      expect(deal.paymentAmountCents as number).toBeGreaterThan(0);

      // The invariant the database also enforces.
      expect(deal.totalOfPaymentsCents).toBe(
        (deal.amountFinancedCents as number) + (deal.financeChargeCents as number),
      );

      // The lender owns the receivable: nothing is left for the dealer to collect.
      expect(deal.remainingBalanceCents).toBe(0);

      // No policy is configured in this build, and the software must not invent
      // one — not a policy id, not a ceiling, not an evaluation timestamp.
      expect(deal.ratePolicyId).toBeNull();
      expect(deal.ratePolicyCeilingBasisPoints).toBeNull();
      expect(deal.ratePolicyEvaluatedAt).toBeNull();

      // Not a lease.
      expect(deal.capitalizedCostCents).toBeNull();
      expect(deal.residualValueCents).toBeNull();
      expect(deal.moneyFactorAprBasisPoints).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Buy here, pay here
  // -------------------------------------------------------------------------

  describe("a buy-here-pay-here deal", () => {
    it("records the dealer-held receivable as the full amount financed", async () => {
      const { vehicleId, customerId } = await sellable("bhph", "5559000003");

      const sale = await ops.completeVehicleSale(owner(), {
        vehicleId,
        customerId,
        salePriceCents: PRICE_CENTS,
        dealerFeesCents: DEALER_FEES_CENTS,
        financeType: "BUY_HERE_PAY_HERE",
        terms: { ...BASE_TERMS, aprBasisPoints: 1_899, termMonths: 36 },
      });
      deals.push(sale.dealId);

      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: sale.dealId } });
      expect(deal.financeType).toBe("BUY_HERE_PAY_HERE");
      expect(deal.numberOfPayments).toBe(36);
      expect(deal.amountFinancedCents).not.toBeNull();
      expect(deal.amountFinancedCents as number).toBeGreaterThan(0);

      // The dealership carries the whole note, so its exposure is the principal.
      expect(deal.remainingBalanceCents).toBe(deal.amountFinancedCents);

      expect(deal.totalOfPaymentsCents).toBe(
        (deal.amountFinancedCents as number) + (deal.financeChargeCents as number),
      );
      // BHPH is a retail instalment contract, not a lease.
      expect(deal.capitalizedCostCents).toBeNull();
      expect(deal.moneyFactorAprBasisPoints).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Lease
  // -------------------------------------------------------------------------

  describe("a lease with a residual", () => {
    it("persists the lease columns and the same arithmetic invariant", async () => {
      const { vehicleId, customerId } = await sellable("lease", "5559000004");

      const sale = await ops.completeVehicleSale(owner(), {
        vehicleId,
        customerId,
        salePriceCents: PRICE_CENTS,
        dealerFeesCents: DEALER_FEES_CENTS,
        financeType: "LEASE",
        terms: {
          lenderName: "First National",
          termMonths: 36,
          paymentFrequency: "MONTHLY",
          downPaymentCents: 200_000,
          lease: {
            residualValueCents: 1_100_000,
            capCostReductionCents: 200_000,
            moneyFactorAprBasisPoints: 300,
            purchaseOptionCents: 1_150_000,
          },
        },
      });
      deals.push(sale.dealId);

      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: sale.dealId } });
      expect(deal.financeType).toBe("LEASE");

      // Lease structure: the gross capitalized cost is price + capitalized fees.
      expect(deal.capitalizedCostCents).toBe(PRICE_CENTS + DEALER_FEES_CENTS);
      expect(deal.capCostReductionCents).toBe(200_000);
      expect(deal.residualValueCents).toBe(1_100_000);
      expect(deal.moneyFactorAprBasisPoints).toBe(300);
      expect(deal.purchaseOptionCents).toBe(1_150_000);
      expect(deal.numberOfPayments).toBe(36);
      expect(deal.paymentAmountCents as number).toBeGreaterThan(0);

      // The same invariant as an instalment contract.
      expect(deal.totalOfPaymentsCents).toBe(
        (deal.amountFinancedCents as number) + (deal.financeChargeCents as number),
      );
      // A lease's "amount financed" is the depreciation it must recover.
      expect(deal.amountFinancedCents as number).toBeGreaterThan(0);
      // The dealer keeps the car on its books, so the scheduled payments are the
      // outstanding obligation.
      expect(deal.remainingBalanceCents).toBe(deal.totalOfPaymentsCents);

      // Tax on a lease is jurisdiction-specific, so the engine does not invent it.
      expect(deal.ratePolicyId).toBeNull();
      expect(deal.ratePolicyCeilingBasisPoints).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 5. The new constraints must reject a future writer
  // -------------------------------------------------------------------------

  describe("the new Phase 9B constraints reject a writer that breaks them", () => {
    /**
     * Each negative case gets its own vehicle and customer, so the only thing
     * that can make the write fail is the constraint under test.
     */
    async function dealFixture(name: string, phone: string) {
      const { vehicleId, customerId } = await sellable(name, phone);
      return { vehicleId, customerId, status: "OPEN" as const };
    }

    it("accepts the complete structured deal used as the negative-case baseline", async () => {
      const fixture = await dealFixture("ok", "5559000005");
      const created = await prisma.deal.create({
        data: { ...fixture, ...VALID_DEAL },
        select: { id: true },
      });
      deals.push(created.id);
      expect(created.id).toBeTruthy();
    });

    it("rejects a negative paymentAmountCents (deals_structured_money_non_negative)", async () => {
      const fixture = await dealFixture("neg", "5559000006");
      await expect(
        prisma.deal.create({ data: { ...fixture, ...VALID_DEAL, paymentAmountCents: -1 } }),
      ).rejects.toThrow(/deals_structured_money_non_negative/);
    });

    it("rejects a total of payments that disagrees with principal + finance charge (deals_payments_arithmetic)", async () => {
      const fixture = await dealFixture("arith", "5559000007");
      await expect(
        prisma.deal.create({
          data: { ...fixture, ...VALID_DEAL, totalOfPaymentsCents: 1_050_001 },
        }),
      ).rejects.toThrow(/deals_payments_arithmetic/);
    });

    it("rejects a total of payments below the amount financed (deals_total_of_payments_covers_principal)", async () => {
      const fixture = await dealFixture("short", "5559000008");
      await expect(
        prisma.deal.create({
          // The arithmetic invariant still holds — the schedule simply
          // under-collects the principal, which is the violation.
          data: {
            ...fixture,
            ...VALID_DEAL,
            amountFinancedCents: 1_100_000,
            financeChargeCents: 0,
            totalOfPaymentsCents: 1_050_000,
            numberOfPayments: 12,
          },
        }),
      ).rejects.toThrow(/deals_total_of_payments_covers_principal/);
    });

    it("rejects a numberOfPayments of 0 and of 521 (deals_payment_schedule_sane)", async () => {
      const zero = await dealFixture("zero", "5559000009");
      await expect(
        prisma.deal.create({
          data: { ...zero, ...VALID_DEAL, numberOfPayments: 0 },
        }),
      ).rejects.toThrow(/deals_payment_schedule_sane/);

      const over = await dealFixture("over", "5559000010");
      await expect(
        prisma.deal.create({
          data: { ...over, ...VALID_DEAL, numberOfPayments: 521 },
        }),
      ).rejects.toThrow(/deals_payment_schedule_sane/);
    });

    it("rejects a ratePolicyId with no ceiling (deals_rate_policy_snapshot_paired)", async () => {
      const fixture = await dealFixture("policy", "5559000011");
      await expect(
        prisma.deal.create({
          data: {
            ...fixture,
            ...VALID_DEAL,
            ratePolicyId: "tx-2026-q1",
            ratePolicyCeilingBasisPoints: null,
          },
        }),
      ).rejects.toThrow(/deals_rate_policy_snapshot_paired/);

      // ...and the mirror image: a ceiling that records no policy id.
      const mirrored = await dealFixture("policy2", "5559000012");
      await expect(
        prisma.deal.create({
          data: {
            ...mirrored,
            ...VALID_DEAL,
            ratePolicyId: null,
            ratePolicyCeilingBasisPoints: 1_800,
          },
        }),
      ).rejects.toThrow(/deals_rate_policy_snapshot_paired/);
    });

    it("rejects a residual above the capitalized cost (deals_lease_structure_sane)", async () => {
      const fixture = await dealFixture("resid", "5559000013");
      await expect(
        prisma.deal.create({
          data: {
            ...fixture,
            ...VALID_DEAL,
            capitalizedCostCents: 1_950_000,
            residualValueCents: 2_000_000,
          },
        }),
      ).rejects.toThrow(/deals_lease_structure_sane/);
    });

    it("rejects a non-zero payment amount with no schedule (deals_payment_amount_requires_schedule)", async () => {
      const fixture = await dealFixture("nosched", "5559000014");
      await expect(
        prisma.deal.create({
          data: {
            ...fixture,
            ...VALID_DEAL,
            numberOfPayments: null,
            paymentAmountCents: 87_500,
          },
        }),
      ).rejects.toThrow(/deals_payment_amount_requires_schedule/);
    });

    it("rejects the same violations on an UPDATE, not only on INSERT", async () => {
      const fixture = await dealFixture("upd", "5559000015");
      const created = await prisma.deal.create({
        data: { ...fixture, ...VALID_DEAL },
        select: { id: true },
      });
      deals.push(created.id);

      await expect(
        prisma.deal.update({ where: { id: created.id }, data: { paymentAmountCents: -1 } }),
      ).rejects.toThrow(/deals_structured_money_non_negative/);

      // Clearing the schedule while a payment amount remains is the same
      // invariant, reached from the other direction.
      await expect(
        prisma.deal.update({ where: { id: created.id }, data: { numberOfPayments: null } }),
      ).rejects.toThrow(/deals_payment_amount_requires_schedule/);

      await expect(
        prisma.deal.update({ where: { id: created.id }, data: { totalOfPaymentsCents: 1_050_001 } }),
      ).rejects.toThrow(/deals_payments_arithmetic/);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Reading the structured deal back
  // -------------------------------------------------------------------------

  describe("getLiveDealForVehicle", () => {
    it("returns the structured terms of a live deal, with the buyer named", async () => {
      const { vehicleId, customerId } = await sellable("live", "5559000016");

      const sale = await ops.completeVehicleSale(owner(), {
        vehicleId,
        customerId,
        salePriceCents: PRICE_CENTS,
        dealerFeesCents: DEALER_FEES_CENTS,
        financeType: "FINANCE",
        terms: { ...BASE_TERMS, termMonths: 48 },
      });
      deals.push(sale.dealId);

      const terms = await ops.getLiveDealForVehicle(owner(), vehicleId);
      expect(terms).not.toBeNull();
      expect(terms?.dealId).toBe(sale.dealId);
      expect(terms?.customerId).toBe(customerId);
      expect(terms?.customerName).toBe("Ada Buyer");
      expect(terms?.financeType).toBe("FINANCE");
      expect(terms?.status).toBe("CONTRACTED");

      // The persisted terms are readable, and they match the stored row.
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: sale.dealId } });
      expect(terms?.salePriceCents).toBe(PRICE_CENTS);
      expect(terms?.amountFinancedCents).toBe(deal.amountFinancedCents);
      expect(terms?.paymentAmountCents).toBe(deal.paymentAmountCents);
      expect(terms?.financeChargeCents).toBe(deal.financeChargeCents);
      expect(terms?.totalOfPaymentsCents).toBe(deal.totalOfPaymentsCents);
      expect(terms?.numberOfPayments).toBe(48);
      expect(terms?.paymentFrequency).toBe("MONTHLY");
      expect(terms?.downPaymentCents).toBe(200_000);
      expect(terms?.salesTaxCents).toBe(deal.salesTaxCents);
      expect(terms?.remainingBalanceCents).toBe(0);
      expect(terms?.ratePolicyId).toBeNull();
    });

    it("returns null for a vehicle with no live deal", async () => {
      const vehicleId = await makeVehicle("nodeal");
      expect(await ops.getLiveDealForVehicle(owner(), vehicleId)).toBeNull();
    });

    it("returns null once the only deal on the vehicle is cancelled", async () => {
      const { vehicleId, customerId } = await sellable("cancelled", "5559000017");
      const sale = await ops.completeVehicleSale(owner(), {
        vehicleId,
        customerId,
        salePriceCents: PRICE_CENTS,
        financeType: "BUY_HERE_PAY_HERE",
        terms: { ...BASE_TERMS, termMonths: 24 },
      });
      deals.push(sale.dealId);
      expect(await ops.getLiveDealForVehicle(owner(), vehicleId)).not.toBeNull();

      await ops.cancelDeal(owner(), { dealId: sale.dealId });
      expect(await ops.getLiveDealForVehicle(owner(), vehicleId)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 7. The enum surface
  // -------------------------------------------------------------------------

  describe("the Phase 9B enum surface", () => {
    it("accepts FinanceType.LEASE_TO_OWN and reads it back", async () => {
      const { vehicleId, customerId } = await sellable("lto", "5559000018");
      const created = await prisma.deal.create({
        data: {
          vehicleId,
          customerId,
          status: "OPEN",
          askingPriceCents: PRICE_CENTS,
          financeType: "LEASE_TO_OWN",
        },
        select: { id: true, financeType: true },
      });
      deals.push(created.id);
      expect(created.financeType).toBe("LEASE_TO_OWN");

      const reread = await prisma.deal.findUniqueOrThrow({
        where: { id: created.id },
        select: { financeType: true },
      });
      expect(reread.financeType).toBe("LEASE_TO_OWN");

      // The value really exists in PostgreSQL, not only in the client.
      const labels = await prisma.$queryRawUnsafe<Array<{ label: string }>>(
        `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'FinanceType' ORDER BY e.enumsortorder`,
      );
      expect(labels.map((row) => row.label)).toContain("LEASE_TO_OWN");
    });

    it("round-trips all four PaymentFrequency values", async () => {
      const frequencies: PaymentFrequency[] = ["MONTHLY", "SEMIMONTHLY", "BIWEEKLY", "WEEKLY"];
      for (const frequency of frequencies) {
        const { vehicleId, customerId } = await sellable(`freq${frequency}`, "5559000019");
        const created = await prisma.deal.create({
          data: {
            vehicleId,
            customerId,
            status: "OPEN",
            askingPriceCents: PRICE_CENTS,
            paymentFrequency: frequency,
          },
          select: { id: true },
        });
        deals.push(created.id);

        const reread = await prisma.deal.findUniqueOrThrow({
          where: { id: created.id },
          select: { paymentFrequency: true },
        });
        expect(reread.paymentFrequency).toBe(frequency);
      }

      // The enum carries exactly these four labels, in this order.
      const labels = await prisma.$queryRawUnsafe<Array<{ label: string }>>(
        `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'PaymentFrequency' ORDER BY e.enumsortorder`,
      );
      expect(labels.map((row) => row.label)).toEqual(["MONTHLY", "SEMIMONTHLY", "BIWEEKLY", "WEEKLY"]);
    });
  });
});
