import Link from "next/link";
import type { Metadata } from "next";
import { PUBLIC_INVENTORY_PAGE_SIZE, getPublicDealerInfo, listPublicInventory } from "@/lib/public-catalog";
import { getPublicStrings } from "@/lib/i18n";
import { PublicNav } from "@/app/_components/PublicNav";
import { PublicFooter } from "@/app/_components/PublicFooter";
import { VehicleCard } from "@/app/_components/PublicVehicleCard";
import { ArrowLeft, ArrowRight, Car, ChevronRight, Phone, Search } from "lucide-react";

/**
 * Public inventory catalog.
 *
 * Same design system and the same `VehicleCard` as the landing preview, so the
 * click-through from the homepage is continuous. The only difference is density:
 * this is the "see everything" surface, so it carries the search field and
 * pagination rather than marketing sections.
 *
 * Bilingual, and driven purely by the dictionary: the search placeholder, the
 * result counts, the empty states and the pagination controls are all
 * translated. The search input itself sends whatever the customer typed
 * straight to the database, so a Spanish speaker can search by make or model
 * exactly as they would in English.
 */

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string; lang?: string }>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const s = await getPublicStrings({ searchParam: params.lang ?? null });
  return {
    title: s.t("meta.inventory.title"),
    description: s.t("meta.inventory.description"),
    alternates: { canonical: "/inventory" },
  };
}

export const dynamic = "force-dynamic";

export default async function InventoryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const s = await getPublicStrings({ searchParam: params.lang ?? null });

  const search = typeof params.q === "string" && params.q.trim() !== "" ? params.q.trim().slice(0, 80) : undefined;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [vehicles, dealer] = await Promise.all([
    listPublicInventory({
      search,
      limit: PUBLIC_INVENTORY_PAGE_SIZE,
      offset: (page - 1) * PUBLIC_INVENTORY_PAGE_SIZE,
    }),
    getPublicDealerInfo(),
  ]);

  const name = dealer?.name?.trim() || s.t("meta.siteName");
  const phone = dealer?.phone?.trim() || null;
  const hasResults = vehicles.length > 0;
  const hasNextPage = vehicles.length === PUBLIC_INVENTORY_PAGE_SIZE;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans text-slate-900">
      <PublicNav dealerInfo={dealer} language={s.language} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-5">
          <ol className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <li>
              <Link href="/" className="transition-colors hover:text-orange-700">
                {s.t("inventory.breadcrumbHome")}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            </li>
            <li className="font-semibold text-slate-800">{s.t("inventory.breadcrumbCurrent")}</li>
          </ol>
        </nav>

        {/* Page header + search */}
        <div className="mb-7 flex flex-col gap-5 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              {s.t("inventory.title")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.tc("inventory.intro", { name })}</p>
          </div>

          <form method="get" action="/inventory" className="w-full lg:w-auto">
            {/* The language travels with the search so results stay in Spanish. */}
            {params.lang && <input type="hidden" name="lang" value={params.lang} />}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-72">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <label htmlFor="inventory-search" className="sr-only">
                  {s.t("inventory.searchLabel")}
                </label>
                <input
                  id="inventory-search"
                  type="search"
                  name="q"
                  defaultValue={search ?? ""}
                  placeholder={s.t("inventory.searchPlaceholder")}
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1"
                />
              </div>
              <button
                type="submit"
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
              >
                {s.t("inventory.searchAction")}
              </button>
            </div>
          </form>
        </div>

        {/* Results */}
        {hasResults ? (
          <>
            <p className="mb-4 text-xs text-slate-500" role="status">
              {search ? (
                s.tc("inventory.resultsMatching", { query: `“${search}”` })
              ) : (
                s.tn("inventory.resultsCount", vehicles.length)
              )}
            </p>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {vehicles.map((vehicle) => (
                <VehicleCard key={vehicle.id} vehicle={vehicle} language={s.language} />
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs sm:p-12">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <Car className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-lg font-bold tracking-tight text-slate-900">
              {search ? s.tc("inventory.empty.searchTitle", { query: `“${search}”` }) : s.t("inventory.empty.title")}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
              {s.t(search ? "inventory.empty.searchBody" : "inventory.empty.body")}
            </p>

            <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
              {search ? (
                <Link
                  href="/inventory"
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  <span>{s.t("inventory.empty.clearSearch")}</span>
                </Link>
              ) : (
                <Link
                  href="/"
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  <span>{s.t("inventory.empty.home")}</span>
                </Link>
              )}

              {phone && (
                <a
                  href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
                >
                  <Phone className="h-4 w-4 text-orange-600" aria-hidden="true" />
                  <span>{s.t("inventory.empty.askAboutUpcoming")}</span>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Pagination — only ever shows controls that lead somewhere. */}
        {(page > 1 || hasNextPage) && (
          <nav
            aria-label={s.t("inventory.paginationLabel")}
            className="mt-10 flex items-center justify-between gap-4 border-t border-slate-200 pt-6"
          >
            <div className="flex-1">
              {page > 1 && (
                <Link
                  href={`/inventory?${new URLSearchParams({
                    ...(search ? { q: search } : {}),
                    ...(params.lang ? { lang: params.lang } : {}),
                    page: String(page - 1),
                  })}`}
                  rel="prev"
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span>{s.t("inventory.previous")}</span>
                </Link>
              )}
            </div>

            <span className="font-mono text-xs text-slate-500">{s.tc("inventory.page", { page })}</span>

            <div className="flex flex-1 justify-end">
              {hasNextPage && (
                <Link
                  href={`/inventory?${new URLSearchParams({
                    ...(search ? { q: search } : {}),
                    ...(params.lang ? { lang: params.lang } : {}),
                    page: String(page + 1),
                  })}`}
                  rel="next"
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <span>{s.t("inventory.next")}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </div>
          </nav>
        )}
      </main>

      <PublicFooter dealerInfo={dealer} language={s.language} />
    </div>
  );
}
