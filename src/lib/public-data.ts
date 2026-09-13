import { unstable_cache } from "next/cache";
import {
  getPublicDealerInfo,
  listPublicInventory,
  type PublicDealerInfo,
  type PublicVehicleListing,
} from "@/lib/public-catalog";

/**
 * PUBLIC DELIVERY CACHE — the storefront's read cache.
 *
 * WHAT THIS IS NOT
 * This module does not query anything. Every read below still goes through
 * `public-catalog.ts`, which owns the anonymous read boundary and reads the
 * approved public views. There is no second path to the database, and no
 * operator data passes through here.
 *
 * WHY IT EXISTS
 * Every public page used to open two Postgres round trips before it could send a
 * byte of HTML, on every single request, for data that changes a few times a
 * day. The homepage declared `revalidate = 300`, but because the root layout
 * resolves the visitor's language from a cookie the whole route renders per
 * request, so that declaration never had any effect: the responses measured
 * `Cache-Control: private, no-cache, no-store`. Caching the two landing reads
 * here is what actually takes the database off the first-paint path.
 *
 * FRESHNESS
 * `PUBLIC_DATA_REVALIDATE_SECONDS` is the whole freshness policy, and it is
 * deliberately much tighter than the 300s the homepage already declared as its
 * intent. The visible consequence of a stale hit is limited to AVAILABLE versus
 * RESERVED, and to which vehicles lead the landing grid; the vehicle detail page
 * stays fully dynamic, so a customer who opens a car always sees its current
 * state. A listing that is unpublished or sold can therefore linger on the
 * landing page for at most this window.
 *
 * WHERE THE DATES GO
 * The Next data cache stores values as JSON, so `Date` fields would come back as
 * strings. Rather than pretend otherwise, the cached callback converts them
 * explicitly and the wrapper converts them back, which keeps
 * `PublicVehicleListing` honest for its callers.
 */

/**
 * Freshness window for cached public reads. Short on purpose: this is the
 * maximum time a reservation or a newly published vehicle can be stale on the
 * landing page.
 */
export const PUBLIC_DATA_REVALIDATE_SECONDS = 30;

/** A listing as it survives the JSON data cache. */
type CachedListing = Omit<PublicVehicleListing, "dateListed" | "createdAt" | "updatedAt"> & {
  dateListed: string | null;
  createdAt: string;
  updatedAt: string;
};

function toCached(row: PublicVehicleListing): CachedListing {
  return {
    ...row,
    dateListed: row.dateListed ? row.dateListed.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Restores the Dates, and is a no-op for every other column. */
function fromCached(row: CachedListing): PublicVehicleListing {
  return {
    ...row,
    dateListed: row.dateListed ? new Date(row.dateListed) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

/**
 * The dealership identity. Reused by the header, the footer and the closing
 * panel, so it is the one read that sits in front of the very first byte.
 */
export const getCachedDealerInfo = unstable_cache(
  async (): Promise<PublicDealerInfo | null> => getPublicDealerInfo(),
  ["public-dealer-info"],
  { revalidate: PUBLIC_DATA_REVALIDATE_SECONDS },
);

/**
 * The landing page's featured vehicles.
 *
 * `limit` participates in the cache key automatically (the data cache keys on
 * the arguments), so a different page size can never be served another page
 * size's rows.
 */
const cachedFeaturedInventory = unstable_cache(
  async (count: number): Promise<CachedListing[]> => {
    const listings = await listPublicInventory({ limit: count });
    return listings.map(toCached);
  },
  ["public-featured-inventory"],
  { revalidate: PUBLIC_DATA_REVALIDATE_SECONDS },
);

export async function getCachedFeaturedInventory(limit = 3): Promise<PublicVehicleListing[]> {
  return (await cachedFeaturedInventory(limit)).map(fromCached);
}
