import Link from "next/link";
import { type PublicStrings } from "@/lib/i18n/catalog";
import { type PublicDealerInfo, type PublicVehicleListing } from "@/lib/public-catalog";
import { SECTION_IDS } from "@/lib/i18n/public-content";
import { VehicleCard } from "@/app/_components/PublicVehicleCard";
import { SectionIntro } from "@/app/_components/HomeSection";
import { Reveal } from "@/app/_components/Reveal";
import { ArrowRight, Car, Mail, Phone } from "lucide-react";

/**
 * INVENTORY — the showroom floor.
 *
 * This is the section the whole page is built around, so it is deliberately not
 * a row of three equal boxes. On desktop the newest vehicle is presented as a
 * featured car at roughly twice the visual weight, and the two beside it are
 * horizontal cards stacked in the remaining column. The result is a real
 * hierarchy — one car leads, two support it — which is how a showroom actually
 * reads, and it is what stops the section looking like a database query.
 *
 * RESPONSIVE COMPOSITION
 *   < sm   : a one-at-a-time swipe rail, so the photograph and price are
 *            readable on a phone without shrinking either.
 *   sm–lg  : the featured car full width, the supporting cars stacked below it
 *            at full width (the same row geometry, just wider).
 *   ≥ lg   : 7/12 featured beside a 5/12 column, giving the section its
 *            asymmetry.
 *
 * The number of vehicles is whatever the public catalog returns — the layout
 * adapts to one, two or three without inventing a card, and when there is room
 * left over it is filled with a real destination instead of padding.
 */
export function HomeInventory({
  s,
  vehicles,
  dealer,
}: {
  s: PublicStrings;
  vehicles: PublicVehicleListing[];
  dealer: PublicDealerInfo | null;
}) {
  const hasInventory = vehicles.length > 0;
  const [featured, ...supporting] = vehicles;

  const phone = dealer?.phone?.trim() || null;
  const email = dealer?.email?.trim() || null;
  const telHref = phone ? `tel:${phone.replace(/[^+\d]/g, "")}` : null;
  const name = dealer?.name?.trim() || s.t("meta.siteName");

  return (
    <section
      id={SECTION_IDS.inventory}
      aria-labelledby="home-inventory-heading"
      className="border-b border-slate-200/70 dark:border-white/10"
    >
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <Reveal className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <SectionIntro
            index="01"
            label={s.t("home.inventory.eyebrow")}
            title={s.t("home.inventory.title")}
            titleId="home-inventory-heading"
            titleClassName="max-w-2xl"
            body={s.t("home.inventory.subtitle")}
          />

          {hasInventory && (
            <Link
              href="/inventory"
              className="group/all inline-flex h-11 shrink-0 items-center gap-1.5 self-start rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-[var(--brand-navy-900)] transition-colors hover:border-slate-400 hover:bg-slate-50 dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
            >
              <span>{s.t("home.inventory.viewAll")}</span>
              <ArrowRight
                className="motion-nudge h-4 w-4 transition-transform duration-300 group-hover/all:translate-x-1"
                aria-hidden="true"
              />
            </Link>
          )}
        </Reveal>

        {hasInventory ? (
          <>
            {/* --- Phone: one car at a time, snap-aligned ------------------- */}
            <div className="mt-8 sm:hidden">
              <ul className="snap-rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
                {vehicles.map((vehicle) => (
                  <li key={vehicle.id} className="flex">
                    <VehicleCard vehicle={vehicle} language={s.language} rail emphasis="featured" />
                  </li>
                ))}
              </ul>
            </div>

            {/* --- Tablet and up: featured car, then its supporters -------- */}
            <div className="mt-8 hidden gap-5 sm:grid sm:grid-cols-2 lg:grid-cols-12">
              {featured && (
                <Reveal className="sm:col-span-2 lg:col-span-7">
                  <VehicleCard vehicle={featured} language={s.language} emphasis="featured" />
                </Reveal>
              )}

              <div className="flex flex-col gap-5 sm:col-span-2 lg:col-span-5">
                {supporting.map((vehicle, index) => (
                  <Reveal key={vehicle.id} delay={90 + index * 80} className="flex-1">
                    <VehicleCard vehicle={vehicle} language={s.language} layout="row" />
                  </Reveal>
                ))}

                {/*
                  The column is only ever short when the catalog itself is short,
                  so this is a real link rather than an empty gap. It is never a
                  fourth invented vehicle.
                */}
                {supporting.length < 2 && (
                  <Reveal delay={90 + supporting.length * 80} className="flex-1">
                    <Link
                      href="/inventory"
                      className="group/all flex h-full min-h-[132px] flex-col justify-between rounded-[22px] border border-dashed border-slate-300 bg-white/70 p-5 transition-colors hover:border-orange-400 hover:bg-white dark:border-white/20 dark:bg-white/[0.03] dark:hover:border-orange-500/60"
                    >
                      <div>
                        <h3 className="text-base font-bold tracking-tight text-[var(--brand-navy-900)] dark:text-white">
                          {s.t("home.inventory.browseAllTitle")}
                        </h3>
                        <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                          {s.t("home.inventory.browseAllBody")}
                        </p>
                      </div>
                      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-700 dark:text-orange-400">
                        <span>{s.t("home.inventory.viewAll")}</span>
                        <ArrowRight
                          className="motion-nudge h-4 w-4 transition-transform duration-300 group-hover/all:translate-x-1"
                          aria-hidden="true"
                        />
                      </span>
                    </Link>
                  </Reveal>
                )}
              </div>
            </div>
          </>
        ) : (
          <EmptyInventory s={s} phone={phone} telHref={telHref} email={email} name={name} />
        )}
      </div>
    </section>
  );
}

