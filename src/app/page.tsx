import Link from "next/link";
import type { Metadata } from "next";
import { getPublicDealerInfo, listPublicInventory } from "@/lib/public-catalog";
import { getPublicStrings } from "@/lib/i18n";
import { type PublicStrings } from "@/lib/i18n";
import {
  BENEFITS,
  BENEFIT_CTA_ACTION_KEY,
  BENEFIT_CTA_BODY_KEY,
  BENEFIT_CTA_ICON,
  BENEFIT_CTA_TITLE_KEY,
  BUYING_OPTIONS,
  HERO_ASSURANCE_KEYS,
  SECTION_IDS,
  STEPS,
  TRUST_POINTS,
} from "@/lib/i18n/public-content";
import { PublicNav } from "@/app/_components/PublicNav";
import { PublicFooter } from "@/app/_components/PublicFooter";
import { VehicleCard } from "@/app/_components/PublicVehicleCard";
import { NexoFamilyNote } from "@/app/_components/brand";
import { ArrowRight, Car, CheckCircle2, Mail, Phone } from "lucide-react";

/**
 * Nexo Auto — public homepage.
 *
 * Read this page top to bottom as the sales argument it is:
 *   1. what this is and one obvious next step (hero)
 *   2. why it is different (benefits)
 *   3. the actual cars (inventory preview — real data or an honest empty state)
 *   4. how the process works (four steps)
 *   5. how you can pay (cash / financing / guided structure / flexible paths)
 *   6. why to trust it (capabilities, not invented testimonials)
 *   7. what to do now (closing CTA)
 *
 * HONESTY RULES applied throughout: no fabricated counters, badges, reviews or
 * inventory; no claim of guaranteed approval; financing is always described as
 * an estimate. Every figure comes from `listPublicInventory`, which reads the
 * approved public views — the same boundary anonymous visitors use.
 *
 * BILINGUAL: this file holds no prose. Sections, their order, their icons and
 * their destinations come from `src/lib/i18n/public-content.ts`, and every
 * string comes from the dictionary for the request's language. A dealer's own
 * configured hero text is used in English only, because stored dealer copy is
 * not guest-translatable — the Spanish edition falls back to its own authored
 * hero rather than showing English text to a Spanish reader.
 *
 * The `#` links in the hero and nav are in-page anchors, so the primary
 * conversion path works with zero client-side JavaScript.
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
 * Landing content changes only when a car is listed or dealer settings change,
 * so this is cached for a few minutes instead of re-queried on every visit.
 * `getPublicStrings()` reads cookies, which keeps the render per-request anyway;
 * the inventory query is what this window actually protects.
 */
export const revalidate = 300;

