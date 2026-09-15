import Link from "next/link";
import { formatCents } from "@/lib/money";
import { type PublicVehicleListing } from "@/lib/public-catalog";
import { ArrowRight, Car } from "lucide-react";
import { strings, type Language } from "@/lib/i18n/catalog";
import { VehiclePhoto } from "@/app/_components/VehiclePhoto";

/**
 * The single public vehicle card.
 *
 * The landing preview and the full catalog render the same card on purpose: a
 * visitor who clicks through from the homepage must land on a grid that looks
 * like the same brand.
 *
 * PRIORITY ORDER: photo → name → price. The photograph owns the top of the
 * card and is never washed out; the price is the second loudest element after
 * it; the supporting facts are one compact monospace line. No paragraphs, no
 * badge clutter.
 *
 * TWO GEOMETRIES, ONE CARD
 *   `stack` (default) — photograph above, identity below. The catalog grid and
 *          the mobile rail use this.
 *   `row`  — photograph on the left, identity on the right. The landing's
 *          desktop inventory uses it for the two supporting vehicles beside the
 *          featured one, which is what stops the section reading as three
 *          identical boxes.
 *
 * MICROINTERACTION — four things happen on hover, all of them restrained: the
 * card lifts 3px, an orange hairline draws across its top edge (Nexo's accent,
 * used here rather than a coloured border), the photograph settles in by 4%,
 * and the "View" chip fills with orange. Every one of those is disabled under
 * `prefers-reduced-motion`.
 *
 * The whole card is one hit target via a stretched link, so a thumb anywhere on
 * the card opens the vehicle, and there are no nested interactive elements.
 *
 * SERVER RENDERED
 * The card is a Server Component. Its only stateful behaviour — falling back
 * when a photograph fails to load — lives in `VehiclePhoto`, which keeps the
 * bilingual dictionary, the icons and the price formatting off the client
 * entirely. That is what removes ~15 KB of JavaScript from the landing page and
 * a hydration pass per card.
 *
 * LOCALIZATION: the request language arrives as a plain code and the bundle is
 * built here, on the server. Vehicle data (year, make, model, trim, mileage,
 * stock number, price) is never translated.
 */

interface VehicleCardProps {
  vehicle: PublicVehicleListing;
  language: Language;
  /** `featured` enlarges the card for the landing page's hero vehicle. */
  emphasis?: "default" | "featured";
  /** Fixed width rail item for the mobile swipe strip. */
  rail?: boolean;
  /** Photograph above the details (`stack`) or beside them (`row`). */
  layout?: "stack" | "row";
}

