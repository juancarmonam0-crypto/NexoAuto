import Link from "next/link";
import type { Metadata } from "next";
import { formatCents } from "@/lib/money";
import { PUBLIC_INVENTORY_PAGE_SIZE, listPublicInventory } from "@/lib/public-catalog";
import { PublicNav } from "@/app/_components/PublicNav";
import { PublicFooter } from "@/app/_components/PublicFooter";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { Search, Car, ArrowRight, ArrowLeft, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Inventory · Nexo Auto" };

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function InventoryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = typeof params.q === "string" && params.q.trim() !== "" ? params.q.trim().slice(0, 80) : undefined;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const vehicles = await listPublicInventory({
    search,
    limit: PUBLIC_INVENTORY_PAGE_SIZE,
    offset: (page - 1) * PUBLIC_INVENTORY_PAGE_SIZE,
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-orange-500 selection:text-white">
      <PublicNav />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb & Header */}
        <div className="mb-6 space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <Link href="/" className="hover:text-orange-600 transition-colors">
              Home
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-800">Inventory</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                Vehicle Inventory
              </h1>
              <p className="text-slate-500 text-xs mt-0.5">
                Current selection of vehicles available for review.
              </p>
            </div>

            {/* Compact Search Form */}
            <form method="get" action="/inventory" className="flex items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  name="q"
                  aria-label="Search published inventory"
                  defaultValue={search ?? ""}
                  placeholder="Search make, model, VIN..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs transition-colors cursor-pointer shrink-0"
              >
                Search
              </button>
            </form>
          </div>
        </div>

        {/* Results Container */}
        {vehicles.length === 0 ? (
          <div className="p-8 sm:p-12 text-center rounded-xl bg-white border border-slate-200 space-y-3 my-6 shadow-xs">
            <div className="w-12 h-12 rounded-full bg-slate-100 mx-auto flex items-center justify-center text-slate-400">
              <Car className="w-6 h-6 text-slate-500" />
            </div>
            <h3 className="text-base font-bold text-slate-900">
              {search ? `No vehicles matching "${search}"` : "No vehicles currently listed"}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {search
                ? "Try searching for a different make or model, or view all inventory."
                : "Vehicles are added as they become ready for sale. Check back soon."}
            </p>
            {search && (
              <div className="pt-2">
                <Link
                  href="/inventory"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors"
                >
                  Clear Search
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {vehicles.map((vehicle) => {
              const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

              return (
                <div
                  key={vehicle.id}
                  className="group rounded-xl bg-white border border-slate-200 hover:border-slate-300 overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Photo */}
                    <div className="relative aspect-16/10 bg-slate-100 overflow-hidden flex items-center justify-center border-b border-slate-100">
                      {vehicle.primaryPhotoUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={vehicle.primaryPhotoUrl}
                          alt={title}
                          className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
                          <Car className="w-8 h-8 text-slate-300 mb-1" />
                          <span className="text-xs font-semibold text-slate-500">{title}</span>
                        </div>
                      )}
                      <div className="absolute top-2.5 right-2.5">
                        <StatusBadge
                          status={vehicle.availability === "RESERVED" ? "RESERVED" : "AVAILABLE"}
                          size="sm"
                        />
                      </div>
                    </div>

                    {/* Specs */}
                    <div className="p-4 space-y-2">
                      <div>
                        <h3 className="text-base font-bold text-slate-900 group-hover:text-orange-600 transition-colors">
                          {title}
                          {vehicle.trim ? ` ${vehicle.trim}` : ""}
                        </h3>
                        <div className="flex items-center gap-2 text-xs text-slate-500 font-mono mt-0.5">
                          <span>{vehicle.mileage.toLocaleString("en-US")} mi</span>
                          <span>•</span>
                          <span>{vehicle.exteriorColor || "Exterior N/A"}</span>
                          <span>•</span>
                          <span>Stock #{vehicle.stockNumber}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Price & Action */}
                  <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-500 font-mono uppercase block">Price</span>
                      <span className="text-base font-extrabold font-mono text-slate-900">
                        {formatCents(vehicle.askingPriceCents)}
                      </span>
                    </div>
                    <Link
                      href={`/inventory/${vehicle.id}`}
                      className="px-3.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1"
                    >
                      <span>View Vehicle</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination controls */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-200 text-xs">
          <div>
            {page > 1 ? (
              <Link
                href={`/inventory?${new URLSearchParams({
                  ...(search ? { q: search } : {}),
                  page: String(page - 1),
                })}`}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 font-medium text-slate-700 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </Link>
            ) : null}
          </div>

          <span className="font-mono text-slate-500">Page {page}</span>

          <div>
            {vehicles.length === PUBLIC_INVENTORY_PAGE_SIZE ? (
              <Link
                href={`/inventory?${new URLSearchParams({
                  ...(search ? { q: search } : {}),
                  page: String(page + 1),
                })}`}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 font-medium text-slate-700 transition-colors"
              >
                <span>Next</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            ) : null}
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
