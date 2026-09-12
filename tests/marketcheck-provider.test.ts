import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MarketcheckMarketProvider,
  clearMarketCache,
  marketCacheKey,
  marketCacheSize,
  marketCacheTtlMinutes,
  marketcheckApiKey,
  normalizeMarketcheckListing,
  scrubApiKeyFromUrl,
} from "@/lib/providers/marketcheck";
import type {
  MarketComparable,
  MarketValuationRequest,
  MarketValuationSnapshot,
  ProviderResult,
} from "@/lib/providers/types";
import { deriveConservativeRetail } from "@/lib/market-valuation";
import { evaluateOpportunity, resolveSourcingThresholds } from "@/lib/operations";

/**
 * MARKETCHECK — the provider, the policy, and the acquisition chain.
 *
 * WHAT THIS FILE PROVES
 *   1. The provider never invents a number: every failure mode (bad key, no
 *      entitlement, quota, bad parameters, 5xx, timeout, unreachable, unreadable
 *      body) returns `unavailable`/`error` with NO snapshot attached.
 *   2. Money crosses the boundary exactly once, as integer cents
 *      (`Math.round(dollars * 100)`), and the ADVERTISED price is not a sold
 *      price.
 *   3. The API key cannot leave the server: it is never in the JSON of a
 *      snapshot, and it is scrubbed out of provider-supplied listing URLs even
 *      though `append_api_key=false` was requested (a vendor default is not a
 *      guarantee).
 *   4. The market -> acquisition chain is real: the normalized snapshot goes
 *      through `deriveConservativeRetail()` and its `retailCents` is fed to the
 *      EXISTING engine (`evaluateOpportunity()`), with no second formula
 *      anywhere in this file.
 *
 * NO NETWORK, EVER
 * `globalThis.fetch` is replaced with `vi.fn()` in `beforeEach` and every
 * response is a hand-built object. `afterEach` re-scans every URL the provider
 * ever requested and fails the test if any `api_key` other than the obvious
 * fake `test-key-123` was sent, so a leaked real credential is a red build
 * rather than a silent charge on the dealership's account.
 *
 * WHERE THE ENGINE LIVES
 * The canonical arithmetic is `evaluateSourcingCandidate()` in
 * `src/lib/sourcing.ts`. `evaluateOpportunity()` and `resolveSourcingThresholds()`
 * are the thin application-layer entry points in `src/lib/operations/sourcing.ts`;
 * this file calls THOSE, so the chain under test is the one production uses.
 *
 * FIXTURE
 * A 2021 Toyota Corolla LE with 67,200 miles (subject VIN 5YFEPRAE9MP123456) and
 * a believable spread of Dallas-area advertised prices from $20,500 to $24,995.50.
 * Every expected number below is hand-computed in the comment above it.
 */

const TEST_KEY = "test-key-123";

const SUBJECT_VIN = "5YFEPRAE9MP123456";
const SUBJECT_MILEAGE = 67_200;
const SUBJECT_ZIP = "75201";

/** The dealership's configured floors, as they would come out of settings. */
const DEALER_SETTINGS = { minGrossProfitCents: 150_000, minRoiBasisPoints: 800 };
/** Fees + transport + recon + other. Nothing else is added to a landed cost. */
const ADDED_COSTS = {
  expectedAuctionFeesCents: 45_000,
  transportEstimateCents: 30_000,
  estimatedReconCents: 120_000,
  otherCostsCents: 0,
};
const ADDED_COSTS_CENTS = 195_000;

/** Comparable VINs are real 17-character shapes (no I, O or Q). */
const VIN_L1 = "5YFBURHE8MP654321";
const VIN_L2 = "JTDEPRAE7LJ098765";
const VIN_L3 = "5YFEPRAE0MP234567";
const VIN_L4 = "5YFBURHE3MP345678";
const VIN_L5 = "5YFEPRAE4MP456789";
const VIN_L6 = "5YFBURHE1MP567890";

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

const ENV_KEYS = [
  "MARKETCHECK_API_KEY",
  "MARKETCHECK_CACHE_TTL_MINUTES",
  "MARKETCHECK_DEALER_TYPE",
  "MARKETCHECK_COUNTRY",
] as const;

const savedEnv = new Map<string, string | undefined>();

let provider: MarketcheckMarketProvider;
let fetchMock: ReturnType<typeof vi.fn>;

/**
 * Every URL the provider requested, and the ONLY credential it may carry.
 *
 * This is the quota-and-secrecy guard: the tests below mock a fake key, so a URL
 * carrying anything else would mean a real credential reached the wire.
 */
function assertOnlyTheFakeKeyWasSent(mock: ReturnType<typeof vi.fn>): void {
  for (const call of mock.mock.calls) {
    const raw = String(call[0]);
    for (const match of raw.matchAll(/[?&](api_key|apikey|key|token)=([^&]*)/gi)) {
      expect(match[2], `credential parameter ${String(match[1])} in ${raw}`).toBe(TEST_KEY);
    }
  }
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.MARKETCHECK_API_KEY = TEST_KEY;

  clearMarketCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  provider = new MarketcheckMarketProvider();
});

afterEach(() => {
  assertOnlyTheFakeKeyWasSent(fetchMock);
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearMarketCache();
});

/* -------------------------------------------------------------------------- */
/* HTTP doubles                                                               */
/* -------------------------------------------------------------------------- */

