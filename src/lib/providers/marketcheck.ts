/**
 * MARKETCHECK — the market-intelligence provider.
 *
 * WHAT IT IS FOR
 * MarketCheck publishes live dealer inventory and a market price prediction.
 * This module turns those responses into the ONE normalized shape the rest of
 * Nexo understands (`MarketValuationSnapshot`), so the acquisition maths never
 * becomes coupled to a vendor's field names and a second provider can be added
 * without touching Analyze.
 *
 * SERVER-ONLY, BY CONSTRUCTION
 * The API key is read from `process.env.MARKETCHECK_API_KEY` inside this module,
 * which is only ever imported by server code (the action boundary and the
 * provider registry). It is never returned in a snapshot, never logged, and
 * never placed in a contract.
 *
 * THE KEY-LEAK TRAP THIS MODULE CLOSES
 * MarketCheck's inventory search appends the caller's API key to the URLs it
 * returns (`append_api_key` defaults to TRUE). Handing a listing URL straight to
 * the browser would therefore publish the credential. Every request sends
 * `append_api_key=false`, AND every URL that leaves this module is scrubbed of
 * any `api_key` parameter, because a default is not a guarantee.
 *
 * VERIFIED AGAINST THE PUBLISHED DOCS (docs.marketcheck.com, August 2025 state)
 *   host            https://api.marketcheck.com  + /v2/   (staging: stag-mc-api)
 *   auth            `api_key` QUERY PARAMETER. There is no documented api_key header.
 *   inventory       GET /v2/search/car/active  -> { num_found, listings[] }
 *   prediction      GET /v2/predict/car/us/marketcheck_price          (Base)
 *                   GET /v2/predict/car/us/marketcheck_price/comparables (Premium)
 *                   Requires vin + miles + dealer_type + (zip OR city+state).
 *                   The response field is `marketcheck_price`; there is NO
 *                   `price_range` field, so a range is derived from the
 *                   comparables' `stats.price.percentiles`.
 *   NOT used        /v2/predict/car/us/price — that legacy path returns 404.
 *   limits          rows max 50 (above that it silently falls back to 10);
 *                   Free 500 calls/month at 5 rps, account-wide.
 *   failures        401 bad key, 403 not entitled to the endpoint, 422 invalid
 *                   VIN/params, 429 quota or rate limit, 120 s gateway timeout.
 *
 * The prediction is a SEPARATELY PRICED product: an unentitled key gets 403. So
 * it is attempted but never depended on — a 403 degrades to comparable-only
 * evidence instead of failing the analysis.
 *
 * MONEY AT THE BOUNDARY
 * MarketCheck quotes whole currency units (USD for /us/) as JSON numbers. They
 * are converted to integer cents exactly once, here, at the edge —
 * `Math.round(amount * 100)`. No other module in Nexo sees a dollar amount.
 */

import {
  type MarketComparable,
  type MarketValuationProvider,
  type MarketValuationRequest,
  type MarketValuationSnapshot,
  type ProviderAvailability,
  type ProviderResult,
  providerUnavailable,
} from "./types";
import { isValidVinShape, normalizeVin } from "./vin-decode";

const MARKETCHECK_HOST = "https://api.marketcheck.com";
/** Active dealer listings — the comparable ADVERTISED prices. */
const SEARCH_PATH = "/v2/search/car/active";
/** MarketCheck Price, Base tier. Separately priced; may answer 403. */
const PREDICT_PATH = "/v2/predict/car/us/marketcheck_price";
/** Canada mirrors the same paths under /ca/ when country is configured. */
const PREDICT_PATH_CA = "/v2/predict/car/ca/marketcheck_price";

const REQUEST_TIMEOUT_MS = 9_000;
/** One page is enough evidence for a 2-5 car dealership, and rows must be <= 50. */
const DEFAULT_ROWS = 30;
const MAX_ROWS = 50;
const DEFAULT_RADIUS_MILES = 100;
const DEFAULT_CACHE_TTL_MINUTES = 1_440;

export const MARKETCHECK_PROVIDER_NAME = "marketcheck";

