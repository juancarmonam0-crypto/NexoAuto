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
// Market intelligence (MarketCheck class of data)
//
// The ECONOMIC ENGINE NEVER SEES A PROVIDER RESPONSE. Everything below is the
// normalized shape a provider must produce, so the acquisition maths cannot
// become coupled to one vendor's field names and a second provider can be
// dropped in without touching Analyze.
//
// Two rules, inherited from the rest of this file:
//   - a provider that cannot answer returns `unavailable`/`error`, never a guess
//   - every value carries the provider it came from and when it was retrieved
// ---------------------------------------------------------------------------

/** One comparable vehicle offered for sale in the market. */
export interface MarketComparable {
  /** Provider that supplied this row. */
  source: string;
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mileage?: number;
  /** The ADVERTISED price. Advertised is not sold; the policy accounts for that. */
  askingPriceCents?: number;
  distanceMiles?: number;
  dealerName?: string;
  /** "franchise" | "independent" | provider's own wording. */
  dealerType?: string;
  listingUrl?: string;
  /** How long the listing has been advertised, when the provider reports it. */
  listedDaysAgo?: number;
}

export interface MarketValuationRequest {
  vin: string;
  mileage: number;
  /** Market region, when the dealer has one configured. */
  zip?: string;
  /**
   * Bypass Nexo's own cache and ask the provider again. Set by the operator's
   * deliberate "Refresh market data" action: without it the flag would be
   * collected in the UI and silently ignored, which is worse than not offering
   * the button at all.
   */
  forceRefresh?: boolean;
  /** Fallbacks used only when the VIN alone is not enough to search the market. */
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
}

/**
 * A retrieval of market evidence, normalized.
 *
 * `predictedPriceCents` is the provider's own estimate and is NULL when the
 * provider (or the plan) does not offer one — never a number we invented from
 * the comparable prices.
 */
export interface MarketValuationSnapshot {
  vin: string;
  provider: string;
  /** When the evidence was RETRIEVED from the provider. */
  generatedAt: Date;
  /** False when this snapshot was served from Nexo's own cache. */
  retrievedLive: boolean;
  predictedPriceCents: number | null;
  predictedLowCents: number | null;
  predictedHighCents: number | null;
  /** How many comparables the provider said exist, even if fewer were returned. */
  comparableCountReported: number;
  comparables: MarketComparable[];
  /** Provider-reported facts worth showing, in the provider's own words. */
  notes: string[];
}

export interface MarketValuationProvider {
  readonly name: string;
  availability(): ProviderAvailability;
  /**
   * Retrieves market evidence for one vehicle. MUST NOT throw for a provider
   * failure: return `unavailable` or `error` so Analyze can fall back.
   */
  valuate(request: MarketValuationRequest): Promise<ProviderResult<MarketValuationSnapshot>>;
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