/** Builds the hero copy, preferring the dealer's own English text when set. */
function heroCopy(s: PublicStrings, dealerHeadline?: string | null, dealerSubtext?: string | null) {
  const useDealerCopy = s.language === "en";
  return {
    headline:
      (useDealerCopy ? dealerHeadline?.trim() : null) || s.t("home.hero.headlineFallback"),
    subtext: (useDealerCopy ? dealerSubtext?.trim() : null) || s.t("home.hero.subtextFallback"),
  };
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [s, dealer, vehicles] = await Promise.all([
    getPublicStrings({ searchParam: params.lang ?? null }),
    getPublicDealerInfo(),
    listPublicInventory({ limit: 6 }),
  ]);

  const name = dealer?.name?.trim() || s.t("meta.siteName");
  const phone = dealer?.phone?.trim() || null;
  const email = dealer?.email?.trim() || null;

  const { headline, subtext } = heroCopy(s, dealer?.heroHeadline, dealer?.heroSubtext);
  const aboutText = s.language === "en" ? dealer?.aboutText?.trim() || null : null;
  const hasInventory = vehicles.length > 0;

  const telHref = phone ? `tel:${phone.replace(/[^+\d]/g, "")}` : null;
  const BenefitCtaIcon = BENEFIT_CTA_ICON;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans text-slate-900">
      <PublicNav dealerInfo={dealer} language={s.language} />

      <main className="flex-1">
        <h1 className="sr-only">{s.tc("a11y.srHeadline", { name })}</h1>

        {/* ---------------------------------------------------------------- */}
        {/* B. HERO                                                          */}
        {/* ---------------------------------------------------------------- */}
        <section className="brand-panel relative overflow-hidden">
          {/* Restrained depth: one soft accent wash, no illustration, no collage. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                "radial-gradient(60rem 30rem at 85% -10%, rgba(249,115,22,0.22), transparent 60%), radial-gradient(40rem 24rem at 0% 110%, rgba(255,255,255,0.06), transparent 65%)",
            }}
          />

          <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-16">
            <div className="max-w-3xl">
              <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-300">
                <Car className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{name}</span>
              </span>

              <h2 className="mt-5 text-3xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl">
                {headline}
              </h2>

              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 sm:mt-5 sm:text-base">{subtext}</p>

              {/* CTAs: full-width stacked on phones so both are thumb targets. */}
              <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:items-center">
                <Link
                  href="/inventory"
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 text-sm font-semibold text-white shadow-lg shadow-orange-950/20 transition-colors hover:bg-orange-500 sm:w-auto"
                >
                  <span>{s.t("home.hero.primaryCta")}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>

                <Link
                  href={`#${SECTION_IDS.howItWorks}`}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto"
                >
                  <span>{s.t("home.hero.secondaryCta")}</span>
                </Link>
              </div>

              {/* Capability statements, not invented metrics. */}
              <ul className="mt-7 flex flex-col gap-2 border-t border-white/10 pt-5 text-xs text-slate-300 sm:mt-9 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
                {HERO_ASSURANCE_KEYS.map((key) => (
                  <li key={key} className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-400" aria-hidden="true" />
                    <span>{s.t(key)}</span>
                  </li>
                ))}
              </ul>

              {(phone || email) && (
                <p className="mt-5 text-xs text-slate-400">
                  {s.t("home.hero.preferTalk")}{" "}
                  {phone && telHref && (
                    <a
                      href={telHref}
                      className="font-semibold text-white underline decoration-orange-500/60 underline-offset-4 transition-colors hover:text-orange-300"
                    >
                      {s.tc("home.hero.call", { phone })}
                    </a>
                  )}
                  {phone && email && <span aria-hidden="true"> · </span>}
                  {email && (
                    <a
                      href={`mailto:${email}`}
                      className="font-semibold text-white underline decoration-orange-500/60 underline-offset-4 transition-colors hover:text-orange-300"
                    >
                      {s.t("home.hero.email")}
                    </a>
                  )}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* C. VALUE PROPOSITIONS                                            */}
        {/* ---------------------------------------------------------------- */}
        <section id={SECTION_IDS.whyNexo} className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                {s.t("home.benefits.title")}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">{s.t("home.benefits.subtitle")}</p>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2 lg:grid-cols-3">
              {BENEFITS.map((benefit) => {
                const Icon = benefit.icon;
                return (
                  <div
                    key={benefit.titleKey}
                    className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 transition-colors hover:border-slate-300 hover:bg-white sm:p-6"
                  >
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-navy-900)] text-orange-400">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-base font-bold tracking-tight text-slate-900">{s.t(benefit.titleKey)}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.t(benefit.bodyKey)}</p>
                  </div>
                );
              })}

              {/* Fills the sixth grid cell on desktop with a concrete next step. */}
              <div className="rounded-2xl border border-orange-200 bg-orange-50/70 p-5 sm:p-6">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-600 text-white">
                  <BenefitCtaIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-bold tracking-tight text-slate-900">
                  {s.t(BENEFIT_CTA_TITLE_KEY)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{s.t(BENEFIT_CTA_BODY_KEY)}</p>
                <Link
                  href="/inventory"
                  className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  <span>{s.t(BENEFIT_CTA_ACTION_KEY)}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* D. FEATURED INVENTORY                                            */}
        {/* ---------------------------------------------------------------- */}
        <section id={SECTION_IDS.inventory} className="bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                  {s.t(hasInventory ? "home.inventory.titleWithStock" : "home.inventory.titleEmpty")}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
                  {s.t(hasInventory ? "home.inventory.bodyWithStock" : "home.inventory.bodyEmpty")}
                </p>
              </div>

              {hasInventory && (
                <Link
                  href="/inventory"
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50"
                >
                  <span>{s.t("home.inventory.viewAll")}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </div>

            {hasInventory ? (
              <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {vehicles.map((vehicle) => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} language={s.language} emphasis="featured" />
                ))}
              </div>
            ) : (
              /* Polished empty state: helpful, honest, and still converts. */
              <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-10">
                <div className="mx-auto max-w-xl text-center">
                  <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <Car className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-lg font-bold tracking-tight text-slate-900">
                    {s.t("home.inventory.empty.title")}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
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
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
                      >
                        <Mail className="h-4 w-4 text-orange-600" aria-hidden="true" />
                        <span>{s.t("home.inventory.empty.email")}</span>
                      </a>
                    )}
                    {!phone && !email && (
                      <Link
                        href="/inventory"
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
                      >
                        <span>{s.t("home.inventory.empty.recheck")}</span>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* E. HOW IT WORKS                                                  */}
        {/* ---------------------------------------------------------------- */}
        <section id={SECTION_IDS.howItWorks} className="border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="max-w-2xl">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-700">
                {s.t("home.steps.eyebrow")}
              </span>
              <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                {s.t("home.steps.title")}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">{s.t("home.steps.subtitle")}</p>
            </div>

            <ol className="mt-8 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li key={step.titleKey} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white font-mono text-sm font-extrabold text-slate-900 ring-1 ring-slate-200">
                        {index + 1}
                      </span>
                      <Icon className="h-5 w-5 text-orange-600" aria-hidden="true" />
                    </div>
                    <h3 className="mt-4 text-base font-bold tracking-tight text-slate-900">{s.t(step.titleKey)}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.t(step.bodyKey)}</p>
                  </li>
                );
              })}
            </ol>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/inventory"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
              >
                <span>{s.t("home.steps.cta")}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <p className="text-xs text-slate-500">{s.t("home.steps.note")}</p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* F. BUYING OPTIONS / FINANCING / FLEXIBILITY                      */}
        {/* ---------------------------------------------------------------- */}
        <section id={SECTION_IDS.buyingOptions} className="bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="max-w-2xl">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-700">
                {s.t("home.options.eyebrow")}
              </span>
              <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                {s.t("home.options.title")}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
                {s.t("home.options.subtitle")}
              </p>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2">
              {BUYING_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <div
                    key={option.titleKey}
                    className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[var(--brand-navy-800)]">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <h3 className="text-base font-bold tracking-tight text-slate-900">{s.t(option.titleKey)}</h3>
                    </div>

                    <p className="mt-3 text-sm leading-relaxed text-slate-600">{s.t(option.bodyKey)}</p>

                    <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                      {option.pointKeys.map((pointKey) => (
                        <li key={pointKey} className="flex items-start gap-2 text-xs text-slate-600">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-600" aria-hidden="true" />
                          <span>{s.t(pointKey)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            {/* Required honesty note. Kept visible, not buried in fine print. */}
            <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600">
              <span className="font-semibold text-slate-800">{s.t("home.options.disclaimerLabel")}</span>{" "}
              {s.t("home.options.disclaimer")}
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* G. TRUST                                                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="brand-panel">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="max-w-2xl">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-300">
                {s.t("home.trust.eyebrow")}
              </span>
              <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                {s.t("home.trust.title")}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">{s.t("home.trust.subtitle")}</p>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 sm:mt-10 sm:grid-cols-2">
              {TRUST_POINTS.map((point) => {
                const Icon = point.icon;
                return (
                  <div key={point.titleKey} className="flex gap-4">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-orange-400">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-base font-bold tracking-tight text-white">{s.t(point.titleKey)}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{s.t(point.bodyKey)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {aboutText && (
              <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
                  {s.tc("home.trust.aboutTitle", { name })}
                </h3>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-300">{aboutText}</p>
              </div>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* H. FINAL CTA                                                     */}
        {/* ---------------------------------------------------------------- */}
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center shadow-xs sm:p-12">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-700">
                {s.t("home.final.eyebrow")}
              </span>
              <h2 className="mx-auto mt-3 max-w-2xl text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                {s.t(hasInventory ? "home.final.titleWithStock" : "home.final.titleEmpty")}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">
                {s.t(hasInventory ? "home.final.bodyWithStock" : "home.final.bodyEmpty")}
              </p>

              <div className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
                <Link
                  href="/inventory"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
                >
                  <span>{s.t("home.final.browse")}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>

                {phone && telHref && (
                  <a
                    href={telHref}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
                  >
                    <Phone className="h-4 w-4 text-orange-600" aria-hidden="true" />
                    <span>{s.tc("home.final.call", { phone })}</span>
                  </a>
                )}

                {!phone && email && (
                  <a
                    href={`mailto:${email}`}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
                  >
                    <Mail className="h-4 w-4 text-orange-600" aria-hidden="true" />
                    <span>{s.tc("home.final.email", { name })}</span>
                  </a>
                )}
              </div>

              <div className="mt-7 flex justify-center border-t border-slate-200 pt-6">
                <NexoFamilyNote text={s.tc("brand.familyNote", { family: s.t("brand.familyName") })} />
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter dealerInfo={dealer} language={s.language} />
    </div>
  );
}
