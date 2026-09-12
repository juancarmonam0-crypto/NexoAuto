-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MANAGER', 'SALES', 'RECON', 'VIEWER');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('SOURCING', 'PURCHASED', 'IN_TRANSIT', 'INSPECTION', 'RECONDITIONING', 'READY', 'LISTED', 'RESERVED', 'SOLD', 'DELIVERED', 'WHOLESALE', 'REJECTED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('UNLISTED', 'ACTIVE', 'PAUSED', 'SOLD', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TitleStatus" AS ENUM ('UNKNOWN', 'CLEAN', 'SALVAGE', 'REBUILT', 'FLOOD', 'LEMON', 'BONDED', 'PARTS_ONLY');

-- CreateEnum
CREATE TYPE "AcquisitionSource" AS ENUM ('AUCTION', 'DEALER_TRADE', 'PRIVATE_PARTY', 'WHOLESALE', 'CONSIGNMENT', 'CUSTOMER_TRADE_IN', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleDataOrigin" AS ENUM ('REAL', 'DEMO');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFYING', 'APPOINTMENT', 'NEGOTIATING', 'FINANCING', 'DOCUMENTS', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEBSITE_INQUIRY', 'PHONE', 'WALK_IN', 'REFERRAL', 'MARKETPLACE', 'TRADE_IN', 'AUCTION', 'REPEAT_CUSTOMER', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('PHONE', 'EMAIL', 'TEXT', 'ANY');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'TEXT', 'APPOINTMENT', 'STATUS_CHANGE', 'TASK', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'NEGOTIATING', 'PENDING_DOCUMENTS', 'PENDING_FINANCE', 'CONTRACTED', 'DELIVERED', 'CANCELLED', 'LOST');

-- CreateEnum
CREATE TYPE "FinanceType" AS ENUM ('CASH', 'FINANCE', 'LEASE', 'BUY_HERE_PAY_HERE', 'UNDECIDED');

-- CreateEnum
CREATE TYPE "OfficialWorkflowStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'READY_TO_SUBMIT', 'SUBMITTED_EXTERNALLY', 'COMPLETED', 'REJECTED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'CONVERTED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ReconStatus" AS ENUM ('ESTIMATED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('PARTS', 'LABOR', 'DETAIL', 'TIRES', 'GLASS', 'MECHANICAL', 'BODY', 'SUBLET', 'KEYS', 'FUEL', 'TITLE_REGISTRATION', 'FLOORPLAN_INTEREST', 'ADVERTISING', 'SOFTWARE', 'LOT_RENT', 'UTILITIES', 'INSURANCE', 'PROFESSIONAL_FEES', 'MISC');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('BUYER_ORDER', 'PURCHASE_AGREEMENT', 'ODOMETER_DISCLOSURE', 'TITLE_APPLICATION', 'TITLE_COPY', 'FINANCE_AGREEMENT', 'INSURANCE_PROOF', 'ID_VERIFICATION', 'INSPECTION_REPORT', 'TRADE_IN_APPRAISAL', 'RESERVATION_AGREEMENT', 'DMV_FEE_RECEIPT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'RECEIVED', 'VERIFIED', 'SENT_FOR_SIGNATURE', 'SIGNED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SourcingSource" AS ENUM ('MANUAL_ENTRY', 'PASTED_URL', 'AUCTION_FEED', 'MARKETPLACE_API', 'TRADE_IN_SUBMISSION', 'AUCTION_PURCHASE', 'OTHER');

-- CreateEnum
CREATE TYPE "SourcingCandidateStatus" AS ENUM ('INBOX', 'EVALUATING', 'APPROVED_TO_BUY', 'PASSED', 'PURCHASED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SourcingRecommendation" AS ENUM ('BUY', 'WATCH', 'PASS');

-- CreateEnum
CREATE TYPE "TestDriveStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TrackerStatus" AS ENUM ('NOT_INSTALLED', 'UNKNOWN', 'ONLINE', 'OFFLINE', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'SALES',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "stockNumber" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT,
    "mileage" INTEGER NOT NULL,
    "exteriorColor" TEXT,
    "interiorColor" TEXT,
    "transmission" TEXT,
    "drivetrain" TEXT,
    "engine" TEXT,
    "fuelType" TEXT,
    "bodyType" TEXT,
    "doors" INTEGER,
    "seats" INTEGER,
    "titleStatus" "TitleStatus" NOT NULL DEFAULT 'UNKNOWN',
    "status" "VehicleStatus" NOT NULL DEFAULT 'SOURCING',
    "listingStatus" "ListingStatus" NOT NULL DEFAULT 'UNLISTED',
    "dataOrigin" "VehicleDataOrigin" NOT NULL DEFAULT 'REAL',
    "location" TEXT,
    "notes" TEXT,
    "description" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acquisitionSource" "AcquisitionSource",
    "acquisitionDate" TIMESTAMP(3),
    "acquisitionPriceCents" INTEGER NOT NULL DEFAULT 0,
    "auctionFeesCents" INTEGER NOT NULL DEFAULT 0,
    "transportationCents" INTEGER NOT NULL DEFAULT 0,
    "inspectionCents" INTEGER NOT NULL DEFAULT 0,
    "otherAcquisitionCents" INTEGER NOT NULL DEFAULT 0,
    "reconOverrideCents" INTEGER,
    "targetRetailPriceCents" INTEGER,
    "askingPriceCents" INTEGER,
    "minimumApprovedCents" INTEGER,
    "dateListed" TIMESTAMP(3),
    "dateSold" TIMESTAMP(3),
    "finalSalePriceCents" INTEGER,
    "trackerDeviceId" TEXT,
    "trackerStatus" "TrackerStatus" NOT NULL DEFAULT 'NOT_INSTALLED',
    "trackerLastLatitude" DOUBLE PRECISION,
    "trackerLastLongitude" DOUBLE PRECISION,
    "trackerLastSeenAt" TIMESTAMP(3),
    "trackerGeofenceState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_photos" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storagePath" TEXT,
    "alt" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_status_events" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fromStatus" "VehicleStatus",
    "toStatus" "VehicleStatus" NOT NULL,
    "note" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_recon_items" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "issue" TEXT NOT NULL,
    "vendor" TEXT,
    "estimateCents" INTEGER NOT NULL DEFAULT 0,
    "actualCostCents" INTEGER,
    "status" "ReconStatus" NOT NULL DEFAULT 'ESTIMATED',
    "approvedByStaff" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_recon_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "vendor" TEXT,
    "incurredOn" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "preferredContact" "ContactMethod" NOT NULL DEFAULT 'ANY',
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "notes" TEXT,
    "leadSource" "LeadSource" NOT NULL DEFAULT 'WEBSITE_INQUIRY',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" "LeadSource" NOT NULL DEFAULT 'WEBSITE_INQUIRY',
    "assignedToId" TEXT,
    "summary" TEXT,
    "lostReason" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "body" TEXT NOT NULL,
    "fromStatus" "LeadStatus",
    "toStatus" "LeadStatus",
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "leadId" TEXT,
    "salespersonId" TEXT,
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "askingPriceCents" INTEGER NOT NULL DEFAULT 0,
    "negotiatedPriceCents" INTEGER,
    "salePriceCents" INTEGER,
    "dealerFeesCents" INTEGER NOT NULL DEFAULT 0,
    "financeType" "FinanceType" NOT NULL DEFAULT 'UNDECIDED',
    "lenderName" TEXT,
    "aprBasisPoints" INTEGER,
    "termMonths" INTEGER,
    "downPaymentCents" INTEGER,
    "amountFinancedCents" INTEGER,
    "tradeInVehicleId" TEXT,
    "tradeInAllowanceCents" INTEGER,
    "saleDate" TIMESTAMP(3),
    "deliveryDate" TIMESTAMP(3),
    "titleWorkStatus" "OfficialWorkflowStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "registrationStatus" "OfficialWorkflowStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "officialNotes" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "dealId" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "depositRefundable" BOOLEAN NOT NULL DEFAULT true,
    "depositCollectedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_drive_requests" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "customerId" TEXT,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "preferredDate" TIMESTAMP(3),
    "preferredTime" TEXT,
    "status" "TestDriveStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_drive_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_vehicles" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "visitorKey" TEXT,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_documents" (
    "id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "dealId" TEXT,
    "customerId" TEXT,
    "vehicleId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "storagePath" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "templateKey" TEXT,
    "signedAt" TIMESTAMP(3),
    "signatureName" TEXT,
    "uploadedById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing_candidates" (
    "id" TEXT NOT NULL,
    "source" "SourcingSource" NOT NULL,
    "status" "SourcingCandidateStatus" NOT NULL DEFAULT 'INBOX',
    "vin" TEXT,
    "year" INTEGER,
    "make" TEXT,
    "model" TEXT,
    "trim" TEXT,
    "mileage" INTEGER,
    "listingUrl" TEXT,
    "listingTitle" TEXT,
    "sellerName" TEXT,
    "sellerPhone" TEXT,
    "sellerEmail" TEXT,
    "sellerType" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "customerId" TEXT,
    "conditionNotes" TEXT,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customerExpectedValueCents" INTEGER,
    "drivable" BOOLEAN,
    "askingPriceCents" INTEGER NOT NULL DEFAULT 0,
    "expectedAuctionFeesCents" INTEGER NOT NULL DEFAULT 0,
    "transportEstimateCents" INTEGER NOT NULL DEFAULT 0,
    "estimatedReconCents" INTEGER NOT NULL DEFAULT 0,
    "otherCostsCents" INTEGER NOT NULL DEFAULT 0,
    "estimatedRetailCents" INTEGER NOT NULL DEFAULT 0,
    "minGrossProfitCents" INTEGER NOT NULL DEFAULT 0,
    "minRoiBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "evaluatedAt" TIMESTAMP(3),
    "landedCostCents" INTEGER,
    "expectedProfitCents" INTEGER,
    "expectedRoiBasisPoints" INTEGER,
    "maxPurchasePriceCents" INTEGER,
    "maxBidCents" INTEGER,
    "recommendation" "SourcingRecommendation",
    "recommendationReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNotes" TEXT,
    "purchasedVehicleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sourcing_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "createdById" TEXT,
    "customerId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "vehicleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "name" TEXT NOT NULL DEFAULT 'Dealer Digital',
    "tagline" TEXT NOT NULL DEFAULT 'Quality used vehicles, honestly priced.',
    "addressLine1" TEXT,
    "city" TEXT DEFAULT '',
    "state" TEXT DEFAULT 'TX',
    "postalCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "dealerLicenseNumber" TEXT,
    "legalDisclaimer" TEXT,
    "defaultAprBasisPoints" INTEGER NOT NULL DEFAULT 899,
    "defaultTermMonths" INTEGER NOT NULL DEFAULT 60,
    "defaultDownPaymentCents" INTEGER NOT NULL DEFAULT 200000,
    "financingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reservationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultDepositCents" INTEGER NOT NULL DEFAULT 50000,
    "depositRefundable" BOOLEAN NOT NULL DEFAULT true,
    "reservationHoldHours" INTEGER NOT NULL DEFAULT 72,
    "minGrossProfitCents" INTEGER NOT NULL DEFAULT 150000,
    "minRoiBasisPoints" INTEGER NOT NULL DEFAULT 1000,
    "demoMode" BOOLEAN NOT NULL DEFAULT true,
    "heroHeadline" TEXT DEFAULT '',
    "heroSubtext" TEXT DEFAULT '',
    "aboutText" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealer_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_vin_key" ON "vehicles"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_stockNumber_key" ON "vehicles"("stockNumber");

-- CreateIndex
CREATE INDEX "vehicles_status_idx" ON "vehicles"("status");

-- CreateIndex
CREATE INDEX "vehicles_listingStatus_idx" ON "vehicles"("listingStatus");

-- CreateIndex
CREATE INDEX "vehicles_make_model_idx" ON "vehicles"("make", "model");

-- CreateIndex
CREATE INDEX "vehicles_year_idx" ON "vehicles"("year");

-- CreateIndex
CREATE INDEX "vehicles_askingPriceCents_idx" ON "vehicles"("askingPriceCents");

-- CreateIndex
CREATE INDEX "vehicles_mileage_idx" ON "vehicles"("mileage");

-- CreateIndex
CREATE INDEX "vehicles_acquisitionDate_idx" ON "vehicles"("acquisitionDate");

-- CreateIndex
CREATE INDEX "vehicles_trackerDeviceId_idx" ON "vehicles"("trackerDeviceId");

-- CreateIndex
CREATE INDEX "vehicle_photos_vehicleId_sortOrder_idx" ON "vehicle_photos"("vehicleId", "sortOrder");

-- CreateIndex
CREATE INDEX "vehicle_status_events_vehicleId_createdAt_idx" ON "vehicle_status_events"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "vehicle_recon_items_vehicleId_status_idx" ON "vehicle_recon_items"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "expenses_vehicleId_idx" ON "expenses"("vehicleId");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "expenses_incurredOn_idx" ON "expenses"("incurredOn");

-- CreateIndex
CREATE INDEX "customers_lastName_firstName_idx" ON "customers"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_email_idx" ON "customers"("email");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_customerId_idx" ON "leads"("customerId");

-- CreateIndex
CREATE INDEX "leads_vehicleId_idx" ON "leads"("vehicleId");

-- CreateIndex
CREATE INDEX "leads_assignedToId_idx" ON "leads"("assignedToId");

-- CreateIndex
CREATE INDEX "leads_nextFollowUpAt_idx" ON "leads"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "lead_activities_leadId_createdAt_idx" ON "lead_activities"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "deals_status_idx" ON "deals"("status");

-- CreateIndex
CREATE INDEX "deals_vehicleId_idx" ON "deals"("vehicleId");

-- CreateIndex
CREATE INDEX "deals_customerId_idx" ON "deals"("customerId");

-- CreateIndex
CREATE INDEX "deals_saleDate_idx" ON "deals"("saleDate");

-- CreateIndex
CREATE INDEX "reservations_vehicleId_status_idx" ON "reservations"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "reservations_customerId_idx" ON "reservations"("customerId");

-- CreateIndex
CREATE INDEX "reservations_status_idx" ON "reservations"("status");

-- CreateIndex
CREATE INDEX "test_drive_requests_vehicleId_idx" ON "test_drive_requests"("vehicleId");

-- CreateIndex
CREATE INDEX "test_drive_requests_status_idx" ON "test_drive_requests"("status");

-- CreateIndex
CREATE INDEX "test_drive_requests_preferredDate_idx" ON "test_drive_requests"("preferredDate");

-- CreateIndex
CREATE INDEX "saved_vehicles_customerId_idx" ON "saved_vehicles"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_vehicles_vehicleId_visitorKey_key" ON "saved_vehicles"("vehicleId", "visitorKey");

-- CreateIndex
CREATE UNIQUE INDEX "saved_vehicles_vehicleId_customerId_key" ON "saved_vehicles"("vehicleId", "customerId");

-- CreateIndex
CREATE INDEX "deal_documents_dealId_idx" ON "deal_documents"("dealId");

-- CreateIndex
CREATE INDEX "deal_documents_customerId_idx" ON "deal_documents"("customerId");

-- CreateIndex
CREATE INDEX "deal_documents_vehicleId_idx" ON "deal_documents"("vehicleId");

-- CreateIndex
CREATE INDEX "deal_documents_type_status_idx" ON "deal_documents"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sourcing_candidates_purchasedVehicleId_key" ON "sourcing_candidates"("purchasedVehicleId");

-- CreateIndex
CREATE INDEX "sourcing_candidates_status_idx" ON "sourcing_candidates"("status");

-- CreateIndex
CREATE INDEX "sourcing_candidates_source_idx" ON "sourcing_candidates"("source");

-- CreateIndex
CREATE INDEX "sourcing_candidates_recommendation_idx" ON "sourcing_candidates"("recommendation");

-- CreateIndex
CREATE INDEX "sourcing_candidates_createdAt_idx" ON "sourcing_candidates"("createdAt");

-- CreateIndex
CREATE INDEX "tasks_status_dueAt_idx" ON "tasks"("status", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_assignedToId_idx" ON "tasks"("assignedToId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_status_events" ADD CONSTRAINT "vehicle_status_events_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_status_events" ADD CONSTRAINT "vehicle_status_events_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_recon_items" ADD CONSTRAINT "vehicle_recon_items_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_tradeInVehicleId_fkey" FOREIGN KEY ("tradeInVehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_drive_requests" ADD CONSTRAINT "test_drive_requests_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_drive_requests" ADD CONSTRAINT "test_drive_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_vehicles" ADD CONSTRAINT "saved_vehicles_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_vehicles" ADD CONSTRAINT "saved_vehicles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_documents" ADD CONSTRAINT "deal_documents_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_documents" ADD CONSTRAINT "deal_documents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_documents" ADD CONSTRAINT "deal_documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_documents" ADD CONSTRAINT "deal_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_candidates" ADD CONSTRAINT "sourcing_candidates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_candidates" ADD CONSTRAINT "sourcing_candidates_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_candidates" ADD CONSTRAINT "sourcing_candidates_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_candidates" ADD CONSTRAINT "sourcing_candidates_purchasedVehicleId_fkey" FOREIGN KEY ("purchasedVehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