export function VehicleCard({
  vehicle,
  language,
  emphasis = "default",
  rail = false,
  layout = "stack",
}: VehicleCardProps) {
  const s = strings(language);

  // Authoritative vehicle data — identical in both languages.
  const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  const fullTitle = vehicle.trim ? `${title} ${vehicle.trim}` : title;
  const price = formatCents(vehicle.askingPriceCents);
  const mileage = s.tc("spec.miles", { count: s.n(vehicle.mileage) });

  const isReserved = vehicle.availability === "RESERVED";
  const isDemo = vehicle.dataOrigin === "DEMO";
  const showPhoto = Boolean(vehicle.primaryPhotoUrl);

  const isRow = layout === "row";
  const isFeatured = emphasis === "featured";
  const radius = isFeatured ? "rounded-[30px]" : "rounded-[26px]";

  return (
    <article
      className={`group relative flex overflow-hidden surface-plate plate-hover ${radius} ${
        // `h-full` only for the horizontal card: it is placed in a column that
        // stretches to the featured car's height, and a card that stopped short
        // of its column would leave a visible gap beside the hero vehicle.
        isRow ? "h-full flex-row" : "flex-col"
      } ${rail ? "snap-item w-[78vw] max-w-[20rem] shrink-0 sm:w-[22rem]" : ""}`}
    >
      {/* The orange edge: Nexo's accent, drawn on approach. Decorative only. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[3px] w-0 bg-orange-600 transition-[width] duration-500 ease-out group-focus-within:w-full group-hover:w-full"
      />

      {/* --- Photograph: the card's dominant element --------------------- */}
      <div
        className={`photo-depth relative overflow-hidden bg-slate-100 dark:bg-slate-800 ${
          isRow ? "min-h-[172px] w-[42%] shrink-0" : "aspect-16/10 w-full"
        }`}
      >
        {showPhoto ? (
          <VehiclePhoto
            src={vehicle.primaryPhotoUrl as string}
            alt={s.tc("card.photoAlt", { vehicle: fullTitle })}
            className={`photo-zoom h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] ${
              isRow ? "object-[62%_50%]" : "object-center"
            }`}
          >
            {/* No invented imagery: an honest, quiet placeholder. */}
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-100 to-slate-200 p-5 text-center dark:from-slate-800 dark:to-slate-900">
              <Car className="h-8 w-8 text-slate-400" aria-hidden="true" />
              <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {s.t("card.noPhoto")}
              </span>
            </div>
          </VehiclePhoto>
        ) : (
          /* No photograph on the listing at all. */
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-100 to-slate-200 p-5 text-center dark:from-slate-800 dark:to-slate-900">
            <Car className="h-8 w-8 text-slate-400" aria-hidden="true" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {s.t("card.noPhoto")}
            </span>
          </div>
        )}

        {/*
          Availability is real catalog state, so it is stated — but it is a
          label, not a headline. Reserved and demo are the states a buyer must
          not miss, so they get the solid treatment; available is quiet.
        */}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider shadow-sm ${
              isReserved ? "bg-amber-400 text-amber-950" : "bg-white/95 text-slate-600"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${isReserved ? "bg-amber-900" : "bg-emerald-500"}`}
            />
            {isReserved ? s.t("status.reserved") : s.t("status.available")}
          </span>

          {isDemo && (
            /* orange-700 rather than the button's orange-600: this label is
               small text, so it needs the darker shade to stay readable. */
            <span className="inline-flex items-center rounded-full bg-orange-700 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
              {s.t("status.demo")}
            </span>
          )}
        </div>
      </div>

      {/* --- Identity + price -------------------------------------------- */}
      <div className={`flex flex-1 flex-col ${isRow ? "gap-3 p-5" : "gap-3 p-4 sm:p-5"}`}>
        <div className="space-y-1">
          <h3
            className={`font-bold leading-snug tracking-tight text-[var(--brand-navy-900)] dark:text-white ${
              isFeatured ? "text-lg sm:text-xl" : "text-base sm:text-[17px]"
            }`}
          >
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
            <span
              className={`block font-mono font-extrabold leading-tight tabular-nums text-[var(--brand-navy-900)] dark:text-white ${
                isFeatured ? "text-[27px]" : "text-2xl"
              }`}
            >
              {price}
            </span>
          </div>

          <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition-colors group-hover:border-orange-600 group-hover:bg-orange-600 group-hover:text-white dark:border-orange-500/30 dark:bg-orange-500/15 dark:text-orange-400 dark:group-hover:bg-orange-600 dark:group-hover:text-white">
            <span>{s.t("card.explore")}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
      </div>

      {/*
        Stretched link: one accessible name for the whole card, no nested
        interactive elements, and a focus ring that wraps the card.

        `prefetch={true}` is intentional. Vehicle detail is dynamic, so the
        default App Router policy would wait for a server render on click. Nexo
        Auto has a deliberately small inventory; fully prefetching visible car
        details trades a handful of background reads for near-instant taps.
      */}
      <Link
        href={`/inventory/${vehicle.id}`}
        prefetch={true}
        className={`absolute inset-0 ${radius} focus-visible:outline-2 focus-visible:outline-offset-2`}
      >
        <span className="sr-only">
          {s.tc("card.viewAction", { vehicle: fullTitle, stock: vehicle.stockNumber, price })}
        </span>
      </Link>
    </article>
  );
}
