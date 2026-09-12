import type {
  AuctionFeedProvider,
  LenderProvider,
  ProviderAvailability,
  ProviderResult,
  ProviderSummary,
  ValuationRequest,
  ValuationResult,
  VehicleHistoryProvider,
  VehicleHistoryReport,
  VehicleValuationProvider,
} from "./types";
import { providerUnavailable } from "./types";
import { vinDecodeProvider } from "./vin-decode";
import { gpsProvider } from "./traccar";

/**
 * Providers that are deliberately NOT implemented.
 *
 * Each one documents the credential a real integration would need and refuses
 * to return data. That is the honest behaviour: the product must never display
 * a valuation, history report or rate quote it did not actually receive.
 */

class NotConfiguredProvider {
  readonly requirement: string;
  constructor(
    readonly name: string,
    readonly label: string,
    requirement: string,
  ) {
    this.requirement = requirement;
  }
  availability(): ProviderAvailability {
    return { status: "unavailable", reason: `${this.label} is not configured. ${this.requirement}` };
  }
}

class UnconfiguredHistoryProvider extends NotConfiguredProvider implements VehicleHistoryProvider {
  async fetchReport(vin: string): Promise<ProviderResult<VehicleHistoryReport>> {
    void vin;
    return providerUnavailable(this.name, this.availability().status === "unavailable" ? (this.availability() as { reason: string }).reason : "");
  }
}

class UnconfiguredValuationProvider extends NotConfiguredProvider implements VehicleValuationProvider {
  async estimateRetail(request: ValuationRequest): Promise<ProviderResult<ValuationResult>> {
    void request;
    const availability = this.availability();
    return providerUnavailable(this.name, availability.status === "unavailable" ? availability.reason : "");
  }
}

class UnconfiguredAuctionFeedProvider extends NotConfiguredProvider implements AuctionFeedProvider {
  async listCandidates(): Promise<ProviderResult<never[]>> {
    const availability = this.availability();
    return providerUnavailable(this.name, availability.status === "unavailable" ? availability.reason : "");
  }
}

class UnconfiguredLenderProvider extends NotConfiguredProvider implements LenderProvider {
  async quoteRates(): Promise<ProviderResult<never[]>> {
    const availability = this.availability();
    return providerUnavailable(this.name, availability.status === "unavailable" ? availability.reason : "");
  }
}

export const historyProvider = new UnconfiguredHistoryProvider(
  "vehicle-history",
  "Vehicle history (Carfax / AutoCheck class)",
  "Requires a licensed history feed with an API agreement. This app will not guess accident, title-brand or odometer data.",
);

export const valuationProvider = new UnconfiguredValuationProvider(
  "vehicle-valuation",
  "Retail valuation (KBB / Black Book / MMR class)",
  "Requires a licensed valuation feed. Until then, staff enter their own expected retail value.",
);

export const auctionFeedProvider = new UnconfiguredAuctionFeedProvider(
  "auction-feed",
  "Auction feed (Manheim / Copart / IAA class)",
  "Requires a credentialed auction API or a permitted data feed. No scraping, no CAPTCHA bypass.",
);

export const marketplaceProvider = new UnconfiguredAuctionFeedProvider(
  "marketplace-feed",
  "Marketplace feed (Facebook Marketplace class)",
  "Requires an approved platform API. Listings are entered manually or pasted as URLs today.",
);

export const lenderProvider = new UnconfiguredLenderProvider(
  "lender",
  "Lender rate quotes",
  "Requires a lender or aggregator agreement. The in-app financing tool is an estimator only and never an approval.",
);

/** Everything the admin integrations screen shows, with its real status. */
export function providerSummaries(): ProviderSummary[] {
  const rows: Array<{ key: string; label: string; availability: ProviderAvailability; requirement: string }> = [
    {
      key: "vin-decode",
      label: "VIN decoding (NHTSA vPIC)",
      availability: vinDecodeProvider.availability(),
      requirement: "Public US government API. No key required.",
    },
    {
      key: "gps",
      label: "GPS tracking (Traccar)",
      availability: gpsProvider.availability(),
      requirement: "Requires TRACCAR_BASE_URL and TRACCAR_API_TOKEN pointing at your Traccar server.",
    },
    {
      key: "vehicle-history",
      label: historyProvider.label,
      availability: historyProvider.availability(),
      requirement: historyProvider.requirement,
    },
    {
      key: "vehicle-valuation",
      label: valuationProvider.label,
      availability: valuationProvider.availability(),
      requirement: valuationProvider.requirement,
    },
    {
      key: "auction-feed",
      label: auctionFeedProvider.label,
      availability: auctionFeedProvider.availability(),
      requirement: auctionFeedProvider.requirement,
    },
    {
      key: "marketplace-feed",
      label: marketplaceProvider.label,
      availability: marketplaceProvider.availability(),
      requirement: marketplaceProvider.requirement,
    },
    {
      key: "lender",
      label: lenderProvider.label,
      availability: lenderProvider.availability(),
      requirement: lenderProvider.requirement,
    },
  ];
  return rows;
}