/** A minimal `Response` stand-in: only what `requestJson()` touches. */
function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): Response {
  const lowered = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function urlsOf(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((call) => String(call[0]));
}

function searchUrlOf(mock: ReturnType<typeof vi.fn>): URL {
  const raw = urlsOf(mock).find((url) => url.includes("/v2/search/car/active"));
  if (raw === undefined) throw new Error("the inventory search request was never issued");
  return new URL(raw);
}

function predictUrlsOf(mock: ReturnType<typeof vi.fn>): URL[] {
  return urlsOf(mock)
    .filter((url) => url.includes("/marketcheck_price"))
    .map((url) => new URL(url));
}

function requireSnapshot(
  result: ProviderResult<MarketValuationSnapshot>,
): MarketValuationSnapshot {
  if (result.status !== "ok" || result.data === undefined) {
    throw new Error(
      `expected an ok snapshot, received ${result.status}: ${result.message ?? "(no message)"}`,
    );
  }
  return result.data;
}

function comparableAt(snapshot: MarketValuationSnapshot, index: number): MarketComparable {
  const row = snapshot.comparables[index];
  if (row === undefined) throw new Error(`expected a comparable at index ${index}`);
  return row;
}

function byVin(snapshot: MarketValuationSnapshot, vin: string): MarketComparable {
  const row = snapshot.comparables.find((comparable) => comparable.vin === vin);
  if (row === undefined) throw new Error(`expected a comparable for VIN ${vin}`);
  return row;
}

function expectIntegerCents(label: string, value: number | null | undefined): void {
  expect(typeof value, `${label} must be a number`).toBe("number");
  expect(Number.isInteger(value), `${label} (${String(value)}) must be integer CENTS`).toBe(true);
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

function requestWithZip(overrides: Partial<MarketValuationRequest> = {}): MarketValuationRequest {
  return {
    vin: SUBJECT_VIN,
    mileage: SUBJECT_MILEAGE,
    zip: SUBJECT_ZIP,
    year: 2021,
    make: "Toyota",
    model: "Corolla",
    trim: "LE",
    ...overrides,
  };
}

/**
 * No ZIP: the prediction endpoint REQUIRES a location, so this request can only
 * produce the inventory search. Used wherever a test wants exactly one fetch.
 */
function requestNoZip(overrides: Partial<MarketValuationRequest> = {}): MarketValuationRequest {
  return {
    vin: SUBJECT_VIN,
    mileage: SUBJECT_MILEAGE,
    year: 2021,
    make: "Toyota",
    model: "Corolla",
    trim: "LE",
    ...overrides,
  };
}

/** No VIN: the search falls back to year/make/model and the prediction is illegal. */
function requestByYearMakeModel(): MarketValuationRequest {
  return {
    vin: "",
    mileage: SUBJECT_MILEAGE,
    zip: SUBJECT_ZIP,
    year: 2021,
    make: "Toyota",
    model: "Corolla",
    trim: "LE",
  };
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

interface SearchEnvelope {
  num_found: number;
  listings: unknown[];
}

/**
 * A realistic `/v2/search/car/active` envelope.
 *
 * `price` is in DOLLARS and may be fractional (MarketCheck quotes whole currency
 * units, not cents) — L1 asks $24,995.50, so the normalized value must be
 * exactly 2,499,550 cents and not 2,499,549 or 2,499,555.
 */
function searchEnvelope(overrides: Partial<SearchEnvelope> = {}): SearchEnvelope {
  const listings: unknown[] = [
    {
      vin: VIN_L1,
      price: 24_995.5,
      miles: 61_200,
      dist: 18.4,
      // The `append_api_key` trap, live: the provider echoed the caller's key
      // into the URL it returned. It must never reach the snapshot.
      vdp_url: `https://dealer.example/vdp/123?api_key=${TEST_KEY}`,
      dom: 12,
      build: { year: 2021, make: "Toyota", model: "Corolla", trim: "LE" },
      dealer: { name: "Sunrise Toyota", dealer_type: "franchise" },
    },
    {
      vin: VIN_L2,
      price: 22_980,
      miles: 71_950,
      dist: 42,
      vdp_url: "https://dealer.example/vdp/456?stock=9",
      // `dom` absent: `dom_active` is the fallback, so this is 33 days.
      dom_active: 33,
      build: { year: 2021, make: "Toyota", model: "Corolla", trim: "LE" },
      dealer: { name: "Metro Motors", dealer_type: "independent" },
    },
    {
      vin: VIN_L3,
      price: 21_450.75,
      miles: 78_400,
      dist: 61.2,
      vdp_url: "https://dealer.example/vdp/789",
      dom: 48,
      build: { year: 2020, make: "Toyota", model: "Corolla", trim: "LE" },
      dealer: { name: "Value Auto Sales", dealer_type: "independent" },
    },
    {
      vin: VIN_L4,
      price: 23_995,
      miles: 54_800,
      dist: 88,
      vdp_url: "https://dealer.example/vdp/321",
      // Both present: `dom` wins, so 7 — not 99.
      dom: 7,
      dom_active: 99,
      build: { year: 2021, make: "Toyota", model: "Corolla", trim: "SE" },
      dealer: { name: "Northside Toyota", dealer_type: "franchise" },
    },
    {
      vin: VIN_L5,
      price: 20_500,
      miles: 66_500,
      dist: 12,
      vdp_url: "https://dealer.example/vdp/654",
      dom: 64,
      build: { year: 2020, make: "Toyota", model: "Corolla", trim: "LE" },
      dealer: { name: "Budget Cars", dealer_type: "independent" },
    },
    {
      // Identified but UNPRICED: kept, with `askingPriceCents` undefined. No
      // `dist` either, which must be `undefined` and never 0 ("unknown
      // distance" and "next door" are different facts).
      vin: VIN_L6,
      miles: 69_000,
      vdp_url: "https://dealer.example/vdp/987",
      dom: 5,
      build: { year: 2021, make: "Toyota", model: "Corolla", trim: "LE" },
      dealer: { name: "No Price Motors", dealer_type: "independent" },
    },
    {
      // Neither identity nor price: dropped, not given invented values.
      dealer: { name: "Ghost Listing" },
      vdp_url: "https://dealer.example/vdp/000",
    },
  ];
  return { num_found: 137, listings, ...overrides };
}

/**
 * The documented `/v2/predict/car/us/marketcheck_price` response. There is no
 * `price_range` field; the range comes from the prediction's own comparable
 * percentiles, which is why the keys are the strings "25.0" and "75.0".
 */
const PREDICTION_PAYLOAD = {
  marketcheck_price: 23_650,
  comparables: {
    stats: { price: { percentiles: { "25.0": 22_400, "75.0": 26_050 } } },
  },
};

/** Routes each mocked response to the endpoint that asked for it. */
function routeFetch(): void {
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/marketcheck_price")) return jsonResponse(200, PREDICTION_PAYLOAD);
    return jsonResponse(200, searchEnvelope());
  });
}

/** Runs the provider once against the routed doubles and returns the snapshot. */
async function retrieveLiveSnapshot(
  request: MarketValuationRequest = requestWithZip(),
): Promise<MarketValuationSnapshot> {
  return requireSnapshot(await provider.valuate(request));
}

/* ========================================================================== */
/* A. Configuration and availability                                          */
/* ========================================================================== */

describe("MarketCheck — configuration and availability", () => {
  it("is unavailable without a key, names it in the message, and never calls fetch", async () => {
    delete process.env.MARKETCHECK_API_KEY;
    expect(marketcheckApiKey()).toBeUndefined();
    // Blank is not configured either — a stray space must not look like a key.
    process.env.MARKETCHECK_API_KEY = "   ";
    expect(marketcheckApiKey()).toBeUndefined();

    const availability = provider.availability();
    expect(availability.status).toBe("unavailable");
    if (availability.status !== "unavailable") throw new Error("expected unavailable");
    expect(availability.reason).toContain("MARKETCHECK_API_KEY");

    const result = await provider.valuate(requestWithZip());
    expect(result.status).toBe("unavailable");
    expect(result.provider).toBe("marketcheck");
    expect(result.message).toContain("MARKETCHECK_API_KEY");
    // No snapshot at all: there is nothing to price against, so nothing is shown.
    expect(result.data).toBeUndefined();

    // The whole point: an unconfigured provider must not spend quota.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is available, and trims the key it will send, once the key is set", () => {
    expect(provider.availability()).toEqual({ status: "available", provider: "marketcheck" });

    process.env.MARKETCHECK_API_KEY = `  ${TEST_KEY}  `;
    expect(marketcheckApiKey()).toBe(TEST_KEY);
    expect(provider.availability().status).toBe("available");
  });

  it("falls back to the 24-hour default for a missing, blank, invalid or non-positive TTL", () => {
    delete process.env.MARKETCHECK_CACHE_TTL_MINUTES;
    expect(marketCacheTtlMinutes()).toBe(1_440);

    process.env.MARKETCHECK_CACHE_TTL_MINUTES = "   ";
    expect(marketCacheTtlMinutes()).toBe(1_440);

    process.env.MARKETCHECK_CACHE_TTL_MINUTES = "not-a-number";
    expect(marketCacheTtlMinutes()).toBe(1_440);

    // 0 and negatives are documented as "use the default", NOT "expire now".
    process.env.MARKETCHECK_CACHE_TTL_MINUTES = "0";
    expect(marketCacheTtlMinutes()).toBe(1_440);

    process.env.MARKETCHECK_CACHE_TTL_MINUTES = "-30";
    expect(marketCacheTtlMinutes()).toBe(1_440);
  });

  it("honours a valid TTL and caps it at one week (10080 minutes)", () => {
    process.env.MARKETCHECK_CACHE_TTL_MINUTES = "120";
    expect(marketCacheTtlMinutes()).toBe(120);

    process.env.MARKETCHECK_CACHE_TTL_MINUTES = "1440";
    expect(marketCacheTtlMinutes()).toBe(1_440);

    process.env.MARKETCHECK_CACHE_TTL_MINUTES = "10080";
    expect(marketCacheTtlMinutes()).toBe(10_080);

    // A misconfigured month of caching would serve evidence older than the market.
    process.env.MARKETCHECK_CACHE_TTL_MINUTES = "99999";
    expect(marketCacheTtlMinutes()).toBe(10_080);
  });
});

/* ========================================================================== */
/* B. Successful retrieval and normalization                                  */
/* ========================================================================== */

describe("MarketCheck — retrieval and normalization", () => {
  it("returns an ok, live snapshot identified by the provider and stamped with a time", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot();

    expect(snapshot.provider).toBe("marketcheck");
    expect(snapshot.retrievedLive).toBe(true);
    expect(snapshot.generatedAt).toBeInstanceOf(Date);
    expect(Number.isFinite(snapshot.generatedAt.getTime())).toBe(true);
    // The subject is echoed back normalized (uppercased, no separators).
    expect(snapshot.vin).toBe(SUBJECT_VIN);
    // `num_found` is what the provider says EXISTS, not how many rows came back.
    expect(snapshot.comparableCountReported).toBe(137);
    // Six of the seven mocked rows survive: one is identified-but-unpriced and
    // one carries neither identity nor price.
    expect(snapshot.comparables).toHaveLength(6);
    expect(snapshot.comparables.every((row) => row.source === "marketcheck")).toBe(true);
  });

  it("converts a fractional DOLLAR price to exact integer cents and maps every field", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot();

    const l1 = byVin(snapshot, VIN_L1);
    // $24,995.50 x 100 = 2,499,550 cents exactly. Cents are integers; a float
    // 24995.5 must never survive past this boundary.
    expect(l1.askingPriceCents).toBe(2_499_550);
    expectIntegerCents("L1 askingPriceCents", l1.askingPriceCents);
    expect(l1.mileage).toBe(61_200);
    expect(l1.distanceMiles).toBe(18.4);
    expect(l1.listedDaysAgo).toBe(12);
    expect(l1.dealerName).toBe("Sunrise Toyota");
    expect(l1.dealerType).toBe("franchise");
    expect(l1.vin).toBe(VIN_L1);
    expect(l1.year).toBe(2021);
    expect(l1.make).toBe("Toyota");
    expect(l1.model).toBe("Corolla");
    expect(l1.trim).toBe("LE");

    // The second fractional price: $21,450.75 -> 2,145,075 cents.
    expect(byVin(snapshot, VIN_L3).askingPriceCents).toBe(2_145_075);
    // Whole-dollar prices stay whole: $22,980 -> 2,298,000 cents.
    expect(byVin(snapshot, VIN_L2).askingPriceCents).toBe(2_298_000);

    for (const row of snapshot.comparables) {
      if (row.askingPriceCents !== undefined) {
        expectIntegerCents(`comparable ${String(row.vin)} askingPriceCents`, row.askingPriceCents);
      }
    }
  });

  it("requests the search endpoint with the documented, quota-safe parameters", async () => {
    routeFetch();
    await retrieveLiveSnapshot();

    const url = searchUrlOf(fetchMock);
    expect(url.origin).toBe("https://api.marketcheck.com");
    expect(url.pathname).toBe("/v2/search/car/active");
    expect(url.searchParams.get("api_key")).toBe(TEST_KEY);
    // The credential must never be appended to the URLs the provider returns.
    expect(url.searchParams.get("append_api_key")).toBe("false");
    // Documented maximum is 50 rows; above it the API silently returns 10.
    const rows = Number(url.searchParams.get("rows"));
    expect(Number.isInteger(rows)).toBe(true);
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(50);
    expect(url.searchParams.get("start")).toBe("0");
    expect(url.searchParams.get("car_type")).toBe("used");
    // Identified by VIN, so the year/make/model fallback is not also sent.
    expect(url.searchParams.get("vin")).toBe(SUBJECT_VIN);
    expect(url.searchParams.get("year")).toBeNull();
    expect(url.searchParams.get("zip")).toBe(SUBJECT_ZIP);
  });

  it("keeps an identified listing with no price and drops a listing with no identity and no price", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot();

    // "No price" is a fact the policy treats as unpriced — not a reason to drop
    // the row, and certainly not a reason to invent a number.
    const unpriced = byVin(snapshot, VIN_L6);
    expect(unpriced.askingPriceCents).toBeUndefined();
    expect(unpriced.mileage).toBe(69_000);

    // The anonymous row is gone entirely.
    expect(snapshot.comparables.some((row) => row.dealerName === "Ghost Listing")).toBe(false);
    expect(snapshot.notes.join(" ")).toContain(
      "1 of 7 returned listings carried no usable identity or price and were ignored.",
    );
  });

  it("reports an absent distance as unknown (never 0) and falls back to dom_active", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot();

    // No `dist` in the response means "not reported": 0 would claim the car is
    // next door, which is a different (and fabricated) fact.
    expect(byVin(snapshot, VIN_L6).distanceMiles).toBeUndefined();
    expect(byVin(snapshot, VIN_L1).distanceMiles).toBe(18.4);

    // `dom` absent, `dom_active` present -> 33 days on market.
    expect(byVin(snapshot, VIN_L2).listedDaysAgo).toBe(33);
    // Both present -> the canonical `dom` wins (7), not the fallback (99).
    expect(byVin(snapshot, VIN_L4).listedDaysAgo).toBe(7);
  });
});

