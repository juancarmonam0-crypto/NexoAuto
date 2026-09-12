import Link from "next/link";
import { formatCents } from "@/lib/money";
import { getPublicDealerInfo, listPublicInventory } from "@/lib/public-catalog";
import { PublicNav } from "@/app/_components/PublicNav";
import { PublicFooter } from "@/app/_components/PublicFooter";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { ArrowRight, Car, Phone, Mail, Shield, CheckCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [dealer, vehicles] = await Promise.all([
    getPublicDealerInfo(),
    listPublicInventory({ limit: 6 }),
  ]);

  const name = dealer?.name ?? "Nexo Auto";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-orange-500 selection:text-white">
      <PublicNav />

      <main className="flex-1">
        {/* Compact Automotive Hero */}
        <section className="bg-white border-b border-slate-200 py-8 sm:py-12">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="max-w-2xl space-y-3">
              <span className="text-xs font-bold font-mono uppercase text-orange-600 tracking-wider">
                {name}
              </span>
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                Fewer cars. Carefully selected.
              </h1>
              <p className="text-sm sm:text-base text-slate-600 font-normal leading-relaxed">
                {dealer?.heroSubtext?.trim() ||
                  "A focused inventory of available used vehicles with clear pricing and straightforward information."}
              </p>
              <div className="pt-1">
                <a
                  href="#inventory"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm transition-colors cursor-pointer"
                >
                  <span>View Inventory</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Inventory Section - Immediately Visible */}
        <section id="inventory" className="py-8 sm:py-12 max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
                Available Vehicles
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Current vehicles available to review.
              </p>
            </div>
          </div>

          {vehicles.length === 0 ? (
            /* Deliberate Zero-Inventory State */
            <div className="p-8 sm:p-12 text-center rounded-xl bg-white border border-slate-200 space-y-4 shadow-xs">
              <div className="w-12 h-12 rounded-full bg-slate-100 mx-auto flex items-center justify-center text-slate-400">
                <Car className="w-6 h-6 text-slate-500" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-base font-bold text-slate-900">New vehicles are being selected</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Inventory updates as new vehicles become available. Reach out to inquire about upcoming arrivals or specific requests.
                </p>
              </div>

              {(dealer?.phone || dealer?.email) && (
                <div className="pt-2 flex flex-wrap items-center justify-center gap-4 text-xs font-medium">
                  {dealer.phone && (
                    <a
                      href={`tel:${dealer.phone}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5 text-orange-600" />
                      <span>{dealer.phone}</span>
                    </a>
                  )}
                  {dealer.email && (
                    <a
                      href={`mailto:${dealer.email}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors"
                    >
                      <Mail className="w-3.5 h-3.5 text-orange-600" />
                      <span>{dealer.email}</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* High-Presence Vehicle Grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {vehicles.map((vehicle) => {
                const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

                return (
                  <div
                    key={vehicle.id}
                    className="group rounded-xl bg-white border border-slate-200 hover:border-slate-300 overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      {/* Vehicle Image */}
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
        </section>

        {/* Simple Trust & Overview Section */}
        <section className="bg-white border-t border-slate-200 py-10">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                  <Shield className="w-4 h-4 text-orange-600" />
                  <span>Focused Inventory</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  We intentionally keep inventory focused so each available vehicle is easy to review.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                  <CheckCircle className="w-4 h-4 text-orange-600" />
                  <span>Clear Pricing</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Available vehicle pricing is shown clearly on each listing.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                  <Car className="w-4 h-4 text-orange-600" />
                  <span>Direct Communication</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Review the vehicle details, then contact Nexo Auto when you are interested.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter dealerInfo={dealer} />
    </div>
  );
}