/** Franchise vs independent materially changes the predicted price. */
const DEFAULT_DEALER_TYPE = "independent";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/** The API key, read server-side only. Returns undefined when not configured. */
export function marketcheckApiKey(): string | undefined {
  const raw = process.env.MARKETCHECK_API_KEY;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Which side of the market we are pricing against. Default: independent. */
export function marketcheckDealerType(): "franchise" | "independent" {
  const raw = process.env.MARKETCHECK_DEALER_TYPE?.trim().toLowerCase();
  return raw === "franchise" ? "franchise" : DEFAULT_DEALER_TYPE;
}

/** Market region: "us" (default) or "ca". */
function marketcheckCountry(): "us" | "ca" {
  return process.env.MARKETCHECK_COUNTRY?.trim().toLowerCase() === "ca" ? "ca" : "us";
}

/**
 * How long a retrieved snapshot is reused before another paid call, in minutes.
 * Default 24 hours: comparable inventory does not move fast enough to justify
 * re-querying the same VIN, and the dealership is a 2-5 car operation.
 * Capped at one week so a misconfigured value cannot serve month-old evidence.
 */
export function marketCacheTtlMinutes(): number {
  const raw = process.env.MARKETCHECK_CACHE_TTL_MINUTES;
  const parsed = raw === undefined || raw.trim() === "" ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CACHE_TTL_MINUTES;
  return Math.min(parsed, 10_080);
}

/* -------------------------------------------------------------------------- */
/* Cache — module-scope, per server instance                                  */
/* -------------------------------------------------------------------------- */

interface CacheEntry {
  expiresAt: number;
  snapshot: MarketValuationSnapshot;
}

/**
 * WHY AN IN-MEMORY CACHE AND NOT A TABLE
 * The brief prefers no schema change for V1, and market snapshots are cheap to
 * re-derive: a cache exists to stop the SAME VIN being queried twice in a row,
 * which is the actual quota risk for a microdealer. The trade-off is documented
 * rather than hidden: this cache lives per server instance, so a cold start or a
 * second instance costs one more API call, and `retrievedLive` on every snapshot
 * always tells the operator which one they are looking at.
 */
const cache = new Map<string, CacheEntry>();

export function marketCacheKey(request: MarketValuationRequest): string {
  const vin = request.vin === undefined || request.vin === "" ? "-" : normalizeVin(request.vin);
  const identity = [request.year ?? "", request.make ?? "", request.model ?? "", request.trim ?? ""]
    .join("|")
    .toLowerCase();
  return `${vin}::${identity}::${Math.round(request.mileage)}::${request.zip ?? "-"}`;
}

/** Clears the cache. Used by tests; also a deliberate escape hatch for ops. */
export function clearMarketCache(): void {
  cache.clear();
}

export function marketCacheSize(): number {
  return cache.size;
}

/* -------------------------------------------------------------------------- */
/* Parsing helpers                                                            */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asInteger(value: unknown): number | undefined {
  const parsed = asNumber(value);
  return parsed === undefined ? undefined : Math.round(parsed);
}

/** Whole currency units (possibly fractional, possibly a string) -> integer cents. */
function toCents(value: unknown): number | undefined {
  const amount = asNumber(value);
  if (amount === undefined || amount <= 0) return undefined;
  return Math.round(amount * 100);
}

/**
 * Removes any API key from a provider-supplied URL.
 *
 * MarketCheck appends the caller's key to returned URLs unless
 * `append_api_key=false` is sent. We send it — and scrub anyway, because a
 * vendor default is not a guarantee and this URL goes to a browser.
 */
export function scrubApiKeyFromUrl(url: string | undefined, key: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("api_key");
    parsed.searchParams.delete("apikey");
    let result = parsed.toString();
    if (key !== undefined && key !== "") result = result.split(key).join("[redacted]");
    return result;
  } catch {
    // Not a parseable URL: fall back to blunt removal rather than pass it through.
    if (key !== undefined && key !== "" && url.includes(key)) {
      return url.split(key).join("[redacted]");
    }
    return url;
  }
}