/* ========================================================================== */
/* C. The price prediction endpoint                                           */
/* ========================================================================== */

describe("MarketCheck — the separately priced price prediction", () => {
  it("uses marketcheck_price and the comparable percentiles as integer cents", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot();

    // marketcheck_price 23650 dollars -> 2,365,000 cents.
    expect(snapshot.predictedPriceCents).toBe(2_365_000);
    // 25th percentile 22400 dollars -> 2,240,000 cents.
    expect(snapshot.predictedLowCents).toBe(2_240_000);
    // 75th percentile 26050 dollars -> 2,605,000 cents.
    expect(snapshot.predictedHighCents).toBe(2_605_000);
    expectIntegerCents("predictedPriceCents", snapshot.predictedPriceCents);
    expectIntegerCents("predictedLowCents", snapshot.predictedLowCents);
    expectIntegerCents("predictedHighCents", snapshot.predictedHighCents);

    // A second request went to the documented Base-tier prediction path with
    // every parameter it requires: vin + miles + dealer_type + zip.
    const predictions = predictUrlsOf(fetchMock);
    expect(predictions).toHaveLength(1);
    const url = predictions[0]!;
    expect(url.pathname).toBe("/v2/predict/car/us/marketcheck_price");
    expect(url.searchParams.get("vin")).toBe(SUBJECT_VIN);
    expect(url.searchParams.get("miles")).toBe(String(SUBJECT_MILEAGE));
    expect(url.searchParams.get("dealer_type")).toBe("independent");
    expect(url.searchParams.get("zip")).toBe(SUBJECT_ZIP);
    expect(url.searchParams.get("append_api_key")).toBe("false");
    expect(url.searchParams.get("api_key")).toBe(TEST_KEY);
  });

  it("degrades to comparable-only evidence when the plan answers 403 on the prediction", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/marketcheck_price")) return jsonResponse(403, { error: "not entitled" });
      return jsonResponse(200, searchEnvelope());
    });

    const result = await provider.valuate(requestWithZip());
    expect(result.status).toBe("ok");
    const snapshot = requireSnapshot(result);

    // The inventory search is the backbone: a 403 on the OPTIONAL product must
    // not fail the analysis, only remove the prediction.
    expect(snapshot.comparables).toHaveLength(6);
    expect(snapshot.comparableCountReported).toBe(137);
    expect(snapshot.predictedPriceCents).toBeNull();
    expect(snapshot.predictedLowCents).toBeNull();
    expect(snapshot.predictedHighCents).toBeNull();
    expect(snapshot.notes.join(" ")).toContain("HTTP 403");
  });

  it("does not request the prediction without a ZIP, and says why", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot(requestNoZip());

    // Exactly one request: the prediction needs a location, so it is never formed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(predictUrlsOf(fetchMock)).toHaveLength(0);
    expect(snapshot.predictedPriceCents).toBeNull();
    expect(snapshot.notes.join(" ")).toContain("No market price prediction was requested");
  });

  it("does not request the prediction without a VIN, even when mileage and ZIP are present", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot(requestByYearMakeModel());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(predictUrlsOf(fetchMock)).toHaveLength(0);
    // The fallback search is the year/make/model one, and the snapshot says so.
    const url = searchUrlOf(fetchMock);
    expect(url.searchParams.get("vin")).toBeNull();
    expect(url.searchParams.get("year")).toBe("2021");
    expect(url.searchParams.get("make")).toBe("Toyota");
    expect(url.searchParams.get("model")).toBe("Corolla");
    expect(snapshot.vin).toBe("");
    expect(snapshot.notes.join(" ")).toContain("searched by year, make and model");
    expect(snapshot.predictedPriceCents).toBeNull();
  });

  it("issues the search and the prediction in PARALLEL, not serially", async () => {
    let releaseSearch: (() => void) | undefined;
    const searchGate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });

    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/marketcheck_price")) {
        // The prediction request exists while the search is still unresolved,
        // which is what releases it below.
        releaseSearch?.();
        return jsonResponse(200, PREDICTION_PAYLOAD);
      }
      // A SERIAL implementation would await this forever (the prediction would
      // never be issued), so this test would time out instead of passing.
      await searchGate;
      return jsonResponse(200, searchEnvelope());
    });

    const result = await provider.valuate(requestWithZip());
    expect(result.status).toBe("ok");

    // Both went out. Order is asserted only as a set: `Promise.all` dispatches
    // them together and neither is required to finish first.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = urlsOf(fetchMock);
    expect(urls.some((url) => url.includes("/v2/search/car/active"))).toBe(true);
    expect(urls.some((url) => url.includes("/v2/predict/car/us/marketcheck_price"))).toBe(true);
  }, 2_000);
});

