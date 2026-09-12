-- Dealer Digital — integrity constraints.
--
-- These rules live in the database, not only in application code, so a bug, a
-- race condition or a manual SQL edit cannot produce two active reservations on
-- one vehicle, a negative cost, or a "sold" vehicle with no sale price.

-- ---------------------------------------------------------------------------
-- One live reservation per vehicle.
-- Two staff members accepting a deposit for the same car at the same moment is
-- the classic dealership double-sell. The partial unique index makes the second
-- write fail at the database level.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "reservations_one_active_per_vehicle"
  ON "reservations" ("vehicleId")
  WHERE "status" IN ('PENDING', 'ACTIVE');

-- ---------------------------------------------------------------------------
-- One live deal per vehicle. Cancelled and lost deals stay as history.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "deals_one_live_per_vehicle"
  ON "deals" ("vehicleId")
  WHERE "status" NOT IN ('CANCELLED', 'LOST');

-- ---------------------------------------------------------------------------
-- Money is never negative, and an acquisition price is a real number.
-- ---------------------------------------------------------------------------
ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_money_non_negative" CHECK (
    "acquisitionPriceCents" >= 0
    AND "auctionFeesCents" >= 0
    AND "transportationCents" >= 0
    AND "inspectionCents" >= 0
    AND "otherAcquisitionCents" >= 0
    AND ("reconOverrideCents" IS NULL OR "reconOverrideCents" >= 0)
    AND ("targetRetailPriceCents" IS NULL OR "targetRetailPriceCents" >= 0)
    AND ("askingPriceCents" IS NULL OR "askingPriceCents" >= 0)
    AND ("minimumApprovedCents" IS NULL OR "minimumApprovedCents" >= 0)
    AND ("finalSalePriceCents" IS NULL OR "finalSalePriceCents" >= 0)
  ),
  ADD CONSTRAINT "vehicles_mileage_non_negative" CHECK ("mileage" >= 0),
  ADD CONSTRAINT "vehicles_year_sane" CHECK ("year" BETWEEN 1900 AND 2100),
  ADD CONSTRAINT "vehicles_vin_length" CHECK (char_length("vin") BETWEEN 6 AND 24),
  ADD CONSTRAINT "vehicles_asking_above_minimum" CHECK (
    "askingPriceCents" IS NULL
    OR "minimumApprovedCents" IS NULL
    OR "askingPriceCents" >= "minimumApprovedCents"
  ),
  -- A listing must carry a price; the public catalog must never show $0 cars.
  ADD CONSTRAINT "vehicles_active_listing_requires_price" CHECK (
    "listingStatus" <> 'ACTIVE'
    OR ("askingPriceCents" IS NOT NULL AND "askingPriceCents" > 0)
  ),
  -- A sold or delivered vehicle must record what it actually sold for.
  ADD CONSTRAINT "vehicles_sold_requires_final_price" CHECK (
    "status" NOT IN ('SOLD', 'DELIVERED')
    OR ("finalSalePriceCents" IS NOT NULL AND "finalSalePriceCents" >= 0)
  ),
  -- GPS coordinates are all-or-nothing.
  ADD CONSTRAINT "vehicles_tracker_coordinates_paired" CHECK (
    ("trackerLastLatitude" IS NULL AND "trackerLastLongitude" IS NULL)
    OR ("trackerLastLatitude" IS NOT NULL AND "trackerLastLongitude" IS NOT NULL)
  ),
  ADD CONSTRAINT "vehicles_tracker_latitude_range" CHECK (
    "trackerLastLatitude" IS NULL OR ("trackerLastLatitude" BETWEEN -90 AND 90)
  ),
  ADD CONSTRAINT "vehicles_tracker_longitude_range" CHECK (
    "trackerLastLongitude" IS NULL OR ("trackerLastLongitude" BETWEEN -180 AND 180)
  );

