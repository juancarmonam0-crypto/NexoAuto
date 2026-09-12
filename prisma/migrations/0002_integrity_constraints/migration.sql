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
  ON "reservations" ("vehicle_id")
  WHERE "status" IN ('PENDING', 'ACTIVE');

-- ---------------------------------------------------------------------------
-- One live deal per vehicle. Cancelled and lost deals stay as history.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "deals_one_live_per_vehicle"
  ON "deals" ("vehicle_id")
  WHERE "status" NOT IN ('CANCELLED', 'LOST');

-- ---------------------------------------------------------------------------
-- Money is never negative, and an acquisition price is a real number.
-- ---------------------------------------------------------------------------
ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_money_non_negative" CHECK (
    "acquisition_price_cents" >= 0
    AND "auction_fees_cents" >= 0
    AND "transportation_cents" >= 0
    AND "inspection_cents" >= 0
    AND "other_acquisition_cents" >= 0
    AND ("recon_override_cents" IS NULL OR "recon_override_cents" >= 0)
    AND ("target_retail_price_cents" IS NULL OR "target_retail_price_cents" >= 0)
    AND ("asking_price_cents" IS NULL OR "asking_price_cents" >= 0)
    AND ("minimum_approved_cents" IS NULL OR "minimum_approved_cents" >= 0)
    AND ("final_sale_price_cents" IS NULL OR "final_sale_price_cents" >= 0)
  ),
  ADD CONSTRAINT "vehicles_mileage_non_negative" CHECK ("mileage" >= 0),
  ADD CONSTRAINT "vehicles_year_sane" CHECK ("year" BETWEEN 1900 AND 2100),
  ADD CONSTRAINT "vehicles_vin_length" CHECK (char_length("vin") BETWEEN 6 AND 24),
  ADD CONSTRAINT "vehicles_asking_above_minimum" CHECK (
    "asking_price_cents" IS NULL
    OR "minimum_approved_cents" IS NULL
    OR "asking_price_cents" >= "minimum_approved_cents"
  ),
  -- A listing must carry a price; the public catalog must never show $0 cars.
  ADD CONSTRAINT "vehicles_active_listing_requires_price" CHECK (
    "listing_status" <> 'ACTIVE'
    OR ("asking_price_cents" IS NOT NULL AND "asking_price_cents" > 0)
  ),
  -- A sold or delivered vehicle must record what it actually sold for.
  ADD CONSTRAINT "vehicles_sold_requires_final_price" CHECK (
    "status" NOT IN ('SOLD', 'DELIVERED')
    OR ("final_sale_price_cents" IS NOT NULL AND "final_sale_price_cents" >= 0)
  ),
  -- GPS coordinates are all-or-nothing.
  ADD CONSTRAINT "vehicles_tracker_coordinates_paired" CHECK (
    ("tracker_last_latitude" IS NULL AND "tracker_last_longitude" IS NULL)
    OR ("tracker_last_latitude" IS NOT NULL AND "tracker_last_longitude" IS NOT NULL)
  ),
  ADD CONSTRAINT "vehicles_tracker_latitude_range" CHECK (
    "tracker_last_latitude" IS NULL OR ("tracker_last_latitude" BETWEEN -90 AND 90)
  ),
  ADD CONSTRAINT "vehicles_tracker_longitude_range" CHECK (
    "tracker_last_longitude" IS NULL OR ("tracker_last_longitude" BETWEEN -180 AND 180)
  );

ALTER TABLE "vehicle_recon_items"
  ADD CONSTRAINT "recon_money_non_negative" CHECK (
    "estimate_cents" >= 0 AND ("actual_cost_cents" IS NULL OR "actual_cost_cents" >= 0)
  ),
  ADD CONSTRAINT "recon_completed_has_date" CHECK (
    "status" <> 'COMPLETED' OR "completed_at" IS NOT NULL
  );

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount_cents" > 0);

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_money_non_negative" CHECK (
    "asking_price_cents" >= 0
    AND ("negotiated_price_cents" IS NULL OR "negotiated_price_cents" >= 0)
    AND ("sale_price_cents" IS NULL OR "sale_price_cents" >= 0)
    AND "dealer_fees_cents" >= 0
    AND ("down_payment_cents" IS NULL OR "down_payment_cents" >= 0)
    AND ("trade_in_allowance_cents" IS NULL OR "trade_in_allowance_cents" >= 0)
  ),
  -- A contracted or delivered deal must state the sale price.
  ADD CONSTRAINT "deals_contracted_requires_sale_price" CHECK (
    "status" NOT IN ('CONTRACTED', 'DELIVERED')
    OR ("sale_price_cents" IS NOT NULL AND "sale_price_cents" > 0)
  ),
  ADD CONSTRAINT "deals_apr_sane" CHECK (
    "apr_basis_points" IS NULL OR ("apr_basis_points" >= 0 AND "apr_basis_points" <= 6000)
  ),
  ADD CONSTRAINT "deals_term_sane" CHECK (
    "term_months" IS NULL OR ("term_months" > 0 AND "term_months" <= 180)
  );

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_deposit_non_negative" CHECK ("deposit_cents" >= 0);

ALTER TABLE "sourcing_candidates"
  ADD CONSTRAINT "sourcing_money_non_negative" CHECK (
    "asking_price_cents" >= 0
    AND "expected_auction_fees_cents" >= 0
    AND "transport_estimate_cents" >= 0
    AND "estimated_recon_cents" >= 0
    AND "other_costs_cents" >= 0
    AND "estimated_retail_cents" >= 0
    AND "min_gross_profit_cents" >= 0
    AND "min_roi_basis_points" >= 0
    AND ("customer_expected_value_cents" IS NULL OR "customer_expected_value_cents" >= 0)
  ),
  ADD CONSTRAINT "sourcing_mileage_non_negative" CHECK ("mileage" IS NULL OR "mileage" >= 0);

-- ---------------------------------------------------------------------------
-- A saved vehicle belongs to exactly one owner: an anonymous visitor key or an
-- identified customer, never both and never neither.
-- ---------------------------------------------------------------------------
ALTER TABLE "saved_vehicles"
  ADD CONSTRAINT "saved_vehicles_single_owner" CHECK (
    ("visitor_key" IS NOT NULL AND "customer_id" IS NULL)
    OR ("visitor_key" IS NULL AND "customer_id" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Documents must be attached to something meaningful.
-- ---------------------------------------------------------------------------
ALTER TABLE "deal_documents"
  ADD CONSTRAINT "deal_documents_has_target" CHECK (
    "deal_id" IS NOT NULL OR "customer_id" IS NOT NULL OR "vehicle_id" IS NOT NULL
  ),
  ADD CONSTRAINT "deal_documents_size_sane" CHECK ("size_bytes" >= 0 AND "size_bytes" <= 52428800);

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
    "status" <> 'LOST' OR ("lost_reason" IS NOT NULL AND length(trim("lost_reason")) > 0)
  );

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
