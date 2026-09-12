import Link from "next/link";
import type { Metadata } from "next";
import { getPublicDealerInfo, listPublicInventory } from "@/lib/public-catalog";
import { getPublicStrings } from "@/lib/i18n";
import { type PublicStrings } from "@/lib/i18n/catalog";
import { BUYING_OPTIONS, JOURNEY_STEPS, SECTION_IDS } from "@/lib/i18n/public-content";
import { PublicNav } from "@/app/_components/PublicNav";
import { PublicFooter } from "@/app/_components/PublicFooter";
import { HomeHero } from "@/app/_components/HomeHero";
import { VehicleCard } from "@/app/_components/PublicVehicleCard";
import { RichHeading } from "@/app/_components/RichHeading";
import { NexoFamilyNote, NexoMark } from "@/app/_components/brand";
import { ArrowRight, Car, Mail, Phone, ShieldCheck } from "lucide-react";

/**
 * Nexo Auto — public homepage.
 *
 * SECTION ORDER IS THE SALES ARGUMENT, and it follows the approved mockup:
 *
 *   1. HERO            approved artwork + HTML copy in its negative space
 *   2. INVENTORY       real cars almost immediately — this is a dealership
 *   3. JOURNEY         four short steps, not six explainer cards
 *   4. BUYING OPTIONS  navy band: how you can pay
 *   5. NEXO FAMILY     the brand story, kept factual
 *   6. FOOTER          substantial and dark
 *
 * The previous six-card "why us" grid is gone deliberately: the mockup explains
 * the business in four one-line steps and spends the page on cars instead.
 *
 * HONESTY RULES applied throughout: no fabricated counters, badges, reviews or
 * inventory; no claim of guaranteed approval; financing is always described as an
 * estimate. Every figure comes from `listPublicInventory`, which reads the
 * approved public views — the same boundary anonymous visitors use.
 *
 * The hero artwork is a marketing composition and does NOT depict the actual
 * featured inventory, so no specification card is attached to it. Real vehicles
 * are shown in the inventory section, where their own photographs belong.
 *
 * BILINGUAL: this file holds no prose. Every string comes from the dictionary for
 * the request's language, and a dealer's own configured hero text is used in
 * English only — stored dealer copy is not guest-translatable.
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

/** Inventory and dealer settings change rarely; a short window keeps it fresh. */
export const revalidate = 300;

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [s, dealer, vehicles] = await Promise.all([
    getPublicStrings({ searchParam: params.lang ?? null }),
    getPublicDealerInfo(),
    // Exactly three, so the desktop preview is one clean row rather than a
    // three-plus-one grid with a gap. The catalog carries the rest.
    listPublicInventory({ limit: 3 }),
  ]);

  const name = dealer?.name?.trim() || s.t("meta.siteName");
  const phone = dealer?.phone?.trim() || null;
  const email = dealer?.email?.trim() || null;
  const telHref = phone ? `tel:${phone.replace(/[^+\d]/g, "")}` : null;
  const hasInventory = vehicles.length > 0;

  return (
    <div className="flex min-h-screen flex-col surface-page">
      <PublicNav dealerInfo={dealer} language={s.language} />

      <main className="flex-1">
        {/* ---------------------------------------------------------------- */}
        {/* 1. HERO — approved artwork, live HTML copy                       */}
        {/* ---------------------------------------------------------------- */}
        <HomeHero s={s} />

        {/* ---------------------------------------------------------------- */}
        {/* 2. INVENTORY — cars almost immediately                           */}
        {/* ---------------------------------------------------------------- */}
        <section id={SECTION_IDS.inventory} className="border-b border-slate-200/70 dark:border-white/10">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-400">
                  {s.t("home.inventory.eyebrow")}
                </p>
                <h2 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight text-[var(--brand-navy-900)] sm:text-3xl dark:text-white">
                  {s.t("home.inventory.title")}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {s.t("home.inventory.subtitle")}
                </p>
              </div>

              {hasInventory && (
                <Link
                  href="/inventory"
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 self-start rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-[var(--brand-navy-900)] transition-colors hover:bg-slate-50 dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                >
                  <span>{s.t("home.inventory.viewAll")}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </div>

            {hasInventory ? (
              <>
                {/*
                  Mobile: a natural swipe rail (one card at a time, snap-aligned) so
                  the photo and price read immediately on a phone.
                  Desktop: the same cards in a three-up grid.
                */}
                <div className="mt-7 sm:hidden">
                  <ul className="snap-rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
                    {vehicles.map((vehicle) => (
                      <li key={vehicle.id} className="flex">
                        <VehicleCard vehicle={vehicle} language={s.language} rail emphasis="featured" />
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-7 hidden gap-5 sm:grid sm:grid-cols-2 lg:grid-cols-3">
                  {vehicles.map((vehicle) => (
                    <VehicleCard key={vehicle.id} vehicle={vehicle} language={s.language} emphasis="featured" />
                  ))}
                </div>
              </>
            ) : (
              <EmptyInventory s={s} phone={phone} telHref={telHref} email={email} name={name} />
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 3. JOURNEY — four short steps                                    */}
        {/* ---------------------------------------------------------------- */}
        <section
          id={SECTION_IDS.journey}
          className="border-b border-slate-200/70 bg-white dark:border-white/10 dark:bg-[var(--brand-navy-900)]/40"
        >
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-400">
                {s.t("home.journey.eyebrow")}
              </p>
              <h2 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight text-[var(--brand-navy-900)] sm:text-3xl dark:text-white">
                {s.t("home.journey.title")}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {s.t("home.journey.subtitle")}
              </p>
            </div>

            <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {JOURNEY_STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li key={step.titleKey} className="relative rounded-2xl p-5 surface-card sm:p-6">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 font-mono text-sm font-extrabold text-orange-700 dark:bg-orange-500/15 dark:text-orange-400">
                        {index + 1}
                      </span>
                      <Icon className="h-5 w-5 text-[var(--brand-navy-700)] dark:text-slate-300" aria-hidden="true" />
                    </div>
                    <h3 className="mt-4 text-base font-bold tracking-tight text-[var(--brand-navy-900)] dark:text-white">
                      {s.t(step.titleKey)}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {s.t(step.bodyKey)}
                    </p>
                  </li>
                );
              })}
            </ol>

            <div className="mt-8">
              <Link
                href="/inventory"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
              >
                <span>{s.t("home.journey.cta")}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 4. BUYING OPTIONS — navy band                                    */}
        {/* ---------------------------------------------------------------- */}
        <section id={SECTION_IDS.buyingOptions} className="brand-panel">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-orange-300">
                {s.t("home.options.eyebrow")}
              </p>
              <RichHeading
                runs={s.rich("home.options.title")}
                className="mt-3 text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl"
                emphasisClassName="text-orange-400"
              />
              <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
                {s.t("home.options.subtitle")}
              </p>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {BUYING_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <div
                    key={option.titleKey}
                    className="rounded-2xl border border-white/10 bg-white/5 p-5 transition-colors hover:bg-white/10"
                  >
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/15 text-orange-400">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-base font-bold tracking-tight text-white">{s.t(option.titleKey)}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{s.t(option.bodyKey)}</p>
                  </div>
                );
              })}
            </div>

            {/* Required honesty note — present, but deliberately not dominant. */}
            <p className="mt-6 max-w-3xl text-[11px] leading-relaxed text-slate-400">
              <span className="font-semibold text-slate-300">{s.t("home.options.disclaimerLabel")}</span>{" "}
              {s.t("home.options.disclaimer")}
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 5. NEXO FAMILY — brand story                                     */}
        {/* ---------------------------------------------------------------- */}
        <section
          id={SECTION_IDS.family}
          className="border-b border-slate-200/70 bg-white dark:border-white/10 dark:bg-[var(--brand-navy-900)]/40"
        >
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
              <div className="lg:col-span-7">
                <p className="inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-400">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {s.t("home.family.eyebrow")}
                </p>

                <RichHeading
                  runs={s.rich("home.family.title")}
                  className="mt-4 text-2xl font-extrabold leading-tight tracking-tight text-[var(--brand-navy-900)] sm:text-4xl dark:text-white"
                  emphasisClassName="text-orange-600 dark:text-orange-500"
                />

                <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                  {s.t("home.family.body")}
                </p>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Link
                    href="/inventory"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
                  >
                    <span>{s.t("home.family.cta")}</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{s.t("home.family.note")}</p>
                </div>
              </div>

              {/*
                No second photograph is invented to fill this column, and the
                paragraph above is not repeated here. The composition is carried by
                layout and the approved brand mark, which keeps the section honest
                and avoids stock imagery.
              */}
              <div className="lg:col-span-5">
                <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-8 dark:border-white/10 dark:bg-[var(--brand-navy-900)]">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-orange-500/10 blur-2xl"
                  />
                  <div className="relative space-y-5">
                    <NexoFamilyBadge name={name} tagline={s.t("meta.tagline")} />
                    <NexoFamilyNote text={s.tc("brand.familyNote", { family: s.t("brand.familyName") })} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter dealerInfo={dealer} language={s.language} />
    </div>
  );
}

/** The brand mark block used in the family section. */
function NexoFamilyBadge({ name, tagline }: { name: string; tagline: string }) {
  return (
    <div className="flex items-center gap-3">
      <NexoMark size={40} className="rounded-[10px]" />
      <div className="flex flex-col leading-none">
        <span className="text-base font-extrabold tracking-tight text-[var(--brand-navy-900)] dark:text-white">
          {name.toUpperCase()}
        </span>
        <span className="mt-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
          {tagline}
        </span>
      </div>
    </div>
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
    <div className="mt-7 rounded-2xl p-6 text-center surface-card sm:p-10">
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
  );
}