/* ========================================================================== */
/* D. Failure modes — never a fabricated value                                */
/* ========================================================================== */

describe("MarketCheck — failure modes never fabricate a value", () => {
  it("401 is unavailable and points at MARKETCHECK_API_KEY", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "invalid api key" }));
    const result = await provider.valuate(requestNoZip());

    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("401");
    expect(result.message).toContain("MARKETCHECK_API_KEY");
    expect(result.data).toBeUndefined();
  });

  it("403 on the SEARCH call is unavailable: the backbone failed", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: "not entitled" }));
    const result = await provider.valuate(requestNoZip());

    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("403");
    expect(result.data).toBeUndefined();
  });

  it("429 is unavailable, mentions quota/rate limit, and reports Retry-After seconds", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, { error: "rate limited" }, { "Retry-After": "37" }),
    );
    const result = await provider.valuate(requestNoZip());

    expect(result.status).toBe("unavailable");
    expect(result.message).toMatch(/quota|rate limit/i);
    expect(result.message).toContain("37 seconds");
    expect(result.data).toBeUndefined();
  });

  it("422 is an error (not unavailable) and reports the status", async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: "bad vin" }));
    const result = await provider.valuate(requestNoZip());

    // 422 is OUR bad parameter, not the provider being absent: the operator has
    // to fix the VIN, so this is an error rather than an unavailable provider.
    expect(result.status).toBe("error");
    expect(result.message).toContain("422");
    expect(result.data).toBeUndefined();
  });

  it("500 is an error naming the status", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: "boom" }));
    const result = await provider.valuate(requestNoZip());

    expect(result.status).toBe("error");
    expect(result.message).toContain("500");
    expect(result.data).toBeUndefined();
  });

  it("a thrown TimeoutError is an error that names the timeout", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);
    const result = await provider.valuate(requestNoZip());

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/timed out|timeout/i);
    expect(result.data).toBeUndefined();
  });

  it("a thrown generic network error is an error that says unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.marketcheck.com"));
    const result = await provider.valuate(requestNoZip());

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/unreachable/i);
    expect(result.data).toBeUndefined();
  });

  it("a 200 whose body is not an object is an error, with no crash", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, null));
    const nullBody = await provider.valuate(requestNoZip());
    expect(nullBody.status).toBe("error");
    expect(nullBody.message).toContain("could not read");
    expect(nullBody.data).toBeUndefined();

    // A bare JSON string is valid JSON but not an envelope. Nothing was cached
    // by the failed attempt, so this really is a second request.
    fetchMock.mockResolvedValue(jsonResponse(200, "not an envelope"));
    const stringBody = await provider.valuate(requestNoZip());
    expect(stringBody.status).toBe("error");
    expect(stringBody.message).toContain("could not read");
    expect(stringBody.data).toBeUndefined();
  });

  it("num_found 0 with no listings is ok, empty, and says so", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, searchEnvelope({ num_found: 0, listings: [] })));
    const result = await provider.valuate(requestNoZip());

    // An EMPTY market is a real answer, not a failure — but it is not a value
    // either, so the snapshot must carry zero comparables and no prediction.
    expect(result.status).toBe("ok");
    const snapshot = requireSnapshot(result);
    expect(snapshot.comparables).toEqual([]);
    expect(snapshot.comparableCountReported).toBe(0);
    expect(snapshot.predictedPriceCents).toBeNull();
    expect(snapshot.notes.join(" ")).toContain("no comparable listings");
  });
});