ALTER TABLE "vehicle_recon_items"
  ADD CONSTRAINT "recon_money_non_negative" CHECK (
    "estimateCents" >= 0 AND ("actualCostCents" IS NULL OR "actualCostCents" >= 0)
  ),
  ADD CONSTRAINT "recon_completed_has_date" CHECK (
    "status" <> 'COMPLETED' OR "completedAt" IS NOT NULL
  );

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_amount_positive" CHECK ("amountCents" > 0);

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_money_non_negative" CHECK (
    "askingPriceCents" >= 0
    AND ("negotiatedPriceCents" IS NULL OR "negotiatedPriceCents" >= 0)
    AND ("salePriceCents" IS NULL OR "salePriceCents" >= 0)
    AND "dealerFeesCents" >= 0
    AND ("downPaymentCents" IS NULL OR "downPaymentCents" >= 0)
    AND ("tradeInAllowanceCents" IS NULL OR "tradeInAllowanceCents" >= 0)
  ),
  -- A contracted or delivered deal must state the sale price.
  ADD CONSTRAINT "deals_contracted_requires_sale_price" CHECK (
    "status" NOT IN ('CONTRACTED', 'DELIVERED')
    OR ("salePriceCents" IS NOT NULL AND "salePriceCents" > 0)
  ),
  ADD CONSTRAINT "deals_apr_sane" CHECK (
    "aprBasisPoints" IS NULL OR ("aprBasisPoints" >= 0 AND "aprBasisPoints" <= 6000)
  ),
  ADD CONSTRAINT "deals_term_sane" CHECK (
    "termMonths" IS NULL OR ("termMonths" > 0 AND "termMonths" <= 180)
  );

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_deposit_non_negative" CHECK ("depositCents" >= 0);

ALTER TABLE "sourcing_candidates"
  ADD CONSTRAINT "sourcing_money_non_negative" CHECK (
    "askingPriceCents" >= 0
    AND "expectedAuctionFeesCents" >= 0
    AND "transportEstimateCents" >= 0
    AND "estimatedReconCents" >= 0
    AND "otherCostsCents" >= 0
    AND "estimatedRetailCents" >= 0
    AND "minGrossProfitCents" >= 0
    AND "minRoiBasisPoints" >= 0
    AND ("customerExpectedValueCents" IS NULL OR "customerExpectedValueCents" >= 0)
  ),
  ADD CONSTRAINT "sourcing_mileage_non_negative" CHECK ("mileage" IS NULL OR "mileage" >= 0);

-- ---------------------------------------------------------------------------
-- A saved vehicle belongs to exactly one owner: an anonymous visitor key or an
-- identified customer, never both and never neither.
-- ---------------------------------------------------------------------------
ALTER TABLE "saved_vehicles"
  ADD CONSTRAINT "saved_vehicles_single_owner" CHECK (
    ("visitorKey" IS NOT NULL AND "customerId" IS NULL)
    OR ("visitorKey" IS NULL AND "customerId" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Documents must be attached to something meaningful.
-- ---------------------------------------------------------------------------
ALTER TABLE "deal_documents"
  ADD CONSTRAINT "deal_documents_has_target" CHECK (
    "dealId" IS NOT NULL OR "customerId" IS NOT NULL OR "vehicleId" IS NOT NULL
  ),
  ADD CONSTRAINT "deal_documents_size_sane" CHECK ("sizeBytes" >= 0 AND "sizeBytes" <= 52428800);

-- ---------------------------------------------------------------------------
-- A trade-in candidate must not promise a value: the customer's expectation is
-- stored for internal appraisal only and is never surfaced as an offer.
-- ---------------------------------------------------------------------------
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_has_contact" CHECK (
    "phone" IS NOT NULL OR "email" IS NOT NULL
  );

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_lost_has_reason" CHECK (
    "status" <> 'LOST' OR ("lostReason" IS NOT NULL AND length(trim("lostReason")) > 0)
  );

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