/**
 * Normalizes one inventory listing. Every field is optional: a listing without a
 * price is still returned (the policy counts it as unpriced) rather than being
 * dropped or given a made-up value.
 */
export function normalizeMarketcheckListing(raw: unknown, apiKey?: string): MarketComparable | null {
  const listing = asRecord(raw);
  if (!listing) return null;

  const build = asRecord(listing.build);
  const dealer = asRecord(listing.dealer);

  const comparable: MarketComparable = {
    source: MARKETCHECK_PROVIDER_NAME,
    vin: asString(listing.vin)?.toUpperCase(),
    year: asInteger(build?.year),
    make: asString(build?.make),
    model: asString(build?.model),
    trim: asString(build?.trim),
    mileage: asInteger(listing.miles),
    askingPriceCents: toCents(listing.price),
    // `dist` is present only for a geographically scoped search ("distance" is
    // the fabricated name in third-party examples; the API uses `dist`).
    distanceMiles: asNumber(listing.dist),
    dealerName: asString(dealer?.name),
    dealerType: asString(dealer?.dealer_type),
    listingUrl: scrubApiKeyFromUrl(asString(listing.vdp_url), apiKey),
    listedDaysAgo: asInteger(listing.dom) ?? asInteger(listing.dom_active),
  };

  const hasIdentity =
    comparable.vin !== undefined ||
    comparable.year !== undefined ||
    comparable.make !== undefined ||
    comparable.model !== undefined;
  if (!hasIdentity && comparable.askingPriceCents === undefined) return null;

  return comparable;
}

/** Extracts a percentile from the documented `stats.price.percentiles` shape. */
function percentilePrice(listing: unknown, percentileKey: string): number | undefined {
  const stats = asRecord(asRecord(listing)?.stats);
  const price = asRecord(stats?.price);
  const percentiles = asRecord(price?.percentiles);
  if (!percentiles) return undefined;
  return toCents(percentiles[percentileKey]);
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                       */
/* -------------------------------------------------------------------------- */

interface HttpOutcome {
  status: number;
  payload?: unknown;
  /** Present when the request never produced an HTTP response. */
  transportError?: "timeout" | "network";
  retryAfter?: string;
}

async function requestJson(url: string): Promise<HttpOutcome> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    const retryAfter = response.headers.get("Retry-After") ?? undefined;
    if (!response.ok) return { status: response.status, retryAfter };
    return { status: response.status, payload: (await response.json()) as unknown, retryAfter };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    return { status: 0, transportError: isTimeout ? "timeout" : "network" };
  }
}

/** The operator-facing meaning of a non-2xx from either endpoint. */
function describeHttpFailure(outcome: HttpOutcome, what: string): { unavailable: boolean; message: string } {
  if (outcome.transportError === "timeout") {
    return {
      unavailable: false,
      message: `The market data request timed out while looking up ${what}. Enter the expected retail value manually, or try again.`,
    };
  }
  if (outcome.transportError === "network") {
    return {
      unavailable: false,
      message: `The market data provider is unreachable while looking up ${what}. Enter the expected retail value manually.`,
    };
  }
  switch (outcome.status) {
    case 401:
      return {
        unavailable: true,
        message:
          "MarketCheck rejected the configured API key (HTTP 401), so market data is unavailable. Check MARKETCHECK_API_KEY, or enter the expected retail value manually.",
      };
    case 403:
      return {
        unavailable: true,
        message: `The MarketCheck plan is not authorized for ${what} (HTTP 403). Market data is unavailable; enter the expected retail value manually.`,
      };
    case 422:
      return {
        unavailable: false,
        message: `MarketCheck could not process this request (HTTP 422) — usually an undecodable VIN or a parameter it rejected. Check the VIN, or enter the expected retail value manually.`,
      };
    case 429:
      return {
        unavailable: true,
        message: `The MarketCheck quota or rate limit is exhausted (HTTP 429)${outcome.retryAfter ? `; retry after ${outcome.retryAfter} seconds` : ""}. Enter the expected retail value manually; the monthly quota resets at the start of the next calendar month.`,
      };
    default:
      return {
        unavailable: false,
        message: `MarketCheck responded with HTTP ${outcome.status}. Enter the expected retail value manually.`,
      };
  }
}

