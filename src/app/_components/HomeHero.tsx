import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { type PublicStrings } from "@/lib/i18n/catalog";
import { HERO_ASSURANCES, SECTION_IDS } from "@/lib/i18n/public-content";
import { RichHeading } from "@/app/_components/RichHeading";
import {
  NEXO_HERO_HEIGHT,
  NEXO_HERO_LOCAL,
  NEXO_HERO_WIDTH,
} from "@/app/_components/brand";

/**
 * The hero.
 *
 * COMPOSITION — the mockup's, and the reason the approved image works:
 * the artwork puts the vehicle on the RIGHT and leaves the LEFT genuinely
 * bright, so the real HTML headline, supporting copy and CTAs sit in that
 * negative space. The image is never covered by a navy scrim, never cropped
 * into a card, and never carries baked text — it is the background composition,
 * and everything readable here is live, selectable, translatable HTML.
 *
 * RESPONSIVE RECOMPOSITION — one image, two crops, no second artwork:
 *   ≥ lg   : image behind the copy, cropped to favour the car on the right.
 *   < lg   : copy on top, then the SAME image below cropped toward the vehicle
 *            (`object-[72%_50%]`), so the car stays dominant on a phone without
 *            shrinking the headline or hiding the car behind text.
 *
 * THEME — the left of the artwork is light in both modes, so the copy stays deep
 * navy and legible without a scrim. Dark mode tints the surrounding band and the
 * dividers rather than the photograph, keeping the vehicle's natural colour.
 *
 * LCP — this is the largest contentful element on the page, so it is eager,
 * high-priority and dimensioned to reserve its box (no layout shift).
 */
export function HomeHero({ s, ctaHref = "/inventory" }: { s: PublicStrings; ctaHref?: string }) {
  const heroAlt = s.t("a11y.heroImage");

  return (
    <section className="relative isolate overflow-hidden border-b border-slate-200/70 bg-white dark:border-white/10 dark:bg-[var(--brand-navy-950)]">
      {/* --- Desktop / tablet: the artwork is the section background --------- */}
      <div className="absolute inset-0 hidden lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={NEXO_HERO_LOCAL}
          alt=""
          aria-hidden="true"
          width={NEXO_HERO_WIDTH}
          height={NEXO_HERO_HEIGHT}
          // Above the fold and the LCP element: never lazy, always high priority.
          loading="eager"
          decoding="async"
          fetchPriority="high"
          // `object-right` keeps the SUV in frame and lets the copy own the left.
          className="h-full w-full object-cover object-right"
        />
        {/*
          A short, soft fade on the far left only — it extends the artwork's own
          negative space so long Spanish lines stay readable. It is a gradient,
          not a panel: the car and skyline remain fully visible.
        */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[64%] bg-gradient-to-r from-white via-white/90 to-transparent dark:from-[var(--brand-navy-950)] dark:via-[var(--brand-navy-950)]/90"
        />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-6 pb-8 pt-8 sm:gap-8 sm:pb-12 sm:pt-12 lg:grid-cols-12 lg:gap-8 lg:pb-16 lg:pt-14">
          {/* --- Copy column: the artwork's intended negative space --------- */}
          <div className="lg:col-span-6 xl:col-span-5">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-400">
              {s.t("home.hero.eyebrow")}
            </p>

            {/*
              The page's only H1. The artwork's H1 is this text; nothing is baked
              into the image, so it is translatable, selectable and indexable.
            */}
            <RichHeading
              as="h1"
              runs={s.rich("home.hero.headline")}
              className="mt-3 text-[2.1rem] font-extrabold leading-[1.06] tracking-tight text-[var(--brand-navy-900)] sm:text-5xl lg:text-[3.4rem] dark:text-white"
              emphasisClassName="text-orange-600 dark:text-orange-500"
            />

            <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
              {s.t("home.hero.subtext")}
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href={ctaHref}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span>{s.t("home.hero.primaryCta")}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>

              <Link
                href={`#${SECTION_IDS.journey}`}
                className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white/80 px-6 text-sm font-semibold text-[var(--brand-navy-900)] backdrop-blur-sm transition-colors hover:bg-white dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              >
                {s.t("home.hero.secondaryCta")}
              </Link>
            </div>

            {/* --- Exactly three compact credentials, as in the mockup ------ */}
            <ul className="mt-7 grid grid-cols-1 gap-x-5 gap-y-3 border-t border-slate-200/80 pt-5 sm:grid-cols-3 dark:border-white/10">
              {HERO_ASSURANCES.map((item) => (
                <li key={item.key} className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400">
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold leading-tight text-[var(--brand-navy-900)] dark:text-white">
                      {s.t(item.key)}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                      {s.t(item.bodyKey)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* --- Mobile / tablet: the SAME approved artwork, recomposed ----- */}
          <div className="lg:hidden">
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={NEXO_HERO_LOCAL}
                alt={heroAlt}
                width={NEXO_HERO_WIDTH}
                height={NEXO_HERO_HEIGHT}
                loading="eager"
                decoding="async"
                fetchPriority="high"
                // Cropped toward the vehicle so the car stays the subject on a phone.
                className="aspect-16/10 w-full object-cover object-[70%_50%]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
