/**
 * External data provider contracts.
 *
 * WHY THIS FILE EXISTS
 * Dealer Digital does NOT have access to Manheim, Copart, IAA, Carfax,
 * AutoCheck, Facebook Marketplace, KBB, Black Book or any lender. Nothing in
 * this application may imply otherwise. Instead, every external data need is
 * expressed as an interface with an explicit "not configured" state, so a real
 * integration can be dropped in without redesigning the product.
 *
 * Rules for implementations:
 *   - Return `{ status: "unavailable" }` rather than inventing a value.
 *   - Never fabricate history, condition, valuation or approval data.
 *   - Never scrape a source that forbids it, bypass a CAPTCHA, or use a fake
 *     account. Server-to-server APIs with credentials only.
 *   - Keep credentials server-side. They are never sent to the browser and
 *     never rendered in the UI.
 */

export type ProviderAvailability =
  | { status: "available"; provider: string }
  | { status: "unavailable"; reason: string };

export interface ProviderResult<T> {
  status: "ok" | "unavailable" | "error";
  data?: T;
  /** Human-readable explanation shown to staff when data is missing. */
  message?: string;
  provider: string;
}

export function providerUnavailable<T>(provider: string, reason: string): ProviderResult<T> {
  return { status: "unavailable", provider, message: reason };
}

// ---------------------------------------------------------------------------
// VIN decoding
// ---------------------------------------------------------------------------

export interface VinDecodeResult {
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  fuelType?: string;
  transmission?: string;
  drivetrain?: string;
  bodyType?: string;
  doors?: number;
  seats?: number;
  manufacturer?: string;
  /** Fields the decoder could not resolve, surfaced so staff can fill them. */
  missingFields: string[];
}

export interface VinDecodeProvider {
  readonly name: string;
  availability(): ProviderAvailability;
  decode(vin: string): Promise<ProviderResult<VinDecodeResult>>;
}

// ---------------------------------------------------------------------------
// Vehicle history (Carfax / AutoCheck class of data)
// ---------------------------------------------------------------------------

export interface VehicleHistoryReport {
  vin: string;
  source: string;
  accidentCount?: number;
  titleBrands?: string[];
  odometerReading?: number;
  ownerCount?: number;
  reportedAt: Date;
  rawUrl?: string;
}

export interface VehicleHistoryProvider {
  readonly name: string;
  availability(): ProviderAvailability;
  /** Must return an unavailable result until a licensed feed is configured. */
  fetchReport(vin: string): Promise<ProviderResult<VehicleHistoryReport>>;
}

// ---------------------------------------------------------------------------
// Retail valuation (KBB / Black Book / MMR class of data)
// ---------------------------------------------------------------------------

export interface ValuationRequest {
  vin?: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  mileage: number;
  condition?: string;
}

export interface ValuationResult {
  retailCents: number;
  wholesaleCents?: number;
  tradeInCents?: number;
  source: string;
  asOf: Date;
}

export interface VehicleValuationProvider {
  readonly name: string;
  availability(): ProviderAvailability;
  estimateRetail(request: ValuationRequest): Promise<ProviderResult<ValuationResult>>;
}

// ---------------------------------------------------------------------------
// Auction / marketplace feeds
// ---------------------------------------------------------------------------

export interface AuctionFeedQuery {
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  mileageMax?: number;
  limit?: number;
}

export interface AuctionFeedCandidate {
  externalId: string;
  source: string;
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mileage?: number;
  currentBidCents?: number;
  buyNowCents?: number;
  auctionEndsAt?: Date;
  location?: string;
  url?: string;
  /** Feed-reported fees, when the source publishes them. */
  disclosedFeesCents?: number;
}

export interface AuctionFeedProvider {
  readonly name: string;
  availability(): ProviderAvailability;
  listCandidates(query: AuctionFeedQuery): Promise<ProviderResult<AuctionFeedCandidate[]>>;
}

// ---------------------------------------------------------------------------
// Lenders
// ---------------------------------------------------------------------------

export interface LenderRateQuoteRequest {
  amountFinancedCents: number;
  termMonths: number;
  creditTier?: string;
  vehicleYear?: number;
  vehicleMileage?: number;
}

export interface LenderRateQuote {
  lender: string;
  aprBasisPoints: number;
  termMonths: number;
  quotedAt: Date;
  expiresAt?: Date;
}

export interface LenderProvider {
  readonly name: string;
  availability(): ProviderAvailability;
  /** Must not be implemented as a fake approval. Quotes only, when configured. */
  quoteRates(request: LenderRateQuoteRequest): Promise<ProviderResult<LenderRateQuote[]>>;
}

// ---------------------------------------------------------------------------
// GPS (Traccar)
// ---------------------------------------------------------------------------

export interface TrackerPosition {
  deviceId: string;
  latitude: number;
  longitude: number;
  speedKnots?: number;
  courseDegrees?: number;
  fixTime: Date;
  valid: boolean;
}

export interface TrackerDevice {
  deviceId: string;
  name: string;
  status: "online" | "offline" | "unknown";
  lastUpdate?: Date;
}

export interface GpsProvider {
  readonly name: string;
  availability(): ProviderAvailability;
  listDevices(): Promise<ProviderResult<TrackerDevice[]>>;
  getLatestPosition(deviceId: string): Promise<ProviderResult<TrackerPosition>>;
}

// ---------------------------------------------------------------------------
// Registry of everything the product can optionally talk to.
// ---------------------------------------------------------------------------

export interface ProviderSummary {
  key: string;
  label: string;
  availability: ProviderAvailability;
  /** What a real integration would need. Shown on the admin integrations page. */
  requirement: string;
}

export const NOT_CONFIGURED = "Not configured";