/* -------------------------------------------------------------------------- */
/* The provider                                                               */
/* -------------------------------------------------------------------------- */

export class MarketcheckMarketProvider implements MarketValuationProvider {
  readonly name = MARKETCHECK_PROVIDER_NAME;

  availability(): ProviderAvailability {
    if (marketcheckApiKey() === undefined) {
      return {
        status: "unavailable",
        reason:
          "MARKETCHECK_API_KEY is not configured, so market data is unavailable. Analyze works without it: enter the expected retail value manually.",
      };
    }
    return { status: "available", provider: this.name };
  }

  async valuate(request: MarketValuationRequest): Promise<ProviderResult<MarketValuationSnapshot>> {
    const availability = this.availability();
    if (availability.status === "unavailable") {
      return providerUnavailable(this.name, availability.reason);
    }

    const key = marketcheckApiKey();
    if (key === undefined) return providerUnavailable(this.name, "MARKETCHECK_API_KEY is not configured.");

    // ---- identify the subject vehicle
    const vin = request.vin === undefined || request.vin.trim() === "" ? undefined : normalizeVin(request.vin);
    if (vin !== undefined && !isValidVinShape(vin)) {
      return {
        status: "error",
        provider: this.name,
        message: "That does not look like a valid VIN (17 characters, no I, O or Q).",
      };
    }
    if (vin === undefined && (request.year === undefined || !request.make || !request.model)) {
      return {
        status: "error",
        provider: this.name,
        message: "A VIN, or a year, make and model, is needed to search the market.",
      };
    }

    // ---- cache (skipped deliberately when the operator asks for fresh data)
    const cacheKey = marketCacheKey({ ...request, vin: vin ?? "" });
    const ttlMs = marketCacheTtlMinutes() * 60_000;
    const cached = cache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > Date.now() && request.forceRefresh !== true) {
      return { status: "ok", provider: this.name, data: { ...cached.snapshot, retrievedLive: false } };
    }

    const country = marketcheckCountry();

    // ---- request 1: comparable inventory
    const searchParams = new URLSearchParams();
    searchParams.set("api_key", key);
    searchParams.set("car_type", "used");
    searchParams.set("rows", String(Math.min(DEFAULT_ROWS, MAX_ROWS)));
    searchParams.set("start", "0");
    // Never let the provider decorate returned URLs with our credential.
    searchParams.set("append_api_key", "false");
    if (country === "ca") searchParams.set("country", "ca");
    if (vin !== undefined) {
      searchParams.set("vin", vin);
    } else {
      searchParams.set("year", String(request.year));
      searchParams.set("make", request.make as string);
      searchParams.set("model", request.model as string);
      if (request.trim) searchParams.set("trim", request.trim);
    }
    if (request.zip) {
      searchParams.set("zip", request.zip);
      searchParams.set("radius", String(DEFAULT_RADIUS_MILES));
    }
    const searchUrl = `${MARKETCHECK_HOST}${SEARCH_PATH}?${searchParams.toString()}`;

    // ---- request 2: the price prediction. REQUIRES vin + miles + dealer_type +
    //      a location, and is a separately priced product that may answer 403, so
    //      it is attempted only when it can legally be asked and is never fatal.
    const canPredict = vin !== undefined && request.mileage > 0 && Boolean(request.zip);
    const predictParams = new URLSearchParams();
    if (canPredict) {
      predictParams.set("api_key", key);
      predictParams.set("vin", vin as string);
      predictParams.set("miles", String(Math.round(request.mileage)));
      predictParams.set("dealer_type", marketcheckDealerType());
      predictParams.set("zip", request.zip as string);
      predictParams.set("append_api_key", "false");
    }
    const predictPath = country === "ca" ? PREDICT_PATH_CA : PREDICT_PATH;
    const predictUrl = `${MARKETCHECK_HOST}${predictPath}?${predictParams.toString()}`;