/**
 * What the inventory section occupies while the catalog read is in flight.
 *
 * It is a RESERVED LAYOUT, not a loading animation: the section has the same
 * box, padding and card geometry as the real thing, so when the cars stream in
 * nothing below them moves. There is no shimmer, no spinner and no client
 * JavaScript — a skeleton that costs frames to render would defeat the point on
 * the phones this is meant to help.
 *
 * It carries no heading and no `id`, deliberately: React streams the resolved
 * section alongside the placeholder, and a duplicated `id` (or a duplicated
 * `aria-labelledby` target) would be worse than a moment of empty space. The
 * section is also below the fold on every viewport, so it is `aria-hidden`
 * decoration rather than something to announce.
 */
export function HomeInventoryPlaceholder() {
  return (
    <section aria-hidden="true" className="border-b border-slate-200/70 dark:border-white/10">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <div className="h-[188px] sm:h-[224px]" />
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-12">
          <div className="h-[320px] rounded-[26px] surface-subtle sm:col-span-2 lg:col-span-7 lg:h-[430px]" />
          <div className="flex flex-col gap-5 sm:col-span-2 lg:col-span-5">
            <div className="h-[120px] flex-1 rounded-[22px] surface-subtle" />
            <div className="h-[120px] flex-1 rounded-[22px] surface-subtle" />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Honest, helpful empty inventory state — never fake cars. */
function EmptyInventory({
  s,
  phone,
  telHref,
  email,
  name,
}: {
  s: PublicStrings;
  phone: string | null;
  telHref: string | null;
  email: string | null;
  name: string;
}) {
  return (
    <Reveal className="mt-8">
      <div className="rounded-[22px] p-6 text-center surface-plate sm:p-10">
        <div className="mx-auto max-w-xl">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300">
            <Car className="h-6 w-6" aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-lg font-bold tracking-tight text-[var(--brand-navy-900)] dark:text-white">
            {s.t("home.inventory.empty.title")}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {s.t("home.inventory.empty.body")}
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            {phone && telHref && (
              <a
                href={telHref}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                <span>{s.tc("home.inventory.empty.call", { phone })}</span>
              </a>
            )}
            {email && (
              <a
                href={`mailto:${email}?subject=${encodeURIComponent(
                  s.tc("home.inventory.empty.mailSubject", { name }),
                )}`}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-[var(--brand-navy-900)] transition-colors hover:bg-slate-50 dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              >
                <Mail className="h-4 w-4 text-orange-600 dark:text-orange-400" aria-hidden="true" />
                <span>{s.t("home.inventory.empty.email")}</span>
              </a>
            )}
            {!phone && !email && (
              <Link
                href="/inventory"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-[var(--brand-navy-900)] transition-colors hover:bg-slate-50 dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              >
                {s.t("home.inventory.empty.recheck")}
              </Link>
            )}
          </div>
        </div>
      </div>
    </Reveal>
  );
}
