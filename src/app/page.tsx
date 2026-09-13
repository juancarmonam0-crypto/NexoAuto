import type { Metadata } from "next";
import { Suspense } from "react";
import { getPublicStrings } from "@/lib/i18n";
import { type PublicStrings } from "@/lib/i18n/catalog";
import { type PublicDealerInfo } from "@/lib/public-catalog";
import { getCachedDealerInfo, getCachedFeaturedInventory } from "@/lib/public-data";
import { PublicNav } from "@/app/_components/PublicNav";
import { PublicFooter } from "@/app/_components/PublicFooter";
import { HomeHero } from "@/app/_components/HomeHero";
import { HomeInventory, HomeInventoryPlaceholder } from "@/app/_components/HomeInventory";
import { HomeJourney } from "@/app/_components/HomeJourney";
import { HomeBuyingOptions } from "@/app/_components/HomeBuyingOptions";
import { HomeFamily } from "@/app/_components/HomeFamily";
import { HomeClosing } from "@/app/_components/HomeClosing";

/**
 * Nexo Auto — public homepage.
 *
 * SECTION ORDER IS THE SALES ARGUMENT:
 *
 *   1. HERO            approved artwork + HTML copy in its negative space
 *   2. INVENTORY       real cars almost immediately — this is a dealership
 *   3. ROUTE           four stops, drawn as one connected journey
 *   4. BUYING OPTIONS  navy ledger: the four ways you can pay
 *   5. NEXO FAMILY     the brand story, kept factual, no action
 *   6. CLOSING         the page's conclusion and its two real actions
 *   7. FOOTER          substantial and dark
 *
 * ART DIRECTION — one page, six different visual grammars. Each section is
 * composed differently on purpose (photographic editorial grid → connected
 * route → numbered ledger → brand plate → floating closing panel) so that the
 * page reads as a single art-directed experience rather than the same card grid
 * repeated at intervals. What ties them together is the section marker system in
 * `HomeSection.tsx`, one accent colour, and light/dark surfaces that alternate
 * white → canvas → white → navy → canvas.
 *
 * MOTION — a single vocabulary, implemented once in `Reveal.tsx` and in the
 * hero's pure-CSS entrance: content arrives as it enters the viewport, the route
 * draws itself, and hover moves things by a few pixels. Nothing bounces, nothing
 * parallaxes, and `prefers-reduced-motion` removes all of it. The largest
 * contentful paint — the hero artwork — is never animated.
 *
 * HONESTY RULES applied throughout: no fabricated counters, badges, reviews or
 * inventory; no claim of guaranteed approval; financing is always described as an
 * estimate; no inspection, warranty or quality claim the product cannot evidence.
 * Every figure comes from `listPublicInventory`, which reads the approved public
 * views — the same boundary anonymous visitors use.
 *
 * The hero artwork is a marketing composition and does NOT depict the actual
 * featured inventory, so no specification card is attached to it. Real vehicles
 * are shown in the inventory section, where their own photographs belong. The
 * closing panel reuses the same artwork as a bookend, heavily treated, and also
 * makes no claim about a specific vehicle.
 *
 * BILINGUAL: this file holds no prose. Every string comes from the dictionary for
 * the request's language.
 */

interface PageProps {
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const s = await getPublicStrings({ searchParam: params.lang ?? null });
  return {
    title: s.t("meta.home.title"),
    description: s.t("meta.home.description"),
    alternates: { canonical: "/" },
  };
}

/**
 * RENDERING AND CACHING — what actually happens on a request.
 *
 * This route cannot be statically prerendered, and no configuration will change
 * that: the root layout resolves the visitor's language from a cookie and an
 * `Accept-Language` header so `<html lang>` is correct before first paint, and
 * reading those makes the render per-request. That was already true before this
 * change — which is why the `revalidate = 300` this file used to declare did
 * nothing at all, and why every response measured
 * `Cache-Control: private, no-cache, no-store`.
 *
 * So the work was moved instead of the route:
 *
 *   - the dealership identity comes from `getCachedDealerInfo()`, a 30s cached
 *     read, so the shell no longer opens a database round trip on the first
 *     paint path;
 *   - the featured cars are read inside their own `Suspense` boundary, so the
 *     header, hero, copy and calls to action are flushed to the browser BEFORE
 *     the catalog is asked for anything. The visitor never waits on inventory to
 *     see the brand.
 *
 * The freshness policy lives in `src/lib/public-data.ts`. The vehicle detail
 * page remains fully dynamic, so opening a car always shows its current state.
 */
export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Only what the shell itself renders: the strings and the dealer identity.
  const [s, dealer] = await Promise.all([
    getPublicStrings({ searchParam: params.lang ?? null }),
    getCachedDealerInfo(),
  ]);

  const name = dealer?.name?.trim() || s.t("meta.siteName");
  const phone = dealer?.phone?.trim() || null;
  const email = dealer?.email?.trim() || null;

  return (
    <div className="flex min-h-screen flex-col surface-page">
      <PublicNav dealerInfo={dealer} language={s.language} />

      <main className="flex-1">
        {/* 1. HERO — approved artwork, live HTML copy. Flushed with the shell. */}
        <HomeHero s={s} />

        {/* 2. INVENTORY — the page's only catalog read, streamed in place. */}
        <Suspense fallback={<HomeInventoryPlaceholder />}>
          <FeaturedInventory s={s} dealer={dealer} />
        </Suspense>

        {/* 3–6. Everything else is static copy and never waits on data. */}
        <HomeJourney s={s} />
        <HomeBuyingOptions s={s} />
        <HomeFamily s={s} name={name} />
        <HomeClosing s={s} phone={phone} email={email} name={name} />
      </main>

      <PublicFooter dealerInfo={dealer} language={s.language} />
    </div>
  );
}

/**
 * The featured cars.
 *
 * Deliberately its own async component: a `Suspense` boundary can only stream
 * past an `await` that happens INSIDE it. Awaiting the catalog in `HomePage`
 * would hold the entire document — hero included — until the database answered.
 *
 * Exactly three: one featured car beside two supporting ones is the composition
 * the desktop inventory is designed around. The catalog carries the rest.
 */
async function FeaturedInventory({ s, dealer }: { s: PublicStrings; dealer: PublicDealerInfo | null }) {
  const vehicles = await getCachedFeaturedInventory(3);
  return <HomeInventory s={s} vehicles={vehicles} dealer={dealer} />;
}