    // The two lookups are independent: run them together rather than serially.
    const [searchOutcome, predictOutcome] = await Promise.all([
      requestJson(searchUrl),
      canPredict ? requestJson(predictUrl) : Promise.resolve<HttpOutcome>({ status: 0 }),
    ]);

    // ---- the inventory search is the backbone: if IT fails, so does the valuation
    if (searchOutcome.status !== 200 || searchOutcome.payload === undefined) {
      const failure = describeHttpFailure(searchOutcome, "comparable listings");
      return failure.unavailable
        ? providerUnavailable(this.name, failure.message)
        : { status: "error", provider: this.name, message: failure.message };
    }

    const envelope = asRecord(searchOutcome.payload);
    if (!envelope) {
      return {
        status: "error",
        provider: this.name,
        message: "MarketCheck returned a response Nexo could not read, so no market value is shown.",
      };
    }

    const rawListings = Array.isArray(envelope.listings) ? envelope.listings : [];
    const comparables = rawListings
      .map((row) => normalizeMarketcheckListing(row, key))
      .filter((row): row is MarketComparable => row !== null);
    const numFound = asInteger(envelope.num_found) ?? comparables.length;

    const notes: string[] = [];

    // ---- the prediction is optional evidence
    let predictedPriceCents: number | null = null;
    let predictedLowCents: number | null = null;
    let predictedHighCents: number | null = null;

    if (!canPredict) {
      notes.push(
        "No market price prediction was requested: it needs a VIN, a mileage and a dealer ZIP code, and one of those was missing. Comparable listings are the evidence used.",
      );
    } else if (predictOutcome.status === 200 && predictOutcome.payload !== undefined) {
      const prediction = asRecord(predictOutcome.payload);
      predictedPriceCents = prediction ? (toCents(prediction.marketcheck_price) ?? null) : null;
      // There is no `price_range` field in the documented response. When the
      // plan returns the Premium tier, the range comes from the prediction's own
      // comparable statistics, which live under `comparables.stats.price`.
      const predictionComparables = asRecord(prediction?.comparables);
      predictedLowCents = percentilePrice(predictionComparables, "25.0") ?? null;
      predictedHighCents = percentilePrice(predictionComparables, "75.0") ?? null;
      notes.push(
        predictedPriceCents === null
          ? "MarketCheck answered the price request without a usable `marketcheck_price` value, so only comparable listings were used."
          : `MarketCheck's own price prediction (${marketcheckDealerType()} dealer type) is shown alongside the comparable distribution, and the conservative policy discounts it.`,
      );
    } else if (predictOutcome.status === 403) {
      notes.push(
        "The MarketCheck plan is not authorized for the price prediction endpoint (HTTP 403), so the valuation uses comparable listings only.",
      );
    } else if (predictOutcome.status !== 0) {
      notes.push(
        `The price prediction endpoint did not return a value (HTTP ${predictOutcome.status}); the valuation uses comparable listings only.`,
      );
    }

    if (comparables.length === 0) {
      notes.push(
        predictedPriceCents === null
          ? "MarketCheck returned no comparable listings for this vehicle in the search area, so there is nothing to price against."
          : "MarketCheck returned no comparable listings for this vehicle, so the valuation rests on the price prediction alone.",
      );
    }
    if (rawListings.length > 0 && comparables.length < rawListings.length) {
      notes.push(
        `${rawListings.length - comparables.length} of ${rawListings.length} returned listings carried no usable identity or price and were ignored.`,
      );
    }
    if (vin === undefined) {
      notes.push("The market was searched by year, make and model because no VIN was supplied.");
    }
    notes.push(
      "Prices shown are ADVERTISED prices from active listings, not sold prices; the conservative policy discounts them accordingly.",
    );

    const snapshot: MarketValuationSnapshot = {
      vin: vin ?? "",
      provider: this.name,
      generatedAt: new Date(),
      retrievedLive: true,
      predictedPriceCents,
      predictedLowCents,
      predictedHighCents,
      comparableCountReported: numFound,
      comparables,
      notes,
    };

    cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, snapshot });
    return { status: "ok", provider: this.name, data: snapshot };
  }
}

export const marketValuationProvider: MarketValuationProvider = new MarketcheckMarketProvider();