/* ========================================================================== */
/* E. Caching and quota discipline                                            */
/* ========================================================================== */

describe("MarketCheck — caching and quota discipline", () => {
  it("serves a second identical request from cache, with no fetch and the same numbers", async () => {
    routeFetch();
    const request = requestNoZip();

    const first = await retrieveLiveSnapshot(request);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const secondResult = await provider.valuate(request);
    const second = requireSnapshot(secondResult);

    // No second paid call: the same VIN is not queried twice in a row.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.retrievedLive).toBe(false);
    expect(marketCacheSize()).toBe(1);
    // `retrievedLive` is the ONLY difference — same evidence, same numbers.
    expect({ ...second, retrievedLive: true }).toEqual(first);
  });

  it("bypasses the cache when the operator asks to refresh market data", async () => {
    // Without this, the "Refresh market data" button would collect a flag the
    // provider never read: the UI would promise fresh evidence and quietly serve
    // the cached snapshot. `forceRefresh` is what makes the button honest.
    const request = requestWithZip();
    routeFetch();

    const first = requireSnapshot(await provider.valuate(request));
    expect(first.retrievedLive).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // search + prediction

    // The cached read: no further provider traffic.
    const cachedRead = requireSnapshot(await provider.valuate(request));
    expect(cachedRead.retrievedLive).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The deliberate refresh: the provider is asked again and the new evidence
    // is reported as live rather than as cached.
    const refreshed = requireSnapshot(await provider.valuate({ ...request, forceRefresh: true }));
    expect(refreshed.retrievedLive).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keys the cache on the VIN, the mileage and the ZIP", () => {
    const base = requestWithZip();
    const key = marketCacheKey(base);

    // Identical inputs: identical key (so the second call is a cache hit).
    expect(marketCacheKey({ ...base })).toBe(key);
    // A VIN typed in lower case with stray spaces is the same vehicle.
    expect(marketCacheKey({ ...base, vin: ` ${SUBJECT_VIN.toLowerCase()} ` })).toBe(key);

    // Every field that changes the market answer changes the key.
    expect(marketCacheKey({ ...base, mileage: SUBJECT_MILEAGE + 1 })).not.toBe(key);
    expect(marketCacheKey({ ...base, mileage: SUBJECT_MILEAGE + 5_000 })).not.toBe(key);
    expect(marketCacheKey({ ...base, zip: "75202" })).not.toBe(key);
    expect(marketCacheKey({ ...base, vin: VIN_L1 })).not.toBe(key);
    // No ZIP and a ZIP are different queries, so they must not share an entry.
    expect(marketCacheKey(requestNoZip())).not.toBe(key);
  });

  it("reuses a cached entry whose TTL cannot have expired (no fake timers)", async () => {
    // One minute. Even a slow test suite cannot consume it, and the clock is
    // NOT faked: faking weeks of expiry would prove nothing about real time.
    process.env.MARKETCHECK_CACHE_TTL_MINUTES = "1";
    expect(marketCacheTtlMinutes()).toBe(1);

    routeFetch();
    const request = requestNoZip();
    await retrieveLiveSnapshot(request);
    const second = requireSnapshot(await provider.valuate(request));

    expect(second.retrievedLive).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(marketCacheSize()).toBe(1);
  });

  it("treats MARKETCHECK_CACHE_TTL_MINUTES=0 as the default TTL, not as 'expire now'", async () => {
    process.env.MARKETCHECK_CACHE_TTL_MINUTES = "0";
    // Documented behaviour: 0 is not a valid TTL, so the 24-hour default stands.
    expect(marketCacheTtlMinutes()).toBe(1_440);

    routeFetch();
    const request = requestNoZip();
    await retrieveLiveSnapshot(request);
    const second = requireSnapshot(await provider.valuate(request));

    // If 0 had meant "expire immediately", this would have been a second paid call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.retrievedLive).toBe(false);
  });
});

