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
 * The landing preview and the full catalog render the same card on purpose: a
 * visitor who clicks through from the homepage must land on a grid that looks
 * identical.
 *
 * PRIORITY ORDER (per the mockup): photo → name → price. The price is the second
 * loudest element on the card after the photograph, and the supporting facts are
 * one compact line. No paragraphs, no badge clutter.
 *
 * The whole card is one hit target via a stretched link, so a thumb anywhere on
 * the card opens the vehicle.
 *
 * LOCALIZATION: the request language arrives as a plain code — functions cannot
 * cross the server/client boundary — and the bundle is rebuilt here. Vehicle data
 * (year, make, model, trim, mileage, stock number, price) is never translated.
 */

interface VehicleCardProps {
  vehicle: PublicVehicleListing;
  language: Language;
  /** `featured` lifts the card slightly for above-the-fold previews. */
  emphasis?: "default" | "featured";
  /** Fixed width rail item for the mobile swipe strip. */
  rail?: boolean;
}

export function VehicleCard({ vehicle, language, emphasis = "default", rail = false }: VehicleCardProps) {
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

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl border transition-all surface-card ${
        rail ? "snap-item w-[78vw] max-w-[20rem] shrink-0 sm:w-[22rem]" : ""
      } ${
        emphasis === "featured"
          ? "hover:-translate-y-0.5 hover:shadow-lg"
          : "hover:shadow-md"
      }`}
    >
      {/* Photo — the card's dominant element */}
      <div className="relative aspect-16/10 w-full overflow-hidden border-b border-slate-100 bg-slate-100 dark:border-white/10 dark:bg-slate-800">
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
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-100 to-slate-200 p-5 text-center dark:from-slate-800 dark:to-slate-900">
            <Car className="h-9 w-9 text-slate-400" aria-hidden="true" />
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{fullTitle}</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{s.t("card.noPhoto")}</span>
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

      {/* Identity + price */}
      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div className="space-y-1">
          <h3 className="text-base font-bold leading-snug tracking-tight text-[var(--brand-navy-900)] sm:text-[17px] dark:text-white">
            {fullTitle}
          </h3>
          {/* One compact fact line: mileage and stock, nothing more. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-slate-500 sm:text-xs dark:text-slate-400">
            <span>{mileage}</span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
              •
            </span>
            <span>{s.tc("spec.stockNumber", { stock: vehicle.stockNumber })}</span>
          </p>
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-slate-100 pt-3 dark:border-white/10">
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {s.t("card.askingPrice")}
            </span>
            <span className="block font-mono text-2xl font-extrabold leading-tight text-[var(--brand-navy-900)] dark:text-white">
              {price}
            </span>
          </div>

          <span className="inline-flex items-center gap-1 rounded-lg bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-700 transition-colors group-hover:bg-orange-100 dark:bg-orange-500/15 dark:text-orange-400 dark:group-hover:bg-orange-500/25">
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
