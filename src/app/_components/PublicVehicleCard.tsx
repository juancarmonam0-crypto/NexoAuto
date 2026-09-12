"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/money";
import { type PublicVehicleListing } from "@/lib/public-catalog";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { ArrowRight, Car } from "lucide-react";
import { strings, type Language } from "@/lib/i18n/catalog";

/**
 * The single public vehicle card.
 *
 * The landing preview and the full inventory catalog render the same card on
 * purpose: a visitor who clicks through from the homepage must land on a grid
 * that looks identical, so the page never feels like it swapped systems.
 *
 * Interaction model: the whole card is one hit target via a stretched link, so
 * a thumb anywhere on the card opens the vehicle. That is also why the card is
 * a client component — one `onError` fallback for a broken photo URL is the only
 * state involved, and it keeps the marketing pages free of client-side data
 * fetching or animation libraries.
 *
 * LOCALIZATION: the request language arrives as a plain code — functions cannot
 * cross the server/client boundary — and the bundle is rebuilt here. Vehicle data
 * (year, make, model, trim, mileage, stock number, price) is never translated;
 * only the labels around it are. Mileage and price use the request locale's own
 * number formatting, so Spanish shows 68.000 in place of 68,000.
 */

interface VehicleCardProps {
  vehicle: PublicVehicleListing;
  language: Language;
  /** `featured` lifts the card slightly for above-the-fold previews. */
  emphasis?: "default" | "featured";
}

export function VehicleCard({ vehicle, language, emphasis = "default" }: VehicleCardProps) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const s = strings(language);

  // Authoritative vehicle data — identical in both languages.
  const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  const fullTitle = vehicle.trim ? `${title} ${vehicle.trim}` : title;
  const price = formatCents(vehicle.askingPriceCents);
  const mileage = s.tc("spec.miles", { count: s.n(vehicle.mileage) });

  const isReserved = vehicle.availability === "RESERVED";
  const isDemo = vehicle.dataOrigin === "DEMO";
  const showPhoto = Boolean(vehicle.primaryPhotoUrl) && !photoFailed;

  const secondaryFacts = [
    mileage,
    vehicle.exteriorColor || null,
    s.tc("spec.stockNumber", { stock: vehicle.stockNumber }),
  ].filter(Boolean) as string[];

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-white transition-all ${
        emphasis === "featured"
          ? "border-slate-200 shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
          : "border-slate-200 shadow-xs hover:border-slate-300 hover:shadow-md"
      }`}
    >
      {/* Photo */}
      <div className="relative aspect-16/10 w-full overflow-hidden border-b border-slate-100 bg-slate-100">
        {showPhoto ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={vehicle.primaryPhotoUrl as string}
            alt={s.tc("card.photoAlt", { vehicle: fullTitle })}
            loading="lazy"
            decoding="async"
            onError={() => setPhotoFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-100 to-slate-200 p-5 text-center">
            <Car className="h-9 w-9 text-slate-400" aria-hidden="true" />
            <span className="text-xs font-semibold text-slate-600">{fullTitle}</span>
            <span className="text-[11px] text-slate-500">{s.t("card.photosSoon")}</span>
          </div>
        )}

        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <StatusBadge
            status={isReserved ? "RESERVED" : "AVAILABLE"}
            label={isReserved ? s.t("status.reserved") : s.t("status.available")}
            size="sm"
          />
          {isDemo && <StatusBadge status="DEMO" label={s.t("status.demo")} size="sm" />}
        </div>
      </div>

      {/* Identity + facts */}
      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div className="space-y-1.5">
          <h3 className="text-base font-bold leading-snug tracking-tight text-slate-900 sm:text-[17px]">
            {fullTitle}
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-slate-500 sm:text-xs">
            {secondaryFacts.map((fact, index) => (
              <span key={fact} className="inline-flex items-center gap-2">
                {index > 0 && (
                  <span aria-hidden="true" className="text-slate-300">
                    •
                  </span>
                )}
                <span>{fact}</span>
              </span>
            ))}
          </p>
        </div>

        {/* Price reads as the card's second-strongest element after the title. */}
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
              {s.t("card.askingPrice")}
            </span>
            <span className="block font-mono text-xl font-extrabold leading-tight text-slate-900">{price}</span>
          </div>

          <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 transition-colors group-hover:text-orange-800">
            <span>{s.t("card.explore")}</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </div>
      </div>

      {/*
        Stretched link: one accessible name for the whole card, no nested
        interactive elements, and a focus ring that wraps the card.
      */}
      <Link
        href={`/inventory/${vehicle.id}`}
        className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span className="sr-only">
          {s.tc("card.viewAction", { vehicle: fullTitle, stock: vehicle.stockNumber, price })}
        </span>
      </Link>
    </article>
  );
}