/* ========================================================================== */
/* F. SECURITY — the API key must never leave the server                      */
/* ========================================================================== */

describe("MarketCheck — the API key never leaves the server", () => {
  it("contains no key in the serialized snapshot and scrubs it out of returned URLs", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot();

    // The snapshot is what a server component hands to the browser: if the key
    // were anywhere in it, it would be published.
    expect(JSON.stringify(snapshot)).not.toContain(TEST_KEY);
    expect(snapshot.comparables.some((row) => (row.listingUrl ?? "").includes(TEST_KEY))).toBe(
      false,
    );

    // The provider echoed `?api_key=...` in its vdp_url (the append_api_key
    // trap). It comes back with the parameter deleted.
    expect(byVin(snapshot, VIN_L1).listingUrl).toBe("https://dealer.example/vdp/123");
    expect(byVin(snapshot, VIN_L1).listingUrl).not.toContain(TEST_KEY);
    // Other query parameters are evidence-adjacent and must survive.
    expect(byVin(snapshot, VIN_L2).listingUrl).toBe("https://dealer.example/vdp/456?stock=9");
  });

  it("scrubApiKeyFromUrl removes api_key and apikey and leaves the rest intact", () => {
    expect(
      scrubApiKeyFromUrl("https://dealer.example/vdp/1?api_key=test-key-123&stock=9", TEST_KEY),
    ).toBe("https://dealer.example/vdp/1?stock=9");

    expect(scrubApiKeyFromUrl("https://dealer.example/vdp/1?apikey=abc123&stock=9", "abc123")).toBe(
      "https://dealer.example/vdp/1?stock=9",
    );

    // A key that leaked into some OTHER parameter is redacted too, because the
    // URL parser cannot know which parameter is "the" credential.
    const leaked = scrubApiKeyFromUrl(
      "https://dealer.example/vdp/1?api_key=test-key-123&utm_source=test-key-123",
      TEST_KEY,
    );
    expect(leaked).not.toContain(TEST_KEY);
    expect(leaked).toContain("redacted");
    expect(leaked).toContain("utm_source");
  });

  it("scrubApiKeyFromUrl handles an unparseable value without throwing", () => {
    // `new URL()` throws on both of these; a throw here would break a whole page.
    expect(scrubApiKeyFromUrl("not a url at all", TEST_KEY)).toBe("not a url at all");
    expect(scrubApiKeyFromUrl("vdp/123?api_key=test-key-123", TEST_KEY)).toBe(
      "vdp/123?api_key=[redacted]",
    );

    expect(scrubApiKeyFromUrl(undefined, TEST_KEY)).toBeUndefined();
    expect(scrubApiKeyFromUrl("", TEST_KEY)).toBe("");
    expect(scrubApiKeyFromUrl("https://x.test/a", undefined)).toBe("https://x.test/a");
    expect(() => scrubApiKeyFromUrl("https://x.test/?api_key=test-key-123", TEST_KEY)).not.toThrow();
  });
});

/* ========================================================================== */
/* B (continued). The normalization contract, unit level                      */
/* ========================================================================== */

describe("MarketCheck — the normalization contract, unit level", () => {
  it("returns null for anything that is not a listing object", () => {
    expect(normalizeMarketcheckListing(null)).toBeNull();
    expect(normalizeMarketcheckListing(undefined)).toBeNull();
    expect(normalizeMarketcheckListing("listing")).toBeNull();
    expect(normalizeMarketcheckListing(42)).toBeNull();
    // No identity AND no price: dropped rather than filled with invented values.
    expect(normalizeMarketcheckListing({ dealer: { name: "Ghost" } })).toBeNull();
  });

  it("keeps an identified listing whose price is missing, zero or negative", () => {
    for (const price of [undefined, 0, -1, null]) {
      // A listing VIN is uppercased (the request VIN additionally goes through
      // `normalizeVin`, which also strips spaces and dashes — not this path).
      const row = normalizeMarketcheckListing({ vin: "5yfburhe8mp654321", price });
      // 0 and negatives are "no usable price", NOT "free" and NOT a negative cost.
      expect(row?.askingPriceCents, `price ${String(price)}`).toBeUndefined();
      expect(row?.vin).toBe("5YFBURHE8MP654321");
    }
  });

  it("coerces a numeric-string price, prefers dom, and scrubs the URL with the given key", () => {
    const row = normalizeMarketcheckListing(
      {
        vin: "5yfburhe8mp654321",
        price: "18500",
        miles: "62000",
        dist: "12.5",
        dom: 9,
        dom_active: 40,
        vdp_url: `https://dealer.example/vdp/1?api_key=${TEST_KEY}&stock=7`,
        build: { year: "2021", make: "Toyota", model: "Corolla", trim: "LE" },
        dealer: { name: "Example", dealer_type: "franchise" },
      },
      TEST_KEY,
    );

    expect(row).not.toBeNull();
    expect(row?.askingPriceCents).toBe(1_850_000);
    expect(row?.mileage).toBe(62_000);
    expect(row?.distanceMiles).toBe(12.5);
    expect(row?.listedDaysAgo).toBe(9);
    expect(row?.year).toBe(2021);
    expect(row?.listingUrl).toBe("https://dealer.example/vdp/1?stock=7");
  });
});

/* ========================================================================== */
/* G. The market -> acquisition chain (no duplicated math)                    */
/* ========================================================================== */

describe("MarketCheck -> deriveConservativeRetail -> evaluateOpportunity", () => {
  it("prices a 2021 Corolla LE end-to-end and calls it a BUY at a realistic ask", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot();

    // ---- the conservative policy reads the LIVE snapshot
    const derived = deriveConservativeRetail({ snapshot, mileage: SUBJECT_MILEAGE });

    /**
     * THE ARITHMETIC, HAND-COMPUTED.
     *
     * Relevance band = max(10,000, round(67,200 x 25%)) = 16,800 miles, so every
     * priced comparable between 50,400 and 84,000 miles counts: L1 (61,200),
     * L2 (71,950), L3 (78,400), L4 (54,800), L5 (66,500) — five of them, which
     * clears MIN_COMPARABLES_FOR_DISTRIBUTION = 3. L6 is unpriced and ignored.
     *
     * Advertised prices, sorted: 2,050,000 / 2,145,075 / 2,298,000 / 2,399,500
     * / 2,499,550, so the median (odd count) is 2,298,000.
     *   comparable candidate = 2,298,000 - ceil(2,298,000 x 300bps) = 2,298,000 - 68,940
     *                        = 2,229,060 cents
     *   prediction candidate = 2,365,000 - ceil(2,365,000 x 200bps) = 2,365,000 - 47,300
     *                        = 2,317,700 cents
     * The policy takes the LOWER source: 2,229,060 -> rounded DOWN to whole
     * dollars = 2,229,000 cents ($22,290). The comparable distribution is the
     * binding (lower) source, hence `market-comparables`.
     */
    expect(derived.retailCents).toBe(2_229_000);
    expect(derived.source).toBe("market-comparables");
    expect(derived.marketEstimateCents).toBe(2_229_000);
    expect(derived.overridden).toBe(false);
    // The two candidates are within 382bps of each other, inside the 1000bp
    // agreement band, so confidence is high.
    expect(derived.confidence).toBe("high");
    expect(derived.evidence.predictionCandidateCents).toBe(2_317_700);
    expect(derived.evidence.comparableCandidateCents).toBe(2_229_060);
    expect(derived.evidence.comparableSummary?.used).toBe(5);
    expect(derived.evidence.comparableSummary?.medianAskingCents).toBe(2_298_000);
    expectIntegerCents("derived.retailCents", derived.retailCents);

    // ---- the EXISTING engine consumes that retail number
    const thresholds = resolveSourcingThresholds(DEALER_SETTINGS);
    expect(thresholds).toEqual({ minGrossProfitCents: 150_000, minRoiBasisPoints: 800 });

    const evaluation = evaluateOpportunity(
      {
        askingPriceCents: 1_795_000, // $17,950 — a realistic dealer ask
        ...ADDED_COSTS,
        estimatedRetailCents: derived.retailCents!,
      },
      thresholds,
    );

    /**
     * Ceilings, hand-computed from the engine's documented formulas:
     *   gross floor: 2,229,000 - 150,000 - 195,000 = 1,884,000
     *   ROI floor:   floor(2,229,000 x 10,000 / 10,800) - 195,000
     *              = floor(2,063,888.88) - 195,000 = 1,868,888 -> 1,868,800
     * The ROI floor is lower, so it binds and MAX BUY = 1,868,800.
     */
    expect(evaluation.maxPurchasePriceCents).toBe(1_868_800);
    expect(evaluation.maxBidCents).toBe(1_868_800); // a bid IS a purchase price
    expect(evaluation.bindingConstraint).toBe("roi-floor");

    // Landed cost is asking + added costs, by definition.
    expect(evaluation.addedCostsCents).toBe(ADDED_COSTS_CENTS);
    expect(evaluation.landedCostCents).toBe(1_990_000);
    expect(evaluation.landedCostCents).toBe(1_795_000 + evaluation.addedCostsCents);
    // Expected profit = retail - landed = 2,229,000 - 1,990,000 = 239,000.
    expect(evaluation.expectedProfitCents).toBe(239_000);
    // ROI = round(239,000 / 1,990,000 x 10,000) = round(1201.005) = 1201bps.
    expect(evaluation.expectedRoiBasisPoints).toBe(1_201);

    // $17,950 is below the ceiling and clears both floors, so: BUY.
    expect(evaluation.recommendation).toBe("BUY");

    for (const [label, value] of [
      ["landedCostCents", evaluation.landedCostCents],
      ["addedCostsCents", evaluation.addedCostsCents],
      ["expectedProfitCents", evaluation.expectedProfitCents],
      ["maxPurchasePriceCents", evaluation.maxPurchasePriceCents],
      ["maxBidCents", evaluation.maxBidCents],
      ["overMaxByCents", evaluation.overMaxByCents],
    ] as const) {
      expectIntegerCents(label, value);
    }
  });

  it("is a PASS when the ask is far above the maximum buy", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot();
    const derived = deriveConservativeRetail({ snapshot, mileage: SUBJECT_MILEAGE });

    const evaluation = evaluateOpportunity(
      {
        askingPriceCents: 2_600_000, // $26,000 — well above the 1,868,800 ceiling
        ...ADDED_COSTS,
        estimatedRetailCents: derived.retailCents!,
      },
      resolveSourcingThresholds(DEALER_SETTINGS),
    );

    // WHY PASS AND NOT WATCH: the engine returns WATCH only when the deal is
    // still PROFITABLE but misses a threshold. Here landed cost is
    // 2,600,000 + 195,000 = 2,795,000 against a 2,229,000 retail, so the
    // expected profit is -566,000: the unit loses money as priced, and the
    // engine's final branch is PASS.
    expect(evaluation.landedCostCents).toBe(2_795_000);
    expect(evaluation.expectedProfitCents).toBe(-566_000);
    expect(evaluation.recommendation).toBe("PASS");
    expect(evaluation.overMaxByCents).toBe(2_600_000 - 1_868_800);
  });

  it("honours a manual override without destroying the market estimate", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot();

    const MANUAL = 2_600_000; // the operator knows this unit is worth more
    const derived = deriveConservativeRetail({
      snapshot,
      mileage: SUBJECT_MILEAGE,
      manualRetailCents: MANUAL,
    });

    expect(derived.source).toBe("manual");
    expect(derived.retailCents).toBe(MANUAL);
    expect(derived.overridden).toBe(true);
    // Overriding never erases what the market said.
    expect(derived.marketEstimateCents).toBe(2_229_000);
    // Confidence describes market agreement, and the market number is not in use.
    expect(derived.confidence).toBeNull();
    expect(derived.reasons.join(" ")).toContain("overrode the market estimate");
  });

  it("produces an evaluation consistent with the override, and a higher override raises MAX BUY", async () => {
    routeFetch();
    const snapshot = await retrieveLiveSnapshot();
    const thresholds = resolveSourcingThresholds(DEALER_SETTINGS);
    const costs = { ...ADDED_COSTS, askingPriceCents: 1_795_000 };

    const market = deriveConservativeRetail({ snapshot, mileage: SUBJECT_MILEAGE });
    const overridden = deriveConservativeRetail({
      snapshot,
      mileage: SUBJECT_MILEAGE,
      manualRetailCents: 2_600_000,
    });

    const fromMarket = evaluateOpportunity(
      { ...costs, estimatedRetailCents: market.retailCents! },
      thresholds,
    );
    const fromOverride = evaluateOpportunity(
      { ...costs, estimatedRetailCents: overridden.retailCents! },
      thresholds,
    );

    // Same car, same costs, same thresholds: only the retail assumption moved.
    //   gross floor: 2,600,000 - 150,000 - 195,000 = 2,255,000
    //   ROI floor:   floor(2,600,000 x 10,000 / 10,800) - 195,000
    //              = floor(2,407,407.40) - 195,000 = 2,212,407 -> 2,212,400
    // ROI binds again, so MAX BUY rises from 1,868,800 to 2,212,400.
    expect(fromOverride.maxPurchasePriceCents).toBe(2_212_400);
    expect(fromOverride.maxBidCents).toBe(2_212_400);
    expect(fromOverride.maxPurchasePriceCents).toBeGreaterThan(fromMarket.maxPurchasePriceCents);

    // And the evaluation follows the override: profit 2,600,000 - 1,990,000 = 610,000,
    // ROI = round(610,000 / 1,990,000 x 10,000) = 3,065bps, both above the floors.
    expect(fromOverride.landedCostCents).toBe(1_990_000);
    expect(fromOverride.expectedProfitCents).toBe(610_000);
    expect(fromOverride.expectedRoiBasisPoints).toBe(3_065);
    expect(fromOverride.recommendation).toBe("BUY");

    expectIntegerCents("override maxPurchasePriceCents", fromOverride.maxPurchasePriceCents);
    expectIntegerCents("override expectedProfitCents", fromOverride.expectedProfitCents);
  });

  it("still runs the acquisition analysis when the market is down, using the manual number", async () => {
    // The provider is unreachable: no snapshot at all.
    fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.marketcheck.com"));
    const result = await provider.valuate(requestWithZip());
    expect(result.status).toBe("error");
    expect(result.data).toBeUndefined();

    const MANUAL = 1_900_000;
    const derived = deriveConservativeRetail({
      snapshot: null,
      mileage: SUBJECT_MILEAGE,
      manualRetailCents: MANUAL,
    });

    expect(derived.retailCents).toBe(MANUAL);
    expect(derived.source).toBe("manual");
    expect(derived.overridden).toBe(true);
    // There was no market number to preserve, and none was invented.
    expect(derived.marketEstimateCents).toBeNull();
    expect(derived.evidence.comparableSummary).toBeNull();

    const evaluation = evaluateOpportunity(
      {
        askingPriceCents: 1_795_000,
        ...ADDED_COSTS,
        estimatedRetailCents: derived.retailCents!,
      },
      resolveSourcingThresholds(DEALER_SETTINGS),
    );

    // Hand-computed: gross floor 1,900,000 - 150,000 - 195,000 = 1,555,000;
    // ROI floor floor(1,900,000 x 10,000 / 10,800) - 195,000 = 1,564,200.
    // The gross floor is lower, so it binds: MAX BUY = 1,555,000.
    expect(evaluation.maxPurchasePriceCents).toBe(1_555_000);
    expect(evaluation.bindingConstraint).toBe("gross-profit-floor");
    // At that retail the asking price is still too high: profit = -90,000.
    expect(evaluation.landedCostCents).toBe(1_990_000);
    expect(evaluation.expectedProfitCents).toBe(-90_000);
    expect(evaluation.recommendation).toBe("PASS");
  });

  it("refuses to produce a market evaluation with no evidence and no manual number", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    await provider.valuate(requestWithZip());

    const derived = deriveConservativeRetail({
      snapshot: null,
      mileage: SUBJECT_MILEAGE,
      manualRetailCents: null,
    });

    // WHY THIS MATTERS: `retailCents: null` is the contract's "I will not guess".
    // The market is down, no operator number exists, and there is no comparable
    // distribution to lean on, so NO acquisition evaluation can be produced from
    // the market. The caller must ask the operator for the expected retail
    // before the engine can score anything — this module never fills the gap.
    expect(derived.retailCents).toBeNull();
    expect(derived.source).toBe("none");
    expect(derived.marketEstimateCents).toBeNull();
    expect(derived.overridden).toBe(false);
    expect(derived.reasons.join(" ")).toContain("will not guess a retail value");

    // The engine's own honest behaviour when it is handed "no estimate": 0 is
    // the only representable stand-in, and it produces WATCH with an explicit
    // "cannot be scored" reason rather than a BUY on a fabricated number.
    const evaluation = evaluateOpportunity(
      { askingPriceCents: 1_795_000, ...ADDED_COSTS, estimatedRetailCents: 0 },
      resolveSourcingThresholds(DEALER_SETTINGS),
    );
    expect(evaluation.recommendation).toBe("WATCH");
    expect(evaluation.reasons.join(" ")).toContain("cannot be scored");
    expect(evaluation.expectedProfitCents).toBe(-1_990_000);
  });
});
